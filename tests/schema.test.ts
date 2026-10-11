// @vitest-environment node
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verify, validate } from '@agentshouse/mdmodel';

test('current JSON Schema keeps slot types, exact IDs and closed-object validation', () => {
  const source = readFileSync(new URL('../schema.yaml', import.meta.url), 'utf8');
  const result = verify(source);
  assert.equal(result.verdict, 'accept');
  if (result.verdict !== 'accept') throw new Error(JSON.stringify(result));
  const manifest = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(result.model.types).sort(), [...new Set(manifest.room_slots.flatMap((slot: { types: string[] }) => slot.types))].sort());
  assert(!/^types:/m.test(source));
  for (const [name, type] of Object.entries(result.model.types)) {
    assert.equal(type.fields.id?.type, 'string', name);
    assert.equal(type.fields.id?.prose, false, `${name}: IDs must remain exact-match values`);
    const shape = type.shape.schema as { properties: Record<string, { type?: string; enum?: unknown[] }>; required: string[] };
    const fields = Object.fromEntries(Object.entries(shape.properties).map(([field, spec]) => [field, spec.enum?.[0] ?? (spec.type === 'number' ? 0 : 'sample')]));
    const markdown = (values: Record<string, unknown>) => `---\ntype: ${name}\n${Object.entries(values).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n`;
    assert.deepEqual(validate({ 'valid.md': markdown(fields) }, { binaryTargets: [] }, result.model), { verdict: 'accept' });
    const invalid = validate({ 'invalid.md': markdown({ ...fields, unknown_field: 'refused' }) }, { binaryTargets: [] }, result.model);
    assert.equal(invalid.verdict, 'refuse');
    if (invalid.verdict === 'refuse') assert.equal(invalid.rule, 'undeclared-field');
    for (const required of shape.required) {
      const missing = { ...fields }; delete missing[required];
      const refusal = validate({ 'missing.md': markdown(missing) }, { binaryTargets: [] }, result.model);
      assert.equal(refusal.verdict, 'refuse', `${name}.${required} is required`);
      if (refusal.verdict === 'refuse') assert.equal(refusal.rule, 'required');
    }
  }
});

test('all original synthetic documents still validate without rewriting historical seed evidence', () => {
  const result = verify(readFileSync(new URL('../schema.yaml', import.meta.url), 'utf8'));
  if (result.verdict !== 'accept') throw new Error(JSON.stringify(result));
  const original = JSON.parse(readFileSync(new URL('./support/seed-room-changes.json', import.meta.url), 'utf8')) as { changes: { path: string; content: string }[] };
  const library = Object.fromEntries(original.changes.filter(change => !change.path.endsWith('/schema.yaml')).map(change => [change.path.replace('/rooms/retro-board-port/', ''), change.content]));
  assert.equal(Object.keys(library).length, 41);
  assert.deepEqual(validate(library, { binaryTargets: [] }, result.model), { verdict: 'accept' });
});
