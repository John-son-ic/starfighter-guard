import { readFileSync } from 'node:fs';
import { randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Socket } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { createReleaseServer } from '../../scripts/serve-release.mjs';
import { DUEL_NET, DUEL_ROOM_ALPHABET, type DuelInputFrame, type DuelRoomCommand, type DuelRoomState, type DuelSlot } from '../shared/duel-contract.ts';
import type { DuelFlightEvent, DuelFlightState, DuelServerMessage } from '../shared/duel-snapshot.ts';
import { decodeDuelClientMessage, createDuelMessageBudget, consumeDuelMessageBudget } from '../platform/duel-protocol.ts';
import { createDuelRoom, reduceDuelRoom } from '../sim/duel-room.ts';
import { createDuelFlight, advanceDuelFlight, resetDuelRound, NEUTRAL_DUEL_INPUT } from '../sim/duel-flight.ts';
import { createDuelSnapshot } from '../sim/duel-snapshot.ts';
import { decodeDuelCollision, type DuelCollider } from '../sim/duel-collision.ts';

export interface DuelServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly staticRoot?: string;
  readonly allowedOrigins?: readonly string[];
  readonly maxConnections?: number;
  readonly maxRooms?: number;
  readonly heartbeatMs?: number;
  readonly idleMs?: number;
  /** No timers in manual mode; advance()/maintain() are for bounded server tests. */
  readonly automatic?: boolean;
  readonly nowMs?: () => number;
  readonly collider?: DuelCollider;
}
export interface DuelServerAddress { readonly host: string; readonly port: number; readonly origin: string; readonly wsUrl: string }
interface Session {
  id: string; ws: WebSocket; code: string | null; slot: DuelSlot | null;
  budget: ReturnType<typeof createDuelMessageBudget>;
  queue: DuelInputFrame[]; held: DuelInputFrame; lastInputMs: number; acceptedSeq: number;
  invalid: number; alive: boolean; closing: boolean; closeTimer: ReturnType<typeof setTimeout> | null;
  createdMs: number;
}
interface Room {
  state: DuelRoomState; flight: DuelFlightState | null;
  effects: { tick: number; event: DuelFlightEvent }[]; activityMs: number;
}
const COLLISION_URL=new URL('../../public/collision/venator-duel.bin',import.meta.url);
type ErrorCode=Extract<DuelServerMessage,{type:'error'}>['error'];

function integer(value: number,min: number,max: number,label: string) {
  if(!Number.isInteger(value)||value<min||value>max) throw new RangeError(`Invalid ${label}`);
  return value;
}
function loadCollider() {
  const bytes=readFileSync(COLLISION_URL);
  return decodeDuelCollision(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
}
/** Construct without listening or installing timers. Closing is explicit and idempotent. */
export function createDuelServer(options: DuelServerOptions={}) {
  const host=options.host??'127.0.0.1',port=integer(options.port??8787,0,65535,'port');
  if(typeof host!=='string'||!host||host.includes('/')||host.includes('\0')) throw new RangeError('Invalid host');
  const maxConnections=integer(options.maxConnections??32,1,32,'connection limit');
  const maxRooms=integer(options.maxRooms??16,1,16,'room limit');
  const heartbeatMs=integer(options.heartbeatMs??10000,10,60000,'heartbeat');
  const idleMs=integer(options.idleMs??120000,20,3600000,'idle lifetime');
  const automatic=options.automatic??true,now=options.nowMs??(()=>performance.now());
  createDuelMessageBudget(now()); // Fail before opening resources on an invalid clock.
  const origins=new Set(options.allowedOrigins??[]);
  for(const origin of origins) {
    const url=new URL(origin);
    if(!['http:','https:'].includes(url.protocol)||url.origin!==origin) throw new RangeError('Origins must be exact HTTP(S) origins');
  }
  const collider=options.collider??loadCollider();
  const server=createReleaseServer(options.staticRoot??fileURLToPath(new URL('../../dist',import.meta.url)));
  const tcpSockets=new Set<Socket>();
  server.on('connection',socket=>{tcpSockets.add(socket);socket.once('close',()=>tcpSockets.delete(socket));});
  server.headersTimeout=10000;server.requestTimeout=10000;server.keepAliveTimeout=5000;
  const wss=new WebSocketServer({noServer:true,maxPayload:DUEL_NET.maxMessageBytes,perMessageDeflate:false,clientTracking:true});
  const sessions=new Map<string,Session>(),rooms=new Map<string,Room>();
  let tick=0,droppedSteps=0,reserved=0,stopping=false,address: DuelServerAddress | null=null;
  let simulationTimer: ReturnType<typeof setInterval> | null=null,maintenanceTimer: ReturnType<typeof setInterval> | null=null;
  let listenPromise: Promise<DuelServerAddress> | null=null,closePromise: Promise<void> | null=null;
  let lastPump=now();

  const peers=(room: Room)=>[...sessions.values()].filter(s=>s.code===room.state.code&&!s.closing);
  function clearInput(session: Session,newMatch=false) {
    session.queue=[];session.held=NEUTRAL_DUEL_INPUT;session.lastInputMs=now();
    if(newMatch) session.acceptedSeq=0;
  }
  function send(s: Session,message: DuelServerMessage) {
    if(s.closing||s.ws.readyState!==WebSocket.OPEN) return;
    if(s.ws.bufferedAmount>262144) {end(s,'disconnect',null);return;}
    s.ws.send(JSON.stringify(message),error=>{if(error){detach(s,'disconnect');s.ws.terminate();}});
  }
  function snapshot(room: Room) {
    room.effects=room.effects.filter(e=>e.tick>=tick-12).slice(-96);
    return createDuelSnapshot(room.state,room.flight,tick,room.effects.map(e=>e.event));
  }
  function broadcast(room: Room) {const message=snapshot(room);for(const s of peers(room))send(s,message);}
  function apply(room: Room,command: DuelRoomCommand) {
    const reduced=reduceDuelRoom(room.state,command);
    if(reduced.error) return reduced;
    room.state=reduced.state;
    if(reduced.events.some(e=>e.type==='countdown-started')) {
      room.flight=createDuelFlight();room.effects=[];
      for(const s of peers(room))clearInput(s,true);
    }
    if(room.state.phase==='waiting') {room.flight=null;room.effects=[];}
    for(const event of reduced.events) {
      if(event.type==='round-started') {
        if(!room.flight) throw new Error('Missing initialized flight');
        if(event.roundId>room.flight.roundId) room.flight=resetDuelRound(room.flight,event.roundId);
        for(const s of peers(room))clearInput(s);
      }
      if(event.type==='round-ended'||event.type==='match-finished') {
        if(room.flight)room.flight={...room.flight,projectiles:[]};
        for(const s of peers(room))clearInput(s);
      }
      if(event.type==='match-finished')room.activityMs=now();
    }
    return reduced;
  }
  function detach(s: Session,reason: 'leave'|'disconnect') {
    const code=s.code;s.code=null;s.slot=null;clearInput(s);
    if(!code)return;
    const room=rooms.get(code);if(!room)return;
    apply(room,{type:'leave',connectionId:s.id,reason});room.activityMs=now();
    if(room.state.phase==='closed')rooms.delete(code);
    else if(!stopping)broadcast(room);
  }
  function end(s: Session,reason: 'leave'|'disconnect',message: DuelServerMessage | null) {
    if(s.closing)return;
    // Send terminal notification before marking closed; don't recurse via the slow-client guard.
    if(message&&s.ws.readyState===WebSocket.OPEN&&s.ws.bufferedAmount<=262144)s.ws.send(JSON.stringify(message));
    s.closing=true;detach(s,reason);
    if(s.ws.readyState===WebSocket.OPEN)s.ws.close(reason==='leave'?1000:1008,'session ended');
    else s.ws.terminate();
    s.closeTimer=setTimeout(()=>s.ws.terminate(),1000);s.closeTimer.unref();
  }
  function error(s: Session,code: ErrorCode,fatal=false) {
    const message={v:1,type:'error',error:code,fatal} as const;
    if(fatal)end(s,'disconnect',message);else send(s,message);
  }
  function charge(s: Session,cost=1) {
    const step=consumeDuelMessageBudget(s.budget,now(),cost);s.budget=step.state;
    if(!step.allowed)error(s,'rate-limited',true);
    return step.allowed;
  }
  function createCode() {
    for(let attempt=0;attempt<16;attempt++) {
      let code='';for(let i=0;i<6;i++)code+=DUEL_ROOM_ALPHABET[randomInt(DUEL_ROOM_ALPHABET.length)];
      if(!rooms.has(code))return code;
    }
    return null;
  }
  function onMessage(s: Session,data: RawData,binary: boolean) {
    if(stopping||s.closing||!charge(s))return;
    if(binary){error(s,'invalid-message',true);return;}
    const text=(Array.isArray(data)?Buffer.concat(data):Buffer.isBuffer(data)?data:Buffer.from(data)).toString('utf8');
    const decoded=decodeDuelClientMessage(text);
    if(!decoded.ok){s.invalid++;error(s,'invalid-message',s.invalid>=3);return;}
    const message=decoded.message;s.invalid=0;
    if(message.type==='ping'){send(s,{v:1,type:'pong',nonce:message.nonce});return;}
    if(message.type==='create'||message.type==='join') {
      if(!charge(s,DUEL_NET.admissionCost-1))return;
      if(s.code){error(s,'already-in-room');return;}
      let room: Room | undefined;
      if(message.type==='create') {
        if(rooms.size>=maxRooms){error(s,'server-full');return;}
        const code=createCode();if(!code){error(s,'server-full');return;}
        room={state:createDuelRoom(code),flight:null,effects:[],activityMs:now()};rooms.set(code,room);
      } else room=rooms.get(message.code);
      if(!room){error(s,'room-not-found');return;}
      const result=apply(room,{type:'join',connectionId:s.id});
      if(result.error){error(s,result.error);return;}
      s.code=room.state.code;s.slot=room.state.members[0]?.connectionId===s.id?0:1;clearInput(s,true);room.activityMs=now();
      send(s,{v:1,type:'welcome',code:s.code,slot:s.slot});broadcast(room);return;
    }
    if(message.type==='leave'){end(s,'leave',{v:1,type:'closed',reason:'room-closed'});return;}
    const room=s.code?rooms.get(s.code):undefined;
    if(!room||s.slot===null){error(s,'not-member');return;}
    if(message.type==='ready') {
      const changed=room.state.members[s.slot]?.ready!==message.value;
      const result=apply(room,{type:'ready',connectionId:s.id,value:message.value});
      if(result.error){error(s,result.error);return;}
      if(changed&&room.state.phase!=='finished')room.activityMs=now();broadcast(room);return;
    }
    if(message.type==='input') {
      if(room.state.phase!=='playing'||message.matchId!==room.state.matchId||message.roundId!==room.state.roundId||message.frames[0]!.seq<=s.acceptedSeq){error(s,'stale-input');return;}
      if(s.queue.length+message.frames.length>6){error(s,'input-queue-full');return;}
      s.queue.push(...message.frames);s.acceptedSeq=message.frames.at(-1)!.seq;s.lastInputMs=now();
    }
  }
  function takeInput(s: Session): DuelInputFrame {
    if(now()-s.lastInputMs>DUEL_NET.inputTimeoutMs){clearInput(s);return NEUTRAL_DUEL_INPUT;}
    const frame=s.queue.shift();
    if(frame){s.held=frame;return frame;}
    return {...s.held,seq:0,torpedo:false,shield:false};
  }
  function tickOnce() {
    tick++;
    for(const room of rooms.values()) {
      let deadSlots: readonly DuelSlot[]=[];
      if(room.state.phase==='playing') {
        if(!room.flight)throw new Error('Playing room has no flight');
        const inputs: [DuelInputFrame,DuelInputFrame]=[NEUTRAL_DUEL_INPUT,NEUTRAL_DUEL_INPUT];
        for(const s of peers(room))if(s.slot!==null)inputs[s.slot]=takeInput(s);
        const result=advanceDuelFlight(room.flight,inputs,collider);room.flight=result.state;deadSlots=result.deadSlots;
        room.effects.push(...result.events.map(event=>({tick,event})));room.effects=room.effects.slice(-96);
      }
      const result=apply(room,{type:'tick',deadSlots});
      if(result.events.length||tick%3===0)broadcast(room);
    }
  }
  function maintain() {
    if(stopping)return;
    for(const s of sessions.values()) {
      if(s.closing)continue;
      if(!s.code&&now()-s.createdMs>=30000){end(s,'leave',{v:1,type:'closed',reason:'idle'});continue;}
      if(!s.alive){end(s,'disconnect',null);s.ws.terminate();continue;}
      s.alive=false;s.ws.ping();
    }
    for(const [code,room] of rooms) {
      const idleWaiting=room.state.phase==='waiting'&&room.state.members.filter(Boolean).length<=1;
      if((idleWaiting||room.state.phase==='finished')&&now()-room.activityMs>=idleMs) {
        for(const s of peers(room))end(s,'leave',{v:1,type:'closed',reason:'idle'});
        rooms.delete(code);
      }
    }
  }
  server.on('upgrade',(request,socket,head)=>{
    socket.on('error',()=>undefined);
    const refuse=(status: number,label: string)=>{socket.end(`HTTP/1.1 ${status} ${label}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);};
    if(stopping||sessions.size+reserved>=maxConnections){refuse(503,'Service Unavailable');return;}
    if(request.url!=='/ws'){refuse(404,'Not Found');return;}
    if(!request.headers.origin||!origins.has(request.headers.origin)){refuse(403,'Forbidden');return;}
    reserved++;let released=false;
    const release=()=>{if(!released){released=true;reserved--;}};
    socket.once('close',release);
    try {wss.handleUpgrade(request,socket,head,ws=>{
      release();
      const s: Session={id:randomUUID(),ws,code:null,slot:null,budget:createDuelMessageBudget(now()),queue:[],held:NEUTRAL_DUEL_INPUT,lastInputMs:now(),acceptedSeq:0,invalid:0,alive:true,closing:false,closeTimer:null,createdMs:now()};
      sessions.set(s.id,s);
      ws.on('message',(data,binary)=>onMessage(s,data,binary));ws.on('pong',()=>{s.alive=true;});
      ws.on('error',()=>{detach(s,'disconnect');ws.terminate();});
      ws.on('close',()=>{if(s.closeTimer)clearTimeout(s.closeTimer);detach(s,'disconnect');sessions.delete(s.id);});
    });} catch {release();socket.destroy();}
  });
  function pump() {
    const current=now(),available=Math.floor((current-lastPump)/(1000/60));
    if(available<=0)return;
    const count=Math.min(5,available);droppedSteps+=Math.max(0,available-count);
    lastPump=available>5?current:lastPump+count*(1000/60);
    for(let i=0;i<count;i++)tickOnce();
  }
  function listen(): Promise<DuelServerAddress> {
    if(stopping)return Promise.reject(new Error('Server is closed'));
    if(listenPromise)return listenPromise;
    listenPromise=new Promise((resolve,reject)=>{
      const fail=(err: Error)=>{server.off('listening',ready);reject(err);};
      const ready=()=>{
        server.off('error',fail);
        const bound=server.address();if(!bound||typeof bound==='string'){reject(new Error('No TCP address'));return;}
        const urlHost=host.includes(':')?`[${host}]`:host;
        address={host,port:bound.port,origin:`http://${urlHost}:${bound.port}`,wsUrl:`ws://${urlHost}:${bound.port}/ws`};
        if(!options.allowedOrigins){origins.add(address.origin);if(host==='127.0.0.1'||host==='localhost')for(const name of ['127.0.0.1','localhost']){origins.add(`http://${name}:${bound.port}`);origins.add(`http://${name}:5173`);}}
        lastPump=now();
        if(automatic&&!stopping){simulationTimer=setInterval(pump,8);maintenanceTimer=setInterval(maintain,heartbeatMs);simulationTimer.unref();maintenanceTimer.unref();}
        resolve(address);
      };
      server.once('error',fail);server.once('listening',ready);server.listen(port,host);
    });
    return listenPromise;
  }
  // These listeners prevent transport errors from becoming unhandled process errors.
  server.on('error',()=>{if(address&&!stopping)void close();});wss.on('error',()=>{if(!stopping)void close();});
  function close(): Promise<void> {
    if(closePromise)return closePromise;
    stopping=true;if(simulationTimer)clearInterval(simulationTimer);if(maintenanceTimer)clearInterval(maintenanceTimer);
    closePromise=(async()=>{
      if(listenPromise)await listenPromise.catch(()=>undefined);
      for(const s of sessions.values())end(s,'leave',{v:1,type:'closed',reason:'server-shutdown'});
      const force=setTimeout(()=>{for(const s of sessions.values())s.ws.terminate();for(const socket of tcpSockets)socket.destroy();},100);force.unref();
      try {await Promise.all([new Promise<void>(resolve=>wss.close(()=>resolve())),new Promise<void>(resolve=>{if(server.listening)server.close(()=>resolve());else resolve();})]);}
      finally {clearTimeout(force);for(const s of sessions.values()){if(s.closeTimer)clearTimeout(s.closeTimer);s.ws.terminate();}for(const socket of tcpSockets)socket.destroy();sessions.clear();rooms.clear();}
    })();
    return closePromise;
  }
  return {
    listen,close,
    advance(count=1) {
      if(automatic)throw new Error('Manual advance requires automatic:false');
      if(!address||stopping)throw new Error('Server is not running');
      integer(count,1,5,'manual tick count');for(let i=0;i<count;i++)tickOnce();
    },
    maintain() {if(automatic)throw new Error('Manual maintenance requires automatic:false');maintain();},
    stats:()=>({connections:sessions.size,rooms:rooms.size,serverTick:tick,reserved,droppedSteps,queuedInputs:[...sessions.values()].reduce((n,s)=>n+s.queue.length,0)}),
  };
}
