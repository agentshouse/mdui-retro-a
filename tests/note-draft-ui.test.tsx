import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {useNoteDraft} from '../src/useNoteDraft';
import {openNoteDraft,type NoteDraftSession} from '../src/house';
import {boundary,board,note} from './support/note-drafts';
function Input({source}:{source:()=>Promise<NoteDraftSession>}){const draft=useNoteDraft(note.text,note.path,source);return <input aria-label="Note draft" value={draft.value} onChange={event=>draft.change(event.target.value)}/>;}
it('hydrates a reopened note input and never calls a navigation confirmation',async()=>{
  const confirm=vi.fn();vi.stubGlobal('confirm',confirm);const {md,drafts,methods}=boundary();
  const source=()=>openNoteDraft(md,board,{note});const view=render(<Input source={source}/>);
  fireEvent.change(screen.getByLabelText('Note draft'),{target:{value:'Typed note survives'}});
  await waitFor(()=>expect(drafts.get(note.path)?.parts.fields?.text.value).toBe('Typed note survives'));
  view.unmount();render(<Input source={source}/>);
  await waitFor(()=>expect(screen.getByLabelText('Note draft')).toHaveValue('Typed note survives'));
  expect(confirm).not.toHaveBeenCalled();expect(methods.save).not.toHaveBeenCalled();vi.unstubAllGlobals();
});
it('finishes an already typed local write even if navigation beats draft hydration',async()=>{
  let release!:(value:NoteDraftSession)=>void;const write=vi.fn(async()=>{});const close=vi.fn();
  const pending=new Promise<NoteDraftSession>(resolve=>{release=resolve;});
  const view=render(<Input source={()=>pending}/>);fireEvent.change(screen.getByLabelText('Note draft'),{target:{value:'Immediate Back'}});view.unmount();
  await act(async()=>{release({text:()=>'',write,close,subscribe:()=>()=>{},save:vi.fn()} as NoteDraftSession);await pending;});
  await waitFor(()=>expect(write).toHaveBeenCalledWith('Immediate Back'));expect(close).toHaveBeenCalled();
});
