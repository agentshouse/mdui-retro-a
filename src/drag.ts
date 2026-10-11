import type {Collision, UniqueIdentifier} from '@dnd-kit/core';
import type {Board,Column,Note} from './model';
// Pinned donor constants/misc.ts and DragAndDrop/Sortable.tsx use these IoU bands.
export const COMBINE_THRESHOLD=0.13;
export const MOVE_THRESHOLD=0.63;
/** Donor CustomDndContext keeps the prior note first below the move threshold. */
export function stabilizeCollisions(collisions:Collision[],previous:Collision|null):Collision[]{
  const top=collisions[0];
  if(!previous||top?.data?.droppableContainer?.data.current?.type!=='note'||Number(top.data.value)>=MOVE_THRESHOLD)return collisions;
  const index=collisions.findIndex(hit=>hit.id===previous.id);
  const ordered=[...collisions];
  if(index<0)ordered.unshift({...previous,data:{...previous.data,value:0}});
  else ordered.unshift(...ordered.splice(index,1));
  return ordered;
}
export type DragSnapshot={board:Board;columns:readonly Column[];notes:readonly Note[]};
export type NoteDrop=
  |{kind:'group';note:Note;target:Note;members:Note[]}
  |{kind:'reorder';note:Note;column:Column;orderedRoots:Note[]}
  |{kind:'move';note:Note;column:Column;orderedRoots:Note[]};
const roots=(snapshot:DragSnapshot,columnId:string)=>snapshot.notes.filter(note=>note.column_id===columnId&&!note.stack_id).sort((a,b)=>b.rank-a.rank||a.id.localeCompare(b.id));
const sameOrder=(a:readonly Note[],b:readonly Note[])=>a.length===b.length&&a.every((note,index)=>note.id===b[index].id);
/** Pure gesture planning. All write bases are the snapshot captured on drag start. */
export function planNoteDrop(snapshot:DragSnapshot,activeId:UniqueIdentifier,collisions:readonly Collision[]|null):NoteDrop|null {
  const note=snapshot.notes.find(row=>row.id===activeId&&!row.stack_id);
  if(!note||snapshot.board.isLocked||!collisions?.length)return null;
  const noteCollisions=collisions.filter(hit=>hit.id!==activeId&&snapshot.notes.some(row=>row.id===hit.id&&!row.stack_id)&&typeof hit.data?.value==='number'&&hit.data.value>0).sort((a,b)=>Number(b.data?.value)-Number(a.data?.value));
  const hit=noteCollisions[0];
  const target=hit?snapshot.notes.find(row=>row.id===hit.id):undefined;
  const ratio=Number(hit?.data?.value??0);
  const sourceRatio=Number(collisions.find(hit=>hit.id===activeId)?.data?.value??0);
  if(ratio<COMBINE_THRESHOLD&&sourceRatio>=MOVE_THRESHOLD)return null;
  if(target&&ratio>=COMBINE_THRESHOLD&&ratio<MOVE_THRESHOLD){
    return {kind:'group',note,target,members:[note,...snapshot.notes.filter(row=>row.stack_id===note.id)]};
  }
  const column=target&&ratio>=MOVE_THRESHOLD?snapshot.columns.find(row=>row.id===target.column_id):snapshot.columns.find(row=>collisions.some(hit=>hit.id===`column:${row.id}`));
  if(!column)return null;
  const orderedRoots=roots(snapshot,column.id).filter(row=>row.id!==note.id);
  // Donor cross-column note drops insert before that note; column blank space appends.
  if(target&&ratio>=MOVE_THRESHOLD){
    const original=roots(snapshot,column.id);
    const index=note.column_id===column.id?original.findIndex(row=>row.id===target.id):orderedRoots.findIndex(row=>row.id===target.id);
    orderedRoots.splice(Math.max(0,index),0,note);
  }else orderedRoots.push(note);
  if(column.id===note.column_id){
    return sameOrder(roots(snapshot,column.id),orderedRoots)?null:{kind:'reorder',note,column,orderedRoots};
  }
  return {kind:'move',note,column,orderedRoots};
}
export function describeNoteDrop(drop:NoteDrop|null):string {
  if(!drop)return 'Drag a note over a card to group it, or farther across a card to reorder.';
  if(drop.kind==='group')return `Group with “${drop.target.text.slice(0,70)}”`;
  return `${drop.kind==='move'?'Move':'Reorder'} in ${drop.column.name}, position ${drop.orderedRoots.findIndex(note=>note.id===drop.note.id)+1}`;
}
