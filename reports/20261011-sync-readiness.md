# Room readiness correction, 11 October 2026

Implements Master’s Porting instruction `messages/20261011T1400Z-master-rooms-wait-for-sync.md`.

The App observes the complete values of both `rooms` and `sync-status`. `lastCompleted: null` remains a loading state. Once the first sync completes, a missing or ambiguous sole-slot binding is a recoverable current-state error. A later exactly-one-Room value clears that binding error without a reload. The latest completed timestamp continues to count while another synchronization is pending or running.

Typed data observation waits for the first completed synchronization and an available Room. Reach loss blocks mutation while retaining local form state and opened document bases. Recovery does not discard or silently rebase Room drafts. Storage-loss and connection-refusal warnings remain separate from binding readiness.

Tests cover initial empty/incomplete sync, zero/multiple Rooms after completion, late sole-Room recovery, and lost/recovered reach. The React ports include mounted unsaved-input coverage; Recombiner retains the same mounted Add Book dialog and tests its store’s readiness/write guard and Room identity.

The installed bridge/runtime documentation and `status.d.ts`, `connection.js`, and `reach.js` were read to verify the contract. No new Runtime API, credentials, local fallback data, schema, Room data, App allocation, or binding changes are introduced. Existing donor UI, licences and build distribution checks are preserved.

Full exact-commit typecheck, lint, tests, build, release check and licence audit are required before source/release publication. Hosted desktop/narrow CRUD, reload and synchronization acceptance remains pending the parent’s browser recheck; local tests and publication do not establish hosted acceptance.
