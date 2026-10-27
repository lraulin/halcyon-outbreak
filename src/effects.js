import * as THREE from 'three';

// Particles, tracers, flashes, decals and camera shake.
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.shakeAmt = 0;
    this.systems = {
      glow: this.makeSystem(1500, true, 0.09),
      solid: this.makeSystem(2500, false, 0.07),
    };
    this.tracers = [];
    this.flashes = [];
    this.tracerGeo = new THREE.BoxGeometry(0.025, 0.025, 1);
    this.tracerGeo.translate(0, 0, -0.5);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    this.decalGeo = new THREE.CircleGeometry(1, 12);
    this.decalGeo.rotateX(-Math.PI / 2);
    this.decals = [];
    this.flashLight = new THREE.PointLight(0xffc070, 0, 12, 1.6);
    scene.add(this.flashLight);
    this.flashLightT = 0;
    this.boomLight = new THREE.PointLight(0xff8030, 0, 25, 1.5);
    scene.add(this.boomLight);
    this.boomT = 0;
    this.flashGeo = new THREE.SphereGeometry(1, 8, 6);
  }

  makeSystem(max, additive, size) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(max * 3).fill(-999);
    const col = new Float32Array(max * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: additive ? 1 : 0.95,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
    return { max, pos, col, geo, pts, vel: new Float32Array(max * 3), life: new Float32Array(max), drag: new Float32Array(max), grav: new Float32Array(max), next: 0 };
  }

  emit(sysName, p, n, { color = [1, 1, 1], speed = 2, dir = null, spread = 1, life = 0.6, gravity = 9, drag = 1, jitter = 0.15 } = {}) {
    const s = this.systems[sysName];
    for (let i = 0; i < n; i++) {
      const k = s.next;
      s.next = (s.next + 1) % s.max;
      s.pos[k * 3] = p.x; s.pos[k * 3 + 1] = p.y; s.pos[k * 3 + 2] = p.z;
      let vx = (Math.random() * 2 - 1), vy = (Math.random() * 2 - 1), vz = (Math.random() * 2 - 1);
      if (dir) { vx = dir.x + vx * spread; vy = dir.y + vy * spread; vz = dir.z + vz * spread; }
      const sp = speed * (0.4 + Math.random() * 0.8);
      const l = Math.hypot(vx, vy, vz) || 1;
      s.vel[k * 3] = (vx / l) * sp; s.vel[k * 3 + 1] = (vy / l) * sp; s.vel[k * 3 + 2] = (vz / l) * sp;
      const j = 1 - jitter + Math.random() * jitter * 2;
      s.col[k * 3] = color[0] * j; s.col[k * 3 + 1] = color[1] * j; s.col[k * 3 + 2] = color[2] * j;
      s.life[k] = life * (0.5 + Math.random() * 0.8);
      s.grav[k] = gravity;
      s.drag[k] = drag;
    }
  }

  blood(p, dir, amount = 1) {
    this.emit('solid', p, Math.floor(26 * amount), { color: [0.45, 0.02, 0.02], speed: 3.5, dir, spread: 0.7, life: 0.8, gravity: 10 });
    this.emit('solid', p, Math.floor(10 * amount), { color: [0.25, 0.0, 0.0], speed: 1.2, life: 1.0, gravity: 6 });
    this.decal({ x: p.x + (dir?.x || 0) * 0.5, z: p.z + (dir?.z || 0) * 0.5 }, 0.25 + Math.random() * 0.35 * amount, 0x3a0505);
  }

  acid(p, amount = 1) {
    this.emit('glow', p, Math.floor(30 * amount), { color: [0.4, 0.9, 0.1], speed: 3, life: 0.9, gravity: 8 });
    this.emit('solid', p, Math.floor(20 * amount), { color: [0.3, 0.6, 0.05], speed: 1.5, life: 1.2, gravity: 2, drag: 2 });
    this.decal(p, 0.6 * amount, 0x3d6b0c, 0.75);
  }

  sparks(p, normal) {
    this.emit('glow', p, 12, { color: [1, 0.75, 0.35], speed: 6, dir: normal, spread: 0.9, life: 0.35, gravity: 14 });
    this.emit('solid', p, 8, { color: [0.45, 0.43, 0.4], speed: 1.5, dir: normal, spread: 1, life: 0.7, gravity: 1, drag: 3 });
  }

  dust(p, normal) {
    this.emit('solid', p, 14, { color: [0.4, 0.36, 0.3], speed: 2, dir: normal, spread: 1, life: 0.8, gravity: 3, drag: 3 });
  }

  splinters(p, normal) {
    this.emit('solid', p, 14, { color: [0.45, 0.32, 0.18], speed: 4, dir: normal, spread: 1, life: 0.7, gravity: 10 });
  }

  explosion(p, radius) {
    this.emit('glow', p, 120, { color: [1, 0.55, 0.15], speed: 9 * radius / 2.5, life: 0.6, gravity: 2, drag: 3 });
    this.emit('glow', p, 50, { color: [1, 0.9, 0.5], speed: 4, life: 0.35, gravity: 0, drag: 4 });
    this.emit('solid', p, 80, { color: [0.12, 0.11, 0.1], speed: 3, life: 2.2, gravity: -1.2, drag: 1.5, jitter: 0.3 });
    this.emit('solid', p, 40, { color: [0.3, 0.25, 0.2], speed: 10, life: 1.2, gravity: 12 });
    this.decal(p, radius * 0.6, 0x0b0a09, 0.9);
    const m = new THREE.Mesh(this.flashGeo, new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(p.x, p.y, p.z);
    this.scene.add(m);
    this.flashes.push({ mesh: m, t: 0, dur: 0.45, r0: 0.3, r1: radius });
    this.boomLight.position.set(p.x, p.y + 1, p.z);
    this.boomLight.intensity = 180;
    this.boomT = 0.6;
    this.shake(0.5);
  }

  muzzle(p, dir) {
    this.flashLight.position.set(p.x, p.y, p.z);
    this.flashLight.intensity = 40;
    this.flashLightT = 0.07;
    this.emit('glow', p, 8, { color: [1, 0.8, 0.4], speed: 3, dir, spread: 0.35, life: 0.08, gravity: 0 });
    this.emit('solid', p, 4, { color: [0.35, 0.35, 0.35], speed: 0.6, dir, spread: 0.5, life: 0.6, gravity: -0.5, drag: 2 });
    const m = new THREE.Mesh(this.flashGeo, new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(p.x, p.y, p.z);
    this.scene.add(m);
    this.flashes.push({ mesh: m, t: 0, dur: 0.06, r0: 0.12, r1: 0.05 });
  }

  decal(p, r, color, opacity = 0.85) {
    const m = new THREE.Mesh(this.decalGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.set(p.x, 0.012 + this.decals.length * 0.00005, p.z);
    m.scale.set(r * (0.8 + Math.random() * 0.4), 1, r);
    m.rotation.y = Math.random() * Math.PI;
    m.renderOrder = 1;
    this.scene.add(m);
    this.decals.push(m);
    if (this.decals.length > 220) {
      const old = this.decals.shift();
      this.scene.remove(old);
      old.material.dispose();
    }
  }

  // Tracer that travels from a to b; resolves when it arrives.
  tracer(a, b, { speed = 160, color = 0xffe2a0, len = 2.2, width = 1 } = {}) {
    return new Promise((res) => {
      const mat = color === 0xffe2a0 ? this.tracerMat : new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(this.tracerGeo, mat);
      mesh.scale.set(width, width, 0.01);
      const from = new THREE.Vector3(a.x, a.y, a.z);
      const to = new THREE.Vector3(b.x, b.y, b.z);
      const dist = from.distanceTo(to);
      mesh.position.copy(from);
      mesh.lookAt(to); // +z faces travel direction; geometry extends along -z so the tail trails behind
      this.scene.add(mesh);
      this.tracers.push({ mesh, from, to, dist, d: 0, speed, len, res });
    });
  }

  shake(a) {
    this.shakeAmt = Math.min(1, this.shakeAmt + a);
  }

  update(dt) {
    for (const s of Object.values(this.systems)) {
      for (let k = 0; k < s.max; k++) {
        if (s.life[k] <= 0) continue;
        s.life[k] -= dt;
        if (s.life[k] <= 0) { s.pos[k * 3 + 1] = -999; continue; }
        const dk = Math.exp(-s.drag[k] * dt);
        s.vel[k * 3] *= dk; s.vel[k * 3 + 2] *= dk;
        s.vel[k * 3 + 1] = s.vel[k * 3 + 1] * dk - s.grav[k] * dt;
        s.pos[k * 3] += s.vel[k * 3] * dt;
        s.pos[k * 3 + 1] += s.vel[k * 3 + 1] * dt;
        s.pos[k * 3 + 2] += s.vel[k * 3 + 2] * dt;
        if (s.pos[k * 3 + 1] < 0.02 && s.grav[k] > 0) {
          s.pos[k * 3 + 1] = 0.02;
          s.vel[k * 3] *= 0.3; s.vel[k * 3 + 2] *= 0.3; s.vel[k * 3 + 1] = 0;
        }
      }
      s.geo.attributes.position.needsUpdate = true;
      s.geo.attributes.color.needsUpdate = true;
    }

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.d += t.speed * dt;
      const head = Math.min(t.d, t.dist);
      const tail = Math.max(0, head - t.len);
      const p = t.from.clone().lerp(t.to, head / Math.max(t.dist, 1e-4));
      t.mesh.position.copy(p);
      t.mesh.scale.z = Math.max(0.01, head - tail);
      if (t.d >= t.dist) {
        this.scene.remove(t.mesh);
        this.tracers.splice(i, 1);
        t.res();
      }
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const r = f.r0 + (f.r1 - f.r0) * Math.sqrt(k);
      f.mesh.scale.setScalar(r);
      f.mesh.material.opacity = 1 - k;
      if (k >= 1) {
        this.scene.remove(f.mesh);
        f.mesh.material.dispose();
        this.flashes.splice(i, 1);
      }
    }

    if (this.flashLightT > 0) {
      this.flashLightT -= dt;
      if (this.flashLightT <= 0) this.flashLight.intensity = 0;
    }
    if (this.boomT > 0) {
      this.boomT -= dt;
      this.boomLight.intensity = Math.max(0, this.boomT / 0.6) * 180;
    }
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.4);
  }
}
