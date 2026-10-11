import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { verify, validate, parse } from '@agentshouse/mdmodel'
const schema = fs.readFileSync('schema.yaml', 'utf8')
const model = verify(schema)
assert.equal(model.verdict, 'accept')
const documents = {}
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink())
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(file)
    else { assert(entry.isFile() && file.endsWith('.md')); documents[path.relative('starter', file)] = fs.readFileSync(file, 'utf8') }
  }
}
walk('starter')
assert(Object.keys(documents).length > 0)
assert.equal(validate({ 'settings/schema.yaml': schema, ...documents }, { binaryTargets: [] }, model.model).verdict, 'accept')
const originals = new Map(JSON.parse(fs.readFileSync('tests/support/donor-seed-changes.json', 'utf8')).changes.map(row => [row.path.replace(/^\/rooms\/[^/]+\//, ''), row.content]))
const rows = Object.entries(documents).map(([file, content]) => {
  assert.equal(content, originals.get(file), 'Starter must retain original demo paths and bytes.')
  const result = parse(content, file); assert(result.ok); return result.document
})
for (const row of rows) {
  for (const [field, type] of [['board_id', 'retro_board'], ['column_id', 'retro_column'], ['stack_id', 'retro_note'], ['note_id', 'retro_note']]) {
    const id = row.fields[field]
    if (id) assert(rows.some(other => other.type === type && other.fields.id === id), `Missing ${field}: ${id}`)
  }
}
console.log(`PASS: ${rows.length} original starter records accepted with closed references.`)
