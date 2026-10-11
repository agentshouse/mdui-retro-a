import {createContext, useContext, useEffect, useId, useRef, type ReactNode} from 'react';
import {CloseIcon} from './Icons';
export const FeedbackContext = createContext('');
export function Modal({title, children, close}: {title:string; children:ReactNode; close:()=>void; busy?:boolean}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const feedback = useContext(FeedbackContext);
  useEffect(()=>{ const d=ref.current; d?.showModal(); return ()=>d?.close(); }, []);
  return <dialog ref={ref} className="retro-dialog" aria-labelledby={heading} onCancel={event=>{event.preventDefault();close();}}>
    <header><h2 id={heading}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><CloseIcon/></button></header>
    {feedback && <p className="retro-modal-feedback" role="alert">{feedback}</p>}
    {children}
  </dialog>;
}
