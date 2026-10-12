import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {App} from '../src/App';
import {boundary,board,note} from './support/note-drafts';
const fixture=vi.hoisted(()=>({observations:new Map<string,any>(),runtime:{} as any}));
vi.mock('../src/house',async original=>{
  const actual=await original<typeof import('../src/house')>();
  const get=(key:string)=>async()=>fixture.observations.get(key);
  return {...actual,houseRuntime:async()=>fixture.runtime,observeRooms:get('rooms'),observeSyncStatus:get('sync'),observeRetro:get('query'),observeRoomDrafts:get('drafts'),observeServiceMode:get('mode'),observeStorageLoss:get('loss'),observeConnectionRefusal:get('refusal')};
});
function observe(key:string,value:any){const listeners=new Set<(value:any)=>void>();const item={value,current:()=>item.value,subscribe:(fn:(value:any)=>void)=>{listeners.add(fn);return()=>listeners.delete(fn);},close:vi.fn(),emit:(next:any)=>{item.value=next;listeners.forEach(fn=>fn(next));}};fixture.observations.set(key,item);return item;}
const room={locator:'r',name:'Retro'};
const status=(lastCompleted:string|null)=>({lastCompleted,state:'syncing',attentionRequired:[],providerUnreachable:false,reset:null});
beforeEach(()=>{fixture.runtime={};fixture.observations.clear();observe('rooms',[]);observe('sync',status(null));observe('query',{documents:[]});observe('drafts',[]);observe('mode','open');observe('loss',null);observe('refusal',null);});

import {connectHouseBridge} from '@agentshouse/app-bridge';
import {createHouseBridgeTestHost} from '@agentshouse/app-bridge/test-host';
import {BoardNavigation,boardAddress} from '../src/navigation';
async function loadedFixture(){
 const f=boundary();fixture.runtime=f.md;
 fixture.observations.get('rooms').value=[room];fixture.observations.get('sync').value=status('2026-10-11T13:00:00Z');
 const data=await f.methods.query();fixture.observations.get('query').value=data;
 return f;
}
it('retains a cold note link until sync/data and reopens the native draft on Back and full remount',async()=>{
 const f=await loadedFixture();const data=fixture.observations.get('query').value;
 fixture.observations.get('sync').value=status(null);fixture.observations.get('query').value={documents:[]};
 const address=boardAddress({room:board.room,path:board.path,note:note.path});
 const host=createHouseBridgeTestHost({address});const nav=new BoardNavigation(connectHouseBridge(host));
 const view=render(<App navigation={nav}/>);await screen.findByRole('status');expect(screen.queryByRole('dialog')).toBeNull();expect(host.navigations).toHaveLength(0);
 act(()=>{fixture.observations.get('query').value=data;fixture.observations.get('sync').emit(status('2026-10-11T13:00:00Z'));});
 const textarea=await screen.findByLabelText('Note');fireEvent.change(textarea,{target:{value:'Raw local note survives navigation'}});
 await waitFor(()=>expect(f.drafts.get(note.path)?.parts.fields?.text.value).toBe('Raw local note survives navigation'));
 host.open('/boards');await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 host.open(address);await waitFor(()=>expect(screen.getByLabelText('Note')).toHaveValue('Raw local note survives navigation'));
 expect(host.navigations).toHaveLength(0);expect(f.methods.save).not.toHaveBeenCalled();expect(f.methods.roomDraft.discard).not.toHaveBeenCalled();
 view.unmount();const reloadHost=createHouseBridgeTestHost({address});render(<App navigation={new BoardNavigation(connectHouseBridge(reloadHost))}/>);
 await waitFor(()=>expect(screen.getByLabelText('Note')).toHaveValue('Raw local note survives navigation'));expect(f.methods.save).not.toHaveBeenCalled();
});
it('rejects a note belonging to another board and never mutates data on route replay',async()=>{
 const f=await loadedFixture();const host=createHouseBridgeTestHost({address:boardAddress({room:'r',path:board.path,note:'retros/other/notes/n.md'})});
 render(<App navigation={new BoardNavigation(connectHouseBridge(host))}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('not in this board');expect(screen.queryByLabelText('Note')).toBeNull();
 expect(f.methods.roomDraft.write).not.toHaveBeenCalled();expect(f.methods.save).not.toHaveBeenCalled();
});
it('opens and closes a note through UI addresses, and host Back reopens it without a save',async()=>{
 const f=await loadedFixture();const host=createHouseBridgeTestHost({address:boardAddress({room:'r',path:board.path,note:note.path})});
 render(<App navigation={new BoardNavigation(connectHouseBridge(host))}/>);await screen.findByLabelText('Note');
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect(host.navigations.at(-1)?.address).toBe(boardAddress({room:'r',path:board.path}));
 host.open(boardAddress({room:'r',path:board.path,note:note.path}));await screen.findByLabelText('Note');expect(f.methods.save).not.toHaveBeenCalled();
});
it('does not let a completed creation steal a later host-selected board',async()=>{
 await loadedFixture(); const house=await import('../src/house');
 let complete!:(value:any)=>void;const pending=new Promise<any>(resolve=>{complete=resolve;});
 const create=vi.spyOn(house,'createBoard').mockReturnValue(pending);
 const host=createHouseBridgeTestHost({address:'/boards'});
 const view=render(<App navigation={new BoardNavigation(connectHouseBridge(host))}/>);
 try {
  await waitFor(()=>expect(screen.getByRole('button',{name:'New board'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'New board'}));
  fireEvent.change(screen.getByLabelText('Board name'),{target:{value:'Pending explicit creation'}});fireEvent.click(screen.getByRole('button',{name:'Create board'}));
  await waitFor(()=>expect(create).toHaveBeenCalledOnce());host.open(boardAddress({room:board.room,path:board.path}));await screen.findByRole('heading',{name:'Retro'});
  await act(async()=>{complete({board:{...board,id:'new',path:'retros/new/board.md'}});await pending;});
  expect(host.address()).toBe(boardAddress({room:board.room,path:board.path}));expect(host.navigations).toHaveLength(0);expect(screen.queryByRole('dialog')).toBeNull();
 } finally {view.unmount();create.mockRestore();}
});
it('closes an explicitly addressed deleted note without discarding its local draft or recreating it',async()=>{
 const f=await loadedFixture();const host=createHouseBridgeTestHost({address:boardAddress({room:board.room,path:board.path,note:note.path})});
 render(<App navigation={new BoardNavigation(connectHouseBridge(host))}/>);await screen.findByLabelText('Note');
 act(()=>fixture.observations.get('query').emit({documents:fixture.observations.get('query').value.documents.filter((row:any)=>row.path!==note.path)}));
 await waitFor(()=>expect(screen.queryByLabelText('Note')).toBeNull());expect(screen.getByRole('alert')).toHaveTextContent('not in this board');
 expect(f.methods.save).not.toHaveBeenCalled();expect(f.methods.roomDraft.discard).not.toHaveBeenCalled();expect(f.methods.roomDraft.write).not.toHaveBeenCalled();
});
