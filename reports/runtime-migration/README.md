# Runtime migration verification

## Current bridge Runtime migration (2026-10-11)

Applied Master’s `20261011T0440Z-master-live-go.md` locally. The only application House dependency is exact `@agentshouse/app-bridge@0.1.0-ce524f6608238`. `src/house.ts` derives its client type from `connectHouseBridge()` and returns `bridge.runtime` unchanged. The existing retry-on-rejection and cached connection remain. No Runtime protocol or client is imported, constructed or copied into application source. The bridge still lists Runtime/model packages transitively for its declarations, so the conservative installed-production-closure notices include their original licenses.

The official package test host now checks missing-host failure, rejected-client failure, retry, deferred delivery, exact client identity, connection reuse and the tab title. All existing concurrency, exact bases, refused/queued save, editor and attachment tests are retained. Current results: typecheck, lint, 119 tests, build, static release/network checks and license checks pass. Release: 70 files / 1,285,353 bytes, 60 local font files. Full check results and immutable release hashes are under `reports/runtime-migration/`.

The newly installed bridge actually declares MIT and includes its own original LICENSE; that text is now distributed verbatim. The old installed bridge gap is closed locally, and license completeness reports no unresolved gap. Original donor, font and supplemental notices remain. Historical gap statements above describe earlier package versions and checks. This does not change a platform issue’s status or establish blanket legal clearance.

No remote schema or document write, App allocation, binding, release branch, push, browser or hosted acceptance was performed. Publication remains in Tasks-first order, with the schema replacement defect pending the platform fix. Existing identity and fidelity limitations are unchanged.

`checks.json` records exact check exit codes and test counts. `release-audit.json` is the complete static release audit; `license-check.json` records original-notice completeness. `release-sha256.json` identifies this complete artifact. Local `.log`/`.err` files are diagnostic output and are not committed.
