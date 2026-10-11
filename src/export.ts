import {columnsFor,notesFor,votesForNote,type RetroData,type Board} from './model';
/** Local text exports; no donor API or remote branding/image. */
export function exportCSV(data:RetroData,board:Board):string {
  const quote=(value:string|number)=>{let text=String(value);if(/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  const notes=notesFor(data,board);
  const rows:(string|number)[][]=[['Column','Note','Group','Vote documents','Legacy recorded votes']];
  for(const column of columnsFor(data,board))for(const note of notes.filter(n=>n.column_id===column.id))rows.push([column.name,note.text,note.stack_id?notes.find(n=>n.id===note.stack_id)?.text??'':'',votesForNote(data,board,note).length,note.votes]);
  return '\ufeff'+rows.map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n';
}
export function exportMarkdown(data:RetroData,board:Board):string {
  const escape=(text:string)=>text.replace(/[\\`*_{}[\]()#+.!<>]/g,'\\$&');
  const lines=[`# ${escape(board.name)}`,'',escape(board.description),''];
  const notes=notesFor(data,board);
  for(const column of columnsFor(data,board)){
    lines.push(`## ${escape(column.name)}`,'',escape(column.description),'');
    for(const note of notes.filter(n=>n.column_id===column.id&&!n.stack_id)){
      lines.push(`- ${escape(note.text).replaceAll('\n','\n  ')}${votesForNote(data,board,note).length?` (${votesForNote(data,board,note).length} vote documents)`:''}${note.votes?` (${note.votes} legacy recorded votes)`:''}`);
      for(const child of notes.filter(n=>n.stack_id===note.id))lines.push(`  - ${escape(child.text).replaceAll('\n','\n    ')}${votesForNote(data,board,child).length?` (${votesForNote(data,board,child).length} vote documents)`:''}${child.votes?` (${child.votes} legacy recorded votes)`:''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
