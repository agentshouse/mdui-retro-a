// @vitest-environment node
import { test, expect } from 'vitest';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { verify, validate } from '@agentshouse/mdmodel';
import rows from './sample-documents.json';
test('licensed donor fixture preserves all content and relationships without live authors', () => {
 const source = fs.readFileSync('samples/donor/dummy-board-data.json','utf8');
 const donor=JSON.parse(source); const manifest=JSON.parse(fs.readFileSync('samples/PROVENANCE.json','utf8'));
 expect(crypto.createHash('sha256').update(source).digest('hex')).toBe(manifest.source_sha256);
 expect(crypto.createHash('sha256').update(fs.readFileSync('samples/donor/LICENSE')).digest('hex')).toBe(manifest.license_sha256);
 const notes=rows.filter(r=>r.type==='retro_note'); expect(notes).toHaveLength(donor.notes.length);
 for(const note of donor.notes) { const actual=notes.find(r=>r.fields.id===note.id)!.fields;expect(actual.text).toBe(note.text);expect(actual.column_id).toBe(note.position.column);expect(actual.stack_id).toBe(note.position.stack??''); }
 expect(rows.some(r=>(r.type as string)==='retro_vote')).toBe(false);
 const v=verify(fs.readFileSync('schema.yaml','utf8'));if(v.verdict!=='accept')throw Error('schema');
 const payload=JSON.parse(fs.readFileSync('scripts/donor-seed-changes.json','utf8'));expect(validate(Object.fromEntries(payload.changes.map((c:{path:string;content:string})=>[c.path.replace('/rooms/retro-board-port/',''),c.content])),{binaryTargets:[]},v.model)).toEqual({verdict:'accept'});
});
