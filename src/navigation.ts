import type { HouseBridge } from '@agentshouse/app-bridge';
export type BoardTarget = { room: string; path: string; note?: string };
export type NavigationBridge = Pick<HouseBridge,'address'|'onAddress'|'push'|'replace'>;
export type BoardRoute = { target: BoardTarget | null; ready: boolean; error: string | null };
const safeRoom = (value: string) => /^[a-zA-Z0-9_.-]{1,256}$/.test(value);
const safePath = (value: string) => value.length > 0 && value.length <= 512 && !value.includes('\\') && ![...value].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127) && value.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');
export function boardAddress(target: BoardTarget | null): string {
  if (!target) return '/boards';
  if (!safeRoom(target.room)||!safePath(target.path)||(target.note!==undefined&&!safePath(target.note))) throw new Error('Invalid board address.');
  const query = new URLSearchParams({room:target.room,path:target.path});
  if(target.note)query.set('note',target.note);
  const address=`/boards?${query}`;
  if(address.length>1000)throw new Error('This board link is too long.');
  return address;
}
export function readBoardAddress(address: string | null): BoardRoute {
  if(address===null)return {target:null,ready:false,error:null};
  try {
    if(address.length>1000||[...address].some(c=>c.charCodeAt(0)<=32||c.charCodeAt(0)===127)||!/^\/(?:boards)?(?:\?|$)/.test(address))throw new Error();
    const [pathname,query='']=address.split('?');
    if(address.includes('#')||!['/','/boards'].includes(pathname)||address.split('?').length>2)throw new Error();
    const searchParams=new URLSearchParams(query);
    const keys=[...searchParams.keys()];
    if(keys.some(key=>!['room','path','note'].includes(key))||new Set(keys).size!==keys.length)throw new Error();
    if(!keys.length)return {target:null,ready:true,error:null};
    const room=searchParams.get('room'),path=searchParams.get('path'),note=searchParams.get('note');
    if(!room||!path||!safeRoom(room)||!safePath(path)||(note!==null&&!safePath(note)))throw new Error();
    return {target:{room,path,...(note===null?{}:{note})},ready:true,error:null};
  } catch { return {target:null,ready:true,error:'This board link is invalid. Choose a board from the library.'}; }
}

/** House owns history. Serial requests coalesce rapid clicks, while host events
 * never echo a navigation or write Room data. Stale failures cannot replace a
 * later host selection. No runtime/data loading is needed to retain a deep link. */
export class BoardNavigation {
  private state: BoardRoute;
  private listeners = new Set<() => void>();
  private close?: () => void;
  private sequence = 0;
  private active: { address: string; sequence: number; replace: boolean } | null = null;
  private queued: { address: string; sequence: number; replace: boolean } | null = null;
  constructor(private bridge: NavigationBridge) { this.state = readBoardAddress(bridge.address()); }
  snapshot = () => this.state;
  private update(next: BoardRoute) {
    if (JSON.stringify(next.target) === JSON.stringify(this.state.target) && next.ready === this.state.ready && next.error === this.state.error) return;
    this.state = next;
    this.listeners.forEach(listener => listener());
  }
  private receive = (address: string) => {
    if (this.active && address !== this.active.address) {
      this.sequence++;
      this.queued = null;
    }
    this.update(readBoardAddress(address));
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.close) {
      this.close = this.bridge.onAddress(this.receive);
      const current = this.bridge.address();
      if (current !== null) this.receive(current);
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.close?.();
        this.close = undefined;
        this.active = null;
        this.sequence++;
        this.queued = null;
      }
    };
  };
  navigate(target: BoardTarget | null, replace = false) {
    let address: string;
    try { address = boardAddress(target); }
    catch { this.update({ ...this.state, error: "Invalid board address." }); return; }
    if (!this.active && this.state.ready && JSON.stringify(this.state.target) === JSON.stringify(target) && !this.state.error) return;
    this.queued = { address, sequence: ++this.sequence, replace };
    this.drain();
  }
  private drain() {
    if (this.active || !this.queued || !this.listeners.size) return;
    const request = this.queued;
    this.queued = null;
    this.active = request;
    void this.bridge[request.replace ? "replace" : "push"](request.address).then(address => {
      if (request.sequence === this.sequence && this.listeners.size) this.update(readBoardAddress(address));
    }).catch(error => {
      if (request.sequence === this.sequence && this.listeners.size) {
        this.update({ ...this.state, error: error instanceof Error ? error.message : "House refused navigation." });
      }
    }).finally(() => {
      if (this.active === request) {
        this.active = null;
        this.drain();
      }
    });
  }
}
