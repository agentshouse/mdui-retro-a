import {it,expect} from 'vitest';
import {exportCSV,exportMarkdown} from '../src/export';
import {readRetro} from '../src/house';
import rows from './sample-documents.json';
const data=readRetro({documents:rows.map(row=>({...row,room:'sample'}))});
it('loads the real seed fixture as one licensed donor board with two columns and four notes',()=>{expect(data.boards).toHaveLength(1);expect(data.columns).toHaveLength(2);expect(data.notes).toHaveLength(4);});
it('exports quoted CSV, guarding spreadsheet formulas',()=>{const board=data.boards[0];const note=data.notes[0];const csv=exportCSV({...data,notes:[{...note,text:'=HYPERLINK("evil")\ntext'}]},board);expect(csv).toContain('"\'=HYPERLINK(""evil"")\ntext"');expect(csv).toContain('Vote documents');});
it('exports plain local Markdown without remote logos or participant data',()=>{const markdown=exportMarkdown(data,data.boards[0]);expect(markdown).toContain('# Test Board');expect(markdown).toContain('## Positive');expect(markdown).not.toMatch(/https?:|participants|avatar|scrumlr/i);});
