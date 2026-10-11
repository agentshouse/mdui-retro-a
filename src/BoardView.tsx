import {useNoteDraft} from "./useNoteDraft";
import type {NoteDraftSession} from "./house";
// The board/column/note structure and SCSS are adapted from the pinned donor.
// Store selectors and websocket actions are replaced by document props/callbacks.
import {useRef, useState, type CSSProperties, type FormEvent, type ReactNode} from 'react';
import {DndContext, DragOverlay, defaultDropAnimationSideEffects, MouseSensor, TouchSensor, KeyboardSensor, rectIntersection, useSensor, useSensors, useDroppable, type DragEndEvent, type DragMoveEvent, type DragStartEvent, type Collision, type DragOverEvent} from '@dnd-kit/core';
import {SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates} from '@dnd-kit/sortable';
import {CSS} from '@dnd-kit/utilities';
import {planNoteDrop,describeNoteDrop,stabilizeCollisions,type DragSnapshot,type NoteDrop} from './drag';
import classNames from 'classnames';
import {getColorClassName} from './constants/colors';
import {type Board, type Column, type Note, type Vote, MAX_NOTE_LENGTH} from './model';
import {AttributionLabel} from './Attribution';
import {PlusIcon, EditIcon, ArrowLeftIcon, ArrowRightIcon, ColumnsIcon, SettingsIcon, LockIcon, UnlockIcon, FileIcon} from './Icons';
import './components/Board/Board.scss';
import './components/Column/Column.scss';
import './components/Column/ColumnHeader/ColumnHeader.scss';
import './components/Column/ColumnDetails/ColumnDetails.scss';
import './components/Note/Note.scss';
import './components/NoteInput/NoteInput.scss';
import './components/BoardHeader/BoardHeader.scss';
import './components/Infobar/Infobar.scss';
import './components/DragAndDrop/Sortable.scss';
import './components/DragAndDrop/DragOverlay.scss';
export type BoardActions = {
  addNote:(column:Column,text:string,draft?:NoteDraftSession)=>Promise<boolean>;
  openNoteDraft?:(column:Column)=>Promise<NoteDraftSession>;
  editNote:(note:Note)=>void;
  addVote:(note:Note)=>void;
  editColumn:(column:Column)=>void;
  moveNote:(note:Note,column:Column)=>void;
  dropNote:(drop:NoteDrop,snapshot:DragSnapshot)=>void;
  library:()=>void; settings:()=>void; addColumn:()=>void; export:()=>void;
  toggleLock:()=>void; toggleTheme:()=>void;
};
type NoteContentProps={note:Note;stackSize:number;disabled:boolean;onOpen:()=>void;onVote:()=>void;votes:Vote[];handle:ReactNode};
function NoteContent({note,stackSize,disabled,onOpen,onVote,votes,handle}:NoteContentProps){
  return <><article className="note note--stackBetween">
    <header className="note__header"><span className="note__author-container retro-note-kind"><AttributionLabel author={note.lastEditedBy}/></span>
      <button type="button" className="retro-votes" onClick={onVote} disabled={disabled} title="Add one vote document. Duplicate prevention and undo are not available yet." aria-label={`Add vote to note: ${note.text}`}>+ {votes.length}</button>
      {handle}
    </header>
    <button type="button" className="retro-open-note" onClick={onOpen} aria-label={`Open note: ${note.text}`}><main className="note__container note__container--extended"><div className="note__text">{note.text}</div>{note.edited&&<div className="note__marker-edited">(edited)</div>}</main></button>
    <footer className="note__footer"><span className="retro-note-kind">{stackSize>0?`${stackSize+1} grouped notes`:note.votes>0?`${note.votes} legacy recorded votes`:null}</span><button className="retro-note-more" onClick={onOpen}>{stackSize?'Open group':'Edit note'} <EditIcon/></button></footer>
  </article>{stackSize>0&&<div className="note__in-stack"/>}</>;
}
export function NoteCard({note,stackSize,color,disabled,onOpen,onVote,votes,combine=false}:{note:Note;stackSize:number;color:string;disabled:boolean;onOpen:()=>void;onVote:()=>void;votes:Vote[];combine?:boolean}) {
  const drag=useSortable({id:note.id,data:{type:'note',columnId:note.column_id},disabled});
  const style:CSSProperties={transform:CSS.Transform.toString(drag.transform),transition:drag.transition};
  return <div role="button" tabIndex={-1} aria-label={`Draggable note: ${note.text.slice(0,70)}`} aria-disabled={disabled} ref={drag.setNodeRef} data-note-id={note.id} style={style} className={classNames('note__root','sortable',color,{'sortable--dragging':drag.isDragging,shouldCombine:combine})} onMouseDown={event=>drag.listeners?.onMouseDown?.(event)} onTouchStart={event=>drag.listeners?.onTouchStart?.(event)}>
    <NoteContent note={note} stackSize={stackSize} disabled={disabled} onOpen={onOpen} onVote={onVote} votes={votes} handle={<button type="button" className="retro-drag-handle" aria-label={`Move note: ${note.text.slice(0,30)}`} title="Drag to group, reorder or move" ref={drag.setActivatorNodeRef} {...drag.attributes} onKeyDown={event=>drag.listeners?.onKeyDown?.(event)} disabled={disabled}>⠿</button>}/>
  </div>;
}
function NoteInput({column,disabled,onAdd,openDraft}:{column:Column;disabled:boolean;onAdd:(column:Column,text:string,draft?:NoteDraftSession)=>Promise<boolean>;openDraft?:()=>Promise<NoteDraftSession>}) {
  const draft=useNoteDraft('',`${column.room}/${column.path}`,openDraft);
  const value=draft.value;const setValue=draft.change;
  const [sending,setSending]=useState(false);
  async function submit(event:FormEvent) {event.preventDefault();if(sending||disabled||!value.trim())return;setSending(true);const text=value;try{const pending=draft.session();const session=pending?await pending:undefined;if(await(session?onAdd(column,text,session):onAdd(column,text)))draft.restart();}catch(error){draft.report(error);}finally{setSending(false);}}
  return <form className="note-input" onSubmit={submit}>
    <textarea rows={1} className="note-input__input" aria-label={`Add note to ${column.name}`} placeholder="Write a note…" value={value} maxLength={MAX_NOTE_LENGTH} disabled={disabled||sending} onChange={event=>{setValue(event.target.value);event.target.style.height="auto";event.target.style.height=`${event.target.scrollHeight}px`;}} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();event.currentTarget.form?.requestSubmit();}}}/>
    <button type="submit" className="note-input__add-button" title="Add note" aria-label={`Create note in ${column.name}`} disabled={disabled||sending||!value.trim()}><PlusIcon className="note-input__icon--add"/></button>
    {draft.error&&<p role="alert">{draft.error}</p>}
    {value.length>1800&&<span className="retro-character-count">{value.length}/{MAX_NOTE_LENGTH}</span>}
  </form>;
}
function BoardColumn({column,notes,votes,disabled,actions,dropIntent}:{column:Column;notes:Note[];votes:Vote[];disabled:boolean;actions:BoardActions;dropIntent:NoteDrop|null}) {
  const drop=useDroppable({id:`column:${column.id}`,data:{type:'column'},disabled});
  const color=getColorClassName(column.color);
  const roots=notes.filter(note=>!note.stack_id);
  return <section className={classNames('column',color,{'column--hidden':!column.visible})} aria-label={column.name}>
    <div className="column__content"><div className="column-header">
      <div className="column-details column-details--moderator-view"><div className="column-details__name-and-settings-wrapper">
        <div className="column-details__name-wrapper"><button className="column-details__name column-details__name--moderator" onClick={()=>actions.editColumn(column)} title={column.name}>{column.name}</button><span className="column-details__notes-count">{notes.length}</span></div>
        <button className="icon-button" aria-label={`Edit ${column.name} column`} onClick={()=>actions.editColumn(column)}><SettingsIcon/></button>
      </div><p className="retro-column-description">{column.description||'Add a description…'}{!column.visible&&' · Marked hidden'}</p></div>
      <NoteInput column={column} disabled={disabled} onAdd={actions.addNote} openDraft={actions.openNoteDraft?()=>actions.openNoteDraft!(column):undefined}/>
    </div>
    <SortableContext items={roots.map(note=>note.id)} strategy={dropIntent?.kind==='group'?()=>null:verticalListSortingStrategy}><div ref={drop.setNodeRef} data-column-id={column.id} className={classNames('column__notes-wrapper',{isOver:drop.isOver})}><ul className="column__note-list">
      {roots.map(note=><li key={note.id}><NoteCard note={note} color={color} stackSize={notes.filter(child=>child.stack_id===note.id).length} disabled={disabled} onOpen={()=>actions.editNote(note)} onVote={()=>actions.addVote(note)} votes={votes.filter(vote=>vote.note_id===note.id&&vote.room===note.room)} combine={dropIntent?.kind==='group'&&dropIntent.target.id===note.id}/></li>)}
    </ul>{!notes.length&&<p className="retro-empty-column">A fresh perspective starts here.</p>}</div></SortableContext></div>
  </section>;
}
export function BoardView({board,columns,notes,votes,busy,actions}:{board:Board;columns:Column[];notes:Note[];votes:Vote[];busy:boolean;actions:BoardActions}) {
  const ref=useRef<HTMLElement>(null);
  const sensors=useSensors(useSensor(MouseSensor,{activationConstraint:{distance:2}}),useSensor(TouchSensor,{activationConstraint:{delay:200,tolerance:5}}),useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}));
  const snapshot=useRef<DragSnapshot|null>(null);
  const previousCollision=useRef<Collision|null>(null);
  const [activeNote,setActiveNote]=useState<Note|null>(null);
  const [dropIntent,setDropIntent]=useState<NoteDrop|null>(null);
  const onDragStart=({active}:DragStartEvent)=>{if(busy||board.isLocked)return;snapshot.current={board:{...board},columns:columns.map(column=>({...column})),notes:notes.map(note=>({...note}))};setActiveNote(snapshot.current.notes.find(note=>note.id===active.id)??null);setDropIntent(null);};
  const resetDrag=()=>{snapshot.current=null;previousCollision.current=null;setActiveNote(null);setDropIntent(null);};
  const onDragMove=({active,collisions}:DragMoveEvent)=>{setDropIntent(snapshot.current?planNoteDrop(snapshot.current,active.id,collisions):null);};
  const onDragOver=(event:DragOverEvent)=>{onDragMove(event);const top=event.collisions?.[0];if(top?.data?.droppableContainer?.data.current?.type==='note')previousCollision.current=top;};
  const scroll=(direction:number)=>ref.current?.scrollBy({left:direction*(ref.current.clientWidth/Math.min(columns.length||1,3)),behavior:'smooth'});
  const onDragEnd=({active,over,collisions}:DragEndEvent)=>{const opened=snapshot.current;const planned=opened&&over&&!busy&&!board.isLocked?planNoteDrop(opened,active.id,collisions):null;resetDrag();if(opened&&planned)actions.dropNote(planned,opened);};
  return <DndContext sensors={sensors} collisionDetection={args=>stabilizeCollisions(rectIntersection(args),previousCollision.current)} onDragStart={onDragStart} onDragMove={onDragMove} onDragOver={onDragOver} onDragCancel={resetDrag} onDragEnd={onDragEnd}>
    <header className="board-header">
      <button className="board-header__link retro-brand" onClick={actions.library} title="All boards"><ColumnsIcon/><span>Retro board</span></button>
      <button className="board-header_name-and-settings" onClick={actions.settings} aria-label="Board settings">
        <div className="board-header__access-policy-status">{board.isLocked?<LockIcon/>:<UnlockIcon/>}<span>{board.isLocked?'Locked board':'Shared board'}</span></div>
        <div className="board-header__name-container"><h1 className="board-header__name" title={board.name}>{board.name}</h1></div>
      </button>
      <div className="board-header__users"><button className="icon-button" title="Board settings" aria-label="Board settings menu" onClick={actions.settings}><SettingsIcon/></button></div>
    </header>
    {activeNote && <aside className="info-bar retro-status" role="status" title={describeNoteDrop(dropIntent)}>{describeNoteDrop(dropIntent)}</aside>}
    <main className={classNames("board",{"board--dragging":!!activeNote})} ref={ref} style={{'--board__columns':Math.max(columns.length,1)} as CSSProperties} aria-label="Retrospective board">
      <div className={`board__spacer-left ${getColorClassName(columns[0]?.color)}`}/>
      {columns.map(column=><BoardColumn key={column.id} column={column} notes={notes.filter(n=>n.column_id===column.id)} votes={votes} disabled={busy||board.isLocked} actions={actions} dropIntent={dropIntent}/>)}
      {!columns.length&&<section className="column retro-no-columns"><h2>Make room for ideas</h2><button onClick={actions.addColumn} disabled={busy||board.isLocked}>Add a column</button></section>}
      <div className={`board__spacer-right ${getColorClassName(columns.at(-1)?.color)}`}/>
    </main>
    <DragOverlay zIndex={1000} dropAnimation={{sideEffects:defaultDropAnimationSideEffects({styles:{active:{opacity:"0.5"}}})}}>{activeNote&&<div className={classNames('drag-overlay',getColorClassName(columns.find(column=>column.id===activeNote.column_id)?.color))} aria-hidden inert><NoteContent note={activeNote} stackSize={notes.filter(note=>note.stack_id===activeNote.id).length} disabled={false} onOpen={()=>{}} onVote={()=>{}} votes={votes.filter(vote=>vote.note_id===activeNote.id&&vote.room===activeNote.room)} handle={<span className="retro-drag-handle">⠿</span>}/></div>}</DragOverlay>
    <nav className="retro-toolbar" aria-label="Board tools">
      <button className="icon-button" onClick={()=>scroll(-1)} aria-label="Previous column"><ArrowLeftIcon/></button>
      <button className="icon-button" onClick={actions.addColumn} disabled={busy||board.isLocked} aria-label="Add column" title="Add column"><PlusIcon/></button>
      <button className="icon-button" onClick={actions.toggleLock} disabled={busy} aria-label={board.isLocked?'Unlock board':'Lock board'} title={board.isLocked?'Unlock board':'Lock board'}>{board.isLocked?<LockIcon/>:<UnlockIcon/>}</button>
      <button className="icon-button" onClick={actions.export} aria-label="Export board" title="Export board"><FileIcon/></button>
      <button className="icon-button" onClick={actions.toggleTheme} aria-label="Toggle dark mode" title="Toggle dark mode">◐</button>
      <button className="icon-button" onClick={()=>scroll(1)} aria-label="Next column"><ArrowRightIcon/></button>
    </nav>
  </DndContext>;
}
