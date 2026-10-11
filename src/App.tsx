import {useNoteDraft,type NoteDraftSource} from "./useNoteDraft";
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {BoardView,type BoardActions} from './BoardView';
import {exportCSV,exportMarkdown} from './export';
import {AttributionLabel} from './Attribution';
import {FeedbackContext,Modal} from './Modal';
import {Button} from './components/Button';
import {ColumnsIcon,PlusIcon} from './Icons';
import {type Board,type Column,type Note,type Vote,type RetroData,COLORS,DEFAULT_COLUMNS,MAX_NOTE_LENGTH,columnsFor,notesFor,votesFor,parseImport,exportBoard} from './model';
import {houseRuntime,observeRetro,observeRooms,observeSyncStatus,observeRoomDrafts,observeStorageLoss,observeConnectionRefusal,observeServiceMode,readRetro,createBoard,updateBoard,createColumn,updateColumn,createNote,updateNote,addVote,moveNote,deleteNote,deleteColumn,deleteBoard,importBoard,groupNotes,unstackNote,reorderColumns,reorderNotes,openNoteDraft,type NoteDraftSession,type HouseRuntime,type HouseRoom,type RetroResult} from './house';
const keyOf=(row:{room:string;path:string})=>`${row.room}/${row.path}`;
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e);
type Dialog={kind:'export'}|{kind:'new'}|{kind:'board';board:Board}|{kind:'column';column?:Column}|{kind:'note';note:Note};
function download(name:string,text:string,mime='application/json') {const url=URL.createObjectURL(new Blob([text],{type:mime}));const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function App() {
  const [md,setMd]=useState<HouseRuntime|null>(null);
  const [data,setData]=useState<RetroData>({boards:[],columns:[],notes:[],votes:[]});
  const [rooms,setRooms]=useState<readonly HouseRoom[]>([]);
  const [room,setRoom]=useState('');
  const [selected,setSelected]=useState('');
  const [dialog,setDialog]=useState<Dialog|null>(null);
  const [loaded,setLoaded]=useState(false);
  const [syncCompleted,setSyncCompleted]=useState(false);
  const reached=useRef(false);
  const [busy,setBusy]=useState(false);
  const busyRef=useRef(false);
  const [error,setError]=useState('');
  const [fatal,setFatal]=useState(false);
  const [attention,setAttention]=useState('');
  const [halted,setHalted]=useState(false);
  const [dark,setDark]=useState(false);
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light';},[dark]);
  useEffect(()=>{
    let disposed=false; const cleanup:(()=>void)[]=[];
    async function connect(){
      const runtime=await houseRuntime();if(disposed)return;setMd(runtime);
      const listen=async<T,>(promise:Promise<{current():T;subscribe(fn:(value:T)=>void):()=>void;close():void}>,apply:(value:T)=>void)=>{
        const observation=await promise;if(disposed){observation.close();return;}apply(observation.current());cleanup.push(observation.subscribe(value=>{if(!disposed)apply(value);}),()=>observation.close());
      };
      let latest:RetroResult|undefined;let completed=false;let queryStarted=false;
      const redraw=()=>{if(!reached.current||!completed)return;if(!queryStarted){queryStarted=true;void listen(observeRetro(runtime),value=>{if(reached.current){latest=value;redraw();}}).catch(e=>{if(!disposed){setError(errorText(e));setFatal(true);}});}if(!latest)return;try{setData(readRetro(latest));setLoaded(true);setFatal(false);}catch(e){setError(errorText(e));setFatal(true);}};
      await Promise.all([
        listen(observeRooms(runtime),value=>{reached.current=value.length===1;setRooms(value);if(value.length===1)setRoom(value[0].locator);redraw();}),
        listen(observeSyncStatus(runtime),value=>{completed=value.lastCompleted!==null;setSyncCompleted(completed);redraw();if(value.attentionRequired.length)setAttention('House returned changes that need attention. Your Room drafts are preserved; resolve them in House before retrying.');}),
        listen(observeRoomDrafts(runtime),value=>{if(value.some(draft=>draft.returned))setAttention('A Room draft needs attention. Resolve it in House before editing that document again.');}),
        listen(observeServiceMode(runtime),value=>setHalted(value==='write-halted')),
        listen(observeStorageLoss(runtime),value=>{if(value)setAttention(`House storage warning: ${value}`);}),
        listen(observeConnectionRefusal(runtime),value=>{if(value){setError(`House connection refused: ${value.reason}`);setFatal(true);}}),
      ]);
    }
    connect().catch(e=>{if(!disposed){setError(errorText(e));setFatal(true);}});
    return()=>{disposed=true;cleanup.forEach(fn=>fn());};
  },[]);
  const openedBoard=useRef<Board|undefined>(undefined);
  const currentBoard=data.boards.find(b=>keyOf(b)===selected);
  if(currentBoard)openedBoard.current=currentBoard;
  const board=currentBoard??(openedBoard.current&&keyOf(openedBoard.current)===selected?openedBoard.current:undefined);
  const columns=board?columnsFor(data,board):[];
  const notes=board?notesFor(data,board):[];
  const boardVotes=board?votesFor(data,board):[];
  const blocked=busy||fatal||!md||!syncCompleted||rooms.length!==1||!!(selected&&!currentBoard);
  async function act(work:()=>Promise<unknown>):Promise<boolean>{
    if(busyRef.current||blocked)return false;
    busyRef.current=true;setBusy(true);setError('');
    try{await work();return true;}catch(e){setError(errorText(e));return false;}finally{busyRef.current=false;setBusy(false);}
  }
  async function withClose(work:()=>Promise<unknown>){if(await act(work))setDialog(null);}
  const actions:BoardActions={
    addNote:(column,text,draft)=>act(()=>draft?draft.save(text):createNote(md!,board!,column,text)),
    openNoteDraft:column=>openNoteDraft(md!,board!,{column}),
    addVote:note=>void act(()=>addVote(md!,board!,note)),
    editNote:note=>setDialog({kind:'note',note}),editColumn:column=>setDialog({kind:'column',column}),
    moveNote:(note,column)=>void act(()=>moveNote(md!,board!,note,column,notes)),
    dropNote:(drop,opened)=>void act(()=>drop.kind==='group'?groupNotes(md!,opened.board,drop.target,drop.members):drop.kind==='reorder'?reorderNotes(md!,opened.board,drop.column,drop.orderedRoots):moveNote(md!,opened.board,drop.note,drop.column,opened.notes,drop.orderedRoots)),
    library:()=>setSelected(''),settings:()=>setDialog({kind:'board',board:board!}),addColumn:()=>setDialog({kind:'column'}),
    export:()=>setDialog({kind:'export'}),
    toggleLock:()=>void act(()=>updateBoard(md!,board!,{isLocked:!board!.isLocked})),toggleTheme:()=>setDark(v=>!v),
  };
  const removeBoard=async(value:Board)=>{if(!confirm(`Delete “${value.name}” and all of its columns, notes and vote documents from the Room?`))return;await withClose(async()=>{await deleteBoard(md!,value,data);setSelected('');});};
  const removeColumn=async(value:Column)=>{if(!confirm(`Delete “${value.name}” and all of its notes and vote documents from the Room?`))return;await withClose(()=>deleteColumn(md!,board!,value,data));};
  const removeNote=async(value:Note)=>{if(!confirm('Delete this note and any notes grouped beneath it, including their vote documents, from the Room?'))return;await withClose(()=>deleteNote(md!,board!,value,data));};
  const bindingError=syncCompleted&&rooms.length!==1?(rooms.length>1?'Retro board received multiple data bindings. Check this App’s configuration in House.':'No Retro Room is bound. Bind exactly one Retro Room in House.'):'';
  return <FeedbackContext.Provider value={bindingError||error||attention||(halted?'Provider writes are paused; Save queues changes locally.':'')}><div className="retro-app">
    {!syncCompleted&&<p role="status">Loading…</p>}
    {board?<BoardView board={board} columns={columns} notes={notes} votes={boardVotes} busy={blocked} actions={actions}/>:<main className="retro-library">
      <header className="retro-library-header"><div><ColumnsIcon/><h1>Retro board</h1></div><button className="icon-button" aria-label="Toggle dark mode" onClick={()=>setDark(v=>!v)}>◐</button></header>
      <section className="retro-library-intro"><p className="retro-eyebrow">Make space for your next idea</p><h2>Your retrospectives</h2><p>Reflect on the work. Find the patterns. Decide what comes next.</p></section>
      <div className="retro-library-actions"><Button icon={<PlusIcon/>} disabled={blocked||!room} onClick={()=>setDialog({kind:'new'})}>New board</Button><Button variant="secondary" disabled={blocked||!room} onClick={()=>input.current?.click()}>Import JSON</Button></div>
      <input type="file" ref={input} accept="application/json,.json" hidden onChange={async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;if(file.size>5_000_000){setError('Imported board is too large (5 MB maximum).');return;}await act(async()=>{const result=await importBoard(md!,room,parseImport(await file.text()));setSelected(keyOf(result.board));});}}/>
      {loaded&&selected&&!board&&<p className="retro-inline-notice">The selected board is no longer in the Room.</p>}
      <section hidden={!!bindingError} className="retro-board-cards" aria-label="Available boards">{data.boards.map(value=>{const cs=columnsFor(data,value);return <button className="retro-board-card" key={keyOf(value)} onClick={()=>setSelected(keyOf(value))}><div className="retro-board-preview" aria-hidden>{cs.slice(0,4).map(c=><div key={c.id} className={getColorClass(c.color)}><span/><span/><span/></div>)}</div><h3>{value.name}</h3><p>{value.description||'A space to reflect together.'}</p><span>{cs.length} columns · {notesFor(data,value).length} notes{value.isLocked?' · Locked':''}</span></button>;})}</section>
      {!data.boards.length&&<div className="retro-empty"><h3>{loaded&&syncCompleted&&!bindingError?'A fresh start':!syncCompleted?'Loading…':'Your boards are unavailable'}</h3><p>{syncCompleted&&rooms.length===1?'Create a board or import a local JSON file.':'Board documents will appear when House connects.'}</p></div>}
    </main>}
    {(bindingError||error||attention||halted)&&<div className="retro-notices">
      {(bindingError||error)&&<div role="alert" className="retro-notice retro-notice--error">{bindingError||error}<button aria-label="Dismiss error" onClick={()=>setError('')}>×</button></div>}
      {attention&&<div role="status" className="retro-notice">{attention}<button aria-label="Dismiss notice" onClick={()=>setAttention('')}>×</button></div>}
      {halted&&<div role="status" className="retro-notice">Provider writes are paused. You can keep typing and Save; changes queue locally until writes resume.</div>}
    </div>}
    {dialog?.kind==='export'&&board&&<Modal title="Export board" close={()=>setDialog(null)}><p className="retro-help">Download the current Room snapshot. JSON can be imported into a new board. Attributed vote documents are not copied into imports; historical counts are separate from new votes.</p><div className="retro-form-actions">{(['json','csv','md'] as const).map(format=><button key={format} onClick={()=>{try{const text=format==='json'?exportBoard(data,board):format==='csv'?exportCSV(data,board):exportMarkdown(data,board);download(`${board.name.replace(/[^a-z0-9_-]+/gi,'-')}.${format}`,text,format==='json'?'application/json':format==='csv'?'text/csv':'text/markdown');}catch(e){setError(errorText(e));}}}>Download {format==='md'?'Markdown':format.toUpperCase()}</button>)}</div></Modal>}
    {dialog?.kind==='new'&&<BoardForm busy={blocked} close={()=>setDialog(null)} save={(name,description,template)=>withClose(async()=>{const result=await createBoard(md!,room,name,template==='start-stop'?[
      {name:'Start',description:'New things to try',color:'goal-green',index:0},{name:'Stop',description:'What is holding us back?',color:'planning-pink',index:1},{name:'Continue',description:'Keep the good things going',color:'backlog-blue',index:2}
    ]:DEFAULT_COLUMNS,description);setSelected(keyOf(result.board));})}/>}
    {dialog?.kind==='board'&&<BoardForm board={dialog.board} busy={blocked} close={()=>setDialog(null)} remove={()=>void removeBoard(dialog.board)} save={(name,description)=>withClose(()=>updateBoard(md!,dialog.board,{name,description}))}/>}
    {dialog?.kind==='column'&&board&&<ColumnForm column={dialog.column} busy={blocked||board.isLocked} close={()=>setDialog(null)} remove={dialog.column?()=>void removeColumn(dialog.column!):undefined} reorder={dialog.column?(direction)=>{const i=columns.findIndex(c=>c.id===dialog.column!.id),j=i+direction;if(j<0||j>=columns.length)return;const ordered=[...columns];[ordered[i],ordered[j]]=[ordered[j],ordered[i]];void withClose(()=>reorderColumns(md!,board,ordered));}:undefined} save={value=>withClose(()=>dialog.column?updateColumn(md!,board,dialog.column,value):createColumn(md!,board,{...value,index:columns.length}))}/>}
    {dialog?.kind==='note'&&board&&<NoteForm key={keyOf(dialog.note)} note={dialog.note} notes={notes} columns={columns} busy={blocked||board.isLocked} close={()=>setDialog(null)} votes={boardVotes.filter(vote=>vote.note_id===dialog.note.id)} addVote={()=>void act(()=>addVote(md!,board,dialog.note))} draftSource={()=>openNoteDraft(md!,board,{note:dialog.note})} save={(text,draft)=>withClose(()=>draft?draft.save(text):updateNote(md!,board,dialog.note,{text,edited:true}))} remove={()=>void removeNote(dialog.note)} move={column=>withClose(()=>moveNote(md!,board,dialog.note,column,notes))} group={root=>withClose(()=>groupNotes(md!,board,root,[dialog.note]))} unstack={()=>withClose(()=>unstackNote(md!,board,dialog.note))} open={note=>setDialog({kind:'note',note})} reorder={direction=>{const column=columns.find(c=>c.id===dialog.note.column_id);if(!column)return;const roots=notes.filter(n=>n.column_id===column.id&&!n.stack_id);const i=roots.findIndex(n=>n.id===dialog.note.id),j=i+direction;if(i<0||j<0||j>=roots.length)return;[roots[i],roots[j]]=[roots[j],roots[i]];void withClose(()=>reorderNotes(md!,board,column,roots));}}/>}
  </div></FeedbackContext.Provider>;
}
function getColorClass(color:string){return `accent-color__${color}`;}
export function BoardForm({board,busy,close,save,remove}:{board?:Board;busy:boolean;close:()=>void;save:(name:string,description:string,template:string)=>Promise<void>;remove?:()=>void}) {
  const [name,setName]=useState(board?.name??'');const[description,setDescription]=useState(board?.description??'');const[template,setTemplate]=useState('classic');
  return <Modal title={board?'Board settings':'Create a retrospective'} busy={busy} close={close}><form onSubmit={e=>{e.preventDefault();void save(name,description,template);}}>
    <label>Board name<input autoFocus required maxLength={128} value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></label>
    <label>Description<textarea maxLength={1024} value={description} onChange={e=>setDescription(e.target.value)} disabled={busy}/></label>
    {!board&&<label>Template<select value={template} onChange={e=>setTemplate(e.target.value)}><option value="classic">Went well / To improve / Action items</option><option value="start-stop">Start / Stop / Continue</option></select></label>}
    <div className="retro-form-actions">{remove&&<button type="button" className="danger" disabled={busy} onClick={remove}>Delete board</button>}<button type="button" disabled={busy} onClick={close}>Cancel</button><button type="submit" className="primary" disabled={busy||!name.trim()}>{board?'Save changes':'Create board'}</button></div>
  </form></Modal>;
}
export function ColumnForm({column,busy,close,save,remove,reorder}:{column?:Column;busy:boolean;close:()=>void;save:(value:Pick<Column,'name'|'description'|'color'|'visible'>)=>Promise<void>;remove?:()=>void;reorder?:(direction:number)=>void}) {
  const[name,setName]=useState(column?.name??'');const[description,setDescription]=useState(column?.description??'');const[color,setColor]=useState(column?.color??'backlog-blue');const[visible,setVisible]=useState(column?.visible??true);
  return <Modal title={column?'Edit column':'Add a column'} busy={busy} close={close}><form onSubmit={e=>{e.preventDefault();void save({name,description,color,visible});}}>
    <label>Column name<input autoFocus required maxLength={128} value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></label><label>Description<textarea maxLength={1024} value={description} onChange={e=>setDescription(e.target.value)} disabled={busy}/></label>
    <label>Color<select value={color} onChange={e=>setColor(e.target.value as typeof color)} disabled={busy}>{COLORS.map(c=><option key={c}>{c}</option>)}</select></label>
    <label className="retro-checkbox"><input type="checkbox" checked={visible} onChange={e=>setVisible(e.target.checked)} disabled={busy}/>Mark column visible</label><p className="retro-help">A hidden mark adds stripes for planning. Room access still controls who can read its notes.</p>
    {reorder&&<div className="retro-form-actions"><button type="button" disabled={busy} onClick={()=>reorder(-1)}>Move column left</button><button type="button" disabled={busy} onClick={()=>reorder(1)}>Move column right</button></div>}
    <div className="retro-form-actions">{remove&&<button type="button" className="danger" disabled={busy} onClick={remove}>Delete column</button>}<button type="button" onClick={close} disabled={busy}>Cancel</button><button className="primary" type="submit" disabled={busy||!name.trim()}>Save column</button></div>
  </form></Modal>;
}
export function NoteForm({note,notes,columns,busy,close,save,remove,move,group,unstack,open,reorder,votes=[],addVote,draftSource}:{note:Note;notes:Note[];columns:Column[];busy:boolean;close:()=>void;save:(text:string,draft?:NoteDraftSession)=>Promise<void>;draftSource?:NoteDraftSource;remove:()=>void;move:(column:Column)=>Promise<void>;group:(note:Note)=>Promise<void>;unstack:()=>Promise<void>;open:(note:Note)=>void;reorder?:(direction:number)=>void;votes?:Vote[];addVote?:()=>void}) {
  const draft=useNoteDraft(note.text,keyOf(note),draftSource);const text=draft.value;const setText=draft.change;const[target,setTarget]=useState(note.column_id);const[root,setRoot]=useState('');
  const children=notes.filter(n=>n.stack_id===note.id);const dirty=text!==note.text;
  // Opening another group item explicitly remounts the form with its own snapshot.
  const candidateRoots=notes.filter(n=>!n.stack_id&&n.id!==note.id&&n.column_id===note.column_id);
  function safeClose(){close();}
  return <Modal title={children.length?'Note group':'Edit note'} busy={busy} close={safeClose}><form onSubmit={(e:FormEvent)=>{e.preventDefault();void (async()=>{const pending=draft.session();const session=pending?await pending:undefined;await(session?save(text,session):save(text));})().catch(draft.report);}}>
    {draft.error&&<p role="alert">{draft.error}</p>}
    <label>Note<textarea autoFocus rows={6} maxLength={MAX_NOTE_LENGTH} required value={text} onChange={e=>setText(e.target.value)} disabled={busy}/></label><span className="retro-help">{text.length}/{MAX_NOTE_LENGTH} · Shift + Enter for a new line</span>
    <AttributionLabel author={(notes.find(current=>current.room===note.room&&current.id===note.id)??note).lastEditedBy}/>
    {note.votes>0&&<p className="retro-help">Legacy imported/manual vote total: {note.votes}. This is separate from the vote documents below.</p>}
    <div className="retro-form-actions"><button type="button" className="danger" onClick={remove} disabled={busy}>Delete</button><button type="button" onClick={safeClose} disabled={busy}>Cancel</button><button type="submit" className="primary" disabled={busy||!text.trim()}>Save note</button></div>
  </form>
  <section className="retro-vote-list"><h3>Votes ({votes.length})</h3><p className="retro-help">Each click adds one vote document. Per-member duplicate prevention and undo-own-vote are waiting for House current-user support.</p><button disabled={busy||dirty||!addVote} onClick={addVote}>Add vote</button>{votes.length>0?<ul>{votes.map(vote=><li key={keyOf(vote)}><AttributionLabel author={vote.author} label="Head author"/></li>)}</ul>:<p className="retro-help">No vote documents yet.</p>}</section>
  {children.length>0&&<section className="retro-group-list"><h3>Grouped notes</h3>{children.map(child=><button key={child.id} onClick={()=>open(child)}>{child.text}</button>)}</section>}
  <section className="retro-note-organize"><h3>Organize</h3>{dirty&&<p className="retro-help">Save text changes before organizing.</p>}
    {reorder&&!note.stack_id&&<div className="retro-form-actions"><button disabled={busy||dirty} onClick={()=>reorder(-1)}>Move note up</button><button disabled={busy||dirty} onClick={()=>reorder(1)}>Move note down</button></div>}
    <label>Move to column<select value={target} onChange={e=>setTarget(e.target.value)} disabled={busy||dirty}>{columns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button disabled={busy||dirty||target===note.column_id} onClick={()=>{const c=columns.find(c=>c.id===target);if(c)void move(c);}}>Move {children.length?'group':'note'}</button>
    {!children.length&&!note.stack_id&&candidateRoots.length>0&&<><label>Group beneath<select value={root} onChange={e=>setRoot(e.target.value)} disabled={busy||dirty}><option value="">Choose a note</option>{candidateRoots.map(n=><option key={n.id} value={n.id}>{n.text.slice(0,80)}</option>)}</select></label><button disabled={busy||dirty||!root} onClick={()=>{const parent=notes.find(n=>n.id===root);if(parent)void group(parent);}}>Group notes</button></>}
    {note.stack_id&&<button disabled={busy||dirty} onClick={()=>void unstack()}>Remove from group</button>}
  </section></Modal>;
}
