import './style.css';
import {decodeDuelCollision} from '../../sim/duel-collision.ts';
import {NEUTRAL_DUEL_INPUT} from '../../sim/duel-flight.ts';
import type {DuelInputFrame} from '../../shared/duel-contract.ts';
import {DuelClient} from './client.ts';
import {DuelScene} from './scene.ts';
import {solveIntercept} from '../../sim/intercept.ts';

export async function startDuel(app: HTMLElement){
  app.innerHTML=`<main class="duel-shell"><div class="duel-viewport"></div>
  <header class="duel-header"><a href="./" class="duel-brand">◉ <span>守望号<small>REPUBLIC FLIGHT ACADEMY</small></span></a><div class="duel-score"><span class="blue">P1</span><strong id="duel-score">0 : 0</strong><span class="red">P2</span><small id="duel-match-clock">先得 3 分</small></div><div class="duel-network"><span id="duel-ping">尚未连接</span><button id="duel-menu-button" type="button">菜单 Esc</button></div></header>
  <section class="duel-lobby" id="duel-lobby"><span class="duel-eyebrow">03 / LIVE DOGFIGHT</span><h1>双人对战</h1><p>驾驶 Eta-2，在守望号附近展开训练空战。创建房间，邀请你的对手加入。</p>
  <div id="duel-entry"><button class="duel-primary" id="duel-create" disabled>正在准备战场…</button><div class="duel-divider">或输入对方的房间码</div><form id="duel-join-form"><label for="duel-code">六位房间码</label><div class="duel-join-row"><input id="duel-code" maxlength="6" autocomplete="off" spellcheck="false" placeholder="ABC234" aria-label="六位房间码"><button id="duel-join" disabled>加入 ↗</button></div></form><small>两名玩家需要打开同一个联机服务地址。</small></div>
  <div id="duel-room" hidden><div class="duel-room-label">房间码 <button id="duel-copy">复制</button></div><strong class="duel-room-code" id="duel-room-code">------</strong><div id="duel-members"></div><button class="duel-primary" id="duel-ready">准备</button><p id="duel-result"></p><button class="duel-text-button" id="duel-leave">离开房间</button></div>
  <p class="duel-notice" id="duel-notice" role="status" aria-live="polite">首次加载舰体碰撞数据，请稍候。</p><a class="duel-back" href="./">← 返回单人任务</a></section>
  <div class="duel-round" id="duel-round" role="status"></div><div class="duel-reticle" id="duel-reticle" hidden><i></i></div><div id="duel-target" class="duel-target" hidden></div><div id="duel-lead" class="duel-lead" hidden></div><div id="duel-edge" class="duel-edge" hidden>▲</div>
  <aside id="duel-opponent" class="duel-opponent" hidden><small>对手 / ETA-2</small><strong id="duel-distance"></strong><span id="duel-enemy-health"></span></aside>
  <footer class="duel-hud" id="duel-hud" hidden><section class="duel-vitals"><small id="duel-pilot-name">P1 · 蓝方</small><label>机体 <b id="duel-health">100</b></label><meter id="duel-health-bar" min="0" max="100" value="100"></meter><label>武器热量 <b id="duel-heat">0%</b></label><meter id="duel-heat-bar" min="0" max="100" value="0"></meter><label>加速能量 <b id="duel-energy">100%</b></label><meter id="duel-energy-bar" min="0" max="100" value="100"></meter><div class="duel-shield" id="duel-shield"></div></section><div class="duel-controls">鼠标 / A D 转向 · W S 油门 · Q E 滚转<br>左键 激光 · Shift 加速 · R 鱼雷 · F 护盾<br>金色小圈：激光提前量</div><section class="duel-torpedoes"><small>R / 质子鱼雷</small><strong id="duel-lock">等待锁定</strong><progress id="duel-lock-bar" max="120" value="0"></progress><div id="duel-torpedo-slots"></div><span>前向瞄准 2 秒 · 每枚冷却 18 秒</span></section></footer>
  <aside class="duel-menu" id="duel-menu" hidden><h2>飞行菜单</h2><p>对局仍在继续。当前已释放操控，战机会保持飞行。</p><button class="duel-primary" id="duel-resume">继续操控</button><button id="duel-menu-leave">离开房间</button><a href="./">返回单人任务</a></aside></main>`;
  const get=<T extends HTMLElement>(id:string)=>app.querySelector<T>('#'+id)!;
  let collider;
  try{const response=await fetch('./collision/venator-duel.bin');if(!response.ok)throw new Error('Missing map');collider=decodeDuelCollision(await response.arrayBuffer());}
  catch{get('duel-notice').textContent='战场数据加载失败。请重新构建游戏后刷新。';return;}
  const client=new DuelClient(collider),scene=new DuelScene(app.querySelector('.duel-viewport')!,collider);
  let disposed=false,menu=false,busy=false,mouseX=0,mouseY=0,firing=false,shieldPulse=false,torpedoPulse=false;
  const keys=new Set<string>();let last=performance.now(),accumulator=0,raf=0;
  let noticeUntil=0,readyLabel='',roomView='';
  let override: Partial<DuelInputFrame> | null=null;
  const abort=new AbortController(),options={signal:abort.signal};
  const neutral=()=>{keys.clear();mouseX=0;mouseY=0;firing=false;shieldPulse=false;torpedoPulse=false;client.sample(NEUTRAL_DUEL_INPUT,true);};
  function notify(text:string){get('duel-notice').textContent=text;noticeUntil=performance.now()+7000;}
  function update(){
    const s=client.snapshot,inRoom=client.connected&&client.slot!==null&&!!s;
    get('duel-entry').hidden=inRoom;get('duel-room').hidden=!inRoom;
    const lobby=!s||!inRoom||s.phase==='waiting'||s.phase==='finished';get('duel-lobby').hidden=!lobby;
    get('duel-hud').hidden=lobby;get('duel-opponent').hidden=!inRoom||!s.flight||lobby;get('duel-reticle').hidden=!inRoom||s.phase!=='playing'||menu;
    get<HTMLButtonElement>('duel-create').disabled=busy;get<HTMLButtonElement>('duel-join').disabled=busy;
    if(!inRoom){document.documentElement.dataset.duelPhase='lobby';get('duel-create').textContent=busy?'正在连接…':'创建房间 ↗';get('duel-round').textContent='';return;}
    const slot=client.slot!,own=s.flight?.pilots[slot];
    get('duel-room-code').textContent=s.code;get('duel-score').textContent=s.scores.join(' : ');
    const left=Math.max(0,Math.ceil((36000-s.matchTicks)/60));get('duel-match-clock').textContent=lobby?'先得 3 分':`先得 3 分 · ${String(Math.floor(left/60)).padStart(2,'0')}:${String(left%60).padStart(2,'0')}`;
    get('duel-pilot-name').textContent=slot===0?'P1 · 蓝方 / 你':'P2 · 红方 / 你';
    const members=s.occupied.map((present,i)=>`<div class="duel-member"><span class="${i===0?'blue':'red'}">P${i+1} · ${i===0?'蓝方':'红方'}${slot===i?' / 你':''}</span><strong>${!present?'等待加入':s.ready[i]?'已准备':'未准备'}</strong></div>`).join('');
    if(members!==roomView){get('duel-members').innerHTML=members;roomView=members;}
    const label=s.ready[slot]?'取消准备':s.phase==='finished'?'准备重赛':'准备';if(label!==readyLabel){get('duel-ready').textContent=label;readyLabel=label;}
    get<HTMLButtonElement>('duel-ready').disabled=!['waiting','finished'].includes(s.phase);
    get('duel-result').textContent=s.phase==='finished'?(s.winner===null?'本场平局':s.winner===slot?'你赢得了本场对决':'本场对决结束')+(s.finishReason==='disconnect'||s.finishReason==='leave'?' · 对手已离开':' · 再次准备可重赛'):!s.occupied[1-slot]?'等待另一名玩家加入，分享上方房间码。':'两人均准备后开始。';
    get('duel-round').textContent=s.phase==='countdown'?`准备出击 · ${Math.max(1,Math.ceil((180-s.phaseTicks)/60))}`:s.phase==='intermission'?`本轮结束 · ${Math.max(1,Math.ceil((300-s.phaseTicks)/60))} 秒后重新出发`:'';
    document.documentElement.dataset.duelPhase=s.phase;
    if(own){
      for(const [id,value] of [['health',own.health],['heat',Math.round(own.weapon.heat)],['energy',Math.round(own.energy)]] as const){get('duel-'+id).textContent=String(value)+(id==='health'?'':'%');get<HTMLMeterElement>('duel-'+id+'-bar').value=value;}
      get('duel-shield').textContent=own.shieldTicks>0?`F 护盾开启 · ${(own.shieldTicks/60).toFixed(1)}s`:own.shieldCooldownTicks>0?`F 护盾冷却 · ${Math.ceil(own.shieldCooldownTicks/60)}s`:'F 主动护盾 · 就绪';
      const launch=s.phase==='playing'&&own.lockTicks>=120&&own.torpedoCooldownTicks.some(t=>t===0);
      get('duel-lock').textContent=s.phase!=='playing'?'等待下一轮':launch?'锁定完成 · 按 R 发射':own.torpedoCooldownTicks.every(t=>t>0)?'两枚鱼雷冷却中':own.lockTicks>0?`锁定中 · ${(own.lockTicks/60).toFixed(1)} / 2s`:'瞄准对手开始锁定';
      get('duel-lock').classList.toggle('ready',launch);get('duel-reticle').classList.toggle('locked',launch);get<HTMLProgressElement>('duel-lock-bar').value=own.lockTicks;
      get('duel-torpedo-slots').textContent=own.torpedoCooldownTicks.map((ticks,i)=>`${i+1}号 ${ticks?Math.ceil(ticks/60)+'s':'就绪'}`).join('     ');
    }
  }
  client.onChange=update;client.onMessage=notify;client.onEffects=events=>scene.effects(events);
  const enter=async(type:'create'|'join')=>{
    if(busy)return;const code=get<HTMLInputElement>('duel-code').value.trim().toUpperCase();
    if(type==='join'&&!/^[A-HJ-NP-Z2-9]{6}$/.test(code)){notify('请输入六位房间码（不含 0、1、I、O）。');return;}
    busy=true;notify('正在连接联机服务…');update();scene.startAudio();
    try{await client.connect();if(type==='create')client.send({v:1,type:'create'});else client.send({v:1,type:'join',code});notify('已连接。房间内两人准备后开始对决。');}
    catch(error){notify(error instanceof Error?error.message:'连接失败，请重试。');client.leave();}
    finally{busy=false;update();}
  };
  get('duel-create').addEventListener('click',()=>void enter('create'),options);
  get('duel-join-form').addEventListener('submit',event=>{event.preventDefault();void enter('join');},options);
  get<HTMLInputElement>('duel-code').addEventListener('input',event=>{const input=event.target as HTMLInputElement;input.value=input.value.toUpperCase();},options);
  get('duel-ready').addEventListener('click',()=>{scene.startAudio();if(client.slot!==null&&client.snapshot)client.send({v:1,type:'ready',value:!client.snapshot.ready[client.slot]});},options);
  const leave=()=>{neutral();client.leave();menu=false;get('duel-menu').hidden=true;document.documentElement.dataset.duelPhase='lobby';notify('已离开房间，可以创建新房间或加入另一场对决。');update();};
  get('duel-leave').addEventListener('click',leave,options);get('duel-menu-leave').addEventListener('click',leave,options);
  get('duel-copy').addEventListener('click',()=>{const code=client.snapshot?.code;if(!code)return;if(!navigator.clipboard){notify('请手动记下房间码：'+code);return;}void navigator.clipboard.writeText(code).then(()=>notify('房间码已复制，发给对手即可。')).catch(()=>notify('请手动记下房间码：'+code));},options);
  const toggleMenu=()=>{neutral();menu=!menu;get('duel-menu').hidden=!menu;update();};
  get('duel-menu-button').addEventListener('click',toggleMenu,options);get('duel-resume').addEventListener('click',toggleMenu,options);
  window.addEventListener('keydown',event=>{
    if(event.target instanceof HTMLInputElement)return;
    if(event.code==='Escape'){event.preventDefault();if(!event.repeat)toggleMenu();return;}
    if(client.snapshot?.phase!=='playing'||menu)return;
    if(['Tab','Space','KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE','KeyR','KeyF','ShiftLeft','ShiftRight'].includes(event.code))event.preventDefault();
    if(event.code==='KeyF'&&!event.repeat)shieldPulse=true;if(event.code==='KeyR'&&!event.repeat)torpedoPulse=true;keys.add(event.code);
  },options);
  window.addEventListener('keyup',event=>{keys.delete(event.code);},options);
  const viewport=app.querySelector<HTMLElement>('.duel-viewport')!;
  viewport.addEventListener('pointermove',event=>{mouseX=Math.max(-1,Math.min(1,(event.clientX-innerWidth/2)/(innerWidth*.32)));mouseY=Math.max(-1,Math.min(1,(innerHeight/2-event.clientY)/(innerHeight*.32)));},options);
  viewport.addEventListener('pointerdown',event=>{if(event.button===0&&!menu){firing=true;scene.startAudio();}},options);
  window.addEventListener('pointerup',()=>{firing=false;},options);viewport.addEventListener('pointerleave',neutral,options);
  window.addEventListener('blur',neutral,options);document.addEventListener('visibilitychange',()=>{if(document.hidden)neutral();},options);window.addEventListener('resize',()=>scene.resize(),options);
  function sample(){
    const axes=keys.has('KeyA')||keys.has('KeyD');
    const controls=menu?NEUTRAL_DUEL_INPUT:{yaw:axes?Number(keys.has('KeyD'))-Number(keys.has('KeyA')):mouseX,pitch:mouseY,roll:Number(keys.has('KeyQ'))-Number(keys.has('KeyE')),throttle:Number(keys.has('KeyW'))-Number(keys.has('KeyS')),boost:keys.has('ShiftLeft')||keys.has('ShiftRight'),fire:firing,torpedo:torpedoPulse,shield:shieldPulse};
    client.sample(!menu&&override?{...controls,...override}:controls);shieldPulse=false;torpedoPulse=false;
  }
  const timer=setInterval(()=>{const now=performance.now();accumulator+=Math.min(50,now-last);last=now;let count=0;while(accumulator>=1000/60&&count++<3){sample();accumulator-=1000/60;}},8);
  let drawAt=performance.now();
  const draw=(now:number)=>{
    if(disposed)return;const dt=Math.min(.1,(now-drawAt)/1000);drawAt=now;scene.draw(client,dt,now/1000);
    get('duel-ping').textContent=client.connected?(client.lastSnapshotMs&&now-client.lastSnapshotMs>750?'同步延迟…':`${Math.round(client.rtt)} ms · 已连接`):'尚未连接';
    const enemy=client.remote(),own=client.predicted,s=client.snapshot;
    const active=enemy&&own&&s?.phase==='playing'&&enemy.health>0&&!menu;get('duel-target').hidden=!active;get('duel-edge').hidden=true;get('duel-lead').hidden=true;
    if(active){
      const point=scene.project(enemy),distance=Math.hypot(...enemy.position.map((n,i)=>n-own.position[i]!));
      get('duel-distance').textContent=`${Math.round(distance)} m`;get('duel-enemy-health').textContent=`机体 ${enemy.health}%`;
      const blocked=!!collider.sweepSphere(own.position,enemy.position,0);get('duel-enemy-health').textContent+=blocked?' · 舰体遮挡':'';
      if(!blocked){const lead=solveIntercept({x:own.position[0],y:own.position[1],z:own.position[2]},{x:enemy.position[0],y:enemy.position[1],z:enemy.position[2]},{x:enemy.velocity[0],y:enemy.velocity[1],z:enemy.velocity[2]},720,2);if(lead){const projected=scene.project({...enemy,position:[lead.point.x,lead.point.y,lead.point.z]});const marker=get('duel-lead');marker.hidden=!projected.front||projected.x<15||projected.x>innerWidth-15||projected.y<90||projected.y>innerHeight-30;marker.style.left=projected.x+'px';marker.style.top=projected.y+'px';}}
      const inside=point.front&&point.x>35&&point.x<innerWidth-35&&point.y>90&&point.y<innerHeight-65;
      get('duel-target').hidden=!inside;get('duel-target').style.left=point.x+'px';get('duel-target').style.top=point.y+'px';
      if(!inside){const edge=get('duel-edge');edge.hidden=false;const dx=(point.x-innerWidth/2)*(point.front?1:-1),dy=(point.y-innerHeight/2)*(point.front?1:-1),factor=Math.min((innerWidth/2-48)/Math.max(1,Math.abs(dx)),(innerHeight/2-100)/Math.max(1,Math.abs(dy)));edge.style.left=innerWidth/2+dx*factor+'px';edge.style.top=innerHeight/2+dy*factor+'px';edge.style.transform=`translate(-50%,-50%) rotate(${Math.atan2(dy,dx)+Math.PI/2}rad)`;}
    }
    if(noticeUntil&&now>noticeUntil){get('duel-notice').textContent='';noticeUntil=0;}
    raf=requestAnimationFrame(draw);
  };raf=requestAnimationFrame(draw);
  get('duel-create').textContent='创建房间 ↗';get<HTMLButtonElement>('duel-create').disabled=false;get<HTMLButtonElement>('duel-join').disabled=false;get('duel-notice').textContent='';
  document.documentElement.dataset.duelPhase='lobby';
  const roomCode=new URLSearchParams(location.search).get('room');if(roomCode)get<HTMLInputElement>('duel-code').value=roomCode.slice(0,6).toUpperCase();
  if(import.meta.env.DEV&&new URLSearchParams(location.search).get('qa')==='1'){
    const qa={snapshot:()=>client.snapshot,predicted:()=>client.predicted,controls:(input:Partial<DuelInputFrame>|null)=>{override=input;},pending:()=>({connected:client.connected,slot:client.slot}),camera:()=>scene.camera.position.toArray()};
    Object.assign(window,{__duelQA:qa});
  }
  window.addEventListener('pagehide',()=>{disposed=true;abort.abort();clearInterval(timer);cancelAnimationFrame(raf);client.leave();scene.dispose();}, {once:true});
}
