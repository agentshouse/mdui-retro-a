import {useEffect, useRef, useState} from 'react';
import type {NoteDraftSession} from './house';
export type NoteDraftSource = () => Promise<NoteDraftSession>;
/** UI state follows the Runtime draft; in-flight local writes outlive route changes. */
export function useNoteDraft(initial: string, identity: string, source?: NoteDraftSource) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  const [cycle, setCycle] = useState(0);
  const sourceRef = useRef(source); sourceRef.current = source;
  const initialRef = useRef(initial); initialRef.current = initial;
  const typed = useRef<string | undefined>(undefined);
  const current = useRef<NoteDraftSession | undefined>(undefined);
  const opening = useRef<Promise<NoteDraftSession> | undefined>(undefined);
  useEffect(() => {
    const begin = sourceRef.current;
    if (!begin) return;
    let active = true;
    let closedInput: string | undefined;
    const report = (caught: unknown) => {if (active) setError(caught instanceof Error ? caught.message : String(caught));};
    const pending = begin(); opening.current = pending;
    void pending.then(async session => {
      if (active) {current.current = session; session.subscribe(next => {if (active) setValue(next);});}
      const input = active ? typed.current : closedInput;
      if (input !== undefined) await session.write(input);
      else if (active) setValue(session.text());
      if (!active) session.close();
    }).catch(report);
    return () => {closedInput = typed.current; active = false; current.current?.close(); current.current = undefined;};
  }, [identity, cycle]);
  return {
    value, error,
    change(next: string) {
      typed.current = next; setValue(next);
      void current.current?.write(next).catch(caught => setError(caught instanceof Error ? caught.message : String(caught)));
    },
    session: () => opening.current,
    report(caught: unknown) {setError(caught instanceof Error ? caught.message : String(caught));},
    restart() {current.current?.close(); current.current=undefined; typed.current = undefined; setValue(initialRef.current); setError(''); opening.current = undefined; setCycle(value => value + 1);},
  };
}
