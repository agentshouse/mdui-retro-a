# Retro board — House preparation

Current bridge migration: Master’s 2026-10-11 live go has been applied locally. The port pins the published MIT bridge `0.1.0-ce524f6608238` and uses the exact host-provided client from `connectHouseBridge().runtime`. Runtime imports/construction are removed. Earlier dated check counts and old bridge-gap findings below are historical; see the current migration result at the end. Publication still waits for Tasks and the remote schema replacement fix.

A board-only port of [inovex/scrumlr.io](https://github.com/inovex/scrumlr.io/tree/6bae213129563eea946ec58e7a38d068dc53e0c3), pinned at main commit `6bae213129563eea946ec58e7a38d068dc53e0c3`.

## Build and checks

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run release:check
```

The donor's build command is retained: `tsc -b && vite build`. Vite uses `dist/` and a relative asset base. The prebuild step copies the source `app.json` and `schema.yaml`, donor notice, local font notice, and dependency notices into the complete release. All icons and Raleway font files resolve locally. There are no production Go API, websocket, auth, analytics, CDN, remote image, or remote font calls.

The installed runtime packages declare Node >=24.21.0; local Node 24.19.0 emits the known build warning. The Master has accepted this build warning pending the runtime change. Build success is not hosted-runtime verification.

## Retained editor

The donor's board grid, snapping columns, colored outlines, striped columns, note cards, typography, responsive breakpoints, dark theme, icon assets, and Button component are preserved/adapted. Retrospectives support board and column creation/editing/deletion; note creation/editing/deletion; column and note reordering; within-column drag reordering; drop-on-note grouping in the same or another column; positioned cross-column dragging and accessible move controls; flat note grouping/unstacking; board lock; local JSON import/export, CSV export and Markdown export. All persisted content is Room data. Import accepts this port's export and compatible donor board JSON, remapping IDs and ignoring donor participants, author identities and voting sessions.

Sign-in, anonymous join links, server timers, participant presence, avatars, reactions, raised hands, moderator focus and ephemeral drag locks are omitted. Each explicit vote creates one `retro_vote` document. The UI shows its Provider head author and counts actual vote documents. Per-member duplicate prevention and undo-own-vote are deliberately unavailable until House core#3329 supplies current-user identity. Previous manual/imported totals remain separately labeled read-only historical counts; the UI no longer edits an aggregate total. Hidden-column stripes are an editorial marker, not a privacy boundary. Room permissions control access. Board lock is an app editing setting, not access control. Remote note images and remote embeds are rendered as inert text. The donor's server-generated CSV/PDF service is not imported; CSV/Markdown are generated locally and PDF export is not implemented.

The local fidelity correction restores the donor's previously missing note drag gestures. Mouse activation (2 px), delayed touch activation (200 ms / 5 px tolerance), intersection thresholds (0.13 combine / 0.63 move), prior-collision stabilization, combine outlines, sortable transforms and drop overlay are adapted from the pinned donor. Keyboard dragging is an additional accessible path. Modal controls remain alternatives. This is a source- and DOM-tested correction, not a claim of complete visual or interaction parity; see `FIDELITY_CORRECTION.md`.

## Room and runtime

Private sample Room: `retro-board-port` (`r_17.c`). Its schema and 41 synthetic documents were written and independently listed: 3 boards, 9 columns and 29 notes. The fixture lives in `tests/sample-documents.json` and the one-time Room creation edit is recorded under `scripts/seed-room-changes.json`; neither is part of the production import graph or release.

The App declares writable Room slot `retro`, with types `retro_board`, `retro_column`, `retro_note`, and `retro_vote`. Each board, column, note, and vote has its own Markdown document. The Room schema was extended in revision `fr_m1.2.2`; no synthetic vote documents or identity-probe writes were made. Because current House schema field kinds do not include boolean, `isLocked`, `visible`, and `edited` are string enums `"true"`/`"false"` in Room documents. `src/house.ts` alone converts these to UI booleans and exact stored field bases. Queries select `change: true`; note attribution is labeled “Last edited by” and vote attribution “Head author.” These are the Provider’s latest confirmed head authors, not original creators or the current app user. Null/absent authors display as unavailable; unsent edits retain prior confirmed metadata until accepted and refreshed. Attribution is never written into document fields or imported as a claimed author.

Every House bridge/runtime import and call is isolated in `src/house.ts`, using the current documented package pins. It uses Runtime observations and Room Draft/Save. Save means locally queued, never provider-accepted; synchronization and attention come from Runtime observations. Returned/existing drafts are preserved. Drag operations capture the original document positions at drag start, check membership and positions again before saving, and retain exact column/stack/rank bases rather than silently rebasing. Grouping guards the destination root in the same Save; positioned moves save the complete destination order and moved stack together. Grouped edits use one Save batch; destructive actions compare current membership and exact Markdown before preparing removal drafts. Vote cascades participate in exact-membership/Markdown deletion checks. Corrupt IDs, orphaned relationships, invalid stacks, unsupported flags, and unsafe imports are reported visibly. No current-user inference, identity probe, direct provider calls, credentials, copied protocol, fake runtime or browser-storage data layer are present. JSON exports contain anonymous vote totals only; reimport preserves historical counts without recreating attributed votes.

## Verification and remaining gates

- `tsc -b`, blocking TypeScript/accessibility lint, 115 unit/component tests, Vite build, and the complete-release closure audit pass.
- Tests include 13 original donor Button tests, 62 runtime/model tests, 15 DOM behavior tests, 3 fixture/export tests, 12 drag-planning tests, and 10 real dnd-kit sensor tests. DOM tests use happy-dom and isolated runtime doubles; sensor tests use deterministic element geometry with real mouse/touch/keyboard sensors; they are not browser QA or live House validation.
- Final release: 70 regular files, 1,288,588 bytes (1.229 MiB), including 60 local WOFF/WOFF2 files. Under the 2,000-file / 20 MiB limits.
- No browser launch, navigation, screenshot or viewport check was attempted, following the Master's stop instruction. Hosted desktop/360 px acceptance remains blocked by the existing environment issue.
- Current-member identity is still absent from the public Runtime contract. Per-member duplicate prevention and undo-own-vote wait on core#3329; no probe document is written to infer identity.
- No App allocation, main push, release branch or publication. Master’s live go is recorded; Tasks and the platform schema replacement fix remain prerequisites.
- The current bridge includes its own published MIT grant. All production-closure notices remain included; this is not a blanket claim that every bundled asset uses MIT.

## Notices

Donor MIT copyright (c) 2017–2021 inovex GmbH is retained in `LICENSE`, `public/LICENSE.txt`, and distributed notices. Raleway's original OFL is retained. Production dependency notices are generated from the lockfile; @cfworker/json-schema's original MIT text is supplied from its exact publication commit, with provenance and hash. The current bridge’s own published MIT grant is retained. See `SOURCE.md` and `public/licenses/PROVENANCE.txt`.

## Current JSON Schema migration (2026-10-11)

All four types now use top-level JSON Schema properties and type-level required lists. Exact identifiers/linking keys and scalar metadata use unconstrained patterns; names/descriptions/note text remain prose. The current published validator, @agentshouse/mdmodel 0.1.0-c68e2039f1ca8, is a dev-only exact pin. All 41 original synthetic documents validate unchanged; the original seed command/readback evidence remains historical.

Typecheck, lint, 117 tests, build and release audit pass. The schema-only change does not migrate the production bridge or Runtime; the existing UNLICENSED bridge notice remains honest pending that separate upgrade. Room replacement is pending the platform defect in Porting issues/tasks-schema-replacement.md, so no migration write was attempted. reports/schema-migration contains the original schema/revision and prepared exact-base replacement, which must be re-read before use. No App allocation or publication occurred.

## Current bridge Runtime migration (2026-10-11)

Applied Master’s `20261011T0440Z-master-live-go.md` locally. The only application House dependency is exact `@agentshouse/app-bridge@0.1.0-ce524f6608238`. `src/house.ts` derives its client type from `connectHouseBridge()` and returns `bridge.runtime` unchanged. The existing retry-on-rejection and cached connection remain. No Runtime protocol or client is imported, constructed or copied into application source. The bridge still lists Runtime/model packages transitively for its declarations, so the conservative installed-production-closure notices include their original licenses.

The official package test host now checks missing-host failure, rejected-client failure, retry, deferred delivery, exact client identity, connection reuse and the tab title. All existing concurrency, exact bases, refused/queued save, editor and attachment tests are retained. Current results: typecheck, lint, 119 tests, build, static release/network checks and license checks pass. Release: 70 files / 1,285,353 bytes, 60 local font files. Full check results and immutable release hashes are under `reports/runtime-migration/`.

The newly installed bridge actually declares MIT and includes its own original LICENSE; that text is now distributed verbatim. The old installed bridge gap is closed locally, and license completeness reports no unresolved gap. Original donor, font and supplemental notices remain. Historical gap statements above describe earlier package versions and checks. This does not change a platform issue’s status or establish blanket legal clearance.

No remote schema or document write, App allocation, binding, release branch, push, browser or hosted acceptance was performed. Publication remains in Tasks-first order, with the schema replacement defect pending the platform fix. Existing identity and fidelity limitations are unchanged.

## Reused donor demo (Master1150)

The current source-only fixture now adapts the pinned MIT donor's complete `src/utils/test/dummy-board-data.json`: one board, two columns and all four notes, including the stacked-note relationship and five historical vote counts. It is intentionally the donor's test content, not newly invented prose. `samples/PROVENANCE.json` records exact source/license hashes and every mapping; original files and MIT notice are in `samples/donor/`. `scripts/donor-seed-changes.json` contains the operator payload. Earlier 41-document seed evidence remains historical, not the current donor dataset. No automatic seed, runtime fixture import, fake vote authors or participant activity is introduced.

Remote application: all 41 original synthetic documents were freshly read and exactly matched their recorded seed text. One schema-validated atomic edit replaced each with an untyped historical document retaining its entire original Markdown, and created all seven donor documents. All48 resulting document texts were independently read back exactly. No House-native archive feature is claimed: these are recoverable ordinary document edits, and no file was deleted. The donor’s legacy `lean-lilac` color was subsequently adapted to supported `value-violet` with an exact field base. There were no modified user documents at this checkpoint.
