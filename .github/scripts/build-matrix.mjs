#!/usr/bin/env node
/**
 * AG-UI capability matrix generator.
 *
 * Reads the protocol repo's own dojo configuration and its own end-to-end suite, and writes:
 *   MATRIX.md            the full per-integration, per-capability grid
 *   matrix.csv           the same grid as data
 *   badges/*.json        shields endpoints, written by this run and never by hand
 *   README.md            the numbers between the <!-- matrix --> and <!-- capabilities --> markers
 *
 * Two sources, both inside ag-ui-protocol/ag-ui, both pinned to the commit this run read:
 *   apps/dojo/src/menu.ts            the file that calls itself the SINGLE SOURCE OF TRUTH for
 *                                    which capabilities each integration offers
 *   apps/dojo/e2e/tests/**           the specs that drive those cells in a browser
 *
 * Three states, never two. A capability is `declared`, `declared and disabled` (commented out in
 * the config, which is a deliberate off switch, not an omission), or absent. A spec is `resolved`
 * to an integration and capability, or it is `unresolved` and counted apart from both. A run that
 * cannot resolve more than 5% of specs, or that reads fewer integrations than the last run
 * committed, aborts instead of publishing a smaller truth.
 */
import fs from "node:fs";
import path from "node:path";

const REPO = "ag-ui-protocol/ag-ui";
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const LOCAL = process.env.AGUI_LOCAL_CLONE || null;
const OUT = process.env.OUT_DIR || process.cwd();
const UNRESOLVED_ABORT = 0.05;

const H = {
  "User-Agent": "awesome-ag-ui-matrix",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

let failures = 0;
async function api(url, raw = false) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: raw ? { ...H, Accept: "application/vnd.github.raw" } : H });
    if (r.status === 403 || r.status === 429) { await new Promise((s) => setTimeout(s, 5000)); continue; }
    if (!r.ok) return null;
    return raw ? r.text() : r.json();
  }
  failures++;
  return undefined; // third state: could not be read
}

async function readFile(p) {
  if (LOCAL) { try { return fs.readFileSync(path.join(LOCAL, p), "utf8"); } catch { return undefined; } }
  return api(`https://api.github.com/repos/${REPO}/contents/${p}`, true);
}

async function head() {
  if (LOCAL) return "local";
  const j = await api(`https://api.github.com/repos/${REPO}/commits/HEAD`);
  return j?.sha ?? "unknown";
}

// ---------------------------------------------------------------- parse the config

function parseFeatureList(block, known) {
  const on = [], off = [];
  for (const raw of block.replace(/[[\]]/g, "\n").split(/,|\n/)) {
    const t = raw.trim();
    let m = t.match(/^"([a-z0-9_]+)"$/);
    if (m && known.has(m[1])) { on.push(m[1]); continue; }
    m = t.match(/^\/\/\s*"([a-z0-9_]+)"$/);
    if (m && known.has(m[1])) off.push(m[1]);
  }
  return { on: [...new Set(on)], off: [...new Set(off)] };
}

async function loadConfig() {
  const [menu, crewai, types, config] = await Promise.all([
    readFile("apps/dojo/src/menu.ts"),
    readFile("apps/dojo/src/crewai.ts"),
    readFile("apps/dojo/src/types/integration.ts"),
    readFile("apps/dojo/src/config.ts"),
  ]);
  if (!menu || !types) throw new Error("could not read the dojo config; refusing to publish a partial matrix");

  const features = [...types.matchAll(/\|\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);
  const known = new Set(features);

  const labels = {};
  if (config) for (const m of config.matchAll(/id:\s*"([a-z0-9_]+)",\s*\n\s*name:\s*"([^"]+)"/g)) labels[m[1]] = m[2];

  const crewSet = (name) => {
    if (!crewai) return { on: [], off: [] };
    const m = crewai.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
    return m ? parseFeatureList(m[1], known) : { on: [], off: [] };
  };

  const body = menu.slice(menu.indexOf("export const menuIntegrations"));
  const integrations = [];
  const objRe = /\{\s*\n\s*id:\s*"([a-z0-9-]+)",\s*\n\s*name:\s*"([^"]+)",\s*\n\s*features:\s*(\[[\s\S]*?\]),?\s*\n\s*\},/g;
  for (const m of body.matchAll(objRe)) {
    const [, id, name, feat] = m;
    let r;
    if (/CREWAI_FLOW_FEATURES/.test(feat)) r = crewSet("CREWAI_FLOW_FEATURES");
    else if (/CREWAI_CONVERSATIONAL_FEATURES/.test(feat)) r = crewSet("CREWAI_CONVERSATIONAL_FEATURES");
    else r = parseFeatureList(feat, known);
    integrations.push({ id, name, declared: r.on, disabled: r.off });
  }
  const shelved = [...body.matchAll(/\/\/\s*\{[\s\S]{0,220}?\/\/\s*id:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
  return { features, labels, integrations, shelved };
}

// ---------------------------------------------------------------- parse the e2e suite

async function listSpecs() {
  if (LOCAL) {
    const root = path.join(LOCAL, "apps/dojo/e2e/tests");
    const out = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(spec|event-trace)\.ts$/.test(e.name)) out.push(path.relative(LOCAL, p));
      }
    })(root);
    return out;
  }
  const tree = await api(`https://api.github.com/repos/${REPO}/git/trees/HEAD?recursive=1`);
  if (!tree?.tree) throw new Error("could not read the repo tree; refusing to publish a partial matrix");
  return tree.tree.filter((n) => n.type === "blob" && n.path.startsWith("apps/dojo/e2e/tests/") && /\.(spec|event-trace)\.ts$/.test(n.path)).map((n) => n.path);
}

async function loadTested(known) {
  const specs = await listSpecs();
  const tested = {};
  const add = (i, f) => { (tested[i] ||= new Set()).add(f); };
  let unresolved = 0, unreadable = 0;
  for (const p of specs) {
    const s = await readFile(p);
    if (s === undefined) { unreadable++; continue; }
    if (!s) { unresolved++; continue; }
    let hit = false;
    // literal route: /<integration>/feature/<capability>
    for (const m of s.matchAll(/\/([a-z0-9-]+)\/feature\/([a-z0-9_]+)/g)) {
      if (known.has(m[2])) { add(m[1], m[2]); hit = true; }
    }
    // template route: `/${VAR}/feature/<capability>` or `/${VAR}/feature/${VAR2}`
    if (/\/feature\/(?:\$\{|[a-z_]*\$)/.test(s) || /\$\{[A-Za-z_]+\}\/feature\//.test(s)) {
      const idm = s.match(/(?:integrationId|INTEGRATION_ID)\s*=\s*"([a-z0-9-]+)"/);
      if (idm) {
        for (const m of s.matchAll(/\/feature\/([a-z0-9_]+)/g)) if (known.has(m[1])) { add(idm[1], m[1]); hit = true; }
        if (/\/feature\/\$\{/.test(s)) {
          for (const m of s.matchAll(/"([a-z0-9_]+)"/g)) if (known.has(m[1])) { add(idm[1], m[1]); hit = true; }
        }
      }
    }
    if (!hit) unresolved++;
  }
  return { tested, specCount: specs.length, unresolved, unreadable };
}

// ---------------------------------------------------------------- emit

const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;

function replaceBlock(text, name, body) {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(text)) throw new Error(`marker ${name} missing from README`);
  return text.replace(re, `$1\n${body}\n$2`);
}

const main = async () => {
  const sha = await head();
  const { features, labels, integrations, shelved } = await loadConfig();
  const known = new Set(features);
  const { tested, specCount, unresolved, unreadable } = await loadTested(known);

  if (specCount === 0) throw new Error("no e2e specs found; aborting rather than publishing zero coverage");
  const badRate = (unresolved + unreadable) / specCount;
  if (badRate > UNRESOLVED_ABORT) throw new Error(`${(badRate * 100).toFixed(1)}% of specs unresolved or unreadable, above the ${UNRESOLVED_ABORT * 100}% ceiling; aborting`);

  const rows = integrations.map((i) => {
    const t = tested[i.id] || new Set();
    return { ...i, tested: i.declared.filter((f) => t.has(f)) };
  });

  const prev = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, "matrix.json"), "utf8")); } catch { return null; } })();
  if (prev && rows.length < prev.integrations.length) throw new Error(`read ${rows.length} integrations, previous run committed ${prev.integrations.length}; aborting rather than shrinking`);

  const totalDeclared = rows.reduce((a, r) => a + r.declared.length, 0);
  const totalTested = rows.reduce((a, r) => a + r.tested.length, 0);
  const perFeature = Object.fromEntries(features.map((f) => [f, rows.filter((r) => r.declared.includes(f)).length]));
  const fullCoverage = rows.filter((r) => r.declared.length && r.tested.length === r.declared.length).length;
  const zeroTested = rows.filter((r) => r.declared.length && r.tested.length === 0);
  const checkedAt = (process.env.CHECKED_AT || new Date().toISOString()).slice(0, 10);

  // MATRIX.md, the full grid
  const sorted = [...rows].sort((a, b) => b.declared.length - a.declared.length || a.name.localeCompare(b.name));
  const feats = features.filter((f) => perFeature[f] > 0);
  let grid = `| Integration | ${feats.map((f) => `\`${f}\``).join(" | ")} |\n|---|${feats.map(() => "---").join("|")}|\n`;
  for (const r of sorted) {
    grid += `| ${r.name} | ` + feats.map((f) => (r.tested.includes(f) ? "✅" : r.declared.includes(f) ? "◻️" : r.disabled.includes(f) ? "🚫" : "")).join(" | ") + " |\n";
  }
  fs.writeFileSync(path.join(OUT, "MATRIX.md"),
`# AG-UI capability matrix

Every framework integration in \`${REPO}\` against every capability the protocol's dojo defines.
Read from \`apps/dojo/src/menu.ts\` and \`apps/dojo/e2e/tests\` at commit \`${sha}\` on ${checkedAt}.

✅ declared and driven by an end-to-end spec · ◻️ declared, no spec resolved · 🚫 present in the config but commented out

${grid}
${rows.length} integrations · ${features.length} capabilities · ${totalDeclared} declared slots · ${totalTested} with a spec · ${specCount} spec files read, ${unresolved} unresolved, ${unreadable} unreadable.
`);

  // matrix.csv
  const csv = ["integration_id,integration_name,capability,declared,disabled,spec"];
  for (const r of rows) for (const f of features) {
    const d = r.declared.includes(f), off = r.disabled.includes(f);
    if (!d && !off) continue;
    csv.push([esc(r.id), esc(r.name), esc(f), d, off, r.tested.includes(f)].join(","));
  }
  fs.writeFileSync(path.join(OUT, "matrix.csv"), csv.join("\n") + "\n");

  fs.writeFileSync(path.join(OUT, "matrix.json"), JSON.stringify({
    source: REPO, commit: sha, checked: checkedAt,
    integrations: rows, capabilities: features, labels, perCapability: perFeature,
    shelved, totals: { declared: totalDeclared, tested: totalTested, specCount, unresolved, unreadable },
  }, null, 2) + "\n");

  // badges
  fs.mkdirSync(path.join(OUT, "badges"), { recursive: true });
  const badge = (f, label, message, color) => fs.writeFileSync(path.join(OUT, "badges", f), JSON.stringify({ schemaVersion: 1, label, message, color }, null, 2) + "\n");
  badge("capabilities.json", "capability slots tested", `${totalTested}/${totalDeclared}`, totalTested / totalDeclared > 0.7 ? "brightgreen" : "orange");
  badge("integrations.json", "framework integrations", String(rows.length), "6963ff");
  badge("checked-at.json", "matrix checked", checkedAt, "blue");

  // README blocks
  const readmePath = path.join(OUT, "README.md");
  let readme = fs.readFileSync(readmePath, "utf8");

  const gaps = [...rows].filter((r) => r.declared.length - r.tested.length >= 5)
    .sort((a, b) => (b.declared.length - b.tested.length) - (a.declared.length - a.tested.length))
    .map((r) => `${r.name} (${r.tested.length} of ${r.declared.length})`);

  let m = `The protocol repo carries a live demo app, the Dojo, whose config file is the project's own
declaration of which capabilities each integration offers, and an end to end suite that drives those
same cells in a browser. **${rows.length} integrations declare ${totalDeclared} capability slots between them, and ${totalTested}
of those slots have a dojo test behind them.** Both numbers are read out of the repo at commit
\`${sha.slice(0, 7)}\`, not off a comparison page.

\`Backed by a dojo test\` means the suite navigates to that integration's page for that capability. It
is evidence the cell runs, not a promise the feature is production ready.

| Integration | Capabilities declared | Backed by a dojo test |
|---|---:|---:|
`;
  for (const r of sorted) m += `| ${r.name} | ${r.declared.length} | ${r.tested.length} |\n`;
  m += `
**${fullCoverage} of the ${rows.length} have every capability they declare under test.** The widest gaps are ${gaps.join(", ")}.`;
  if (zeroTested.length) m += ` ${zeroTested.length} integrations declare capabilities with no test behind any of them: ${zeroTested.map((r) => r.name).join(", ")}.`;
  m += `

${shelved.length} more adapters sit in the repo with their dojo entry commented out, so they are shipped code
without a live cell: ${shelved.join(", ")}. ${features.filter((f) => perFeature[f] === 0).length} capabilities are defined in the protocol's own type and
declared by nobody yet: ${features.filter((f) => perFeature[f] === 0).map((f) => `\`${f}\``).join(", ")}.

Of ${specCount} spec files read, ${unresolved + unreadable} could not be tied to an integration and capability. They are counted
in neither column.`;
  readme = replaceBlock(readme, "matrix", m);

  let c = `${features.length} named capabilities exist. This is how many of the ${rows.length} integrations declare each one, so
you can tell a safe assumption from a lucky one.

| Capability | Integrations |
|---|---:|
`;
  for (const [f, n] of Object.entries(perFeature).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    c += `| \`${f}\`${labels[f] ? ` <sub>${labels[f]}</sub>` : ""} | ${n} |\n`;
  }
  readme = replaceBlock(readme, "capabilities", c);
  fs.writeFileSync(readmePath, readme);

  console.log(`matrix: ${rows.length} integrations, ${features.length} capabilities, ${totalTested}/${totalDeclared} slots tested, ${specCount} specs (${unresolved} unresolved, ${unreadable} unreadable), commit ${sha}`);
};

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
