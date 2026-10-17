import { FlightWorld, NEUTRAL_INPUT, TORPEDO_CONFIG } from './world.ts';
import { FlightScene } from './scene.ts';
import { FlightAudio } from './audio.ts';
import { TacticalHUD } from './hud.ts';
import { loadSettings, saveSettings } from '../../platform/settings.ts';
import { createFrameStats } from '../../platform/frame-stats.ts';
import type { StorageLike } from '../../shared/types.ts';
import type { FlightInput } from './world.ts';
import { MISSION_CONFIG, MVP_CONFIG } from '../../shared/config.ts';
import './flight.css';
import './hud.css';

export function startFlight(app: HTMLElement) {
  document.title = '余烬航道 · Starfighter Guard';
  app.innerHTML = `<section class="flight-shell">
    <div class="flight-viewport"></div><div class="jump-effect"></div><div class="flight-vignette"></div><div class="damage-overlay"></div>
    <header class="flight-header"><a href="./?mode=models" class="flight-logo">✦ <span>STARFIGHTER GUARD</span></a><div class="mission-status"><i></i><span id="phase-label">编队集结</span><small id="wave-label">余烬航道 / 19 BBY</small></div><button id="pause-button">暂停 <kbd>Esc</kbd></button></header>
    <aside class="wing-panel"><span class="hud-eyebrow">苍鹭中队</span><div id="wing-status"></div><div id="bomber-status"></div><div class="wing-order"><kbd>1</kbd> 集火　<kbd>2</kbd> 归队</div></aside>
    <aside class="carrier-panel"><div><span>守望号</span><strong id="carrier-value">100%</strong></div><div class="hud-bar"><i id="carrier-bar"></i></div><small>狩猎者级 / 保卫受损区域</small></aside>
    <div class="target-layer"></div><div class="reticle"><i></i><b></b></div><div class="steering-cursor"></div><div class="lead-marker"></div><div class="hit-confirm">×</div>
    <div class="torpedo-hud" data-state="idle"><svg class="torpedo-ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="torpedo-track" cx="50" cy="50" r="46"/><circle id="torpedo-progress" cx="50" cy="50" r="46" pathLength="100"/></svg><div class="torpedo-card"><span class="torpedo-label">质子鱼雷</span><strong id="torpedo-status"></strong><small id="torpedo-hint"></small><small id="torpedo-ammo"></small></div></div><div class="target-readout"><span id="target-name">暂无目标</span><strong id="target-distance">—</strong><small>Tab 选择视野中心目标</small></div>
    <div class="flight-message" role="status" aria-live="polite"></div>
    <footer class="telemetry"><div class="speed-cell"><small>航速</small><strong id="speed-value">115<em> m/s</em></strong><span>W / S 调节推力</span><span id="jump-status"></span><span id="shield-status"></span></div><div class="meters"><label>机体 <b id="hull-value">100%</b></label><div class="hud-bar"><i id="hull-bar"></i></div><label>武器热量 <b id="heat-value">0%</b></label><div class="hud-bar heat"><i id="heat-bar"></i></div><label>加速能量 <b id="boost-value">100%</b></label><div class="hud-bar boost"><i id="boost-bar"></i></div></div><div class="flight-stats"><strong id="kills-value">00 <small>/ 46</small></strong><span>敌机击毁</span><small>Q / E 滚转 · Shift 加速 · 左键开火 · R 鱼雷</small></div></footer>
    <div class="flight-overlay"><div class="brief-card"><span class="brief-eyebrow">克隆人战争 / 原创护舰任务</span><h1>余烬航道</h1><p id="brief-copy">守望号的局部护盾已经失效。带领四架 ARC-170，与守望号的自动炮塔协同作战，清除三波敌机后，击破两艘慷慨级各自的护盾；每次放出1架Y翼和2架护航机，摧毁两艘敌舰。</p><div class="brief-controls"><span><b>鼠标</b> 转向</span><span><b>左键</b> 激光炮</span><span><b>W / S</b> 油门</span><span><b>A / D</b> 左右转向</span><span><b>Q / E</b> 滚转</span><span><b>Shift</b> 加速</span><span><b>Tab</b> 选择目标</span><span><b>空格</b> 短程跃迁</span><span><b>F</b> 主动护盾</span><span><b>R</b> 锁定后发射鱼雷</span></div><div class="settings-row"><label>音量<input id="volume" type="range" min="0" max="1" step="0.05"></label><label>灵敏度<input id="sensitivity" type="range" min="0.2" max="3" step="0.1"></label><label>画质<select id="quality"><option value="medium">标准</option><option value="low">低</option></select></label></div><button id="launch-button">进入战场 <span>↗</span></button><button id="restart-button" hidden>重新开始</button><a href="./?mode=models">查看舰船模型 ↗</a><small class="prototype-note">首版飞行原型 · 桌面鼠标键盘</small></div></div>
  </section>`;
  const elements = new Map<string, HTMLElement>();
  const get = <T extends HTMLElement>(selector: string): T => {
    let element = elements.get(selector);
    if (!element) { element = app.querySelector<HTMLElement>(selector) ?? undefined; if (!element) throw new Error(`Missing ${selector}`); elements.set(selector, element); }
    return element as T;
  };
  let storage: StorageLike;
  try { storage = window.localStorage; } catch { storage = { getItem: () => null, setItem: () => { throw new Error('Storage unavailable'); } }; }
  let settings = loadSettings(storage);
  const scene = new FlightScene(get('.flight-viewport'));
  let world = new FlightWorld(scene.carrier,scene.frigate,scene.secondFrigate);
  const audio = new FlightAudio(); audio.volume = settings.volume;
  const frameStats = createFrameStats();
  const performanceText = document.createElement('small');
  performanceText.className = 'prototype-note';
  performanceText.textContent = '游玩后可查看最近帧率，必要时选择低画质。';
  get('.settings-row').after(performanceText);
  let lastSummary = 0;
  let state: 'menu' | 'playing' | 'paused' | 'result' = 'menu';
  const keys = new Set<string>(); let mouseX = 0; let mouseY = 0; let firing = false;
  let previous = performance.now(); let accumulator = 0; let frameId = 0; let disposed = false;
  const abort = new AbortController(); const options = { signal: abort.signal };
  const tactical = new TacticalHUD(get('.target-layer'), get('.target-readout'), get('.lead-marker'), get('.reticle'));
  get('#wing-status').innerHTML = Array.from({length:MVP_CONFIG.friendlies},(_,i)=>i+1).map(i => `<div><i></i><span>苍鹭 ${i}</span><b></b></div>`).join('') + '<small></small>';
  const wingRows = [...get('#wing-status').querySelectorAll('div')].map(row => ({ light: row.querySelector('i')!, value: row.querySelector('b')! }));
  const wingOrder = get('#wing-status').querySelector('small')!;
  let previousKills = -1;

  function resize() { scene.resize(innerWidth, innerHeight, settings.quality === 'low'); }
  function overlay(next: typeof state) {
    state = next; keys.clear(); firing = false; mouseX = mouseY = 0; accumulator = 0; previous = performance.now();
    if (next === 'playing') frameStats.reset();
    document.documentElement.dataset.flightState = next;
    get('.flight-overlay').hidden = next === 'playing';
    get('#restart-button').hidden = next !== 'paused' && next !== 'result';
    get('#pause-button').hidden = next === 'menu' || next === 'result';
    get('#launch-button').hidden = next === 'result';
    if (next === 'paused') { get('h1').textContent = '任务暂停'; get('#brief-copy').textContent = '战场已暂停。调整设置后继续；窗口失去焦点时也会自动暂停。'; get('#launch-button').textContent = '继续飞行 ↗'; }
    if (next === 'result') {
      get('h1').textContent = world.mission.phase === 'won' ? '敌舰已摧毁' : '任务失败';
      get('#brief-copy').textContent = world.mission.phase === 'won' ? `两艘慷慨级均已失去作战能力，守望号保留 ${Math.ceil(world.carrierHealth / MVP_CONFIG.carrierHealth*100)}% 完整度。` : world.mission.lossReason === 'carrier-destroyed' ? '守望号失去作战能力。下一次优先拦截攻击母舰的战机。' : '座机已被摧毁。注意舰体距离与追尾敌机。';
    }
  }
  function restart() {
    scene.reset(); world = new FlightWorld(scene.carrier,scene.frigate,scene.secondFrigate);
    tactical.reset();
    audio.start(); overlay('playing'); scene.render(world, 0); updateHUD();
  }
  function updateHUD() {
    const put = (selector: string, value: string) => { const element = get(selector); if (element.textContent !== value) element.textContent = value; };
    const bar = (selector: string, value: number) => { get(selector).style.width = `${Math.max(0, Math.min(100, value))}%`; };
    put('#jump-status',world.jumpCooldown>0?`跃迁冷却 ${Math.ceil(world.jumpCooldown)}s`:'空格 · 短程跃迁 2500m');
    get('.jump-effect').style.opacity=String(world.jumpFlash*.55);
    put('#speed-value', `${Math.round(world.player.speed * (world.boosting ? 1.6 : 1))} m/s`);
    const hull = Math.ceil(world.player.health); const carrier = Math.ceil(world.carrierHealth / MVP_CONFIG.carrierHealth*100);
    put('#hull-value', `${hull}%`); bar('#hull-bar', hull);
    put('#carrier-value', `${carrier}%`); bar('#carrier-bar', carrier);
    put('#shield-status', world.playerShieldActive ? '护盾开启 '+world.shieldTime.toFixed(1)+'秒' : world.shieldCooldown>0 ? '护盾冷却 '+Math.ceil(world.shieldCooldown)+'秒' : 'F · 护盾就绪');
    get('#shield-status').dataset.active = String(world.playerShieldActive);
    const tc = TORPEDO_CONFIG, target = world.target;
    let ts = 'idle', title = '未锁定', hint = 'Tab 选择敌机 · 持续瞄准2秒', progress = 0;
    if (world.terminal) { title = '武器停用'; hint = '本次任务已结束'; }
    else if (world.torpedoCooldown > 0) {
      ts = 'cooldown'; title = '冷却 ' + Math.ceil(world.torpedoCooldown) + ' 秒'; hint = '暂不可发射 · 冷却后重新锁定';
      progress = (1 - world.torpedoCooldown / tc.cooldown) * 100;
    } else if (world.torpedoLock >= tc.lockTime && world.torpedoTarget === target?.id && world.bolts.length < 192) {
      ts = 'ready'; title = 'R  发射鱼雷'; hint = '锁定完成 · 可发射'; progress = 100;
    } else if (world.torpedoLock > 0 && world.torpedoTarget === target?.id) {
      ts = 'locking'; progress = world.torpedoLock / tc.lockTime * 100;
      title = '锁定中 ' + Math.floor(progress) + '%'; hint = '保持瞄准 · 尚不可发射';
      if (world.bolts.length >= 192) { title = '武器通道忙'; hint = '暂不可发射 · 请稍候'; }
    } else if (target) {
      const delta = target.position.clone().sub(world.player.position);
      hint = delta.length() > tc.range ? '距离过远 · 接近至1200米内' : world.forward(world.player).dot(delta.normalize()) < Math.cos(tc.cone) ? '将目标转入机头前方' : '目标被舰体遮挡 · 调整位置';
    }
    get('.torpedo-hud').dataset.state = ts;
    put('#torpedo-status', title); put('#torpedo-hint', hint);
    put('#torpedo-ammo', world.torpedoCooldowns.map((t,i)=>(i+1)+'号 '+(t>0?Math.ceil(t)+'秒':'就绪')).join('　 · 　'));
    get('#torpedo-progress').style.strokeDashoffset = String(100 - progress);
    put('#heat-value', world.player.weapon.overheated ? '过热' : `${Math.round(world.player.weapon.heat)}%`); bar('#heat-bar', world.player.weapon.heat);
    put('#boost-value', `${Math.round(world.boostEnergy)}%`); bar('#boost-bar', world.boostEnergy);
    get('.heat').classList.toggle('overheated', world.player.weapon.overheated);
    put('#phase-label', world.stage!=='defense'?world.objectiveText:world.mission.phase === 'intermission' ? `下一波 ${Math.max(0, Math.ceil(MISSION_CONFIG.intermissionSeconds - world.mission.phaseSeconds))} 秒` : world.mission.phase === 'briefing' ? '编队集结' : `迎击敌机 · ${world.enemies.length} 架`);
    put('#wave-label', world.stage!=='defense'?world.capitalShips.map((s,i)=>s.destroyed?('敌舰'+(i+1)+' 已毁'):('敌舰'+(i+1)+' 盾'+Math.ceil(s.generator.health/360*100)+'% / 舰桥'+Math.ceil(s.bridge.health/1800*100)+'%')).join(' · '):'WAVE '+Math.max(1, world.mission.waveIndex + 1)+' / '+MISSION_CONFIG.waves.length);
    if (world.mission.kills !== previousKills) { get('#kills-value').innerHTML = `${String(world.mission.kills).padStart(2, '0')} <small>/ ${world.stage==='defense'?MISSION_CONFIG.waves.reduce((sum,n)=>sum+n,0):'∞'}</small>`; previousKills = world.mission.kills; }
    put('.flight-message', world.message);
    put('#bomber-status', world.stage==='launch'||world.stage==='assault' ? '轰炸编队 / 金色中队\n'+[1,2].map(i=>{const f=world.fighters.find(f=>f.id==='gold-'+i);return '金色 '+i+'　'+(f?Math.ceil(f.health/f.maxHealth*100)+'%':world.capitalShips[i-1]!.launched===0?'待出击':'失联')}).join('\n') : '');
    get('.damage-overlay').style.opacity = String(world.hitFlash * 0.6);
    get('.hit-confirm').style.opacity = String(world.hitConfirm);
    get('.steering-cursor').style.transform = `translate(${mouseX * 100}px, ${-mouseY * 80}px)`;
    const friends = Array.from({length:MVP_CONFIG.friendlies},(_,i)=>world.fighters.find(f => f.id === `wing-${i+1}`));
    friends.forEach((f, i) => {
      wingRows[i]!.light.classList.toggle('lost', !f);
      const value = f ? `${Math.ceil(f.health / f.maxHealth * 100)}%` : '失联';
      if (wingRows[i]!.value.textContent !== value) wingRows[i]!.value.textContent = value;
    });
    const order = world.wingOrder === 'focus' ? '执行：集火目标' : world.wingOrder === 'follow' ? '执行：归队掩护' : '执行：自动护航';
    if (wingOrder.textContent !== order) wingOrder.textContent = order;
    tactical.update(world, scene);
  }

  const volume = get<HTMLInputElement>('#volume'); volume.value = String(settings.volume);
  const sensitivity = get<HTMLInputElement>('#sensitivity'); sensitivity.value = String(settings.sensitivity);
  const quality = get<HTMLSelectElement>('#quality'); quality.value = settings.quality;
  function persist() {
    settings = { version: 1, volume: Number(volume.value), sensitivity: Number(sensitivity.value), quality: quality.value === 'low' ? 'low' : 'medium' };
    saveSettings(storage, settings); audio.volume = settings.volume; resize();
  }
  [volume, sensitivity, quality].forEach(element => element.addEventListener('change', persist, options));
  get('#launch-button').addEventListener('click', () => { if (state === 'menu') restart(); else { audio.start(); overlay('playing'); } }, options);
  get('#restart-button').addEventListener('click', restart, options);
  get('#pause-button').addEventListener('click', () => overlay(state === 'playing' ? 'paused' : 'playing'), options);
  window.addEventListener('resize', resize, options);
  window.addEventListener('blur', () => { if (state === 'playing') overlay('paused'); }, options);
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') overlay('paused'); }, options);
  window.addEventListener('keydown', event => {
    if (event.code === 'Escape' && (state === 'playing' || state === 'paused')) { event.preventDefault(); overlay(state === 'playing' ? 'paused' : 'playing'); return; }
    if (state !== 'playing') return;
    if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(event.code)) event.preventDefault();
    if (!event.repeat) {
      if (event.code === 'Tab') world.selectNext(scene.camera);
      if (event.code === 'Digit1') { world.command('focus'); audio.cue('command'); }
      if (event.code === 'Digit2') { world.command('follow'); audio.cue('command'); }
    }
    keys.add(event.code);
  }, options);
  window.addEventListener('keyup', event => keys.delete(event.code), options);
  scene.renderer.domElement.addEventListener('pointermove', event => {
    if (state !== 'playing') return;
    const rawX = (event.clientX / innerWidth - 0.5) * 2; const rawY = (0.5 - event.clientY / innerHeight) * 2;
    const deadzone = (value: number) => Math.sign(value) * Math.max(0, Math.abs(value) - 0.065) / 0.935;
    mouseX = Math.max(-1, Math.min(1, deadzone(rawX) * settings.sensitivity)); mouseY = Math.max(-1, Math.min(1, deadzone(rawY) * settings.sensitivity));
  }, options);
  scene.renderer.domElement.addEventListener('pointerdown', event => { if (event.button === 0 && state === 'playing') firing = true; }, options);
  window.addEventListener('pointerup', () => { firing = false; }, options);
  const releasePointer = () => { firing = false; mouseX = mouseY = 0; };
  scene.renderer.domElement.addEventListener('pointerleave', releasePointer, options);
  scene.renderer.domElement.addEventListener('pointercancel', releasePointer, options);
  scene.renderer.domElement.addEventListener('contextmenu', event => event.preventDefault(), options);
  const input = (): FlightInput => ({ yaw: keys.has('KeyA') || keys.has('KeyD') ? Number(keys.has('KeyD')) - Number(keys.has('KeyA')) : mouseX, pitch: mouseY, roll: Number(keys.has('KeyQ')) - Number(keys.has('KeyE')), throttle: Number(keys.has('KeyW')) - Number(keys.has('KeyS')), boost: keys.has('ShiftLeft') || keys.has('ShiftRight'), fire: firing, jump: keys.has('Space'), shield: keys.has('KeyF'), torpedo: keys.has('KeyR') });
  function step(value: FlightInput) {
    world.step(1 / 60, value); scene.consume(world.events);
    for (const event of world.events) if (event.type === 'shot' || event.type === 'explosion' || event.type === 'player-hit' || event.type==='carrier-shot') audio.cue(event.type === 'player-hit' ? 'impact' : event.type);
    if (world.terminal && state === 'playing') overlay('result');
  }
  function frame(now: number) {
    if (disposed) return;
    const elapsedMs = Math.max(0, now - previous);
    const dt = Math.min(0.1, elapsedMs / 1000); previous = now;
    if (state === 'playing') {
      frameStats.push(elapsedMs);
      accumulator += dt; let count = 0;
      while (accumulator >= 1 / 60 && count++ < 5 && state === 'playing') { step(input()); accumulator -= 1 / 60; }
      if (count >= 5) accumulator = 0;
    }
    if (now - lastSummary > 1000) {
      const summary = frameStats.summary();
      if (summary.count) performanceText.textContent = `最近帧率 ${Math.round(summary.fps)} fps · P95 ${summary.p95Ms.toFixed(1)} ms`;
      lastSummary = now;
    }
    scene.render(world, state === 'playing' ? dt : 0, state === 'playing' ? Math.max(0, accumulator * 60) : 1);
    updateHUD(); frameId = requestAnimationFrame(frame);
  }
  resize(); overlay('menu'); scene.render(world, 0); updateHUD(); frameId = requestAnimationFrame(frame);
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('qa')) {
    Object.defineProperty(window, '__flightQA', { configurable: true, value: {
      get world() { return world; },
      advance(count: number, override: Partial<FlightInput> = {}) { for (let i = 0; i < Math.min(count, 30000); i++) step({ ...NEUTRAL_INPUT, ...override }); scene.render(world, 0); updateHUD(); },
      pause() { overlay('paused'); }, restart,
      snapshot() { return { stage:world.stage, generator:world.generator.health, bridge:world.bridge.health, hangar:world.hangarOpen, bombers:world.bombers.length, phase: world.mission.phase, kills: world.mission.kills, active: world.enemies.length, state, player: world.player.position.toArray(), health: world.player.health, carrier: world.carrierHealth, heat: world.player.weapon.heat }; },
      performance() { return frameStats.summary(); },
      diagnostics() { return scene.diagnostics(); },
      input,
      refresh() { tactical.reset(); scene.reset(); scene.render(world, 0); updateHUD(); },
    } });
  }
  const cleanup = () => {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(frameId); abort.abort(); tactical.dispose(); scene.dispose(); audio.dispose();
    Reflect.deleteProperty(window, '__flightQA');
  };
  window.addEventListener('pagehide', event => { if (!event.persisted) cleanup(); else if (state === 'playing') overlay('paused'); }, options);
  if (import.meta.hot) import.meta.hot.dispose(cleanup);
}
