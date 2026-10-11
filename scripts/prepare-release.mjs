import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { generateNotices, root } from './generate-notices.mjs'

// Source manifests are authoritative; Vite copies public into the release.
fs.mkdirSync(path.join(root, 'public'), { recursive: true })
for (const name of ['app.json', 'schema.yaml']) {
  assert(fs.statSync(path.join(root, name)).isFile(), `Missing source manifest: ${name}`)
  fs.copyFileSync(path.join(root, name), path.join(root, 'public', name))
}
console.log(JSON.stringify(generateNotices(), null, 2))
