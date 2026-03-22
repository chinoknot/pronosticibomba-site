# Match Center 3 Plan

`match-center3.html` is the performance sandbox for the next mobile-first iteration.

The goal is to preserve the current product surface:

- same data
- same filters
- same Bet Master
- same match detail
- same league ordering logic

while replacing the expensive rendering and filtering engine under the hood.

## Current bottlenecks

Observed on large slates (`~1600` matches):

- initial parse of the daily payload is acceptable, but heavy
- filter changes trigger too much recomputation and rerendering
- search runs too eagerly and blocks the main thread
- `Expand all` creates too much live DOM
- match detail can briefly show stale content before the new fetch settles

## Target architecture

### Phase 1: Fast interaction layer

Keep the same payload and same UI.

- add a dedicated `Web Worker` for:
  - search
  - global filters
  - league grouping metadata
- memoize:
  - derived markets per fixture
  - primary pick selection
  - filtered match ids
  - grouped league blocks
- debounce search input
- move expensive rerenders into chunked batches with `requestAnimationFrame`
- fix detail drawer race with request token / abort logic

Expected outcome:

- faster search
- smoother filter changes
- no stale detail flash

### Phase 2: Chunked data delivery

Change the workflow output to avoid one heavy monolithic JSON for all uses.

Generate:

- `summary.json`
- `live-soon.json`
- `search-index.json`
- `leagues/<league-key>.json`
- optional `details/<fixture-id>.json`

Expected outcome:

- first paint loads only what the user needs immediately
- mobile downloads less before it becomes interactive

### Phase 3: Virtualized league rendering

Keep top leagues open by default, but render the long tail lazily.

- top leagues always mounted
- live and soon groups always mounted
- regular leagues rendered only when near viewport
- `Expand all` becomes logical state, not full DOM explosion

Expected outcome:

- smooth scrolling on mobile
- large Saturdays remain usable

### Phase 4: App-ready engine

Use the same chunked payload strategy and filtering model as the future mobile app.

- shared grouping rules
- shared search index rules
- shared primary pick ranking

Expected outcome:

- the web engine becomes the reference for the app rewrite

## First implementation order

1. isolate `match-center3.html` and `assets/match_center3.js`
2. add debounced search + worker filter pipeline
3. add detail-request guard
4. add progressive/chunked league rendering
5. update workflow to emit smaller files

## Guardrails

- do not change current production page behavior
- do not change prediction math during the performance pass
- do not remove filters or features
- preserve current visual hierarchy while optimizing the engine
