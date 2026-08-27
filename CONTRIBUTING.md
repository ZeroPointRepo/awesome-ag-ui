# Contributing to Awesome AG-UI

Thanks for considering a contribution. We are strict about verification and fast about merging,
target under 7 days to a first response on every PR.

## Entries from ZeroPointRepo

Some entries in this list are built by ZeroPointRepo. They are held to the same rules as every other entry,
and to a higher bar on one point:

- Same entry format as everyone else. No bold, no emoji, no "featured" styling.
- At most one per category.
- A higher acceptance bar: no working path for the reader, no real docs, it does not go in.
- A competing entry is never rejected or downranked to protect one of ours.

## Adding an entry

Open a PR that adds one entry, in the right category, in this exact shape:

```
- **What it does for the reader, as a short action phrase** with
  [name](repo-url) by [author](author-url). A factual one-line description. N★, LICENSE.
```

One lead phrase, one description, nothing else in the visible line. If this ecosystem installs
things, add the command in a collapsed `<details><summary>Install</summary>` block underneath.

### Acceptance bar (we merge if all of these are true)

1. **The link resolves** and the repo is not empty or archived.
2. **It is genuinely about AG-UI.** The bar is a dependency, not a topic label: an `@ag-ui/*` or
   `@copilotkit/*` package in a manifest, an `ag-ui-protocol` requirement, or an install line for one
   in the project's own README. `ag-ui` is also a common abbreviation for unrelated things, which is
   why the label alone does not count. The `AG-UI dependency` column in `CATALOG.md` reports the
   automated check only, so a hand-curated entry whose dependency sits somewhere the check does not
   reach shows `—` there and still belongs on the page. The column says what the machine found, not
   what a maintainer concluded.
3. **It is not already listed.**
4. **The category is right.** If it spans two, pick the primary use case. A maintainer will move it
   rather than bounce the PR over this alone.

We reject only for: dead link, no real substance, pure spam, or exact duplicate. **We always reply**,
even to a rejection, and we will say exactly what would get a resubmission in.

An honestly empty category beats a padded one. If your entry does not clear the bar yet, say so in
the PR and we will tell you plainly what is missing, instead of listing something that does not work.

## Before you change the matrix generator

The capability matrix is read out of `ag-ui-protocol/ag-ui`, from two files that project owns:
`apps/dojo/src/menu.ts` for what each integration declares, and `apps/dojo/e2e/tests/**` for which
of those cells a test drives. Three rules hold it together, and each exists because dropping it
produces a confident wrong answer:

- **A capability has three states, not two.** Declared, declared and commented out, or absent. A
  commented-out entry is a deliberate off switch by the people who wrote it, and collapsing it into
  either neighbour loses that.
- **A spec that cannot be tied to an integration and a capability is unresolved, and stays that
  way.** It is counted in neither column and printed in the run output. Guessing from the file name
  would be a coin flip dressed as data.
- **The run aborts rather than shrinks.** More than one spec in twenty unresolved, fewer
  integrations than the last committed run, or no specs at all, and it publishes nothing. A quiet
  network failure that returns an empty list looks exactly like a project that removed its tests.

If you change how specs are resolved, say in the PR what moves and by how much. The numbers on the
README are written by that script between markers, so a parser change rewrites the page.

## Style

- One entry per line plus its optional command block, no sub-bullets beyond that.
- No affiliate links, no UTM parameters, no tracking redirects.
- Keep descriptions under about 120 characters where you can.
- No em dashes. Use a period, comma, or colon instead.
