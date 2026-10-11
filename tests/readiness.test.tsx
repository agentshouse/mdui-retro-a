import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {App} from '../src/App';
import {boundary} from './support/note-drafts';
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
it('keeps initial empty and ambiguous device state loading until a completed sync, then recovers on every Rooms value',async()=>{
  render(<App/>);await screen.findByRole('status');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  act(()=>fixture.observations.get('rooms').emit([room,{...room,locator:'other'}]));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  act(()=>fixture.observations.get('sync').emit(status('2026-10-11T13:00:00Z')));
  expect(await screen.findByRole('alert')).toHaveTextContent('multiple data bindings');
  act(()=>fixture.observations.get('rooms').emit([]));
  expect(screen.getByRole('alert')).toHaveTextContent('No Retro Room');
  act(()=>fixture.observations.get('rooms').emit([room]));
  await waitFor(()=>expect(screen.getByRole('button',{name:'New board'})).toBeEnabled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('preserves an unsaved donor form on reach loss and enables it on later recovery',async()=>{
  fixture.observations.get('rooms').value=[room];fixture.observations.get('sync').value=status('2026-10-11T13:00:00Z');
  render(<App/>);await waitFor(()=>expect(screen.getByRole('button',{name:'New board'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'New board'}));
  const input=screen.getByLabelText('Board name');fireEvent.change(input,{target:{value:'Keep my retrospective'}});
  act(()=>fixture.observations.get('rooms').emit([]));
  expect(input).toHaveValue('Keep my retrospective');expect(screen.getByRole('button',{name:'Create board'})).toBeDisabled();
  act(()=>fixture.observations.get('query').emit({documents:[]}));
  act(()=>fixture.observations.get('rooms').emit([room]));
  expect(input).toHaveValue('Keep my retrospective');expect(screen.getByRole('button',{name:'Create board'})).toBeEnabled();
});

it('keeps typing and local Save enabled during provider write-halt while retaining reach guards',async()=>{
  const {md,methods}=boundary();fixture.runtime=md;
  fixture.observations.get('rooms').value=[room];fixture.observations.get('sync').value=status('2026-10-11T13:00:00Z');fixture.observations.get('mode').value='write-halted';
  render(<App/>);await waitFor(()=>expect(screen.getByRole('button',{name:'New board'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'New board'}));const input=screen.getByLabelText('Board name');expect(input).toBeEnabled();fireEvent.change(input,{target:{value:'Saved during provider halt'}});
  act(()=>fixture.observations.get('rooms').emit([]));expect(screen.getByRole('button',{name:'Create board'})).toBeDisabled();
  act(()=>fixture.observations.get('rooms').emit([room]));expect(input).toHaveValue('Saved during provider halt');expect(screen.getByRole('button',{name:'Create board'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'Create board'}));await waitFor(()=>expect(methods.save).toHaveBeenCalledOnce());expect(methods.roomDraft.write).toHaveBeenCalledTimes(4);
});
