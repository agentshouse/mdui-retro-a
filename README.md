# Retro Board

A collaborative retrospective board with columns, notes, stacks, and votes stored as Room documents.

Use Node.js 24.21 or newer. Install with `npm ci --ignore-scripts --no-audit`, then run `npm run dev` for development or `npm run build` for a production build. `npm run verify` checks types, lint, tests, starter documents, licenses, source safety, and the release artifact.

`starter/` contains a small existing example board with its columns and notes at their original Room-relative paths. Starter documents are optional; the App never seeds a Room automatically.

To publish, configure `origin` as the credential-free HTTPS Git URL of your House App, commit your changes on `main`, and run `npm run publish`. It verifies a clean source tree and atomically publishes source and a parentless release. Verify the published source revision in House afterward.

License texts and notices are retained in `LICENSE` and `public/licenses/`.
