# Provider write-halt and local Save

The installed `@agentshouse/mdruntime/AGENTS.md` lines 175–180 explicitly distinguish Provider Actions from local Room Draft Save. During `write-halted`, local Save still validates and queues a Change Batch; submission waits until the Provider reopens writes. A refused Provider Action must not be held or retried by an App.

This release removes only the App's incorrect service-mode gate on local typing/Save. The notice now explains that local changes remain queued while Provider writes are paused. Existing Room readiness, reach, refusal, storage, exact-base, board-lock and validation guards are retained. These Apps do not call House Actions; their existing mutation operations use Room Draft writes and Save.

Regression coverage exercises local Save during a write-halt; existing reach-loss/refusal and draft-preservation coverage remains. No schema, manifest, binding, Room data, donor content, licence, authentication or House Action contract changes are introduced. Exact-commit typecheck, lint, tests, build, release and licence checks precede ordinary source and parentless release pushes.

Hosted acceptance is pending the shared House browser-authentication repair; no browser pass is inferred from local tests or publication.
