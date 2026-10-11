# Source provenance and extraction

- Donor: https://github.com/inovex/scrumlr.io
- Branch at extraction: main
- Pinned commit: 6bae213129563eea946ec58e7a38d068dc53e0c3
- Donor version: 5.4.2
- Donor license: MIT, copyright (c) 2017–2021 inovex GmbH

The donor checkout remains separately available for comparison; it is not included in the release.

## Retained donor files

- `src/index.scss`: unchanged donor base styles, including six local Raleway font weights
- `src/constants/_colors.scss`, `_styles.scss`, `_mixins.scss`, `colors.ts`: donor tokens, mixins and color helpers
- `src/components/Board/Board.scss`, `Column/Column.scss`, `Column/ColumnHeader/ColumnHeader.scss`, `Column/ColumnDetails/ColumnDetails.scss`, `Note/Note.scss`, `NoteInput/NoteInput.scss`, `BoardHeader/BoardHeader.scss`, `Infobar/Infobar.scss`: unchanged donor layout, card and responsive styles
- `src/components/DragAndDrop/Sortable.scss` and `DragOverlay.scss`: unchanged donor drag-state and overlay styles
- `src/components/Button/Button.tsx` and `Button.scss`: unchanged donor primitive; index exports only the used Button
- `src/components/Button/__tests__/Button.test.tsx`: original donor tests; minimal `testUtils.tsx` removes unrelated auth/store wrappers
- `src/assets/icons/*.svg`: selected original donor icons; no product logo, avatars, remote imagery or bundled marketing assets
- Root MIT license is unchanged

`BoardView.tsx` adapts donor board, column/header, note and note-input markup to typed document props. Go-bound selectors/actions and participant logic are removed. `App.tsx`, `Modal.tsx` and `port.scss` supply an ordinary document library, forms and House feedback; no donor login shell is retained. Native textarea resizing replaces react-textarea-autosize to avoid carrying a dependency with an absent upstream license notice.

`house.ts` is the single runtime boundary. `model.ts` expresses donor-style column order, descending note ranks and one-level note stacks without participant IDs. Head authors are read-only Provider metadata; `retro_vote` documents contain only id/board_id/note_id. `export.ts` generates local CSV/Markdown with no API calls, logos or remote assets.

## Tooling changes

The donor `tsc -b && vite build` pipeline and Vite React/SVGR/SCSS setup are retained. Build output is `dist` instead of `build`, with relative URLs. Unused donor dependencies are omitted and a reproducible npm lockfile is committed. The donor's accessibility plugin declares support through ESLint 9 while its package.json lists ESLint 10; this extraction pins ESLint 9 within that peer range and uses blocking recommended TS/accessibility rules rather than the donor's warning-only plugin. Vitest runs only retained and port-specific tests, not the full donor suite.

## Verification boundary

The release checker parses reachable production TS/TSX/JS, follows CSS/SVG/assets, verifies local HTML/import/CSS references, compares manifest/schema/notices to source, checks font closure, rejects symlinks/path escapes/forbidden network constructs and checks size. Its positive/negative scanner fixtures pass. This is static evidence, not intercepted browser-network evidence. No browser attempt or publication was made.

## Attribution and vote extension

Master-directed extension uses only the installed public `select.change: true` contract. Notes show the Provider head author as “Last edited by”; vote documents show “Head author,” with user/site kind and honest unavailable attribution. Each explicit vote creates a fresh document containing only id, board_id and note_id. No current-user observation exists yet, so per-member duplicate prevention and undo-own-vote remain pending core#3329. Provider attribution is not editable/importable app data; no identity probe is used. Existing numeric note votes are read-only historical totals. JSON export stores aggregate voteTotals without authors, and import preserves them only as historical counts, never as new vote documents.

## Local note-gesture correction

The original extraction handled only cross-column note drops. The current local correction restores within-column drag reordering and drop-on-note grouping, including moving an entire existing stack across columns. `src/drag.ts` adapts the donor's combine/move thresholds and collision stabilization from `constants/misc.ts`, `DragAndDrop/Sortable.tsx`, `Droppable.tsx`, and `CustomDndContext.tsx`. `BoardView.tsx` uses the donor's mouse/touch activation settings, real dnd-kit sortable contexts, combine outline and shared note overlay markup. Keyboard sorting is an additional accessible path. `App.tsx` connects the resulting plan to the existing Room-backed grouping/reorder/move operations, extended to preserve the drag-start column/stack/rank bases and batch dependent changes.

`FIDELITY_CORRECTION.md` records exact source comparisons, deterministic DOM gesture tests, release checks and remaining browser/live-Runtime gaps. No new dependency or schema is introduced. This correction is local only; no Room, Porting issue/status/message, App, remote Git ref or release was changed.
