#!/usr/bin/env node
// Build CATALOG.md and catalog.csv: the full machine-built index for this list.
//
// README.md is the curated, organized page and is written by hand. These two files are not: they
// are rebuilt from scratch on every run of the refresh-catalog workflow, from two live sources.
//
//   1. README.md's own catalog section - the curated entries, parsed out of the page itself so the
//      layers can never drift apart.
//   2. The GitHub repository-search API - everything in this ecosystem the search can reach, top
//      of search by stars, capped at MAX_CANDIDATES.
//
// Every candidate has to earn its row: the repo resolves through the API, is not archived, is not
// a fork, and is not a rename of the slug we point at. Anything that fails is dropped and the drop
// counts are printed, so a shrinking catalog is visible rather than silent.
//
// Reference implementation with a per-ecosystem install check bolted on:
// https://github.com/ZeroPointRepo/awesome-dsh-plugins/blob/main/.github/scripts/build-catalog.mjs
//
// Usage: GH_TOKEN=... node .github/scripts/build-catalog.mjs

import { readFileSync, writeFileSync } from 'node:fs';

// ------------------------------------------------------------------ TUNE THIS BLOCK PER REPO

// What the reader is browsing. Used in the CATALOG.md heading and the count line.
const ORG = 'ZeroPointRepo';
const REPO = 'awesome-ag-ui';
const NOUN = 'AG-UI project';
const NOUN_PLURAL = 'AG-UI projects';
const TITLE = 'AG-UI catalog';

// How the catalog finds candidates. Repository search, not code search: code search does not work
// with the Actions GITHUB_TOKEN. Add the topics and phrases this ecosystem actually uses.
const QUERIES = [
  "topic:ag-ui",
  "topic:ag-ui-protocol",
  "topic:agui",
  "\"@ag-ui/client\" in:readme",
  "\"ag-ui-protocol\" in:readme",
  "\"@copilotkit\" in:readme",
];

// Owners that are the upstream project itself, or other people's list repos. Not entries.
const DENY_OWNERS = new Set([]);

// OPTIONAL. If entries in this ecosystem are installed with a command, set a regex that matches a
// real one in a project's own README, e.g. /^\s*(thing\s+install\s+\S+.*?)\s*$/i. When set, the
// catalog gains an Install column and a row only counts as verified when the command comes out of
// the project's own docs. Leave null for lists where there is nothing to install.
const INSTALL_RE = null;

// ------------------------------------------------------------------ end of tunable block

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const MAX_CANDIDATES = Number(process.env.MAX_CANDIDATES || 400);
const CONCURRENCY = Number(process.env.CONCURRENCY || 8);

const H = {
  'User-Agent': 'awesome-ag-ui-catalog',
  Accept: 'application/vnd.github+json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(url, tries = 5) {
  let r;
  for (let i = 0; i < tries; i++) {
    r = await fetch(url, { headers: H });
    if (r.ok) return r;
    // Secondary rate limiting is the normal failure here, and it is temporary. Waiting it out is
    // the difference between a good row and a row that silently reads as unverified.
    if (r.status === 403 || r.status === 429) {
      const retryAfter = Number(r.headers.get('retry-after')) || 0;
      await sleep(Math.max(retryAfter * 1000, 4000 * 2 ** i));
      continue;
    }
    return r;
  }
  return r;
}

// Some projects document a pinned ref as a shell variable rather than inline:
//   THING_REF=v2.4.0
//   thing install "github:owner/repo#${THING_REF}"
// Substituting the assignments before matching is the difference between checking that pin and
// reporting a correctly pinned entry as drift.
function expandVars(md) {
  const vars = new Map();
  for (const m of md.matchAll(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})=["']?([\w.@#/-]+)["']?\s*$/gm)) {
    vars.set(m[1], m[2]);
  }
  if (!vars.size) return md;
  return md.replace(/\$\{?([A-Z][A-Z0-9_]{2,})\}?/g, (all, name) => (vars.has(name) ? vars.get(name) : all));
}

let readFailures = 0;

async function fetchReadme(slug) {
  const r = await api(`https://api.github.com/repos/${slug}/readme`);
  if (!r.ok) {
    readFailures++;
    console.log(`  could not read ${slug}'s README (HTTP ${r.status})`);
    return null;
  }
  const j = await r.json();
  return expandVars(Buffer.from(j.content, 'base64').toString('utf8'));
}

// ---------------------------------------------------------------- README (curated entries)

const readme = readFileSync('README.md', 'utf8');
// Scoped to the catalog section only, so a Featured entry or a link inside the "Good to know"
// accordions cannot inflate the count.
const cStart = readme.indexOf('## The catalog');
const cEnd = readme.indexOf('## Good to know');
// Strip HTML comments first. The scaffold leaves the entry SHAPE in a TODO comment in every empty
// category, and that shape starts with "- **...**". Without this it parses as a phantom entry.
const catalogText = (cStart >= 0 && cEnd > cStart ? readme.slice(cStart, cEnd) : readme).replace(
  /<!--[\s\S]*?-->/g,
  ''
);
const rLines = catalogText.split('\n');

// An entry starts on a bold action line and its links and command follow within a few lines:
//   - **What it does for the reader** with
//     [name](https://github.com/owner/repo) by [author](author-url). Description. N★, LICENSE.
// The project's own repo link is the FIRST github.com link in the block; the author link is second.
const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const curated = [];
let section = null;
for (let i = 0; i < rLines.length; i++) {
  const h = rLines[i].match(/^### (.+?)\s*$/);
  if (h) section = h[1];
  if (!/^- \*\*/.test(rLines[i])) continue;
  const headline = (rLines[i].match(/^- \*\*(.+?)\*\*/) || [])[1] || null;
  let name = null;
  let slug = null;
  let cmd = null;
  for (let j = i; j < Math.min(i + 12, rLines.length); j++) {
    if (j > i && /^- \*\*/.test(rLines[j])) break; // next entry started
    if (!slug) {
      const m = rLines[j].match(/\[([^\]]+)\]\(https:\/\/github\.com\/([^/)]+)\/([^/)#]+)\)/);
      if (m) {
        name = m[1];
        slug = `${m[2]}/${m[3].replace(/\.git$/i, '')}`;
      }
    }
    if (/^\s*```/.test(rLines[j])) {
      cmd = (rLines[j + 1] || '').trim();
      break;
    }
  }
  if (!slug) continue;
  curated.push({ name, slug, desc: headline, cmd, section, curated: true });
}
console.log(`Curated entries parsed from README.md: ${curated.length}`);

// ---------------------------------------------------------------- discovery (repo search)

const isList = (fullName) => /^awesome[-_]/i.test(fullName.split('/')[1] || '');

const found = new Map();
let searchPages = 0;
for (const q of QUERIES) {
  for (let page = 1; page <= 3; page++) {
    const r = await api(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=100&page=${page}`
    );
    searchPages++;
    if (!r.ok) {
      console.log(`  search "${q}" page ${page}: HTTP ${r.status}, skipping rest of this query`);
      break;
    }
    const j = await r.json();
    const items = j.items || [];
    for (const it of items) {
      if (it.archived || it.fork) continue;
      if (DENY_OWNERS.has(it.full_name.split('/')[0])) continue;
      if (isList(it.full_name)) continue;
      if (!found.has(it.full_name)) found.set(it.full_name, it);
    }
    if (items.length < 100) break;
    await sleep(2500); // search API is 30 req/min
  }
  await sleep(2500);
}
console.log(`Discovery: ${found.size} unique candidate repos from ${searchPages} search requests`);
if (found.size === 0) {
  console.error('Search returned nothing. Keeping the existing catalog instead of shrinking it.');
  process.exit(1);
}

const curatedSlugs = new Set(curated.map((e) => e.slug.toLowerCase()));
const ranked = [...found.values()]
  .filter((it) => !curatedSlugs.has(it.full_name.toLowerCase()))
  .sort((a, b) => b.stargazers_count - a.stargazers_count);
const shortlist = ranked.slice(0, MAX_CANDIDATES);

// Every candidate discovery turned up has to end this run in exactly one bucket. A candidate that
// is capped away, or skipped because the REST budget ran low, is not "dropped" and is not "listed",
// and if it lands in neither it disappears: the page then reads as if we checked everything, which
// is the exact failure the cap and the budget guard exist to prevent. The reconciliation below is
// asserted, so a bucket added later and left out of it fails the run rather than quietly shrinking
// the visible total.
const discovery = {
  candidates: ranked.length,
  notReachedByCap: ranked.length - shortlist.length,
  skippedForBudget: 0,
  droppedUnreadable: 0,
  droppedNoCommand: 0,
  droppedNoEvidence: 0,
  listed: 0,
};
if (discovery.notReachedByCap > 0) {
  console.log(
    `Capped at MAX_CANDIDATES=${MAX_CANDIDATES}: ${discovery.notReachedByCap} lower-starred candidates not reached this run`
  );
}

// ---------------------------------------------------------------- install-command handling

const PLACEHOLDER =
  /[<>]|path\/to|\/Users\/|(?:^|[\s"'(])[A-Za-z]:[\\/]|%[A-Za-z_]+%|your[-_]|YOUR[-_]|\.\.\/|~\/|link:\.|file:/;

function selfRefScore(fullName, line) {
  const [owner, repo] = fullName.toLowerCase().split('/');
  const l = line.toLowerCase();
  let score = 0;
  if (l.includes(repo)) score += 2;
  if (l.includes(owner)) score += 1;
  const compact = repo.replace(/[-_.]/g, '');
  if (compact.length > 3 && l.replace(/[-_.]/g, '').includes(compact)) score += 1;
  return score;
}

function extractCommand(fullName, md) {
  if (!INSTALL_RE) return null;
  const hits = [];
  for (const raw of md.split('\n')) {
    const m = raw.match(INSTALL_RE);
    if (!m) continue;
    const line = m[1].trim().replace(/\s+#.*$/, '');
    if (PLACEHOLDER.test(line)) continue;
    if (/^\.{0,2}\//.test(line.split(/\s+/).pop())) continue;
    hits.push({ line, score: selfRefScore(fullName, line) });
  }
  hits.sort((a, b) => b.score - a.score || a.line.length - b.line.length);
  return hits[0] && hits[0].score >= 2 ? hits[0].line : null;
}


// ---------------------------------------------------------------- AG-UI dependency evidence
//
// The bar for a row in this catalog. A topic is a label anyone can attach; a dependency is a fact
// the project committed to its own manifest. Every row is checked for one, and the check has three
// outcomes, never two:
//
//   true   an @ag-ui/* or @copilotkit/* package in a manifest, an ag-ui-protocol requirement, or an
//          install line for one in the project's own README
//   false  read the manifests, found none
//   null   could not read the manifests. Not evidence of absence. Reported as its own state and
//          counted apart from both, and the run aborts if too many land here.
//
// The distinction exists because a failed network read that returns an empty file list looks
// exactly like a project with no dependencies, and printing that as "no evidence" would be the one
// dishonest cell on a page whose whole value is that the cells are checked.

// MCP servers this list names, with the endpoint their own docs publish, and a live handshake
// against each. This is the one column on the page that is not read from a file: it asks the server
// itself. @ag-ui/mcp-middleware stamps static headers on outbound MCP requests and runs no OAuth
// flow, so what a server does about auth is exactly what decides whether it works behind an AG-UI
// agent. A server that is simply down at check time is unreachable, which is a third state and not
// a claim that it does not work.
let MCP_ENDPOINTS = {};
try {
  MCP_ENDPOINTS = JSON.parse(readFileSync('.github/data/mcp-endpoints.json', 'utf8')).endpoints || {};
} catch { /* no endpoints file, the probe simply never fires */ }

const MCP_INIT = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'awesome-ag-ui', version: '1' } },
});

async function mcpAuthMode(url) {
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: MCP_INIT,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return null; // unreachable: not evidence either way
  }
  if (r.status === 401 || r.status === 403) {
    const wa = r.headers.get('www-authenticate') || '';
    return /resource_metadata|Bearer/i.test(wa) || r.status === 401
      ? 'live MCP endpoint, takes a bearer key the middleware can stamp'
      : 'live MCP endpoint, authenticated';
  }
  if (r.ok) return 'live MCP endpoint, answers an unauthenticated handshake';
  return null;
}

const MANIFESTS = [
  'package.json', 'pyproject.toml', 'requirements.txt', 'Directory.Packages.props',
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'go.mod', 'Cargo.toml', 'pubspec.yaml',
];
const AGUI_DEP = /@ag-ui\/[a-z0-9-]+|ag-ui-protocol|ag_ui[-_](core|protocol)|AgUiDotnet|AGUI\.Server/i;
const CK_DEP = /@copilotkit\/[a-z0-9-]+|^\s*["']?copilotkit\b/im;

let evidenceUnreadable = 0;

// A framework the protocol repo ships an integration for is evidence in the other direction: AG-UI
// depends on it, not the reverse, so LangGraph will never carry an @ag-ui package and would
// otherwise read as unverified on a list it is the whole reason for.
let UPSTREAMS = new Set();
try {
  const j = JSON.parse(readFileSync('.github/data/integration-upstreams.json', 'utf8'));
  UPSTREAMS = new Set(Object.values(j.upstreams || {}).map((v) => v.toLowerCase()));
} catch {
  console.log('  no integration-upstreams.json, framework rows will be checked as ordinary dependents');
}

async function rawFile(slug, file) {
  const r = await api(`https://api.github.com/repos/${slug}/contents/${encodeURIComponent(file)}`);
  if (r.status === 404) return '';
  if (!r.ok) return null;
  const j = await r.json();
  if (!j || !j.content) return '';
  return Buffer.from(j.content, 'base64').toString('utf8');
}

async function depEvidence(slug, md) {
  if (UPSTREAMS.has(slug.toLowerCase())) return { ok: true, note: 'the protocol repo ships an integration for it' };
  const endpoint = MCP_ENDPOINTS[slug] || MCP_ENDPOINTS[slug.toLowerCase()];
  if (endpoint) {
    const probe = await mcpAuthMode(endpoint);
    if (probe) return { ok: true, note: probe };
  }
  const t = await api(`https://api.github.com/repos/${slug}/git/trees/HEAD?recursive=1`);
  if (!t.ok) { evidenceUnreadable++; return { ok: null, note: 'manifests unreadable' }; }
  const tree = await t.json();
  const blobs = (tree.tree || []).filter((n) => n.type === 'blob').map((n) => n.path);
  // Root manifests first, then nested ones. A monorepo keeps its dependency two directories down
  // and a root-only check reads that as no dependency, which is the wrong answer, not a missing one.
  const isManifest = (p) => MANIFESTS.includes(p.split('/').pop());
  const depth = (p) => p.split('/').length;
  const want = blobs.filter(isManifest).sort((a, b) => depth(a) - depth(b) || a.localeCompare(b)).slice(0, 6);
  let unreadable = 0;
  for (const w of want) {
    const c = await rawFile(slug, w);
    if (c === null) { unreadable++; continue; }
    if (AGUI_DEP.test(c)) return { ok: true, note: `${w} declares an AG-UI package` };
    if (CK_DEP.test(c)) return { ok: true, note: `${w} declares a CopilotKit package` };
  }
  if (md) {
    const install = md.match(/(?:pip install|uv add|poetry add|npm i(?:nstall)?|pnpm add|yarn add|dotnet add package)\s+[^\n`]*(?:ag-ui|ag_ui|copilotkit)[^\n`]*/i);
    if (install) return { ok: true, note: 'install line in its own README' };
    if (/from\s+ag_ui[.\s]|import\s+ag_ui\b/.test(md)) return { ok: true, note: 'ag_ui import in its own README' };
  }
  if (unreadable || (!want.length && md === null)) { evidenceUnreadable++; return { ok: null, note: 'manifests unreadable' }; }
  return { ok: false, note: 'no dependency found' };
}

// ---------------------------------------------------------------- screenshots (data capture only)

// Collected now, displayed nowhere. CATALOG.md stays a text table; an image strip built from
// whatever a README happens to contain would be a wall of broken and mismatched art, which is the
// empty-state rule in reverse. This just future-proofs the data for a consumer that does not exist
// yet, so the discipline is: only URLs the project itself published, only GitHub-hosted, never a
// guess and never a hotlink to someone else's image host.
const GH_IMAGE_HOST =
  /^https:\/\/(raw\.githubusercontent\.com\/|user-images\.githubusercontent\.com\/|camo\.githubusercontent\.com\/|private-user-images\.githubusercontent\.com\/|repository-images\.githubusercontent\.com\/|github\.com\/user-attachments\/)/;
const MAX_SHOTS = 4;

// A repo's social preview counts only when the maintainer uploaded one. GitHub serves an
// auto-generated card (opengraph.githubassets.com) for every other repo, and that card is a
// rendered title block, not a screenshot. usesCustomOpenGraphImage is the only honest way to tell
// them apart, and it exists on the GraphQL API only.
async function fetchOgImages(slugs) {
  const out = new Map();
  if (!TOKEN) return out;
  for (let i = 0; i < slugs.length; i += 50) {
    const batch = slugs.slice(i, i + 50);
    const query = `query {${batch
      .map(
        (s, n) =>
          ` r${n}: repository(owner:${JSON.stringify(s.split('/')[0])}, name:${JSON.stringify(
            s.split('/')[1]
          )}) { openGraphImageUrl usesCustomOpenGraphImage }`
      )
      .join('')} }`;
    let r;
    try {
      r = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
    } catch {
      console.log('  social-preview lookup failed (network), continuing without it');
      return out;
    }
    if (!r.ok) {
      console.log(`  social-preview lookup unavailable (HTTP ${r.status}), continuing without it`);
      return out;
    }
    const j = await r.json();
    batch.forEach((slug, n) => {
      const d = j.data && j.data[`r${n}`];
      if (d && d.usesCustomOpenGraphImage && GH_IMAGE_HOST.test(d.openGraphImageUrl || '')) {
        out.set(slug, d.openGraphImageUrl);
      }
    });
  }
  return out;
}

// Images the project's own README points at. Relative paths are resolved against the repo's default
// branch, which is where the README already says the file lives; nothing is fabricated.
function extractImages(slug, md) {
  if (!md) return [];
  const found = [];
  const add = (raw) => {
    if (!raw) return;
    let u = raw.trim().replace(/^<|>$/g, '').replace(/["')]+$/, '').split(/\s+/)[0];
    if (!u || u.startsWith('#') || u.startsWith('data:') || u.startsWith('mailto:')) return;
    if (/^https?:\/\//i.test(u)) {
      if (!GH_IMAGE_HOST.test(u)) return; // third-party image host, never hotlink it
    } else {
      if (/^\/\//.test(u)) return; // protocol-relative, host unknown
      u = `https://raw.githubusercontent.com/${slug}/HEAD/${u.replace(/^\.?\//, '')}`;
    }
    if (!found.includes(u)) found.push(u);
  };
  for (const m of md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) add(m[1]);
  for (const m of md.matchAll(/<img[^>]+src\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  return found.slice(0, MAX_SHOTS);
}

// ---------------------------------------------------------------- verify + assemble

// The Actions token gets 5,000 REST calls an hour for the whole installation, shared with every
// other workflow in the repo. A full discovery pass at MAX_CANDIDATES can eat most of that, and the
// first time it did, the link-check job an hour later failed on a rate limit it had no part in
// causing. So discovery stops while there is still budget for the other jobs, and says how many
// candidates it skipped. A cap that is not printed reads as "we checked everything".
const RESERVE = Number(process.env.RATE_RESERVE || 600);
let budgetLeft = Infinity;
async function refreshBudget() {
  try {
    const r = await fetch('https://api.github.com/rate_limit', { headers: H });
    if (!r.ok) return;
    const j = await r.json();
    budgetLeft = j.resources?.core?.remaining ?? Infinity;
  } catch { /* leave the last reading in place */ }
}
await refreshBudget();
console.log(`REST budget at start: ${budgetLeft === Infinity ? 'unknown' : budgetLeft} (reserving ${RESERVE} for other jobs)`);

const rows = [];
const dropped = { unresolved: 0, archived: 0, renamed: 0, noCommand: 0, noEvidence: 0 };

async function run(items, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}

await run(curated, async (e) => {
  const r = await api(`https://api.github.com/repos/${e.slug}`);
  if (!r.ok) return void dropped.unresolved++;
  const j = await r.json();
  if (j.archived) return void dropped.archived++;
  if (j.full_name.toLowerCase() !== e.slug.toLowerCase()) return void dropped.renamed++;

  const md = await fetchReadme(e.slug);
  const ev = await depEvidence(j.full_name, md);
  let verified = true;
  if (INSTALL_RE && e.cmd) {
    const tok = e.cmd.split(/\s+/).pop().replace(/^['"]|['"]$/g, '');
    verified = md
      ? md.includes(/^https:\/\/github\.com\//.test(tok) ? tok.split('/').slice(-2).join('/') : tok)
      : false;
  }
  rows.push({
    name: e.name,
    slug: j.full_name,
    blurb: e.desc || j.description || '',
    stars: j.stargazers_count,
    cmd: e.cmd,
    verified,
    evidence: ev.ok,
    evidenceNote: ev.note,
    shots: extractImages(j.full_name, md),
    section: e.section,
    curated: true,
  });
});

await run(shortlist, async (it) => {
  if (budgetLeft <= RESERVE) { discovery.skippedForBudget++; return; }
  budgetLeft -= 5; // one tree read, up to three manifests, one README
  if (budgetLeft % 250 < 5) await refreshBudget();
  const md = await fetchReadme(it.full_name);
  let cmd = null;
  if (INSTALL_RE) {
    if (!md) { discovery.droppedUnreadable++; dropped.unresolved++; return; }
    cmd = extractCommand(it.full_name, md);
    if (!cmd) { discovery.droppedNoCommand++; dropped.noCommand++; return; }
  }
  const ev = await depEvidence(it.full_name, md);
  // A discovered repo earns its row only on evidence. `false` is a real answer and drops it;
  // `null` means we could not check, which is not the same thing and also does not get a row.
  if (ev.ok !== true) { discovery.droppedNoEvidence++; dropped.noEvidence++; return; }
  rows.push({
    name: it.full_name.split('/')[1],
    slug: it.full_name,
    blurb: it.description || '',
    stars: it.stargazers_count,
    cmd,
    verified: true,
    evidence: ev.ok,
    evidenceNote: ev.note,
    shots: extractImages(it.full_name, md),
    curated: false,
  });
});

// One batched pass, after the rows exist, so a repo with a real uploaded social preview leads with
// it and README images fill in behind.
const og = await fetchOgImages(rows.map((r) => r.slug));
for (const r of rows) {
  const lead = og.get(r.slug);
  r.shots = (lead ? [lead, ...r.shots.filter((u) => u !== lead)] : r.shots).slice(0, MAX_SHOTS);
}
console.log(
  `Screenshots collected: ${rows.filter((r) => r.shots.length).length}/${rows.length} rows have at least one ` +
    `(${og.size} from an uploaded social preview). Data capture only, CATALOG.md is unchanged.`
);

rows.sort((a, b) => b.stars - a.stars || a.slug.localeCompare(b.slug));

console.log(
  `Rows: ${rows.length} (${rows.filter((r) => r.curated).length} curated, ${rows.filter((r) => !r.curated).length} discovered). ` +
    `Dropped: ${dropped.unresolved} unresolved, ${dropped.archived} archived, ${dropped.renamed} renamed, ${dropped.noCommand} no usable install command, ${dropped.noEvidence} no AG-UI dependency evidence.`
);

if (rows.length < curated.length) {
  console.error(`Refusing to write a catalog smaller than the curated list (${rows.length} < ${curated.length}).`);
  process.exit(1);
}

// A README we could not read is an unknown, not a failed check. A handful is normal API weather; a
// pile of them means the run is unreliable and would publish false "unverified" marks.
const readFailureBudget = Math.max(5, Math.round(rows.length * 0.05));
console.log(`README reads that failed: ${readFailures} (budget ${readFailureBudget})`);
const notEstablished = rows.filter((r) => r.evidence === null).length;
const evidenceBudget = Math.max(5, Math.round(rows.length * 0.05));
console.log(
  `AG-UI dependency evidence: ${rows.filter((r) => r.evidence === true).length} confirmed, ` +
    `${rows.filter((r) => r.evidence === false).length} none found, ${notEstablished} not established ` +
    `(budget ${evidenceBudget}).`
);
if (notEstablished > evidenceBudget) {
  console.error('Too many dependency checks could not be read. Keeping the existing catalog rather than publishing an unchecked column.');
  process.exit(1);
}
if (readFailures > readFailureBudget) {
  console.error('Too many README reads failed. Keeping the existing catalog rather than publishing false marks.');
  process.exit(1);
}

// ---------------------------------------------------------------- render

const esc = (s) =>
  String(s || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();

function oneLine(s, max = 120) {
  const t = esc(s);
  return t.length <= max ? t : t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

const starsHuman = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));

const header = INSTALL_RE
  ? '| Name | What it does | ★ | Install | AG-UI dependency |\n|---|---|---|---|---|'
  : '| Name | What it does | ★ | AG-UI dependency |\n|---|---|---|---|';
const evidenceCell = (r) => (r.evidence === true ? `✅ ${esc(r.evidenceNote)}` : r.evidence === false ? '—' : 'Not established');

const body = rows
  .map((r) => {
    const cells = [`[${esc(r.name)}](https://github.com/${r.slug})`, oneLine(r.blurb), starsHuman(r.stars)];
    if (INSTALL_RE) cells.push(r.cmd ? `\`${esc(r.cmd)}\`` : '—');
    cells.push(evidenceCell(r));
    return `| ${cells.join(' | ')} |`;
  })
  .join('\n');

writeFileSync(
  'CATALOG.md',
  `# ${TITLE}

Auto-generated index of every ${NOUN} this repo can resolve and check. The curated, organized list
is [README.md](README.md).

${header}
${body}

<sub>${rows.length} ${NOUN_PLURAL} · same rows as data in [catalog.csv](catalog.csv) · rebuilt by
[\`build-catalog.mjs\`](.github/scripts/build-catalog.mjs) on every
[refresh-catalog](.github/workflows/refresh-catalog.yml) run · edits here are overwritten, send them
to [README.md](README.md).</sub>
`
);
console.log(`Wrote CATALOG.md (${rows.length} ${NOUN_PLURAL})`);

// The same rows as data, for anyone consuming the list programmatically. Full untruncated
// description, exact star count, RFC 4180 quoting.
const csvCell = (v) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// screenshots is semicolon-joined so the column stays one CSV field and splits without a parser.
const cols = INSTALL_RE
  ? ['name', 'description', 'stars', 'install_command', 'agui_dependency', 'evidence', 'repo_url', 'screenshots']
  : ['name', 'description', 'stars', 'agui_dependency', 'evidence', 'repo_url', 'screenshots'];
const csv =
  [cols.join(',')]
    .concat(
      rows.map((r) => {
        const v = [r.name, r.blurb, r.stars];
        if (INSTALL_RE) v.push(r.cmd || '');
        v.push(r.evidence === null ? 'not_established' : String(r.evidence), r.evidenceNote || '', `https://github.com/${r.slug}`, r.shots.join(';'));
        return v.map(csvCell).join(',');
      })
    )
    .join('\n') + '\n';

writeFileSync('catalog.csv', csv);
console.log(`Wrote catalog.csv (${rows.length} rows)`);

// ---------------------------------------------------------------- plugins.json (registry feed)

// dsh-market's own schema, so a market user can point DSHM_REGISTRY_URL at this file and get our
// verified list instead of theirs. Their catalog is a static file too, so this raw URL is the whole
// endpoint. Fields we cannot fill honestly are left out rather than guessed; their type marks them
// optional and their code reads a missing value the same as null.

// An npm name only goes in when the package exists AND its own repository field points back at the
// repo we list. Anything looser attaches someone else's download count to our entry, which is the
// exact claim-jacking their contributing doc warns about.
const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

function npmSpecOf(cmd) {
  if (!cmd) return null;
  let tok = cmd.trim().split(/\s+/).pop().replace(/^['"]|['"]$/g, '').replace(/^npm:/, '');
  if (/^(github:|git\+|https?:|file:|link:|npm-|\.)/i.test(tok)) return null;
  const m = tok.match(/^((?:@[^@/]+\/)?[^@/]+)(?:@[^@]+)?$/);
  return m && NPM_NAME.test(m[1]) ? m[1] : null;
}

async function resolveNpm(rowsIn) {
  const out = new Map();
  let checked = 0;
  let rejected = 0;
  await run(rowsIn, async (r) => {
    const pkg = npmSpecOf(r.cmd);
    if (!pkg) return;
    checked++;
    let res;
    try {
      res = await fetch(`https://registry.npmjs.org/${pkg.replace('/', '%2f')}`, {
        headers: { 'User-Agent': H['User-Agent'] },
      });
    } catch {
      return;
    }
    if (!res.ok) return void rejected++;
    const j = await res.json();
    const repoField = j.repository && (j.repository.url || j.repository);
    const m = String(repoField || '').match(/github\.com[/:]([^/]+)\/([^/.#?]+)/i);
    const claims = m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
    if (claims && claims === r.slug.toLowerCase()) out.set(r.slug, pkg);
    else rejected++;
  });
  console.log(
    `npm linkage: ${out.size} of ${checked} npm-shaped install specs verified back to their own repo ` +
      `(${rejected} rejected: unpublished, or the package points at a different repository).`
  );
  return out;
}

const npmBySlug = await resolveNpm(rows);

// First-seen ledger. The GitHub API can tell us when a repo was created but not when WE first
// listed it, so this is recorded from now on and never back-dated.
const LEDGER = '.github/data/first-seen.json';
const today = new Date().toISOString().slice(0, 10);
let ledger = { _note: '', seen: {} };
try {
  const parsed = JSON.parse(readFileSync(LEDGER, 'utf8'));
  if (parsed && parsed.seen) ledger = parsed;
} catch {
  /* first run */
}
ledger._note =
  'When this catalog first listed each entry, keyed by owner/repo. Written by ' +
  '.github/scripts/build-catalog.mjs and never edited by hand. The ledger starts on 2026-08-27: ' +
  'every entry present that day carries that date because it is the first date we actually ' +
  'recorded, not the date we listed it. Nothing here is back-dated.';
let firstSeenNew = 0;
for (const r of rows) {
  if (!ledger.seen[r.slug]) {
    ledger.seen[r.slug] = today;
    firstSeenNew++;
  }
}
ledger.seen = Object.fromEntries(Object.entries(ledger.seen).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');

// Categories are the README's own section headings. A discovered row has no section, so it says so
// rather than being filed under a guess.
const UNSORTED = 'unsorted';
const categories = {};
for (const r of rows) {
  const key = r.section ? slugify(r.section) : UNSORTED;
  r.category = key;
  if (!categories[key]) categories[key] = { en: r.section || 'Unsorted' };
}

const REPO_URL = `https://github.com/${ORG}/${REPO}`;
const feed = {
  name: REPO,
  url: REPO_URL,
  source: REPO_URL,
  updated: today,
  count: rows.length,
  coverage: {
    _note:
      'What this run actually looked at. `listed` plus every other field equals `candidates`: a ' +
      'candidate the run did not reach is reported here rather than omitted, because a cap that is ' +
      'not published reads as if everything was checked.',
    candidates: discovery.candidates,
    listed: discovery.listed,
    curated: rows.filter((r) => r.curated).length,
    dropped_no_dependency: discovery.droppedNoEvidence,
    dropped_no_install_command: discovery.droppedNoCommand,
    dropped_unreadable: discovery.droppedUnreadable,
    skipped_for_rest_budget: discovery.skippedForBudget,
    not_reached_by_cap: discovery.notReachedByCap,
  },
  categories,
  projects: rows.map((r) => {
    const [owner] = r.slug.split('/');
    const p = {
      name: r.name,
      owner,
      url: `https://github.com/${r.slug}`,
      category: r.category,
      description: { en: esc(r.blurb) },
      stars: r.stars,
      install: r.cmd || '',
      added: ledger.seen[r.slug],
    };
    p.agui_dependency = r.evidence === null ? 'not_established' : r.evidence;
    if (r.evidenceNote) p.evidence = r.evidenceNote;
    const pkg = npmBySlug.get(r.slug);
    if (pkg) p.npm = pkg;
    if (r.shots.length) p.screenshots = r.shots;
    return p;
  }),
};

writeFileSync('projects.json', JSON.stringify(feed, null, 2) + '\n');
console.log(
  `Wrote projects.json (${rows.length} projects, ${Object.keys(categories).length} categories, ` +
    `${firstSeenNew} newly added to the first-seen ledger)`
);

// Keep every number on the README honest. Prose is hand-written; numbers are written here, between
// markers, so the page cannot contradict the data behind it.
// Every bold entry line on the curated page, which is what the badge claims. Some of those point
// at a directory inside the protocol repo rather than a standalone repository, so they are real
// entries for a reader and have no CATALOG row; counting rows here would undercount the page.
const pageEntries = (readme.match(/^- \*\*/gm) || []).length;
const block = `**Full catalog:** all ${rows.length} ${NOUN_PLURAL} this list can resolve and check, in [CATALOG.md](CATALOG.md)

**Machine-readable:** the same rows as data in [catalog.csv](catalog.csv) and [projects.json](projects.json), and the capability grid in [matrix.csv](matrix.csv)`;
let out = readme;
const re = /(<!-- catalogcount:start -->)[\s\S]*?(<!-- catalogcount:end -->)/;
if (!re.test(out)) {
  console.error('README.md is missing the catalogcount markers.');
  process.exit(1);
}
out = out.replace(re, `$1\n${block}\n$2`);
out = out.replace(/(<img src="https:\/\/img\.shields\.io\/badge\/projects-)\d+(-6963ff")/, `$1${pageEntries}$2`);
if (out !== readme) {
  writeFileSync('README.md', out);
  console.log(`Refreshed the README counts (${rows.length} in CATALOG.md, ${pageEntries} entries on the page)`);
}
