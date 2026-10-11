# Master 12:25 donor chrome audit

Instruction: Porting `messages/20261011T1225Z-master-crm-room-label.md`, 2026-10-11. Donor Retro Board at `6bae213` was inspected in its Board, BoardHeader and InfoBar components. The persistent House sync row and generic Room chooser were port additions. Removed both from the library and open board. Real drag/drop guidance stays visible only during dragging; errors, refused drafts, storage warnings and write-halt notices remain.

Board selection remains business selection. The single-slot port chooses a creation binding only when the host returns exactly one Room, otherwise exposes a configuration error and blocks mutation. No Room names/paths are displayed as ordinary chrome. No hardcoded locator, schema/manifest/provider changes or fallback/copy/rebinding.

Verification: typecheck, lint, full 121 tests in 10 files, build and release:check pass. Board DOM and drag-gesture tests verify the retained structure and guidance without ambient sync text. Hosted browser acceptance remains separate.

Removed the remaining port-only storage/presence footer and renamed the board access label to Shared board. No participant identities or presence are fabricated.
