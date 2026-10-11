# Retro local-first note drafts

Implements the Master's 14:15 SPA/draft, 14:20 local-first/shared-overlap, and 14:25 business-field instructions after readiness release 3.

Inline new-note input and editing existing note text stage the actual retro_note business fields at the actual final note path in runtime Room Draft on every change. New note creation may contain empty, incomplete text until explicit Save. Existing text fields preserve their first opened bases. Runtime Presentation State holds only the new-note path for each Room/board/column, never copied content. No new schema type, recovery path or buffer document is introduced.

A serialized CAS loop re-reads the shared local draft and reapplies this tab's latest text on stale overlap; disjoint fields remain intact. Room Draft observations redraw other tabs. Reopening restores local text, and a write already triggered by typing finishes even if navigation beats draft hydration. Typing never calls Save. Explicit Save validates locally against the current observed Room and queues the exact draft revision. Failed validation and returned/conflicting drafts stay available.

Opening boards, columns and grouped notes uses the mounted donor UI and eagerly bundled code; data comes from the full observed Room snapshot. No whole-page navigation, route lazy chunks or unsaved-input prompts are introduced. Board/column popup fields retain the permitted popup behavior; the 14:25 instruction explicitly accepts half-typed popup input loss on reload. Existing reach-loss guards preserve the mounted note form and draft while preventing mutation.

Regression tests cover incomplete creation, local-only typing, reopen hydration, immediate unmount, shared-tab same-field last-input-wins, disjoint field preservation, first bases and explicit revision Save. The existing readiness, refusal and mutation tests remain in the full suite. Final exact-commit type/lint/test/build/release/license checks precede publication. Hosted acceptance remains pending the House release activation repair and parent recheck.
