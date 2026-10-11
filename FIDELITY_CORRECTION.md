# Retro note-drag fidelity correction

Date: 2026-10-11. Scope: local-only correction of the existing Retro port. No Room/schema, Porting issue/status/message, App allocation, remote Git ref or release write was performed during this correction. No browser attempt was made.

## Finding and correction

The earlier board-only extraction retained donor styling but only persisted different-column drops. Modal move/group/reorder controls did not preserve the donor's direct manipulation. The correction adds actual drop-on-note grouping and within-column drag reorder, plus positioned cross-column drops, through the existing Room runtime boundary. Modal controls remain accessible alternatives.

Donor comparison uses `inovex/scrumlr.io` pinned at `6bae213129563eea946ec58e7a38d068dc53e0c3`:

| Donor source | Portable behavior | Port source |
| --- | --- | --- |
| `src/components/DragAndDrop/Sortable.tsx:98–159` | Drop onto note to combine; reorder within a column | `src/drag.ts:24–48`, `src/BoardView.tsx:73–91` |
| `src/constants/misc.ts:7–8` | Combine ratio 0.13; move ratio 0.63 | `src/drag.ts:4–5,33–48` |
| `src/components/DragAndDrop/CustomDndContext.tsx:37–45,64–99` | Mouse distance 2, touch delay 200/tolerance 5, previous-note collision stabilization, overlay/drop animation | `src/drag.ts:7–15`, `src/BoardView.tsx:80–91,107` |
| `src/components/DragAndDrop/Droppable.tsx:38–60` | Blank destination appends; cross-column note destination inserts before it | `src/drag.ts:36–48` |
| `src/components/DragAndDrop/Sortable.scss`, `DragOverlay.scss` | Donor drag styling | Same relative port paths, copied unchanged |

`BoardView.tsx:45–48` uses real dnd-kit sortable note nodes and mouse/touch listeners on the note body. Its focusable handle additionally supports keyboard sorting. The combine target uses the existing donor `.shouldCombine` outline; grouping suppresses reorder transforms. The overlay uses the same note content as the original card. `App.tsx:68` dispatches the planned gesture to Room-backed operations.

## Conflict and data semantics

- `BoardView.tsx:85–90` captures a drag-start board/column/note snapshot. Observation refreshes do not replace its write bases. Cancel, outside drop, lock during the gesture and unchanged drops produce no write.
- `house.ts:246–267` checks exact original column, stack and rank before reordering, then includes all those exact bases for every affected root in one Save.
- `house.ts:302–328` checks the complete source stack and destination root membership. Positioned cross-column moves save the destination order and source children together.
- `house.ts:331–355` groups the complete source stack under the chosen root in either column. The destination root's unchanged position fields are guards in the same Save, so the operation depends on the exact target root/column/rank. This is not an identity probe.
- Existing drafts and refused-save drafts are preserved. Save remains queued, not Provider acceptance. Null/absent stack bases are retained exactly. Unrelated text, author metadata and vote fields are not rewritten by these gestures.
- Current Provider head attribution (“Last edited by” / “Head author”), one document per explicit vote, and the justified current-user/presence omissions are preserved. No new schema or dependency is required.

## Verification

Passed against the final source:

- `npm run typecheck`
- `npm run lint`
- `npm test`: 115 tests in 7 files
- `npm run build`: retained donor `tsc -b && vite build`
- `npm run release:check`
- `node scripts/generate-notices.mjs --check`
- `node scripts/check-release.mjs --self-test`
- `git diff --check`

Test evidence:

- `tests/drag.test.ts`: 12 planner/stabilization tests, covering threshold boundaries, same/cross-column grouping, source-stack members, both reorder directions, positioned cross-column insertion, blank/empty-column drops and no-op/cancel/locked cases.
- `tests/drag-gesture.test.tsx`: 10 DOM tests dispatch real mouse, delayed touch and keyboard sensor events through dnd-kit. Covers note-body activation, grouping highlight, same-column reorder, cross-column group/insert, Escape, outside drops, observation refresh and lock interruption. Only element geometry is deterministic; callbacks/sensors are not mocked. These are not browser rendering or physical-device touch tests.
- `tests/house.test.ts`: 47 runtime tests including exact guarded bases, complete stack/order batching, stale position/root membership refusal, retained existing/refused drafts, and author/vote regressions.
- Remaining suites: 15 model, 15 UI, 3 export/fixture, 13 original donor Button tests.

Release artifact: 70 regular files, 1,288,588 bytes (1.229 MiB), 60 local font files. Closure audit examines 41 reachable production sources. The artifact remains below 2,000 files / 20 MiB, with local entry/manifest/schema/assets/notices. No external runtime dependency was added. License freshness and scanner self-tests pass; the pre-existing `@agentshouse/app-bridge` `UNLICENSED` grant gap remains explicitly reported, not repaired or relabeled.

## Remaining acceptance gaps

1. Actual desktop/360 px rendering, pointer/touch geometry, autoscroll and complete donor interaction/visual parity remain unverified. The donor mutates its local column lists during cross-column hover; this port keeps document order unchanged until drop and shows overlay, combine outline and textual destination feedback instead of reproducing that transient cross-column insertion gap. Browser use remains stopped. This report does not label the entire port fully donor-faithful.
2. Live House Runtime/provider acceptance and concurrent-edit conflict behavior remain unverified; local doubles establish intended Draft/Save calls and exact bases, not a live transaction guarantee.
3. Presence/drag locks and participant-dependent functions remain omitted. Current-member identity, duplicate-vote prevention and undo-own-vote remain blocked on core#3329.
4. Donor PDF export remains unimplemented; local CSV/Markdown/JSON exports are unchanged.
5. Bridge redistribution permission, the live publication go and exact future push/release instructions remain external gates. App/address are still unallocated. Remote coordination updates await the parent's authorization.
