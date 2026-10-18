import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {WebSocket} from 'ws';
import {createDuelServer} from '../src/server/duel-server.ts';
import {decodeDuelCollision} from '../src/sim/duel-collision.ts';
import {NEUTRAL_DUEL_INPUT as N} from '../src/sim/duel-flight.ts';
import {sub,rotate,clamp} from '../src/sim/duel-math.ts';
import {solveIntercept} from '../src/sim/intercept.ts';
import {parseDuelArgs} from '../scripts/serve-duel.mjs';
import {createConnection} from 'node:net';

const bytes=readFileSync(new URL('../public/collision/venator-duel.bin',import.meta.url));
const collider=decodeDuelCollision(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
let nonce=0;
async function setup(t,options={}){
  const clock={ms:0},app=createDuelServer({port:0,automatic:false,nowMs:()=>clock.ms,collider,...options}),address=await app.listen();
  t.after(()=>app.close());
  const advance=(ticks=1)=>{clock.ms+=ticks*1000/60;app.advance(ticks);};
  return {app,address,clock,advance};
}
async function connect(t,address,options={}){
  const ws=new WebSocket(address.wsUrl,{origin:address.origin,...options}),messages=[];
  ws.on('message',raw=>messages.push(JSON.parse(raw.toString())));ws.on('error',()=>undefined);
  t.after(()=>ws.terminate());await once(ws,'open');
  const wait=(predicate,start=0)=>{
    const existing=messages.slice(start).find(predicate);if(existing)return Promise.resolve(existing);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{clean();reject(new Error('Expected websocket message not received'));},2500);
      const receive=()=>{const found=messages.slice(start).find(predicate);if(found){clean();resolve(found);}};
      const closed=()=>{clean();reject(new Error('Socket closed while waiting for message'));};
      const clean=()=>{clearTimeout(timer);ws.off('message',receive);ws.off('close',closed);};
      ws.on('message',receive);ws.on('close',closed);
    });
  };
  const send=message=>ws.send(JSON.stringify({v:1,...message}));
  const request=(message,predicate)=>{const mark=messages.length;send(message);return wait(predicate,mark);};
  const sync=()=>{const n=++nonce;return request({type:'ping',nonce:n},m=>m.type==='pong'&&m.nonce===n);};
  const latest=()=>messages.findLast(m=>m.type==='snapshot');
  return {ws,messages,wait,send,request,sync,latest};
}
async function roomPair(t,options={}){
  const env=await setup(t,options),a=await connect(t,env.address),b=await connect(t,env.address);
  const joined=await a.request({type:'create'},m=>m.type==='welcome');
  await b.request({type:'join',code:joined.code},m=>m.type==='welcome');
  a.send({type:'ready',value:true});b.send({type:'ready',value:true});
  await a.wait(m=>m.type==='snapshot'&&m.phase==='countdown');
  for(let i=0;i<36;i++)env.advance(5);
  await a.sync();await b.sync();assert.equal(a.latest().phase,'playing');
  return {...env,a,b,code:joined.code};
}
const packet=(snapshot,frames)=>({type:'input',matchId:snapshot.matchId,roundId:snapshot.roundId,frames});
async function refused(address,options={},path='/ws'){
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(address.wsUrl.replace('/ws',path),options);ws.on('error',()=>undefined);
    const timer=setTimeout(()=>{ws.terminate();reject(new Error('Upgrade refusal timed out'));},2000);
    ws.on('unexpected-response',(req,res)=>{clearTimeout(timer);res.resume();resolve(res.statusCode);req.destroy();ws.terminate();});
    ws.on('open',()=>{clearTimeout(timer);ws.terminate();reject(new Error('Unexpected upgrade success'));});
  });
}

test('CLI defaults are loopback-only, explicit arguments are bounded, and imports do not listen',async()=>{
  assert.deepEqual(parseDuelArgs([]),{host:'127.0.0.1',port:8787});
  assert.deepEqual(parseDuelArgs(['--host','0.0.0.0','--origin','http://192.168.1.2:8787']),{host:'0.0.0.0',port:8787,allowedOrigins:['http://192.168.1.2:8787']});
  for(const args of [['--port','0'],['--port','1.5'],['--port','99999'],['--host','0.0.0.0'],['--bad','x'],['--origin']])assert.throws(()=>parseDuelArgs(args));
  const server=createDuelServer({collider});assert.equal(server.stats().connections,0);await server.close();await server.close();await assert.rejects(server.listen());
});
test('HTTP uses the existing production static server, including the collision binary',async t=>{
  const {address}=await setup(t);
  const page=await fetch(address.origin);assert.equal(page.status,200);assert.match(await page.text(),/<html/);
  const head=await fetch(address.origin+'/collision/venator-duel.bin',{method:'HEAD'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),bytes.length);
  assert.equal((await fetch(address.origin+'/absent-asset.glb')).status,404);
});
test('missing or unlisted Origin and wrong path are rejected before creating a session',async t=>{
  const {app,address}=await setup(t);
  assert.equal(await refused(address),403);assert.equal(await refused(address,{origin:'https://elsewhere.invalid'}),403);
  assert.equal(await refused(address,{origin:address.origin},'/wrong'),404);assert.equal(app.stats().connections,0);
});
test('two actual connections see the same authoritative countdown, flight and privacy-safe snapshots',async t=>{
  const {a,b,app}=await roomPair(t),sa=a.latest(),sb=b.latest();
  assert.equal(app.stats().connections,2);assert.equal(app.stats().rooms,1);assert.equal(sa.phase,'playing');assert.deepEqual(sa.flight,sb.flight);assert.deepEqual(sa.occupied,[true,true]);
  assert.doesNotMatch(JSON.stringify(sa),/connectionId/);assert.equal(a.messages.find(m=>m.type==='welcome').slot,0);assert.equal(b.messages.find(m=>m.type==='welcome').slot,1);
});
test('queued input is consumed once per tick; replay, wrong round and overflow are rejected atomically',async t=>{
  const {a,b,app,advance}=await roomPair(t);const before=a.latest();
  a.send(packet(before,[{...N,seq:1,yaw:1,boost:true,fire:true},{...N,seq:2,yaw:1,boost:true,fire:true}]));await a.sync();
  assert.equal(app.stats().queuedInputs,2);assert.equal(app.stats().serverTick,180);
  advance(3);await a.sync();await b.sync();let snapshot=a.latest();assert.equal(snapshot.flight.pilots[0].lastProcessedSeq,2);assert.equal(snapshot.flight.pilots[1].lastProcessedSeq,0);assert.notDeepEqual(snapshot.flight.pilots[0].rotation,before.flight.pilots[0].rotation);
  assert.equal((await a.request(packet(snapshot,[{...N,seq:2}]),m=>m.type==='error')).error,'stale-input');
  assert.equal((await a.request({...packet(snapshot,[{...N,seq:3}]),roundId:99},m=>m.type==='error')).error,'stale-input');
  for(let i=3;i<9;i+=2)a.send(packet(snapshot,[{...N,seq:i},{...N,seq:i+1}]));await a.sync();assert.equal(app.stats().queuedInputs,6);
  assert.equal((await a.request(packet(snapshot,[{...N,seq:9}]),m=>m.type==='error')).error,'input-queue-full');assert.equal(app.stats().queuedInputs,6);assert.equal(app.stats().serverTick,183);
});
test('input timeout releases boost/fire while normal flight and the other client continue',async t=>{
  const {a,advance,clock}=await roomPair(t);
  a.send(packet(a.latest(),[{...N,seq:1,boost:true,fire:true}]));await a.sync();advance(3);await a.sync();const before=a.latest();
  clock.ms+=251;advance(3);await a.sync();const after=a.latest();
  assert.equal(after.flight.pilots[0].boosting,false);assert.ok(after.flight.pilots[0].energy>before.flight.pilots[0].energy);assert.ok(after.flight.pilots[0].weapon.heat<before.flight.pilots[0].weapon.heat);assert.ok(after.flight.tick>before.flight.tick);
});
test('full room refuses a third player without affecting a second independent room',async t=>{
  const {app,address,a,code}=await roomPair(t,{maxRooms:2,maxConnections:4}),c=await connect(t,address),d=await connect(t,address);
  assert.equal((await c.request({type:'join',code},m=>m.type==='error')).error,'room-full');
  const second=await c.request({type:'create'},m=>m.type==='welcome');assert.notEqual(second.code,code);assert.equal(app.stats().rooms,2);
  assert.equal((await d.request({type:'create'},m=>m.type==='error')).error,'server-full');await a.sync();assert.equal(a.latest().phase,'playing');
  assert.equal(await refused(address,{origin:address.origin}),503);
});
test('active disconnect forfeits exactly once and explicit leave closes its connection and room',async t=>{
  const {a,b,app}=await roomPair(t),mark=a.messages.length;
  b.ws.terminate();const result=await a.wait(m=>m.type==='snapshot'&&m.phase==='finished',mark);assert.equal(result.finishReason,'disconnect');assert.equal(result.winner,0);assert.deepEqual(result.scores,[0,0]);
  const closed=once(a.ws,'close');assert.equal((await a.request({type:'leave'},m=>m.type==='closed')).reason,'room-closed');await closed;assert.equal(app.stats().rooms,0);
});
test('three malformed messages or an oversize frame close only the offending connection',async t=>{
  const {app,address,a}=await roomPair(t),bad=await connect(t,address);
  for(let i=0;i<2;i++)assert.equal((await bad.request({type:'invented'},m=>m.type==='error')).fatal,false);
  const closed=once(bad.ws,'close');assert.equal((await bad.request({type:'invented'},m=>m.type==='error')).fatal,true);await closed;
  const huge=await connect(t,address),hugeClosed=once(huge.ws,'close');huge.ws.send('x'.repeat(8193));await hugeClosed;
  await a.sync();assert.equal(app.stats().rooms,1);assert.equal(a.latest().phase,'playing');
});
test('maintenance detects an actual missing pong and uses the normal disconnect outcome',async t=>{
  const {app,address,a,b}=await roomPair(t);b.ws.terminate();await a.wait(m=>m.type==='snapshot'&&m.phase==='finished');
  // Start a fresh match with an actual websocket configured not to answer protocol ping.
  const silent=await connect(t,address,{autoPong:false});
  const code=a.latest().code;await silent.request({type:'join',code},m=>m.type==='welcome');
  a.send({type:'ready',value:true});silent.send({type:'ready',value:true});await a.wait(m=>m.type==='snapshot'&&m.phase==='countdown'&&m.matchId===2);
  for(let i=0;i<36;i++)app.advance(5);await a.sync();
  const pinged=once(silent.ws,'ping');app.maintain();await pinged;await a.sync();
  const mark=a.messages.length;app.maintain();const result=await a.wait(m=>m.type==='snapshot'&&m.phase==='finished',mark);assert.equal(result.finishReason,'disconnect');assert.equal(result.winner,0);
});
test('idle waiting rooms are reclaimed while a client ping does not keep them alive',async t=>{
  const {app,address,clock}=await setup(t),a=await connect(t,address);await a.request({type:'create'},m=>m.type==='welcome');
  clock.ms=120001;await a.sync();const closed=once(a.ws,'close');const mark=a.messages.length;app.maintain();assert.equal((await a.wait(m=>m.type==='closed',mark)).reason,'idle');await closed;assert.equal(app.stats().rooms,0);
});
test('unjoined connections cannot occupy admission capacity indefinitely',async t=>{
  const {app,address,clock}=await setup(t),a=await connect(t,address);
  clock.ms=30000;const mark=a.messages.length,closed=once(a.ws,'close');app.maintain();assert.equal((await a.wait(m=>m.type==='closed',mark)).reason,'idle');await closed;
});
test('close is bounded even when a TCP client never finishes its HTTP headers',async t=>{
  const {app,address}=await setup(t),socket=createConnection(address.port,'127.0.0.1');socket.on('error',()=>undefined);t.after(()=>socket.destroy());await once(socket,'connect');socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n');
  const closed=once(socket,'close');await app.close();await closed;
});
test('a real websocket input stream produces three kills, round resets, result and a clean rematch',async t=>{
  const {a,b,advance}=await roomPair(t);let seq=0,rounds=new Set();
  for(let i=0;i<6000&&a.latest().phase!=='finished';i++){
    const s=a.latest();rounds.add(s.roundId);
    if(s.phase==='playing'){
      const p=s.flight.pilots[0],target=s.flight.pilots[1],q=p.rotation;
      const aim=solveIntercept({x:p.position[0],y:p.position[1],z:p.position[2]},{x:target.position[0],y:target.position[1],z:target.position[2]},{x:target.velocity[0],y:target.velocity[1],z:target.velocity[2]},720,2)?.point;
      const local=rotate(sub(aim?[aim.x,aim.y,aim.z]:target.position,p.position),[-q[0],-q[1],-q[2],q[3]]);
      const control={...N,yaw:clamp(Math.atan2(local[0],-local[2])*2,-1,1),pitch:clamp(Math.atan2(local[1],Math.hypot(local[0],local[2]))*2,-1,1),throttle:-1,fire:true};
      a.send(packet(s,[{...control,seq:++seq},{...control,seq:++seq}]));await a.sync();
    }
    advance(2);await a.sync();
  }
  const result=a.latest();assert.equal(result.phase,'finished');assert.equal(result.finishReason,'score');assert.equal(result.winner,0);assert.deepEqual(result.scores,[3,0]);assert.equal(rounds.size,3);
  const mark=a.messages.length;a.send({type:'ready',value:true});b.send({type:'ready',value:true});const rematch=await a.wait(m=>m.type==='snapshot'&&m.matchId===2&&m.phase==='countdown',mark);
  assert.equal(rematch.flight.pilots[0].lastProcessedSeq,0);assert.deepEqual(rematch.flight.projectiles,[]);
  assert.equal((await a.request(packet(result,[{...N,seq:seq+1}]),m=>m.type==='error')).error,'stale-input');
});
test('automatic clock actually advances without messages; closing releases the port and is idempotent',async t=>{
  const app=createDuelServer({port:0,collider}),address=await app.listen();t.after(()=>app.close());
  const a=await connect(t,address);await a.request({type:'create'},m=>m.type==='welcome');await a.wait(m=>m.type==='snapshot'&&m.serverTick>=3);assert.throws(()=>app.advance());
  await app.close();await app.close();const replacement=createDuelServer({port:address.port,collider,automatic:false});t.after(()=>replacement.close());await replacement.listen();
});
test('address-in-use rejects cleanly without an uncaught socket error',async t=>{
  const {address}=await setup(t),second=createDuelServer({port:address.port,collider,automatic:false});
  await assert.rejects(second.listen(),{code:'EADDRINUSE'});await second.close();
});
