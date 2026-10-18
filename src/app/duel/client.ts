import type { DuelClientMessage, DuelInputFrame, DuelSlot } from '../../shared/duel-contract.ts';
import type { DuelFlightEvent, DuelPilotState, DuelServerMessage, DuelSnapshot } from '../../shared/duel-snapshot.ts';
import type { DuelCollider } from '../../sim/duel-collision.ts';
import { advanceDuelMotion } from '../../sim/duel-flight.ts';
import { interpolatePilot, reconcilePilot } from './prediction.ts';

export class DuelClient {
  snapshot: DuelSnapshot | null=null;
  slot: DuelSlot | null=null;
  predicted: DuelPilotState | null=null;
  rtt=0;
  lastSnapshotMs=0;
  onChange: ()=>void=()=>{};
  onMessage: (text: string)=>void=()=>{};
  onEffects: (events: readonly DuelFlightEvent[])=>void=()=>{};
  private socket: WebSocket | null=null;
  private pending: DuelInputFrame[]=[];
  private outbox: DuelInputFrame[]=[];
  private history: {at:number;data:DuelSnapshot}[]=[];
  private seq=0;
  private epoch='';
  private seenEvent=0;
  private pauseUntil=0;
  private pingTimer: ReturnType<typeof setInterval> | null=null;
  private pings=new Map<number,number>();
  private nonce=0;
  private intentional=false;
  private generation=0;
  private collider: DuelCollider;
  constructor(collider: DuelCollider) {this.collider=collider;}
  get connected(){return this.socket?.readyState===WebSocket.OPEN;}
  async connect() {
    this.leave();this.intentional=false;const generation=this.generation;
    const url=new URL('/ws',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
    const socket=new WebSocket(url);this.socket=socket;
    await new Promise<void>((resolve,reject)=>{
      const timeout=setTimeout(()=>{socket.close();reject(new Error('连接超时，请确认双人服务已启动。'));},5000);
      socket.addEventListener('open',()=>{clearTimeout(timeout);resolve();},{once:true});
      socket.addEventListener('error',()=>{clearTimeout(timeout);reject(new Error('未连接到联机服务，请用 start-duel.cmd 启动后再试。'));},{once:true});
      socket.addEventListener('close',()=>{clearTimeout(timeout);reject(new Error('服务已断开，请重新创建或加入房间。'));},{once:true});
    });
    if(this.generation!==generation){socket.close();return;}
    socket.addEventListener('message',event=>{
      if(this.generation!==generation)return;
      try {const message: DuelServerMessage=JSON.parse(String(event.data));if(message.v!==1)throw new Error('Protocol version');this.receive(message);}
      catch {this.onMessage('收到无法识别的服务器数据，连接已关闭。');this.leave();this.onChange();}
    });
    socket.addEventListener('close',()=>{
      if(this.generation!==generation)return;
      this.stopPing();this.pending=[];this.outbox=[];this.predicted=null;
      if(!this.intentional)this.onMessage('连接已断开。请重新创建或加入房间。');
      this.onChange();
    });
    const ping=()=>{const nonce=++this.nonce;this.pings.set(nonce,performance.now());if(this.pings.size>4)this.pings.delete(this.pings.keys().next().value!);this.send({v:1,type:'ping',nonce});};
    this.pingTimer=setInterval(ping,2000);ping();this.onChange();
  }
  send(message: DuelClientMessage) {
    if(!this.connected||this.socket!.bufferedAmount>32768)return false;
    this.socket!.send(JSON.stringify(message));return true;
  }
  private receive(message: DuelServerMessage) {
    if(message.type==='welcome'){this.slot=message.slot;this.onChange();return;}
    if(message.type==='pong') {
      const start=this.pings.get(message.nonce);if(start!==undefined){const sample=performance.now()-start;this.rtt=this.rtt?this.rtt*.7+sample*.3:sample;this.pings.delete(message.nonce);}return;
    }
    if(message.type==='closed') {
      this.onMessage(message.reason==='idle'?'房间已因长时间等待而关闭，请重新创建。':message.reason==='server-shutdown'?'联机服务已关闭。':'已离开房间。');
      this.intentional=true;return;
    }
    if(message.type==='error') {
      if(message.error==='stale-input')return;
      if(message.error==='input-queue-full'){this.pending=[];this.outbox=[];this.pauseUntil=performance.now()+110;return;}
      const errors: Record<string,string>={'room-not-found':'没有找到这个房间，请核对房间码。','room-full':'房间已经有两名玩家。','server-full':'当前服务已满，请稍后重试。','already-in-room':'你已经在房间中了。','rate-limited':'操作过于频繁，连接已关闭。','not-member':'请先创建或加入房间。'};
      this.onMessage(errors[message.error]??'这次操作未被接受，请稍后重试。');return;
    }
    if(message.type!=='snapshot')throw new Error('Unknown server message');
    const at=performance.now(),epoch=`${message.matchId}:${message.roundId}:${message.phase}`;
    const previous=this.snapshot;
    if(previous&&message.serverTick<previous.serverTick)return;
    if(epoch!==this.epoch){
      if(!previous||previous.matchId!==message.matchId){this.seq=0;this.seenEvent=0;}
      this.epoch=epoch;this.pending=[];this.outbox=[];this.history=[];
    }
    this.snapshot=message;this.lastSnapshotMs=at;
    if(this.slot!==null&&message.flight){
      const own=message.flight.pilots[this.slot];this.seq=Math.max(this.seq,own.lastProcessedSeq);
      const reconciled=reconcilePilot(own,this.pending,this.collider);this.predicted=reconciled.pilot;this.pending=reconciled.pending;
    }else this.predicted=null;
    this.history.push({at,data:message});if(this.history.length>12)this.history.shift();
    const fresh=message.events.filter(event=>event.id>this.seenEvent);
    if(fresh.length){this.seenEvent=Math.max(...fresh.map(event=>event.id));this.onEffects(fresh);}
    this.onChange();
  }
  sample(controls: Omit<DuelInputFrame,'seq'>,forceFlush=false) {
    const snapshot=this.snapshot;
    if(!this.connected||this.slot===null||!snapshot?.flight||snapshot.phase!=='playing'||performance.now()-this.lastSnapshotMs>500||performance.now()<this.pauseUntil)return;
    const frame={...controls,seq:++this.seq};this.pending.push(frame);this.outbox.push(frame);
    if(this.pending.length>120){this.pending=[];this.outbox=[];this.predicted=snapshot.flight.pilots[this.slot];return;}
    if(this.predicted)this.predicted=advanceDuelMotion(this.predicted,frame,this.collider).pilot;
    if(this.outbox.length>=2||forceFlush)this.flush();
  }
  private flush() {
    const snapshot=this.snapshot;if(!snapshot)return;
    while(this.outbox.length){
      const frames=this.outbox.splice(0,2);
      if(!this.send({v:1,type:'input',matchId:snapshot.matchId,roundId:snapshot.roundId,frames})){this.pending=[];this.outbox=[];break;}
    }
  }
  remote(at=performance.now()): DuelPilotState | null {
    if(this.slot===null)return null;const other=this.slot===0?1:0,target=at-100;
    const history=this.history.filter(item=>item.data.flight);
    if(!history.length)return null;
    for(let i=1;i<history.length;i++){
      const a=history[i-1]!,b=history[i]!;
      if(target<=b.at)return interpolatePilot(a.data.flight!.pilots[other],b.data.flight!.pilots[other],(target-a.at)/(b.at-a.at||1));
    }
    const last=history.at(-1)!,pilot=last.data.flight!.pilots[other],extra=Math.max(0,Math.min(100,target-last.at))/1000;
    if(last.data.phase!=='playing')return pilot;
    return {...pilot,position:pilot.position.map((n,i)=>n+pilot.velocity[i]!*extra) as [number,number,number]};
  }
  private stopPing(){if(this.pingTimer)clearInterval(this.pingTimer);this.pingTimer=null;this.pings.clear();}
  leave(){this.intentional=true;this.generation++;this.stopPing();if(this.connected)this.send({v:1,type:'leave'});this.socket?.close();this.socket=null;this.snapshot=null;this.slot=null;this.predicted=null;this.pending=[];this.outbox=[];this.history=[];this.epoch='';}
}
