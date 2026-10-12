import {describe,it,expect,vi} from 'vitest';
import {houseBridge} from '@agentshouse/app-bridge';
import {createHouseBridgeTestHost} from '@agentshouse/app-bridge/test-host';
import {BoardNavigation,boardAddress,readBoardAddress} from '../src/navigation';
describe('Retro House addresses',()=>{
 it('round trips separate Room/board/note identity including encoded filenames',()=>{
  const target={room:'r_19.z',path:'retros/a board/board.md',note:'retros/a board/notes/Привет #1.md'};
  expect(readBoardAddress(boardAddress(target))).toEqual({target,ready:true,error:null});
  expect(readBoardAddress(null).ready).toBe(false);
  expect(readBoardAddress('/boards').target).toBeNull();
  for(const input of ['//evil.test','https://evil.test','/boards?room=r','/boards?path=a.md','/boards?room=r&path=../private','/boards?room=r&path=a.md&path=b.md','/boards?room=r&path=a.md&text=secret','/boards?room=r&path=%2Fprivate','/boards?room=r&path=a.md#save','/boards?room=r&path=a.md\n'])expect(readBoardAddress(input).error).toBeTruthy();
 });
 it('uses the official bridge for cold note, Back/Forward and explicit replace after deletion, without echo',async()=>{
  const target={room:'r',path:'retros/b/board.md',note:'retros/b/notes/n.md'};
  const host=createHouseBridgeTestHost({address:boardAddress(target)}),nav=new BoardNavigation(houseBridge());const off=nav.subscribe(vi.fn());
  await vi.waitFor(()=>expect(nav.snapshot().target).toEqual(target));expect(host.navigations).toHaveLength(0);
  nav.navigate({room:'r',path:'retros/c/board.md'});await vi.waitFor(()=>expect(nav.snapshot().target?.path).toBe('retros/c/board.md'));
  host.open(boardAddress(target));await vi.waitFor(()=>expect(nav.snapshot().target).toEqual(target));expect(host.navigations).toHaveLength(1);
  nav.navigate(null,true);await vi.waitFor(()=>expect(nav.snapshot().target).toBeNull());expect(host.navigations[1]).toEqual({mode:'replace',address:'/boards'});off();
 });
});
