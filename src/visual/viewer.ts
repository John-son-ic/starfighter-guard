import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MODEL_CATALOG } from './models/index.ts';
import { disposeModel } from './models/primitives.ts';
import type { ModelId } from '../shared/types.ts';

const ids: ModelId[] = ['venator', 'eta2', 'arc170', 'vulture', 'munificent', 'ywing', 'relay'];
const silhouettes: Record<ModelId, string> = {
  relay:'<circle cx="60" cy="45" r="25"/><path d="M7 35h30v20H7zm76 0h30v20H83zM52 5h16v25H52zm0 56h16v25H52z"/>',
  munificent:'<path d="M40 5h40l12 30-9 48H37L28 35Z"/><path class="accent" d="M56 5h8v80h-8Z"/>',
  ywing:'<path d="M52 5h16v45h30v35H85V60H35v25H22V50h30Z"/>',
  venator: '<path d="M60 4 98 75 87 85 33 85 22 75Z"/><path class="accent" d="M58 13h4v53h-4z"/><path d="M48 69h8v18h-8zm16 0h8v18h-8z"/>',
  eta2: '<path d="m45 13-18 52 7 16 16-5 3-24h14l3 24 16 5 7-16-18-52-8 35H53Z"/><circle class="accent" cx="60" cy="60" r="9"/>',
  arc170: '<path d="m56 8-5 45-42 9v9l42-4 3 19h12l3-19 42 4v-9l-42-9-5-45Z"/><path class="accent" d="M32 37h8v46h-8zm48 0h8v46h-8z"/>',
  vulture: '<path d="m25 10-9 63 16 14 15-12-7-23-4-42Zm70 0 9 63-16 14-15-12 7-23 4-42Z"/><ellipse class="accent" cx="60" cy="61" rx="20" ry="10"/>',
};

function required<T extends Element>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`Missing viewer element: ${selector}`);
  return element;
}

export function startModelViewer(app: HTMLElement) {
  app.innerHTML = `
    <div class="archive">
      <aside class="sidebar">
        <a class="brand" href="./"><span class="republic-mark">✦</span><span>STARFIGHTER<span class="brand-sub">GUARD / 舰船档案</span></span></a>
        <div class="archive-code">REPUBLIC NAVAL ARCHIVE<span>19 BBY</span></div>
        <div class="section-label">舰船目录 <span>${String(ids.length).padStart(2,'0')}</span></div>
        <nav aria-label="选择模型">${ids.map((id, i) => `<button class="ship-card" data-model="${id}" aria-pressed="false"><span class="ship-index">0${i + 1}</span><svg viewBox="0 0 120 95" aria-hidden="true">${silhouettes[id]}</svg><span class="ship-name">${MODEL_CATALOG[id].name}<small>${id === 'arc170' ? 'ARC-170 STARFIGHTER' : MODEL_CATALOG[id].english}</small></span><span class="ship-arrow">↗</span></button>`).join('')}</nav>
        <div class="sidebar-bottom"><span class="signal-dot"></span> C01 · 模型预览<span>本地程序化资产 / v0.1</span></div>
      </aside>
      <section class="workspace" aria-label="三维模型预览">
        <div class="viewport"></div><div class="stage-grid"></div>
        <header class="workspace-header"><span><i></i> ASSET VIEWER</span><span class="header-meta">克隆人战争 · 共和国时期</span><a class="repo-link" href="./models/manifest.json" target="_blank" rel="noopener">资产清单 ↗</a></header>
        <div class="ship-heading"><div class="eyebrow">CAPITAL SHIP / 01</div><h1>狩猎者级</h1><div class="ship-subtitle">VENATOR-CLASS</div><p class="ship-role">共和国主力舰 / 作战母舰</p></div>
        <div class="canvas-label">拖动旋转 · 滚轮缩放 · 右键平移</div>
        <div class="model-tag"><span class="tag-cross">+</span><span class="tag-title">VENATOR</span><small>FLIGHT CONFIGURATION</small></div>
        <div class="view-tools" role="group" aria-label="视角与显示"><button data-view="perspective" class="selected">透视</button><button data-view="top">俯视</button><button data-view="front">正面</button><button data-view="rear">尾部</button><button data-view="bridge" data-detail-view>舰桥近景</button><button data-view="engines" data-detail-view>引擎近景</button><button data-view="bottom" data-detail-view>腹面</button><span class="tool-divider"></span><button id="rotate" aria-pressed="false">自动旋转</button><button id="wireframe" aria-pressed="false">线框</button></div>
        <footer class="data-panel"><div class="dimension"><span>舰体长度</span><strong id="length">1,155<small> m</small></strong><small>模型按参考尺度构建</small></div><div class="feature-block"><span>轮廓特征</span><div class="feature-tags"></div></div><div class="asset-actions"><button id="scale-view">同尺度编队 <span>↗</span></button><button id="export">导出 GLB <span>↓</span></button><small id="geometry-stats">正在加载模型</small></div></footer>
        <div class="viewer-footnote"><span>PROCEDURAL MODEL / 程序化舰船模型</span><span id="render-status" role="status" aria-live="polite">正在初始化</span></div>
      </section>
    </div>`;
  const viewport = required<HTMLDivElement>(app, '.viewport');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label', '可拖动旋转的三维舰船模型');
  viewport.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 15000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.autoRotateSpeed = 0.6;
  scene.add(new THREE.HemisphereLight(0xc9deed, 0x263744, 1.35));
  const key = new THREE.DirectionalLight(0xfff0d6, 3.0);
  key.position.set(-3, 6, -5); scene.add(key);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.normalBias = 0.18;
  const fill = new THREE.DirectionalLight(0x588bb4, 1.6);
  fill.position.set(4, 0, 4); scene.add(fill);
  const underside = new THREE.DirectionalLight(0xb3c9dd, 1.5);
  underside.position.set(-1, -4, 1); scene.add(underside);
  let selected: ModelId = 'venator';
  let current: THREE.Group | null = null;
  let scaleMode = false;
  let wireframe = false;
  let radius = 1;
  let focused = new THREE.Vector3();
  let destroyed = false;
  let animationFrame = 0;
  let previousTime = performance.now();

  function fit(view = 'perspective') {
    const detail = selected === 'venator' && !scaleMode;
    const focus = detail && view === 'bridge' ? new THREE.Vector3(0, 30, 285) : detail && view === 'engines' ? new THREE.Vector3(0, -50, 525) : focused;
    const viewRadius = detail && view === 'bridge' ? 150 : detail && view === 'engines' ? 245 : radius;
    const distance = viewRadius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(1, 1 / camera.aspect) * (detail && view === 'perspective' ? 0.88 : 1.17);
    const direction = view === 'top' ? new THREE.Vector3(0, 1, 0.001) : view === 'front' ? new THREE.Vector3(0, 0.08, -1) : view === 'rear' ? new THREE.Vector3(0, 0.12, 1) : view === 'engines' ? new THREE.Vector3(0.25, 0.22, 1).normalize() : view === 'bottom' ? new THREE.Vector3(0.6, -1, -0.7).normalize() : detail ? new THREE.Vector3(-1.0, 0.7, -1.15).normalize() : new THREE.Vector3(1.0, 0.85, -1.15).normalize();
    camera.position.copy(focus).addScaledVector(direction, distance);
    camera.near = Math.max(0.01, radius / 1000); camera.far = Math.max(500, radius * 50); camera.updateProjectionMatrix();
    controls.target.copy(focus); controls.minDistance = radius * 0.08; controls.maxDistance = radius * 12; controls.update();
    app.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.classList.toggle('selected', button.dataset.view === view));
  }
  function setWireframe(value: boolean) {
    wireframe = value;
    current?.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) if (material instanceof THREE.MeshStandardMaterial) material.wireframe = value;
    });
    required(app, '#wireframe').setAttribute('aria-pressed', String(value));
  }
  function choose(id: ModelId, formation = false) {
    if (current) { scene.remove(current); disposeModel(current); }
    selected = id; scaleMode = formation;
    app.querySelectorAll<HTMLButtonElement>('[data-detail-view]').forEach(button => { button.hidden = id !== 'venator' || formation; });
    required(app, '.workspace').classList.remove('close-view');
    const entry = MODEL_CATALOG[id];
    current = formation ? new THREE.Group() : entry.factory();
    if (formation) {
      current.name = 'true-scale-formation'; current.add(MODEL_CATALOG.venator.factory());
      for (const [index, aircraft] of (['eta2', 'arc170', 'arc170'] as const).entries()) {
        const model = MODEL_CATALOG[aircraft].factory();
        model.position.set(-52 + index * 19, 79 + index * 3, -210 + index * 17); current.add(model);
      }
    }
    scene.add(current);
    const bounds = new THREE.Box3().setFromObject(current);
    focused = bounds.getCenter(new THREE.Vector3()); radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
    key.position.copy(focused).addScaledVector(new THREE.Vector3(-1, 2, -1.4).normalize(), radius * 4);
    key.target.position.copy(focused); scene.add(key.target);
    Object.assign(key.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: radius, far: radius * 7 });
    key.shadow.camera.updateProjectionMatrix();
    fit(); setWireframe(wireframe);
    let triangles = 0; let meshes = 0;
    current.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true; object.receiveShadow = true;
      meshes++; triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
    });
    required(app, 'h1').textContent = formation ? '同尺度编队' : entry.name;
    required(app, '.ship-subtitle').textContent = formation ? 'VENATOR / ETA-2 / 2 × ARC-170' : entry.english;
    required(app, '.ship-role').textContent = formation ? '真实参考尺度 · 约 211 架 Eta-2 的舰长' : entry.role;
    required(app, '.eyebrow').textContent = formation ? 'TRUE SCALE / 1 : 1' : `${id === 'venator' ? 'CAPITAL SHIP' : 'STARFIGHTER'} / 0${ids.indexOf(id) + 1}`;
    required(app, '#length').innerHTML = `${(formation ? 1155 : entry.length).toLocaleString('en-US')}<small> m</small>`;
    required(app, '.feature-tags').innerHTML = (formation ? ['母舰 × 1', 'Eta-2 × 1', 'ARC-170 × 2', '原始比例'] : entry.features).map(text => `<span>${text}</span>`).join('');
    required(app, '.tag-title').textContent = formation ? 'TRUE SCALE' : id.toUpperCase();
    required(app, '#geometry-stats').textContent = `${triangles.toLocaleString('en-US')} 面 · ${meshes} 材质批次`;
    required(app, '#scale-view').innerHTML = formation ? '观察编队近景 <span>↗</span>' : '同尺度编队 <span>↗</span>';
    required(app, '#render-status').textContent = '可交互预览 · 非游戏场景';
    app.querySelectorAll<HTMLButtonElement>('[data-model]').forEach(button => button.setAttribute('aria-pressed', String(!formation && button.dataset.model === id)));
    document.title = `${formation ? '同尺度编队' : entry.name} · Starfighter Guard`;
    document.documentElement.dataset.model = formation ? 'formation' : id;
  }
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  app.querySelectorAll<HTMLButtonElement>('[data-model]').forEach(button => button.addEventListener('click', () => choose(button.dataset.model as ModelId), options));
  app.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => fit(button.dataset.view), options));
  required(app, '#rotate').addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate;
    required(app, '#rotate').setAttribute('aria-pressed', String(controls.autoRotate));
  }, options);
  required(app, '#wireframe').addEventListener('click', () => setWireframe(!wireframe), options);
  required(app, '#scale-view').addEventListener('click', () => {
    if (!scaleMode) choose('venator', true);
    else { focused.set(-33, 82, -193); radius = 34; fit(); required(app, '.workspace').classList.add('close-view'); required(app, '#render-status').textContent = '编队近景 · 母舰与战机均未放大'; }
  }, options);
  required(app, '#export').addEventListener('click', () => {
    const object = current;
    if (!object) return;
    const name = scaleMode ? 'true-scale-formation' : selected;
    const button = required<HTMLButtonElement>(app, '#export'); button.disabled = true;
    void new GLTFExporter().parseAsync(object, { binary: true }).then(result => {
      if (!(result instanceof ArrayBuffer)) throw new Error('Expected binary GLB');
      const url = URL.createObjectURL(new Blob([result], { type: 'model/gltf-binary' }));
      const link = document.createElement('a'); link.href = url; link.download = `${name}.glb`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      required(app, '#render-status').textContent = `${name}.glb 已导出`;
    }).catch(error => { required(app, '#render-status').textContent = `导出失败：${String(error)}`; }).finally(() => { button.disabled = false; });
  }, options);
  function resize() {
    const width = Math.max(1, viewport.clientWidth); const height = Math.max(1, viewport.clientHeight);
    renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize); observer.observe(viewport); resize();
  const requested = new URLSearchParams(location.search).get('model');
  choose(ids.includes(requested as ModelId) ? requested as ModelId : 'venator', requested === 'formation');
  const view = new URLSearchParams(location.search).get('view');
  if (view && ['top', 'front', 'rear', 'bridge', 'engines', 'bottom'].includes(view)) fit(view);
  if (new URLSearchParams(location.search).has('close') && scaleMode) { focused.set(-33, 82, -193); radius = 34; fit(); required(app, '.workspace').classList.add('close-view'); }
  function frame(time: number) {
    if (destroyed) return;
    const dt = Math.min((time - previousTime) / 1000, 0.1); previousTime = time;
    controls.update(dt); renderer.render(scene, camera); renderer.domElement.dataset.ready = 'true';
    animationFrame = requestAnimationFrame(frame);
  }
  animationFrame = requestAnimationFrame(frame);
  const cleanup = () => {
    if (destroyed) return;
    destroyed = true; cancelAnimationFrame(animationFrame); observer.disconnect(); listeners.abort(); controls.dispose();
    if (current) disposeModel(current);
    renderer.dispose();
  };
  window.addEventListener('pagehide', event => { if (!event.persisted) cleanup(); }, { once: true });
  if (import.meta.hot) import.meta.hot.dispose(cleanup);
}
