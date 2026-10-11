import {expect,it} from 'vitest';
import {openNoteDraft} from '../src/house';
import {boundary,board,column,note} from './support/note-drafts';
it('stages incomplete new notes locally at their final business path and restores them after reload',async()=>{
  const {md,methods,drafts}=boundary();const first=await openNoteDraft(md,board,{column});
  await first.write('');expect(methods.save).not.toHaveBeenCalled();
  const path=[...drafts.keys()][0];expect(path).toMatch(/^retros\/b\/notes\/note-/);
  await expect(first.save('')).rejects.toThrow();expect(drafts.size).toBe(1);
  await first.write('Text before navigating away');first.close();
  const reopened=await openNoteDraft(md,board,{column});expect(reopened.text()).toBe('Text before navigating away');
  await reopened.save(reopened.text());expect(methods.save).toHaveBeenCalledOnce();expect(drafts.size).toBe(0);expect(methods.roomDraft.discard).not.toHaveBeenCalled();reopened.close();
});
it('merges disjoint fields, redraws other tabs, and reapplies overlap typing while retaining original field bases',async()=>{
  const {md,methods,drafts,race,remote}=boundary();const one=await openNoteDraft(md,board,{note});
  await one.write('First');const two=await openNoteDraft(md,board,{note});
  remote(note.path,{votes:{value:3,base:{value:0}}});
  race(()=>remote(note.path,{text:{value:'Other tab',base:{value:'Shipped'}}}));
  await one.write('Latest typing');expect(two.text()).toBe('Latest typing');
  expect(drafts.get(note.path)?.parts.fields).toMatchObject({text:{value:'Latest typing',base:{value:'Shipped'}},votes:{value:3,base:{value:0}}});
  await two.write('Last input from second tab');expect(one.text()).toBe('Last input from second tab');
  expect(drafts.size).toBe(1);expect(methods.save).not.toHaveBeenCalled();expect(methods.roomDraft.discard).not.toHaveBeenCalled();one.close();two.close();
});
it('starts a fresh note without overwriting an edit draft at a previously saved creation path',async()=>{
  const {md,methods,drafts}=boundary();const first=await openNoteDraft(md,board,{column});
  await first.write('Created note');const previous=[...drafts.keys()][0];await first.save('Created note');first.close();
  await methods.roomDraft.write('r',previous,null,{fields:{text:{value:'Later edit',base:{value:'Created note'}}}});
  const edit=structuredClone(drafts.get(previous));const next=await openNoteDraft(md,board,{column});
  expect(next.text()).toBe('');await next.write('Different note');
  expect(drafts.size).toBe(2);expect(drafts.get(previous)).toEqual(edit);next.close();
});
