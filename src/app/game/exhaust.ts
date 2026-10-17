import * as THREE from 'three';

/** Reusable layered engine plumes with additive fading; no particle allocation. */
export class PlayerExhaust {
  readonly root = new THREE.Group();
  private plumes: THREE.Group[] = [];
  private strength = 0;
  private geometry = new THREE.CylinderGeometry(0.01, 1, 1, 16, 8, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  private materials = [0x248aff, 0x79eaff, 0xe3fcff].map(color => new THREE.ShaderMaterial({
    uniforms: { tint: { value: new THREE.Color(color) }, intensity: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec2 vUv; uniform vec3 tint; uniform float intensity; void main(){float fade=pow(1.0-vUv.y,1.4);gl_FragColor=vec4(tint,fade*intensity);}',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  constructor() {
    for (let i = 0; i < 2; i++) {
      const plume = new THREE.Group();
      this.materials.forEach((material, j) => {
        const mesh = new THREE.Mesh(this.geometry, material);
        mesh.scale.set(0.32 - j * 0.08, 0.32 - j * 0.08, 1 - j * 0.24);
        plume.add(mesh);
      });
      this.plumes.push(plume); this.root.add(plume);
    }
    this.root.visible = false;
  }
  update(model: THREE.Group, boosting: boolean, alive: boolean, dt: number, time: number) {
    this.strength += ((boosting && alive ? 1 : 0) - this.strength) * (1 - Math.exp(-dt * 10));
    this.root.visible = alive && this.strength > 0.005;
    this.root.position.copy(model.position); this.root.quaternion.copy(model.quaternion);
    const mounts = model.userData.engineMounts as number[][];
    this.plumes.forEach((plume, i) => {
      plume.position.fromArray(mounts[i]!);
      const flicker = 1 + 0.055 * Math.sin(time * 47 + i * 2) + 0.025 * Math.sin(time * 83);
      plume.scale.set(1 + this.strength * 0.25, 1 + this.strength * 0.25, (1 + this.strength * 5) * flicker);
    });
    this.materials.forEach((material, i) => { material.uniforms.intensity!.value = this.strength * (0.5 + i * 0.2); });
  }
  reset() { this.strength = 0; this.root.visible = false; }
  dispose() { this.geometry.dispose(); this.materials.forEach(material => material.dispose()); }
  get intensity() { return this.strength; }
}
