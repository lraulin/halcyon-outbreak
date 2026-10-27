import * as THREE from 'three';
import { World } from './world.js';
import { Unit, SQUAD, PART_LABEL, PART_MULT } from './units.js';
import { Effects } from './effects.js';
import { CameraRig } from './camera.js';
import { UI } from './ui.js';
import { tween, wait, updateTweens, easeIn, easeOut, linear } from './tween.js';
import { sfx, initAudio } from './audio.js';
import { perturb, rangeFalloff } from './weapons.js';
import { key, hexDist, worldToHex } from './hex.js';
import { enemyTurn } from './ai.js';

const DEG = Math.PI / 180;
const GRENADE_RANGE = 9;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v) => Math.hypot(v.x, v.y, v.z);
const norm = (v) => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };

export class Game {
  constructor(container) {
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070a);
    this.scene.fog = new THREE.FogExp2(0x06090d, 0.018);
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 300);

    this.world = new World(this.scene);
    this.setupLights();
    this.effects = new Effects(this.scene);
    this.rig = new CameraRig(this.camera, renderer.domElement, this.world);
    this.ui = new UI(this);

    this.squad = [];
    this.enemies = [];
    this.turn = 1;
    this.phase = 'title';
    this.mode = 'idle';
    this.busy = false;
    this.over = false;
    this.selected = null;
    this.hoverCell = null;
    this.hoverUnit = null;
    this.reach = null;
    this.alarm = false;
    this.pending = [];
    this.dirty = false;
    this.stats = { kills: 0, headshots: 0, shots: 0 };
    this.mouse = new THREE.Vector2();
    this.mousePx = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.raycaster = new THREE.Raycaster();
    this.time = 0;
    this.flareT = 0;

    this.buildOverlays();
    this.spawnInitial();
    this.bindInput();
    const s0 = this.squad[0].pos();
    this.rig.focus(s0.x + 3, s0.z - 4, true);
    this.camera.position.set(s0.x, 30, s0.z + 20);
    this.camera.lookAt(s0.x, 0, s0.z);

    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.frame());
  }

  setupLights() {
    const s = this.scene;
    const w = this.world;
    s.add(new THREE.HemisphereLight(0x5a6c90, 0x0b0907, 0.32));
    s.add(new THREE.AmbientLight(0x1a2233, 0.25));
    const cx = (w.minX + w.maxX) / 2, cz = (w.minZ + w.maxZ) / 2;
    const moon = new THREE.DirectionalLight(0x9ab4e8, 0.55);
    moon.position.set(cx - 18, 40, cz - 22);
    moon.target.position.set(cx, 0, cz);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera;
    sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 1; sc.far = 120;
    moon.shadow.bias = -0.0006;
    moon.shadow.normalBias = 0.03;
    s.add(moon, moon.target);
  }

  buildOverlays() {
    const n = this.world.cellList.length;
    const hexGeo = new THREE.CylinderGeometry(0.86, 0.86, 0.02, 6);
    this.rangeMesh = new THREE.InstancedMesh(hexGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false }), n);
    this.rangeMesh.setColorAt(0, new THREE.Color());
    this.rangeMesh.count = 0;
    this.rangeMesh.frustumCulled = false;
    this.rangeMesh.renderOrder = 2;
    this.scene.add(this.rangeMesh);

    const ringGeo = new THREE.RingGeometry(0.76, 0.94, 6, 1, Math.PI / 6);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = (c, o = 0.85) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide });
    this.selRing = new THREE.Mesh(ringGeo, ringMat(0x4ec9ff));
    this.hoverRing = new THREE.Mesh(ringGeo, ringMat(0xffffff, 0.5));
    this.targetRing = new THREE.Mesh(ringGeo, ringMat(0xff4a3d));
    for (const r of [this.selRing, this.hoverRing, this.targetRing]) {
      r.position.y = 0.03;
      r.visible = false;
      r.renderOrder = 3;
      this.scene.add(r);
    }
    this.pathDots = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), 256);
    this.pathDots.setColorAt(0, new THREE.Color());
    this.pathDots.count = 0;
    this.pathDots.frustumCulled = false;
    this.scene.add(this.pathDots);
    this.coverGroup = new THREE.Group();
    this.scene.add(this.coverGroup);
    this.coverMats = {
      half: new THREE.MeshBasicMaterial({ color: 0x4ec9ff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
      full: new THREE.MeshBasicMaterial({ color: 0x4ec9ff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    };
    this.arcLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffb347 }));
    this.arcLine.visible = false;
    this.arcLine.frustumCulled = false;
    this.scene.add(this.arcLine);
    const blast = new THREE.RingGeometry(2.45, 2.6, 48);
    blast.rotateX(-Math.PI / 2);
    this.blastRing = new THREE.Mesh(blast, ringMat(0xff8a30, 0.8));
    this.blastRing.visible = false;
    this.scene.add(this.blastRing);
    this.grenadeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshStandardMaterial({ color: 0x2a3020, emissive: 0x331100 }));
    this.grenadeMesh.visible = false;
    this.scene.add(this.grenadeMesh);
    this.spitMesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0x9cff30 }));
    this.spitMesh.visible = false;
    this.scene.add(this.spitMesh);
  }

  // ---------------------------------------------------------------- setup
  addUnit(u, c) {
    u.q = c.q;
    u.r = c.r;
    u.setPos(c.x, c.z);
    this.scene.add(u.root);
    this.world.units.push(u);
  }

  spawnInitial() {
    SQUAD.forEach((d, i) => {
      const u = new Unit('soldier', { def: d });
      this.addUnit(u, this.world.squadStart[i]);
      u.yaw = u.root.rotation.y = Math.PI;
      this.squad.push(u);
    });
    for (const { kind, cell } of this.world.enemyStart) this.spawnEnemy(kind, cell, false);
  }

  spawnEnemy(kind, cell, awake) {
    const u = new Unit(kind, { awake });
    this.addUnit(u, cell);
    u.yaw = u.root.rotation.y = Math.random() * Math.PI * 2;
    u.root.visible = false;
    this.enemies.push(u);
    return u;
  }

  start() {
    initAudio();
    sfx.sting();
    this.ui.startHud();
    this.phase = 'player';
    this.world.computeVisibility(this.squad);
    this.updateEnemyVis();
    this.select(this.squad[0]);
    this.updateObjective();
    this.ui.banner('TURN 1', 'LANTERN TEAM — MOVE OUT');
    this.ui.log('Lantern Team deployed. Radio silence from the annex.', 'info');
  }

  updateObjective() {
    const carrier = this.squad.find((s) => s.hasSample && s.alive);
    const text = carrier
      ? `▸ Carry the V-7 case to the <b style="color:#ffd23a">extraction pad</b> (${carrier.name.split(' ')[0]} has it)`
      : `▸ Recover the <b style="color:#40e0ff">V-7 sample case</b> from the north-east lab`;
    this.ui.setObjective(text, this.turn);
  }

  // ---------------------------------------------------------------- frame
  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    updateTweens(dt);
    this.effects.update(dt);
    for (const u of this.world.units) u.update(dt);
    this.world.updateLights(this.time);
    for (const it of this.world.items) {
      it.mesh.rotation.y += dt * 0.7;
      it.ring.material.opacity = 0.35 + Math.sin(this.time * 3) * 0.25;
    }
    if (this.selected && this.selected.alive && this.phase === 'player') {
      const p = this.selected.pos();
      this.selRing.position.set(p.x, 0.03, p.z);
      this.selRing.visible = this.mode !== 'aim';
      this.selRing.material.opacity = 0.6 + Math.sin(this.time * 4) * 0.3;
    } else this.selRing.visible = false;
    this.flareT -= dt;
    if (this.flareT <= 0) {
      this.flareT = 0.07;
      this.effects.emit('glow', this.world.flarePos, 1, { color: [1, 0.25, 0.15], speed: 0.6, dir: { x: 0, y: 1, z: 0 }, spread: 0.6, life: 0.4, gravity: -1 });
      this.effects.emit('solid', this.world.flarePos, 1, { color: [0.35, 0.12, 0.1], speed: 0.6, dir: { x: 0.2, y: 1, z: 0 }, spread: 0.3, life: 3.5, gravity: -0.4, drag: 0.4 });
    }
    if (this.mode === 'aim') this.updateAim(dt);
    this.rig.update(dt, this.effects.shakeAmt);
    this.renderer.render(this.scene, this.camera);
    this.ui.updateLabels(this.camera, this.world.units, dt);
  }

  // ---------------------------------------------------------------- input
  bindInput() {
    const dom = this.renderer.domElement;
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointermove', (e) => {
      const dx = e.clientX - this.mousePx.x, dy = e.clientY - this.mousePx.y;
      this.mousePx = { x: e.clientX, y: e.clientY };
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      if (this.drag) {
        this.drag.moved += Math.abs(dx) + Math.abs(dy);
        if (this.mode === 'aim') {
          this.aimYaw -= dx * 0.0035;
          this.aimPitch = THREE.MathUtils.clamp(this.aimPitch - dy * 0.0035, -1.1, 0.9);
        } else {
          this.rig.goalYaw -= dx * 0.006;
          this.rig.pitch = THREE.MathUtils.clamp(this.rig.pitch + dy * 0.004, 0.45, 1.4);
        }
      }
      if (this.mode !== 'aim') this.updateHover();
    });
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || e.button === 2) {
        this.drag = { moved: 0 };
        return;
      }
      if (e.button === 0) this.onClick();
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 2 && this.drag && this.drag.moved < 6) this.cancel();
      if (e.button === 1 || e.button === 2) this.drag = null;
    });
    dom.addEventListener('wheel', (e) => { e.preventDefault(); this.rig.zoom(e.deltaY); }, { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  onKey(e) {
    if (this.phase !== 'player') return;
    if (e.code === 'Escape') return this.cancel();
    if (e.code === 'Tab') e.preventDefault();
    if (this.busy) return;
    if (this.mode === 'aim') {
      if (e.code === 'Tab') this.cycleTarget();
      if (e.code === 'Space') this.fireAim();
      return;
    }
    if (e.code === 'KeyQ') this.rig.rotate(-1);
    if (e.code === 'KeyE') this.rig.rotate(1);
    if (e.code === 'Tab') this.selectNext(true);
    if (e.code === 'Enter') this.endTurn();
    const acts = { Digit1: 'aim', Digit2: 'swap', Digit3: 'reload', Digit4: 'grenade', Digit5: 'medkit', Digit6: 'overwatch' };
    if (acts[e.code]) this.action(acts[e.code]);
    if (e.code === 'KeyF' && this.selected) this.rig.focus(this.selected.pos().x, this.selected.pos().z);
  }

  pickRay(ndc) {
    this.raycaster.setFromCamera(ndc, this.camera);
    return { o: this.raycaster.ray.origin.clone(), d: this.raycaster.ray.direction.clone() };
  }

  updateHover() {
    if (this.phase !== 'player' || this.busy) { this.clearHover(); return; }
    const { o, d } = this.pickRay(this.mouse);
    this.world.refreshHitboxes();
    let hit = this.world.trace(o, d, 300);
    let unit = null;
    if (hit.type === 'unit') {
      if (hit.unit.root.visible) unit = hit.unit;
      else hit = this.world.trace(o, d, 300, { units: false });
    }
    let cell;
    if (unit) cell = this.world.cell(unit.q, unit.r);
    else {
      const p = hit.type === 'none' ? (d.y < 0 ? { x: o.x - (d.x * o.y) / d.y, z: o.z - (d.z * o.y) / d.y } : null) : hit.point;
      if (p) { const h = worldToHex(p.x, p.z); cell = this.world.cell(h.q, h.r); }
    }
    const k = (cell ? key(cell.q, cell.r) : '') + '|' + (unit ? unit.id : '') + '|' + this.mode;
    this.hoverUnit = unit;
    this.hoverCell = cell;
    if (k === this.lastHoverKey) {
      this.moveTooltip();
      return;
    }
    this.lastHoverKey = k;
    this.renderHover();
  }

  moveTooltip() {
    const t = document.getElementById('tooltip');
    if (!t.classList.contains('hidden')) {
      t.style.left = this.mousePx.x + 'px';
      t.style.top = this.mousePx.y + 'px';
    }
  }

  clearHover() {
    this.hoverRing.visible = false;
    this.targetRing.visible = false;
    this.pathDots.count = 0;
    this.coverGroup.clear();
    this.arcLine.visible = false;
    this.blastRing.visible = false;
    this.ui.tooltip(null);
  }

  renderHover() {
    this.clearHover();
    const u = this.hoverUnit, c = this.hoverCell, sel = this.selected;
    const mx = this.mousePx.x, my = this.mousePx.y;
    if (this.mode === 'grenade' && sel) {
      if (!c) return;
      const d = hexDist(sel, c);
      const okRange = d <= GRENADE_RANGE && d > 0;
      const p0 = this.handPos(sel);
      const arc = this.traceArc(p0, { x: c.x, y: 0.15, z: c.z }, this.arcHeight(d), sel);
      this.arcLine.geometry.setFromPoints(arc.pts.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
      this.arcLine.material.color.set(okRange ? 0xffb347 : 0xff3a2a);
      this.arcLine.visible = true;
      this.blastRing.position.set(arc.end.x, 0.04, arc.end.z);
      this.blastRing.visible = okRange;
      this.ui.tooltip(okRange ? `Throw grenade · <b>2 AP</b>${arc.hit && arc.hit.type === 'obstacle' ? ' <span class="red">· arc obstructed</span>' : ''}` : '<span class="red">Out of range</span>', mx, my);
      return;
    }
    if (this.mode === 'medkit' && sel) {
      if (u && this.medTargets.includes(u)) {
        this.hoverRing.position.set(u.pos().x, 0.03, u.pos().z);
        this.hoverRing.visible = true;
        this.ui.tooltip(`Treat <b>${u.name}</b> · +45 HP, stabilise limbs · <b>4 TU</b>`, mx, my);
      } else this.ui.tooltip('Select an adjacent squadmate (or self)', mx, my);
      return;
    }
    if (u) {
      const p = u.pos();
      if (u.team === 'enemy') {
        this.targetRing.position.set(p.x, 0.03, p.z);
        this.targetRing.visible = true;
        this.ui.tooltip(this.enemyTooltip(u), mx, my);
      } else {
        this.hoverRing.position.set(p.x, 0.03, p.z);
        this.hoverRing.visible = true;
        this.ui.tooltip(`<div class="tt-title">${u.name}</div><div class="dim">${u.role} · HP ${Math.ceil(u.hp)}/${u.maxHp}</div>`, mx, my);
      }
      return;
    }
    if (!c || !sel || !this.reach) return;
    const e = this.reach.get(key(c.q, c.r));
    if (!e || e.cost === 0) {
      if (c.obstacle) this.ui.tooltip(`<span class="dim">${c.obstacle.kind}${isFinite(c.obstacle.hp) ? ` · ${Math.max(0, Math.ceil(c.obstacle.hp))} HP` : ''}</span>`, mx, my);
      return;
    }
    this.hoverRing.position.set(c.x, 0.03, c.z);
    this.hoverRing.visible = true;
    const path = this.world.pathFromReach(this.reach, c);
    const canShoot = sel.tu - e.cost >= sel.weapon.def.tu;
    const col = new THREE.Color(canShoot ? 0x7fd4ff : 0xffc060);
    const pts = [sel.pos().clone()];
    for (const pc of path) pts.push(new THREE.Vector3(pc.x, 0, pc.z));
    const mtx = new THREE.Matrix4();
    let n = 0;
    for (let i = 1; i < pts.length; i++) {
      for (let s = 0; s < 3 && n < 256; s++) {
        const p = pts[i - 1].clone().lerp(pts[i], (s + 1) / 3);
        mtx.makeTranslation(p.x, 0.04, p.z);
        this.pathDots.setMatrixAt(n, mtx);
        this.pathDots.setColorAt(n, col);
        n++;
      }
    }
    this.pathDots.count = n;
    this.pathDots.instanceMatrix.needsUpdate = true;
    this.pathDots.instanceColor.needsUpdate = true;
    for (const cv of this.world.coverAt(c)) {
      const h = cv.type === 'full' ? 0.9 : 0.45;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.75, h), this.coverMats[cv.type]);
      m.position.set(cv.x - Math.sin(cv.angle) * 0.12, h / 2 + 0.02, cv.z - Math.cos(cv.angle) * 0.12);
      m.rotation.y = cv.angle;
      this.coverGroup.add(m);
    }
    const covers = this.world.coverAt(c);
    const cvText = covers.length ? ` · cover: ${covers.filter((x) => x.type === 'full').length} full / ${covers.filter((x) => x.type === 'half').length} half` : '';
    const item = c.item && c.seen ? ` · <span style="color:#9dffb4">pick up ${c.item.type === 'sample' ? 'V-7 case' : c.item.type}</span>` : '';
    this.ui.tooltip(`Move · <b>${(e.cost / 3).toFixed(1)} AP</b>${canShoot ? '' : ' <span class="red">(dash — no shot after)</span>'}${cvText}${item}`, mx, my);
    this.ui.unitPanel(sel, this.mode, e.cost);
  }

  enemyTooltip(u) {
    if (u.state === 'down') return `<div class="tt-title">${u.name} (down)</div><div class="red">Still twitching — destroy the head or it may rise.</div>`;
    const bad = Object.keys(u.parts).filter((k) => u.parts[k] <= 0).map((k) => PART_LABEL[k]);
    const armor = Object.keys(u.armor).length ? `<div class="dim">Armored: ${Object.keys(u.armor).map((k) => `${PART_LABEL[k]} ${u.armor[k]}`).join(', ')}</div>` : '';
    return `<div class="tt-title">${u.name}</div>
      <div>HP ${Math.max(0, Math.ceil(u.hp))}/${u.maxHp} · Head ${Math.max(0, Math.ceil(u.parts.head))}</div>
      ${armor}
      ${bad.length ? `<div class="red">Disabled: ${bad.join(', ')}</div>` : ''}
      ${u.awake ? '' : '<div class="dim">Unaware of you</div>'}
      <div class="dim">Click to aim</div>`;
  }

  onClick() {
    if (this.phase !== 'player' || this.busy) return;
    sfx.click();
    if (this.mode === 'aim') return this.fireAim();
    if (this.mode === 'grenade') {
      if (this.hoverCell) this.throwGrenade(this.selected, this.hoverCell);
      return;
    }
    if (this.mode === 'medkit') {
      if (this.hoverUnit && this.medTargets.includes(this.hoverUnit)) this.useMedkit(this.selected, this.hoverUnit);
      return;
    }
    const u = this.hoverUnit, c = this.hoverCell, sel = this.selected;
    if (u && u.team === 'squad' && u.alive) return this.select(u);
    if (u && u.team === 'enemy' && sel) return this.aimAt(u);
    if (c && sel && this.reach) {
      const e = this.reach.get(key(c.q, c.r));
      if (e && e.cost > 0) this.moveSelected(c);
    }
  }

  cancel() {
    if (this.busy) return;
    if (this.mode === 'aim') this.exitAim();
    this.mode = 'idle';
    this.ui.hint(null);
    this.lastHoverKey = null;
    this.refresh();
    this.updateHover();
  }

  // ---------------------------------------------------------------- selection
  select(u) {
    if (this.busy || !u || !u.alive || this.phase !== 'player') return;
    if (this.mode === 'aim') this.exitAim();
    this.selected = u;
    this.mode = 'idle';
    this.ui.hint(null);
    this.rig.focus(u.pos().x, u.pos().z);
    this.refresh();
  }

  selectNext(force = false) {
    const alive = this.squad.filter((s) => s.alive);
    if (!alive.length) return;
    const i = alive.indexOf(this.selected);
    for (let k = 1; k <= alive.length; k++) {
      const s = alive[(i + k) % alive.length];
      if (s.tu > 0 && !s.overwatch) return this.select(s);
    }
    if (force) this.select(alive[(i + 1) % alive.length]);
  }

  refresh() {
    if (this.dirty) {
      this.dirty = false;
      this.world.computeVisibility(this.squad);
      this.updateEnemyVis();
    }
    const sel = this.selected;
    if (sel && sel.alive && this.phase === 'player' && this.mode === 'idle') this.showRange(sel);
    else this.rangeMesh.count = 0;
    this.ui.roster(this.squad, sel);
    this.ui.unitPanel(sel && sel.alive ? sel : null, this.mode);
    this.lastHoverKey = null;
  }

  showRange(u) {
    this.reach = this.world.reachable(u, u.tu);
    const mtx = new THREE.Matrix4();
    const blue = new THREE.Color(0x3fa8ff), yellow = new THREE.Color(0xffb030);
    let n = 0;
    for (const e of this.reach.values()) {
      if (e.cost === 0) continue;
      mtx.makeTranslation(e.cell.x, 0.025, e.cell.z);
      this.rangeMesh.setMatrixAt(n, mtx);
      this.rangeMesh.setColorAt(n, u.tu - e.cost >= u.weapon.def.tu ? blue : yellow);
      n++;
    }
    this.rangeMesh.count = n;
    this.rangeMesh.instanceMatrix.needsUpdate = true;
    this.rangeMesh.instanceColor.needsUpdate = true;
  }

  canFire(u) {
    return u && u.alive && u.tu >= u.weapon.def.tu && u.weapon.ammo > 0;
  }

  canReload(u) {
    return u && u.alive && u.tu >= 3 && u.weapon.reserve > 0 && u.weapon.ammo < u.weapon.def.mag;
  }

  // ---------------------------------------------------------------- actions
  action(act) {
    const u = this.selected;
    if (!u || !u.alive || this.busy || this.phase !== 'player') return;
    if (this.mode === 'aim') this.exitAim();
    if (act === 'aim') return this.aimAt(null);
    if (act === 'swap') {
      u.weaponIdx = (u.weaponIdx + 1) % u.weapons.length;
      u.setGun();
      sfx.reload();
      this.ui.log(`${u.name} switches to ${u.weapon.def.name}.`);
      this.mode = 'idle';
      return this.refresh();
    }
    if (act === 'reload') {
      if (!this.canReload(u)) return this.ui.log(u.weapon.reserve <= 0 ? 'No spare magazines!' : 'Cannot reload now.', 'warn');
      u.tu -= 3;
      u.weapon.ammo = u.weapon.def.mag;
      u.weapon.reserve--;
      sfx.reload();
      this.ui.log(`${u.name} reloads the ${u.weapon.def.short}. (${u.weapon.reserve} mags left)`);
      this.mode = 'idle';
      return this.afterAction();
    }
    if (act === 'grenade') {
      if (u.grenades <= 0 || u.tu < 6) return;
      this.mode = this.mode === 'grenade' ? 'idle' : 'grenade';
      this.ui.hint(this.mode === 'grenade' ? `<b>LMB</b> throw grenade (max ${GRENADE_RANGE} hexes) · <b>Esc</b> cancel` : null);
      this.refresh();
      this.updateHover();
      return;
    }
    if (act === 'medkit') {
      if (u.medkits <= 0 || u.tu < 4) return;
      this.medTargets = this.squad.filter((s) => s.alive && hexDist(s, u) <= 1 && (s.hp < s.maxHp || Object.keys(s.parts).some((p) => s.parts[p] < s.partMax[p])));
      if (!this.medTargets.length) return this.ui.log('Nobody nearby needs treatment.', 'warn');
      this.mode = 'medkit';
      this.ui.hint('<b>LMB</b> treat squadmate · <b>Esc</b> cancel');
      this.refresh();
      this.updateHover();
      return;
    }
    if (act === 'overwatch') {
      if (!this.canFire(u)) return;
      u.overwatch = true;
      u.tu = 0;
      this.ui.log(`${u.name} is on overwatch with the ${u.weapon.def.short}.`, 'info');
      this.mode = 'idle';
      return this.afterAction();
    }
  }

  afterAction() {
    this.refresh();
    if (this.checkEnd()) return;
    const u = this.selected;
    if (u && (!u.alive || u.tu <= 0)) {
      const next = this.squad.find((s) => s.alive && s.tu > 0 && !s.overwatch);
      if (next) this.select(next);
      else this.refresh();
    }
    this.updateHover();
  }

  async moveSelected(c) {
    const u = this.selected;
    const path = this.world.pathFromReach(this.reach, c);
    if (!path.length) return;
    this.busy = true;
    this.clearHover();
    this.rangeMesh.count = 0;
    this.ui.unitPanel(u, this.mode);
    await this.moveUnit(u, path);
    this.busy = false;
    if (this.over) return;
    this.afterAction();
  }

  stepTime(u) {
    return { soldier: 0.26, hound: 0.16, zombie: 0.42, spitter: 0.42, brute: 0.36 }[u.kind];
  }

  async moveUnit(u, path, opts = {}) {
    const W = this.world;
    u.moving = true;
    for (const c of path) {
      if (!u.alive || this.over) break;
      const occ = W.unitAt(c);
      if (occ && occ !== u) break;
      if (c.obstacle) break;
      if (u.tu < u.moveCost) break;
      const from = u.pos().clone();
      u.q = c.q;
      u.r = c.r;
      u.faceTowards(c.x, c.z);
      u.tu -= u.moveCost;
      const shown = u.team === 'squad' || u.root.visible || c.vis;
      const dur = shown ? this.stepTime(u) * (u.crippled ? 1.6 : 1) : 0.02;
      if (u.team === 'squad') sfx.step();
      await tween(dur, (k) => u.root.position.set(from.x + (c.x - from.x) * k, 0, from.z + (c.z - from.z) * k), linear);
      if (u.team === 'squad') {
        if (c.item) this.pickup(u, c.item);
        W.computeVisibility(this.squad);
        const newly = this.updateEnemyVis();
        this.rig.focus(c.x, c.z);
        if (u.hasSample && c.ch === 'E') {
          u.moving = false;
          this.gameOver(true);
          return;
        }
        if (newly.length) {
          this.ui.log(`<b>Contact!</b> ${newly.map((e) => e.name).join(', ')} spotted.`, 'bad');
          sfx.sting();
          for (const e of newly) if (e.kind === 'brute') this.ui.banner('BRUTE', 'HEAVILY ARMORED — AIM FOR THE HEAD', 'enemy');
          break;
        }
      } else {
        const wasVisible = u.root.visible;
        this.updateEnemyVis();
        if (u.root.visible) {
          this.rig.focus(c.x, c.z);
          if (!wasVisible) await wait(0.25);
        }
        await this.overwatchCheck(u);
        if (opts.stopIf && opts.stopIf(c)) break;
      }
    }
    u.moving = false;
  }

  updateEnemyVis() {
    const newly = [];
    for (const e of this.enemies) {
      const c = this.world.cell(e.q, e.r);
      let vis;
      if (e.state === 'dead') vis = c.vis || e.root.visible;
      else if (e.state === 'down') vis = c.vis;
      else vis = this.squad.some((s) => s.alive && this.world.canSee(s, e));
      if (vis && e.alive && !e.spotted) {
        e.spotted = true;
        newly.push(e);
      }
      e.root.visible = vis;
    }
    this.ui.enemyList(this.enemies.filter((e) => e.root.visible && (e.alive || (e.state === 'down' && e.rising))));
    return newly;
  }

  pickup(u, it) {
    const W = this.world;
    sfx.pickup();
    if (it.type === 'ammo') {
      for (const w of u.weapons) w.reserve += w.id === 'pistol' ? 1 : 2;
      this.ui.log(`${u.name} scavenges ammunition (+2 mags primary, +1 pistol).`, 'good');
    } else if (it.type === 'medkit') {
      u.medkits++;
      this.ui.log(`${u.name} picks up a field medkit.`, 'good');
    } else if (it.type === 'sample') {
      u.hasSample = true;
      this.ui.log(`${u.name} secures the V-7 sample case! The facility alarm is blaring...`, 'warn');
      this.ui.banner('V-7 SECURED', 'GET TO THE EXTRACTION PAD', 'enemy');
      sfx.alarm();
      if (!this.alarm) {
        this.alarm = true;
        this.reinforce(['hound', 'hound', 'zombie']);
        for (const e of this.enemies) if (e.alive) e.awake = true;
      }
      this.updateObjective();
    }
    W.removeItem(it);
  }

  // ---------------------------------------------------------------- aiming
  visibleTargets() {
    const sel = this.selected;
    return this.enemies
      .filter((e) => e.root.visible && (e.alive || (e.state === 'down' && e.rising)))
      .sort((a, b) => a.pos().distanceTo(sel.pos()) - b.pos().distanceTo(sel.pos()));
  }

  aimAt(target) {
    const u = this.selected;
    if (!u || this.busy || this.phase !== 'player') return;
    if (!this.canFire(u)) {
      this.ui.log(u.weapon.ammo <= 0 ? `${u.weapon.def.short} is empty — reload (3).` : 'Not enough AP to fire.', 'warn');
      sfx.dry();
      return;
    }
    if (this.mode === 'aim' && !target) return;
    this.mode = 'aim';
    this.clearHover();
    this.rangeMesh.count = 0;
    const targets = this.visibleTargets();
    this.aimTarget = target || targets[0] || null;
    this.lookAtTarget(this.aimTarget);
    this.rig.setMode('aim');
    this.renderer.domElement.style.cursor = 'none'; // the reticle replaces the pointer
    this.simT = 0;
    this.ui.hint('<b>LMB/Space</b> fire · <b>Mouse</b> aim · <b>RMB-drag</b> / <b>WASD</b> turn · <b>Wheel</b> zoom · <b>Tab</b> next target · <b>Esc</b> cancel');
    this.ui.unitPanel(u, 'aim', u.weapon.def.tu);
    this.ui.show('roster', false);
  }

  lookAtTarget(t) {
    const u = this.selected;
    const e = u.eye();
    if (t) {
      const p = t.aimPoint(t.state === 'down' ? 'head' : 'torso');
      this.aimYaw = Math.atan2(p.x - e.x, p.z - e.z);
      this.aimPitch = Math.atan2(p.y - e.y, Math.hypot(p.x - e.x, p.z - e.z));
      this.aimDist = Math.max(3, Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z));
    } else {
      this.aimYaw = u.root.rotation.y;
      this.aimPitch = -0.08;
      this.aimDist = 12;
    }
  }

  cycleTarget() {
    const ts = this.visibleTargets();
    if (!ts.length) return;
    const i = ts.indexOf(this.aimTarget);
    this.aimTarget = ts[(i + 1) % ts.length];
    this.lookAtTarget(this.aimTarget);
    this.simT = 0;
  }

  exitAim() {
    this.mode = 'idle';
    this.rig.setMode('tactical');
    this.renderer.domElement.style.cursor = '';
    this.ui.reticle(false);
    this.ui.hint(null);
    if (this.phase !== 'title') this.ui.show('roster', true);
    if (this.selected) this.selected.aimPitch = 0;
  }

  aimCamera(u) {
    const e = u.eye();
    const cy = Math.cos(this.aimPitch);
    const f = { x: Math.sin(this.aimYaw) * cy, y: Math.sin(this.aimPitch), z: Math.cos(this.aimYaw) * cy };
    const right = { x: -Math.cos(this.aimYaw), y: 0, z: Math.sin(this.aimYaw) };
    let cam = { x: e.x - f.x * 1.7 + right.x * 0.6, y: e.y - f.y * 1.7 + 0.25, z: e.z - f.z * 1.7 + right.z * 0.6 };
    const dv = sub(cam, e), dl = len(dv), dn = norm(dv);
    const hit = this.world.trace(e, dn, dl, { units: false, ground: false });
    if (hit.type === 'obstacle') cam = { x: e.x + dn.x * Math.max(0.2, hit.t - 0.2), y: e.y + dn.y * Math.max(0.2, hit.t - 0.2), z: e.z + dn.z * Math.max(0.2, hit.t - 0.2) };
    const look = { x: e.x + f.x * this.aimDist, y: e.y + f.y * this.aimDist, z: e.z + f.z * this.aimDist };
    this.rig.setAim(new THREE.Vector3(cam.x, cam.y, cam.z), new THREE.Vector3(look.x, look.y, look.z));
  }

  updateAim(dt) {
    const u = this.selected;
    if (!u || !u.alive) return;
    const keys = this.rig.keys;
    const turn = dt * 0.6 * (this.rig.aimFov / 50);
    if (!this.busy) {
      if (keys.has('KeyA') || keys.has('ArrowLeft')) this.aimYaw += turn;
      if (keys.has('KeyD') || keys.has('ArrowRight')) this.aimYaw -= turn;
      if (keys.has('KeyW') || keys.has('ArrowUp')) this.aimPitch = Math.min(0.9, this.aimPitch + turn);
      if (keys.has('KeyS') || keys.has('ArrowDown')) this.aimPitch = Math.max(-1.1, this.aimPitch - turn);
    }
    u.yaw = this.aimYaw;
    u.root.rotation.y = this.aimYaw;
    u.aimPitch = -this.aimPitch * 0.6;
    this.aimCamera(u);
    if (this.busy) return;

    const w = window.innerWidth, h = window.innerHeight;
    const sx = this.mousePx.x, sy = this.mousePx.y;
    const { o, d } = this.pickRay(new THREE.Vector2((sx / w) * 2 - 1, -(sy / h) * 2 + 1));
    this.world.refreshHitboxes();
    const hit = this.world.trace(o, d, 200, { ignore: u });
    const P = hit.type === 'none' ? { x: o.x + d.x * 200, y: o.y + d.y * 200, z: o.z + d.z * 200 } : hit.point;
    this.aimPoint = P;

    const def = u.weapon.def;
    const m = u.muzzlePos();
    const D = len(sub(P, m));
    const R = D * Math.tan(def.spread * u.accMult * DEG);
    const Dc = Math.max(0.5, len(sub(P, this.camera.position)));
    const rpx = (R / (Dc * Math.tan((this.camera.fov * DEG) / 2))) * (h / 2);
    const cls = hit.type === 'unit' ? (hit.unit.team === 'enemy' ? 'enemy' : 'friendly') : '';
    this.ui.reticle(true, sx, sy, rpx, rpx / Math.SQRT2, cls);

    this.simT -= dt;
    if (this.simT <= 0) {
      this.simT = 0.12;
      const sim = this.simulate(u, P);
      this.ui.aimInfo(this.aimInfoHtml(u, sim, hit, D));
    }
  }

  // Monte-Carlo preview: fire many virtual volleys through the real ballistic trace.
  simulate(u, P) {
    const def = u.weapon.def;
    const W = this.world;
    W.refreshHitboxes();
    const m = u.muzzlePos();
    const base = norm(sub(P, m));
    const shots = Math.min(def.burst, u.weapon.ammo);
    const volleys = Math.max(24, Math.ceil(360 / (shots * def.pellets)));
    const tallies = new Map();
    let blocked = 0, total = 0;
    const dir = { x: 0, y: 0, z: 0 };
    for (let v = 0; v < volleys; v++) {
      const hitThis = new Set();
      for (let b = 0; b < shots; b++) {
        const spread = def.spread * u.accMult * (1 + b * def.recoil) * DEG;
        for (let p = 0; p < def.pellets; p++) {
          perturb(base, spread, dir);
          const hit = W.trace(m, dir, 150, { ignore: u });
          total++;
          if (hit.type === 'unit') {
            let t = tallies.get(hit.unit);
            if (!t) tallies.set(hit.unit, (t = { unit: hit.unit, hits: 0, parts: {}, volleys: 0, dmg: 0 }));
            t.hits++;
            t.parts[hit.part] = (t.parts[hit.part] || 0) + 1;
            const arm = Math.max(0, (hit.unit.armor[hit.part] || 0) - def.armorPierce);
            t.dmg += Math.max(1, def.dmg * rangeFalloff(def, hit.t) * PART_MULT[hit.part] - arm);
            hitThis.add(hit.unit);
          } else if (hit.type === 'obstacle') blocked++;
        }
      }
      for (const un of hitThis) tallies.get(un).volleys++;
    }
    return { volleys, total, perVolley: shots * def.pellets, tallies, blocked };
  }

  aimInfoHtml(u, sim, hit, D) {
    const def = u.weapon.def;
    let focus = hit.type === 'unit' ? sim.tallies.get(hit.unit) : null;
    if (!focus) {
      let best = null;
      for (const t of sim.tallies.values()) if (t.unit.team === 'enemy' && (!best || t.hits > best.hits)) best = t;
      focus = best;
    }
    const pct = (x) => Math.round((x / sim.total) * 100);
    let html = '';
    if (focus) {
      const t = focus;
      const un = t.unit;
      const chance = Math.round((t.volleys / sim.volleys) * 100);
      const parts = Object.entries(t.parts).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${PART_LABEL[p]} ${pct(n)}%`).join(' · ');
      html += `<div class="ai-title">${un.name}${un.state === 'down' ? ' (down)' : ''} <span class="dim">· ${D.toFixed(1)} m</span></div>
        <div class="row"><span>Hit chance</span><span class="big">${chance}%</span></div>
        <div class="row"><span class="dim">Expected hits</span><span>${(t.hits / sim.volleys).toFixed(1)} / ${sim.perVolley}</span></div>
        <div class="row"><span class="dim">Expected damage</span><span>~${Math.round(t.dmg / sim.volleys)}</span></div>
        <div>${parts}</div>`;
    } else {
      html += `<div class="ai-title">Free aim <span class="dim">· ${D.toFixed(1)} m</span></div>`;
      if (hit.type === 'obstacle') html += `<div class="dim">Target: ${hit.obstacle.kind}${isFinite(hit.obstacle.hp) ? ` (${Math.max(0, Math.ceil(hit.obstacle.hp))} HP)` : ''}</div>`;
    }
    if (sim.blocked) html += `<div class="dim">Hits cover / scenery: ${pct(sim.blocked)}%</div>`;
    const ff = [...sim.tallies.values()].filter((t) => t.unit.team === 'squad');
    if (ff.length) html += `<div class="ff">⚠ Friendly fire: ${ff.map((t) => `${t.unit.name.split(' ')[0]} ${pct(t.hits)}%`).join(', ')}</div>`;
    if (D > def.range) html += `<div class="ff">Beyond effective range (${def.range} m) — reduced damage</div>`;
    html += `<div class="dim" style="margin-top:4px">${def.short} · ${def.burst > 1 ? def.burst + '-rd burst' : def.pellets > 1 ? def.pellets + ' pellets' : 'single'} · ${def.tu / 3} AP · ${u.weapon.ammo}/${def.mag}</div>`;
    return html;
  }

  async fireAim() {
    const u = this.selected;
    if (!this.canFire(u) || this.busy || !this.aimPoint) return;
    this.busy = true;
    this.ui.reticle(false);
    this.ui.hint(null);
    await this.fire(u, this.aimPoint);
    await wait(0.6);
    this.exitAim();
    this.busy = false;
    if (this.over) return;
    this.dirty = true;
    this.afterAction();
  }

  pan(p) {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(this.camera);
    return THREE.MathUtils.clamp(v.x, -1, 1) * 0.7;
  }

  makeNoise(p, radius) {
    let woke = 0;
    for (const e of this.enemies) {
      if (!e.alive || e.awake) continue;
      if (hexDist(e, p) <= radius) {
        e.awake = true;
        woke++;
      }
    }
    if (woke) setTimeout(() => sfx.groan(0, 0.6), 400);
  }

  async fire(u, P, { reaction = false } = {}) {
    const w = u.weapon, def = w.def;
    if (!reaction) u.tu -= def.tu;
    u.faceTowards(P.x, P.z);
    if (reaction) u.root.rotation.y = u.yaw;
    const shots = Math.min(def.burst, w.ammo);
    this.makeNoise(u, { pistol: 8, smg: 10, sniper: 14 }[def.sound] ?? 12);
    const arrivals = [];
    for (let b = 0; b < shots; b++) {
      if (!u.alive) break;
      this.world.refreshHitboxes();
      const m = u.muzzlePos();
      const base = norm(sub(P, m));
      const spread = def.spread * u.accMult * (1 + b * def.recoil) * DEG;
      w.ammo--;
      this.stats.shots++;
      sfx.shot(def.sound, this.pan(m));
      this.effects.muzzle(m, base);
      u.flinch = Math.max(u.flinch, def.pellets > 1 || def.sound === 'sniper' ? 0.5 : 0.2);
      for (let p = 0; p < def.pellets; p++) {
        const dir = perturb(base, spread);
        const hit = this.world.trace(m, dir, 150, { ignore: u });
        const end = hit.type === 'none' ? { x: m.x + dir.x * 150, y: m.y + dir.y * 150, z: m.z + dir.z * 150 } : hit.point;
        arrivals.push(
          this.effects.tracer(m, end, { speed: 190, len: def.pellets > 1 ? 1.0 : 2.6, width: def.sound === 'sniper' ? 1.6 : def.pellets > 1 ? 0.6 : 1 })
            .then(() => this.applyHit(hit, def, hit.t, dir, u)),
        );
      }
      if (b < shots - 1) await wait(def.burstDelay);
    }
    await Promise.all(arrivals);
    await this.flushPending();
  }

  async flushPending() {
    while (this.pending.length) {
      const p = this.pending.splice(0);
      await Promise.all(p);
    }
  }

  applyHit(hit, def, dist, dir, shooter) {
    const p = hit.point;
    if (hit.type === 'unit') {
      const u = hit.unit;
      let dmg = def.dmg * rangeFalloff(def, dist) * PART_MULT[hit.part];
      const arm = Math.max(0, (u.armor[hit.part] || 0) - def.armorPierce);
      if (arm > 0) {
        this.effects.sparks(p, hit.normal);
        sfx.impact('metal', this.pan(p));
      }
      dmg = Math.max(1, Math.round(dmg - arm));
      this.damageUnit(u, hit.part, dmg, dir, shooter);
    } else if (hit.type === 'obstacle') {
      const ob = hit.obstacle;
      const n = hit.normal;
      if (ob.mat === 'metal') this.effects.sparks(p, n);
      else if (ob.mat === 'wood') this.effects.splinters(p, n);
      else { this.effects.dust(p, n); if (Math.random() < 0.4) this.effects.sparks(p, n); }
      sfx.impact(ob.mat === 'metal' ? 'metal' : ob.mat === 'wood' ? 'wood' : 'stone', this.pan(p));
      if (isFinite(ob.hp) && !ob.destroyed) {
        ob.hp -= def.dmg;
        if (ob.hp <= 0) this.breakObstacle(ob, shooter);
      }
    } else if (hit.type === 'ground') {
      this.effects.dust(p, hit.normal);
    }
  }

  breakObstacle(ob, src) {
    if (ob.destroyed) return;
    this.world.destroyObstacle(ob);
    this.dirty = true;
    const c = ob.cells[0];
    if (ob.explosive) {
      this.ui.log('A fuel barrel ruptures and explodes!', 'warn');
      this.pending.push(wait(0.08).then(() => this.explode({ x: c.x, y: 0.5, z: c.z }, 2.8, 80, src)));
    } else {
      this.effects.splinters({ x: c.x, y: 0.6, z: c.z }, { x: 0, y: 1, z: 0 });
      this.effects.dust({ x: c.x, y: 0.4, z: c.z }, { x: 0, y: 1, z: 0 });
      sfx.impact('wood', this.pan(c));
      this.ui.log(`${ob.kind[0].toUpperCase() + ob.kind.slice(1)} destroyed — cover lost.`);
    }
  }

  damageUnit(u, part, dmg, dir, src) {
    if (u.state === 'dead') return;
    const p = u.aimPoint(part);
    if (u.state === 'down') {
      u.hp -= dmg;
      this.effects.blood(p, dir, 0.6);
      sfx.impact('flesh', this.pan(p));
      if (part === 'head' || u.hp < -u.maxHp * 0.6) {
        u.state = 'dead';
        u.rising = false;
        if (part === 'head') { u.rig.head.visible = false; this.effects.blood(p, dir, 1.6); }
        this.ui.floatText(p, 'DESTROYED', '#ffd040');
        this.ui.log(`${u.name} corpse destroyed. It won't get up again.`, 'good');
        this.updateEnemyVis();
      }
      return;
    }
    u.hp -= dmg;
    const before = u.parts[part];
    u.parts[part] -= dmg;
    u.flinch = 1;
    this.effects.blood(p, dir, u.team === 'enemy' ? 1 : 0.7);
    sfx.impact('flesh', this.pan(p));
    if (u.team === 'squad') sfx.hurt(this.pan(p));
    this.ui.floatText(p, String(dmg), part === 'head' ? '#ffd040' : u.team === 'squad' ? '#ff6050' : '#ffffff', part === 'head' ? 'HEAD' : PART_LABEL[part]);
    if (u.team === 'enemy') u.awake = true;
    if (src && src.team === 'squad' && u.team === 'squad' && src !== u) this.ui.log(`Friendly fire! ${u.name} is hit.`, 'bad');
    if (before > 0 && u.parts[part] <= 0 && part !== 'head' && part !== 'torso' && u.hp > 0) {
      const what = part.startsWith('leg') ? 'crippled — movement halved' : u.team === 'squad' ? 'disabled — accuracy reduced' : 'disabled — attacks weakened';
      this.ui.log(`${u.name}'s ${PART_LABEL[part].toLowerCase()} is ${what}.`, u.team === 'squad' ? 'bad' : 'good');
    }
    if (u.parts.head <= 0 || u.hp <= 0) this.kill(u, u.parts.head <= 0);
    if (u.team === 'squad') this.ui.roster(this.squad, this.selected);
  }

  kill(u, headshot) {
    if (u.team === 'squad') {
      u.state = 'dead';
      u.overwatch = false;
      u.rig.flashlight.intensity = 0;
      this.ui.log(`<b>${u.name} is down.</b> KIA.`, 'bad');
      sfx.hurt();
      if (u.hasSample) {
        u.hasSample = false;
        const it = this.world.addItem(this.world.cell(u.q, u.r), 'sample');
        it.mesh.visible = true;
        this.ui.log('The V-7 case is on the ground — someone grab it!', 'warn');
        this.updateObjective();
      }
    } else {
      this.stats.kills++;
      if (headshot) {
        this.stats.headshots++;
        u.state = 'dead';
        const hp = u.aimPoint('head');
        u.rig.head.visible = false;
        this.effects.blood(hp, { x: 0, y: 1, z: 0 }, 2);
        this.ui.log(`Headshot! ${u.name} is finished.`, 'good');
      } else if (Math.random() < u.def.reanimate) {
        u.state = 'down';
        u.rising = true;
        u.riseIn = 2;
        this.ui.log(`${u.name} goes down... but it's still twitching.`, 'warn');
      } else {
        u.state = 'dead';
        this.ui.log(`${u.name} killed.`, 'good');
      }
      if (u.kind === 'brute') sfx.roar(this.pan(u.pos()));
    }
    this.fall(u);
    this.checkEnd();
  }

  fall(u) {
    const b = u.rig.body;
    if (u.rig.hound) tween(0.5, (k) => { b.rotation.z = k * Math.PI * 0.5; b.position.y = -0.25 * k; }, easeIn);
    else tween(0.7, (k) => { b.rotation.x = -k * Math.PI * 0.48; b.position.y = 0.1 * k; }, easeIn);
    u.moving = false;
  }

  async reanimate(e) {
    e.state = 'alive';
    e.rising = false;
    e.justRose = true;
    e.awake = true;
    e.hp = Math.round(e.maxHp * 0.6);
    for (const p in e.parts) if (p !== 'head') e.parts[p] = Math.max(e.parts[p], e.partMax[p] * 0.5);
    this.updateEnemyVis();
    if (e.root.visible) {
      this.rig.focus(e.pos().x, e.pos().z);
      this.ui.log(`The ${e.name} gets back up!`, 'bad');
      sfx.groan(this.pan(e.pos()), 1);
    }
    const b = e.rig.body;
    await tween(e.root.visible ? 0.9 : 0.01, (k) => { b.rotation.x = -(1 - k) * Math.PI * 0.48; b.position.y = 0.1 * (1 - k); }, easeOut);
  }

  async explode(p, radius, dmg, src) {
    const W = this.world;
    this.effects.explosion(p, radius);
    sfx.explosion(this.pan(p));
    W.refreshHitboxes();
    const c = { x: p.x, y: p.y + 0.3, z: p.z };
    for (const u of [...W.units]) {
      if (!u.hasColliders()) continue;
      const t = u.aimPoint('torso');
      const d = len(sub(t, c));
      if (d > radius + 0.4) continue;
      if (!W.los(c, t)) continue;
      const k = THREE.MathUtils.clamp(1 - d / (radius * 1.35), 0.25, 1);
      const amount = Math.round(dmg * k);
      if (u.state === 'alive') { u.parts.legL -= amount * 0.3; u.parts.legR -= amount * 0.3; }
      this.damageUnit(u, 'torso', amount, norm(sub(t, c)), src);
    }
    for (const ob of [...W.obstacles]) {
      if (ob.destroyed || !isFinite(ob.hp)) continue;
      const oc = ob.cells[0];
      if (Math.hypot(oc.x - p.x, oc.z - p.z) < radius) {
        ob.hp -= dmg * 1.5;
        if (ob.hp <= 0) this.breakObstacle(ob, src);
      }
    }
    const h = worldToHex(p.x, p.z);
    this.makeNoise(h, 18);
    this.dirty = true;
    await wait(0.5);
  }

  // ---------------------------------------------------------------- grenades & arcs
  handPos(u) {
    const p = u.pos();
    return { x: p.x, y: 1.7 * u.scale, z: p.z };
  }

  arcHeight(d) {
    return 1.8 + d * 0.32;
  }

  // Samples a parabolic arc and sweeps it against the world. Returns the truncated path.
  traceArc(p0, p1, h, ignore) {
    const N = 36;
    const pts = [p0];
    let prev = p0, end = p1, hitRes = null;
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const p = { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t + 4 * h * t * (1 - t), z: p0.z + (p1.z - p0.z) * t };
      const dv = sub(p, prev), dl = len(dv);
      const hit = this.world.trace(prev, norm(dv), dl, { ignore });
      if (hit.type !== 'none') {
        const back = norm(dv);
        end = { x: hit.point.x - back.x * 0.12, y: Math.max(0.1, hit.point.y - back.y * 0.12), z: hit.point.z - back.z * 0.12 };
        pts.push(end);
        hitRes = hit;
        break;
      }
      pts.push(p);
      prev = p;
    }
    return { pts, end, hit: hitRes };
  }

  async animateAlong(mesh, pts, dur, onStep) {
    const segs = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) { const l = len(sub(pts[i], pts[i - 1])); segs.push(l); total += l; }
    mesh.visible = true;
    await tween(dur, (k) => {
      let d = k * total, i = 0;
      while (i < segs.length - 1 && d > segs[i]) { d -= segs[i]; i++; }
      const a = pts[i], b = pts[i + 1] || a;
      const f = segs[i] ? Math.min(1, d / segs[i]) : 1;
      mesh.position.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
      if (onStep) onStep(mesh.position);
    }, linear);
    mesh.visible = false;
  }

  async throwGrenade(u, cell) {
    const d = hexDist(u, cell);
    if (d > GRENADE_RANGE || d === 0 || u.grenades <= 0 || u.tu < 6) return;
    this.busy = true;
    this.mode = 'idle';
    this.clearHover();
    this.ui.hint(null);
    u.grenades--;
    u.tu -= 6;
    u.faceTowards(cell.x, cell.z);
    const dist = Math.hypot(cell.x - u.pos().x, cell.z - u.pos().z);
    const r = dist * 0.06 * u.accMult * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
    const target = { x: cell.x + Math.cos(a) * r, y: 0.12, z: cell.z + Math.sin(a) * r };
    const arc = this.traceArc(this.handPos(u), target, this.arcHeight(d), u);
    this.ui.log(`${u.name} throws a frag grenade!`);
    u.flinch = 0.6;
    await wait(0.2);
    await this.animateAlong(this.grenadeMesh, arc.pts, 0.45 + dist * 0.04);
    this.grenadeMesh.position.set(arc.end.x, arc.end.y, arc.end.z);
    this.grenadeMesh.visible = true;
    sfx.impact('metal', this.pan(arc.end));
    await wait(0.45);
    this.grenadeMesh.visible = false;
    await this.explode(arc.end, 2.6, 75, u);
    await this.flushPending();
    this.busy = false;
    if (this.over) return;
    this.dirty = true;
    this.afterAction();
  }

  useMedkit(u, t) {
    u.medkits--;
    u.tu -= 4;
    const before = t.hp;
    t.hp = Math.min(t.maxHp, t.hp + 45);
    for (const p in t.parts) t.parts[p] = Math.min(t.partMax[p], Math.max(t.parts[p], 0) + t.partMax[p] * 0.5);
    sfx.heal();
    const pp = t.aimPoint('torso');
    this.effects.emit('glow', pp, 30, { color: [0.3, 1, 0.5], speed: 1.2, life: 0.9, gravity: -1 });
    this.ui.floatText(pp, `+${Math.round(t.hp - before)}`, '#6cff8a');
    this.ui.log(`${u.name} treats ${t === u ? 'their own wounds' : t.name}.`, 'good');
    this.mode = 'idle';
    this.ui.hint(null);
    this.afterAction();
  }

  // ---------------------------------------------------------------- enemy actions (used by ai.js)
  async overwatchCheck(e) {
    for (const s of this.squad) {
      if (!e.alive || this.over) return;
      if (!s.alive || !s.overwatch || s.weapon.ammo <= 0) continue;
      const dist = s.pos().distanceTo(e.pos());
      if (dist > s.weapon.def.range * 1.3) continue;
      if (!this.world.canSee(s, e)) continue;
      s.overwatch = false;
      e.root.visible = true;
      this.ui.log(`${s.name}: overwatch fire!`, 'info');
      this.ui.roster(this.squad, this.selected);
      await wait(0.12);
      await this.fire(s, e.aimPoint('torso'), { reaction: true });
      this.dirty = true;
      await wait(0.25);
    }
  }

  async melee(e, s) {
    const def = e.def.melee;
    e.faceTowards(s.pos().x, s.pos().z);
    const b = e.rig.body;
    await tween(0.2, (k) => { e.lunge = k * 0.9; b.position.z = k * 0.35; }, easeIn);
    const pan = this.pan(e.pos());
    if (e.kind === 'hound') sfx.growl(pan);
    else if (e.kind === 'brute') sfx.roar(pan);
    else sfx.bite(pan);
    if (Math.random() < def.acc) {
      let dmg = def.dmg[0] + Math.random() * (def.dmg[1] - def.dmg[0]);
      if (e.parts.armL <= 0 && e.parts.armR <= 0) dmg *= 0.6;
      else if (e.parts.armL <= 0 || e.parts.armR <= 0) dmg *= 0.8;
      const roll = Math.random();
      const part = roll < 0.06 ? 'head' : roll < 0.5 ? 'torso' : roll < 0.65 ? 'armL' : roll < 0.8 ? 'armR' : roll < 0.9 ? 'legL' : 'legR';
      dmg = Math.max(1, Math.round(dmg - (s.armor[part] || 0)));
      this.ui.log(`${e.name} ${def.verb} ${s.name}!`, 'bad');
      this.damageUnit(s, part, dmg, norm(sub(s.pos(), e.pos())), e);
      if (e.kind === 'brute') this.effects.shake(0.5);
      else this.effects.shake(0.15);
    } else {
      this.ui.log(`${s.name} shoves the ${e.name} away!`);
    }
    await tween(0.3, (k) => { e.lunge = 0.9 * (1 - k); b.position.z = 0.35 * (1 - k); });
    await wait(0.25);
  }

  async spit(e, s) {
    const def = e.def.ranged;
    e.faceTowards(s.pos().x, s.pos().z);
    await wait(0.2);
    sfx.spit(this.pan(e.pos()));
    const p0 = e.eye();
    p0.y -= 0.15;
    const tp = s.aimPoint('torso');
    const d = Math.hypot(tp.x - p0.x, tp.z - p0.z);
    const r = (0.3 + d * 0.07) * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
    const target = { x: tp.x + Math.cos(a) * r, y: tp.y - 0.3, z: tp.z + Math.sin(a) * r };
    // extend the arc beyond the target so a miss splashes on the ground behind
    const ext = { x: p0.x + (target.x - p0.x) * 1.4, y: target.y - 1.2, z: p0.z + (target.z - p0.z) * 1.4 };
    const arc = this.traceArc(p0, ext, 0.8 + d * 0.12, e);
    this.ui.log(`${e.name} spits acid at ${s.name}!`, 'bad');
    await this.animateAlong(this.spitMesh, arc.pts, 0.35 + d * 0.035, (pos) => {
      if (Math.random() < 0.6) this.effects.emit('glow', pos, 1, { color: [0.5, 1, 0.1], speed: 0.3, life: 0.4, gravity: 2 });
    });
    const end = arc.end;
    sfx.splat(this.pan(end));
    this.effects.acid({ x: end.x, y: Math.max(0.1, end.y), z: end.z }, 1);
    this.world.refreshHitboxes();
    for (const u of [...this.world.units]) {
      if (!u.alive) continue;
      const t = u.aimPoint('torso');
      const dd = Math.hypot(t.x - end.x, t.z - end.z) + Math.max(0, end.y - t.y - 1) * 0.5;
      const direct = arc.hit && arc.hit.unit === u;
      if (!direct && dd > def.splash) continue;
      const base = def.dmg[0] + Math.random() * (def.dmg[1] - def.dmg[0]);
      const amount = Math.round(direct ? base : base * Math.max(0.3, 1 - dd / (def.splash * 1.3)));
      this.damageUnit(u, direct ? arc.hit.part : 'torso', amount, { x: 0, y: -1, z: 0 }, e);
    }
    await wait(0.4);
  }

  reinforce(kinds) {
    const W = this.world;
    let n = 0;
    const spawns = [...W.spawns].sort(() => Math.random() - 0.5);
    for (const kind of kinds) {
      if (this.enemies.filter((e) => e.alive).length >= 15) break;
      const c = spawns.find((s) => !s.vis && !W.unitAt(s)) || W.neighborCells(spawns[n % spawns.length]).find((x) => !x.obstacle && !x.vis && !W.unitAt(x));
      if (!c) continue;
      const e = this.spawnEnemy(kind, c, true);
      e.justRose = true; // acts next turn
      n++;
    }
    if (n) this.ui.log(n > 1 ? 'You hear more of them coming...' : 'Something is moving out there...', 'warn');
  }

  // ---------------------------------------------------------------- turn flow
  async endTurn() {
    if (this.busy || this.phase !== 'player' || this.over) return;
    if (this.mode === 'aim') this.exitAim();
    this.mode = 'idle';
    this.phase = 'enemy';
    this.busy = true;
    this.clearHover();
    this.rangeMesh.count = 0;
    this.ui.hint(null);
    this.ui.unitPanel(this.selected, 'idle');
    this.ui.banner('ENEMY ACTIVITY', '', 'enemy');
    await wait(1.1);
    await enemyTurn(this);
    if (this.over) return;
    this.startPlayerTurn();
  }

  startPlayerTurn() {
    this.turn++;
    for (const s of this.squad) if (s.alive) { s.tu = s.maxTu; s.overwatch = false; }
    this.phase = 'player';
    this.busy = false;
    this.world.computeVisibility(this.squad);
    this.updateEnemyVis();
    this.updateObjective();
    this.ui.banner(`TURN ${this.turn}`, 'LANTERN TEAM');
    const s = this.selected && this.selected.alive ? this.selected : this.squad.find((x) => x.alive);
    this.select(s);
  }

  checkEnd() {
    if (this.over) return true;
    if (this.squad.every((s) => !s.alive)) {
      this.gameOver(false);
      return true;
    }
    return false;
  }

  gameOver(win) {
    if (this.over) return;
    this.over = true;
    this.phase = 'over';
    this.busy = true;
    this.exitAim();
    this.clearHover();
    const alive = this.squad.filter((s) => s.alive);
    const st = this.stats;
    const body = `<p>${win ? `The V-7 case is aboard. ${alive.length} of 4 operatives made it out of Ashford Hollow.` : 'Lantern Team has been wiped out. Ashford Hollow keeps its secrets.'}</p>
      <p>Turns: <b>${this.turn}</b> · Kills: <b>${st.kills}</b> · Headshots: <b>${st.headshots}</b> · Rounds fired: <b>${st.shots}</b></p>
      <p>${this.squad.map((s) => `${s.name}: ${s.alive ? '<b style="color:#6cff8a">survived</b>' : '<b style="color:#ff4a3d">KIA</b>'}`).join('<br>')}</p>`;
    setTimeout(() => this.ui.endScreen(win ? 'MISSION<br><span>COMPLETE</span>' : 'MISSION<br><span>FAILED</span>', body), 1200);
    if (win) { sfx.pickup(); this.ui.banner('EXTRACTED', 'MISSION COMPLETE'); }
  }
}
