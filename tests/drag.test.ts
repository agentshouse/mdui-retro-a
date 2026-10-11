import {describe,it,expect} from 'vitest';
import type {Collision} from '@dnd-kit/core';
import {planNoteDrop,stabilizeCollisions,COMBINE_THRESHOLD,MOVE_THRESHOLD,type DragSnapshot} from '../src/drag';
import type {Board,Column,Note} from '../src/model';
const board:Board={room:'r',path:'b',id:'b',name:'Retro',description:'',isLocked:false};
const col:Column={room:'r',path:'c',id:'c',board_id:'b',name:'Keep',description:'',color:'backlog-blue',visible:true,index:0};
const other={...col,id:'d',path:'d',index:1};
const a:Note={room:'r',path:'a',id:'a',board_id:'b',column_id:'c',text:'One',rank:3,stack_id:'',edited:false,votes:0};
const b:Note={...a,path:'bb',id:'bb',text:'Two',rank:2};
const c:Note={...a,path:'cc',id:'cc',text:'Three',rank:1};
const d:Note={...a,path:'dd',id:'dd',column_id:'d',text:'Other column',rank:1};
const child:Note={...a,path:'child',id:'child',stack_id:a.id,text:'Child'};
const snapshot:DragSnapshot={board,columns:[col,other],notes:[a,b,c,d,child]};
const collision=(id:string,value:number):Collision=>({id,data:{value}});
describe('donor drag overlap thresholds and portable drop plan',()=>{
 it('keeps the donor combine and move thresholds',()=>{expect(COMBINE_THRESHOLD).toBe(.13);expect(MOVE_THRESHOLD).toBe(.63);});
 it.each([.13,.4,.6299])('groups an overlap ratio of %s and includes the full source stack',ratio=>{const drop=planNoteDrop(snapshot,'a',[collision('a',1),collision('bb',ratio),collision('column:c',.1)]);expect(drop).toMatchObject({kind:'group',note:a,target:b,members:[a,child]});});
 it('allows drop-on-note grouping in another column',()=>{expect(planNoteDrop(snapshot,'a',[collision('dd',.4),collision('column:d',.1)])).toMatchObject({kind:'group',target:d,members:[a,child]});});
 it('reorders below the hovered card after the high-overlap threshold',()=>{const drop=planNoteDrop(snapshot,'a',[collision('bb',.63),collision('column:c',.1)]);expect(drop?.kind).toBe('reorder');expect(drop&&'orderedRoots'in drop?drop.orderedRoots.map(n=>n.id):[]).toEqual(['bb','a','cc']);});
 it('reorders up as well as down',()=>{const drop=planNoteDrop(snapshot,'cc',[collision('a',.9),collision('column:c',.1)]);expect(drop&&'orderedRoots'in drop?drop.orderedRoots.map(n=>n.id):[]).toEqual(['cc','a','bb']);});
 it('moves across columns at the hovered insertion position',()=>{const drop=planNoteDrop(snapshot,'a',[collision('dd',.8),collision('column:d',.1)]);expect(drop?.kind).toBe('move');expect(drop&&'orderedRoots'in drop?drop.orderedRoots.map(n=>n.id):[]).toEqual(['a','dd']);});
 it('appends on the blank column target, including same-column end reorder',()=>{const drop=planNoteDrop(snapshot,'a',[collision('column:c',.25)]);expect(drop&&'orderedRoots'in drop?drop.orderedRoots.map(n=>n.id):[]).toEqual(['bb','cc','a']);const across=planNoteDrop(snapshot,'a',[collision('column:d',.25)]);expect(across&&'orderedRoots'in across?across.orderedRoots.map(n=>n.id):[]).toEqual(['dd','a']);});
 it('supports an empty destination column',()=>{const drop=planNoteDrop({...snapshot,notes:[a,b,c,child]},'a',[collision('column:d',.25)]);expect(drop&&'orderedRoots'in drop?drop.orderedRoots.map(n=>n.id):[]).toEqual(['a']);});
 it('cancels outside drops, unchanged self drops, unknown notes and locked boards',()=>{expect(planNoteDrop(snapshot,'a',[])).toBeNull();expect(planNoteDrop(snapshot,'a',[collision('a',.95),collision('column:c',.1)])).toBeNull();expect(planNoteDrop(snapshot,'cc',[collision('column:c',.2)])).toBeNull();expect(planNoteDrop(snapshot,'missing',[collision('bb',.3)])).toBeNull();expect(planNoteDrop({...snapshot,board:{...board,isLocked:true}},'a',[collision('bb',.3)])).toBeNull();});
});

it('retains the donor previous-note collision stabilization below the move threshold',()=>{
  const previous:Collision={id:'a',data:{value:.9,droppableContainer:{data:{current:{type:'note'}}}}};
  const hovered:Collision={id:'bb',data:{value:.4,droppableContainer:{data:{current:{type:'note'}}}}};
  const stabilized=stabilizeCollisions([hovered],previous);
  expect(stabilized.map(hit=>hit.id)).toEqual(['a','bb']);
  expect(stabilized[0].data?.value).toBe(0);
  expect(planNoteDrop(snapshot,'a',stabilized)).toMatchObject({kind:'group',target:b});
  expect(stabilizeCollisions([{...hovered,data:{...hovered.data,value:.8}}],previous).map(hit=>hit.id)).toEqual(['bb']);
});
