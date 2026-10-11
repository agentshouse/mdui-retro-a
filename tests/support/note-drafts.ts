import {vi} from 'vitest';
import type {HouseRuntime} from '../../src/house';
import type {Board,Column,Note} from '../../src/model';
export const board:Board={id:'b',name:'Retro',description:'',isLocked:false,room:'r',path:'retros/b/board.md'};
export const column:Column={id:'c',board_id:'b',name:'Went well',description:'',color:'backlog-blue',index:0,visible:true,room:'r',path:'retros/b/columns/c.md'};
export const note:Note={id:'n',board_id:'b',text:'Shipped',column_id:'c',stack_id:'',rank:1,edited:false,votes:0,room:'r',path:'retros/b/notes/n.md',lastEditedBy:null};
type Draft=NonNullable<Awaited<ReturnType<HouseRuntime['roomDraft']['read']>>>;
export function boundary(){
  let state:unknown={};let revision=0;let race:(()=>void)|undefined;
  const drafts=new Map<string,Draft>();const listeners=new Set<(value:readonly Draft[])=>void>();
  const publish=()=>{for(const listener of listeners)listener([...drafts.values()]);};
  const docs=[board,column,note].map(({room,path,...value})=>({room,path,type:'text' in value?'retro_note':'board_id' in value?'retro_column':'retro_board',fields:Object.fromEntries(Object.entries(value).filter(([key])=>key!=='lastEditedBy').map(([key,value])=>[key,typeof value==='boolean'?String(value):value]))}));
  const methods={
    query:vi.fn(async()=>({documents:structuredClone(docs)})),
    presentation:{read:vi.fn(async()=>structuredClone(state)),write:vi.fn(async(next:unknown)=>{state=structuredClone(next);})},
    observe:vi.fn(async()=>({current:()=>[...drafts.values()],subscribe:(fn:(value:readonly Draft[])=>void)=>{listeners.add(fn);return()=>listeners.delete(fn);},close:vi.fn()})),
    roomDraft:{
      read:vi.fn(async(_room:string,path:string)=>structuredClone(drafts.get(path)??null)),
      write:vi.fn(async(room:string,path:string,base:string|null,parts:Draft['parts'])=>{
        if(race){const run=race;race=undefined;run();}
        const current=drafts.get(path);if((current?.revision??null)!==base)return{outcome:'stale',current:structuredClone(current??null)};
        const next=structuredClone(parts);
        if(next.fields)for(const [key,part] of Object.entries(next.fields)){const old=current?.parts.fields?.[key];if(old)next.fields={...next.fields,[key]:{...part,base:old.base}};}
        const value={room,path,revision:`r${++revision}`,parts:next,changedUnderneath:current?.changedUnderneath??{},returned:current?.returned??null};drafts.set(path,value);publish();return{outcome:'written',roomDraft:structuredClone(value)};
      }),
      discard:vi.fn(),
    },
    save:vi.fn(async(_room:string,entries:{path:string;revision:string}[])=>{for(const entry of entries){if(drafts.get(entry.path)?.revision!==entry.revision)return{outcome:'refused',rule:'stale'};drafts.delete(entry.path);}publish();return{outcome:'saved',identifier:'queued'};}),
  };
  return{md:methods as unknown as HouseRuntime,methods,drafts,race:(run:()=>void)=>{race=run;},remote:(path:string,fields:NonNullable<Draft['parts']['fields']>)=>{const old=drafts.get(path)!;drafts.set(path,{...old,revision:`r${++revision}`,parts:{...old.parts,fields:{...old.parts.fields,...fields}}});publish();}};
}
