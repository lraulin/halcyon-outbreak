import * as THREE from 'three';
import { makeWeapon } from './weapons.js';

const matCache = new Map();
export function mat(color, o = {}) {
  const k = color + JSON.stringify(o);
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, ...o }));
  return matCache.get(k);
}

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 3, 8);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const sphere = (r, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);

export const PART_LABEL = { head: 'Head', torso: 'Torso', armL: 'L. Arm', armR: 'R. Arm', legL: 'L. Leg', legR: 'R. Leg' };
export const PART_MULT = { head: 1.5, torso: 1, armL: 0.8, armR: 0.8, legL: 0.8, legR: 0.8 };

export const SQUAD = [
  { name: 'Mara Voss', role: 'Point', weapons: ['carbine', 'pistol'], grenades: 1, medkits: 0, acc: 1.0, band: 0x4aa8ff },
  { name: 'Dex Okafor', role: 'Breacher', weapons: ['shotgun', 'pistol'], grenades: 2, medkits: 0, acc: 1.1, band: 0xff9a3c },
  { name: 'Ilya Brandt', role: 'Marksman', weapons: ['dmr', 'pistol'], grenades: 0, medkits: 0, acc: 0.75, band: 0x6cff8a },
  { name: 'June Castellanos', role: 'Medic', weapons: ['pdw', 'pistol'], grenades: 1, medkits: 3, acc: 1.0, band: 0xd17bff },
];

export const ENEMIES = {
  zombie: {
    name: 'Shambler', hp: 90, tu: 6, notice: 9, scale: 1,
    parts: { head: 32, torso: 90, armL: 40, armR: 40, legL: 45, legR: 45 },
    armor: {}, melee: { dmg: [20, 30], tu: 4, acc: 0.8, verb: 'bites' }, reanimate: 0.5,
  },
  hound: {
    name: 'Rot Hound', hp: 55, tu: 14, notice: 14, scale: 1,
    parts: { head: 26, torso: 55, armL: 25, armR: 25, legL: 25, legR: 25 },
    armor: {}, melee: { dmg: [12, 18], tu: 4, acc: 0.85, verb: 'mauls' }, reanimate: 0,
  },
  spitter: {
    name: 'Spitter', hp: 80, tu: 6, notice: 11, scale: 1.05,
    parts: { head: 30, torso: 80, armL: 35, armR: 35, legL: 40, legR: 40 },
    armor: {}, melee: { dmg: [10, 16], tu: 4, acc: 0.75, verb: 'claws' },
    ranged: { dmg: [16, 24], range: 11, tu: 6, splash: 1.5 }, reanimate: 0.3,
  },
  brute: {
    name: 'Brute', hp: 340, tu: 8, notice: 8, scale: 1.45,
    parts: { head: 110, torso: 340, armL: 120, armR: 140, legL: 140, legR: 140 },
    armor: { torso: 12, armR: 6, legL: 4, legR: 4 }, melee: { dmg: [42, 58], tu: 6, acc: 0.8, verb: 'smashes' }, reanimate: 0,
  },
};

function buildHumanoid({ skin, top, bottom, scale = 1, bloated = false, brute = false }) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  root.scale.setScalar(scale);
  const hips = new THREE.Group();
  hips.position.y = 0.95;
  body.add(hips);

  const legs = [];
  for (const side of [1, -1]) {
    const leg = new THREE.Group();
    leg.position.set(0.11 * side, 0, 0);
    leg.add(mesh(capsule(0.085, 0.72), mat(bottom), 0, -0.45, 0));
    leg.add(mesh(box(0.13, 0.08, 0.26), mat(0x1a1a1a), 0, -0.9, 0.05));
    hips.add(leg);
    legs.push(leg);
  }
  hips.add(mesh(box(0.36, 0.18, 0.22), mat(bottom), 0, 0, 0));

  const spine = new THREE.Group();
  hips.add(spine);
  if (bloated) {
    spine.add(mesh(sphere(0.34, 12, 10), mat(top), 0, 0.3, 0.04));
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2, y = 0.15 + Math.random() * 0.35;
      spine.add(mesh(sphere(0.06 + Math.random() * 0.05, 6, 5), mat(0xb5c934, { emissive: 0x4a6a00, emissiveIntensity: 0.8 }), Math.sin(a) * 0.3, y, Math.cos(a) * 0.3));
    }
  } else {
    spine.add(mesh(box(0.42, 0.56, 0.24), mat(top), 0, 0.3, 0));
  }
  if (brute) {
    spine.add(mesh(box(0.5, 0.3, 0.3), mat(0x2b2d33, { metalness: 0.6, roughness: 0.5 }), 0, 0.42, 0.04));
    spine.add(mesh(box(0.46, 0.2, 0.28), mat(0x2b2d33, { metalness: 0.6, roughness: 0.5 }), 0, 0.15, 0.02));
    spine.add(mesh(sphere(0.09, 8, 6), mat(0xff3020, { emissive: 0xff1000, emissiveIntensity: 2 }), 0.08, 0.38, -0.13));
  }

  const head = new THREE.Group();
  head.position.y = 0.58;
  spine.add(head);
  head.add(mesh(capsule(0.05, 0.08), mat(skin), 0, 0.0, 0));
  head.add(mesh(sphere(0.125), mat(skin), 0, 0.13, 0.01));

  const arms = [];
  for (const side of [1, -1]) {
    const arm = new THREE.Group();
    arm.position.set(0.26 * side, 0.5, 0);
    const thick = brute && side === -1 ? 0.12 : 0.062;
    arm.add(mesh(capsule(thick, 0.48), mat(side === 1 && !brute ? top : skin), 0, -0.3, 0));
    arm.add(mesh(sphere(thick * 1.1, 6, 5), mat(skin), 0, -0.6, 0));
    if (brute && side === -1) {
      for (let i = 0; i < 3; i++) arm.add(mesh(new THREE.ConeGeometry(0.035, 0.32, 5), mat(0xd8d0bb), (i - 1) * 0.07, -0.78, 0.05).rotateX(Math.PI));
    }
    spine.add(arm);
    arms.push(arm);
  }
  return { root, body, hips, spine, head, armL: arms[0], armR: arms[1], legL: legs[0], legR: legs[1] };
}

function addEyes(head, color = 0xffe080) {
  const m = mat(color, { emissive: color, emissiveIntensity: 3 });
  head.add(mesh(sphere(0.02, 5, 4), m, 0.045, 0.15, 0.11));
  head.add(mesh(sphere(0.02, 5, 4), m, -0.045, 0.15, 0.11));
}

function buildGun(id) {
  const g = new THREE.Group();
  const dark = mat(0x1b1d20, { metalness: 0.6, roughness: 0.45 });
  const spec = { carbine: [0.75, 0.07], shotgun: [0.8, 0.08], dmr: [1.0, 0.07], pdw: [0.5, 0.08], pistol: [0.25, 0.06] }[id];
  const [len, th] = spec;
  g.add(mesh(box(th, th * 1.6, len), dark, 0, 0, len / 2 - 0.15));
  g.add(mesh(box(th * 0.9, th * 2.2, 0.08), dark, 0, -th * 1.4, 0.05));
  if (id === 'dmr') g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.28, 8).rotateX(Math.PI / 2), dark, 0, th * 1.4, 0.2));
  if (id === 'shotgun') g.add(mesh(box(th * 1.1, th * 0.8, 0.3), mat(0x4a3420), 0, -th, len * 0.5));
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, len - 0.12);
  g.add(muzzle);
  return { gun: g, muzzle };
}

function buildSoldier(def) {
  const rig = buildHumanoid({ skin: 0xc49a7c, top: 0x262d36, bottom: 0x1f252c });
  const vest = mat(0x313a44, { roughness: 0.7 });
  rig.spine.add(mesh(box(0.46, 0.4, 0.3), vest, 0, 0.32, 0));
  rig.spine.add(mesh(box(0.34, 0.4, 0.16), mat(0x2a2f25), 0, 0.3, -0.2));
  rig.head.add(mesh(new THREE.SphereGeometry(0.145, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(0x2b3138), 0, 0.15, 0));
  rig.spine.add(mesh(box(0.08, 0.06, 0.26), mat(def.band, { emissive: def.band, emissiveIntensity: 1.6 }), 0.27, 0.52, 0));
  rig.armR.rotation.set(-1.25, 0, 0.35);
  rig.armL.rotation.set(-1.4, 0, -0.65);
  const light = new THREE.SpotLight(0xfff1d6, 16, 18, 0.45, 0.6, 1.3);
  light.position.set(-0.1, 0.38, 0.5);
  const tgt = new THREE.Object3D();
  tgt.position.set(-0.1, -0.6, 6);
  rig.spine.add(light, tgt);
  light.target = tgt;
  rig.flashlight = light;
  return rig;
}

function buildZombie() {
  const shirts = [0x4a4038, 0x5a5a62, 0x3c4a5c, 0x6b5a45, 0x8a8a80, 0x4d3333];
  const rig = buildHumanoid({ skin: 0x7d8a6e, top: shirts[(Math.random() * shirts.length) | 0], bottom: 0x2e2b28 });
  addEyes(rig.head);
  for (let i = 0; i < 3; i++) {
    rig.spine.add(mesh(box(0.12 + Math.random() * 0.1, 0.1 + Math.random() * 0.1, 0.02), mat(0x4a0606), (Math.random() - 0.5) * 0.3, 0.15 + Math.random() * 0.35, 0.125));
  }
  rig.spine.rotation.x = 0.3;
  rig.head.rotation.z = 0.25;
  return rig;
}

function buildSpitter() {
  const rig = buildHumanoid({ skin: 0x8d9568, top: 0x8f9a5c, bottom: 0x3a3a2a, scale: 1.05, bloated: true });
  addEyes(rig.head, 0xccff40);
  rig.head.add(mesh(sphere(0.05, 6, 5), mat(0x2a0000), 0, 0.06, 0.11));
  rig.spine.rotation.x = 0.2;
  return rig;
}

function buildBrute() {
  const rig = buildHumanoid({ skin: 0x8f8296, top: 0x8f8296, bottom: 0x2a2629, scale: 1.45, brute: true });
  addEyes(rig.head, 0xff4020);
  rig.spine.rotation.x = 0.25;
  rig.head.position.z = 0.06;
  return rig;
}

function buildHound() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const flesh = mat(0x5a2f2a);
  const raw = mat(0x8a2a22, { roughness: 0.5 });
  const spine = new THREE.Group();
  spine.position.y = 0.6;
  body.add(spine);
  spine.add(mesh(capsule(0.19, 0.6).rotateX(Math.PI / 2), flesh, 0, 0, 0));
  spine.add(mesh(capsule(0.1, 0.3).rotateX(Math.PI / 2), raw, 0, 0.12, -0.1));
  for (let i = 0; i < 5; i++) spine.add(mesh(box(0.25, 0.03, 0.03), mat(0xd8cdb0), 0, -0.05, -0.25 + i * 0.12));
  const head = new THREE.Group();
  head.position.set(0, 0.08, 0.5);
  spine.add(head);
  head.add(mesh(box(0.2, 0.2, 0.32), flesh, 0, 0.02, 0.12));
  head.add(mesh(box(0.15, 0.06, 0.2), raw, 0, -0.08, 0.24));
  addEyes(head, 0xff9030);
  const legs = [];
  for (const [x, z] of [[0.13, 0.35], [-0.13, 0.35], [0.13, -0.35], [-0.13, -0.35]]) {
    const leg = new THREE.Group();
    leg.position.set(x, -0.05, z);
    leg.add(mesh(capsule(0.05, 0.38), flesh, 0, -0.25, 0));
    spine.add(leg);
    legs.push(leg);
  }
  const tail = mesh(capsule(0.03, 0.35).rotateX(-0.8), flesh, 0, 0.12, -0.6);
  spine.add(tail);
  return { root, body, spine, head, armL: legs[0], armR: legs[1], legL: legs[2], legR: legs[3], hound: true };
}

const HB_HUMAN = [
  ['head', 'head', [0, 0.13, 0.01], [0, 0.13, 0.01], 0.135],
  ['torso', 'spine', [0, 0.08, 0], [0, 0.48, 0], 0.21],
  ['armL', 'armL', [0, -0.05, 0], [0, -0.6, 0], 0.068],
  ['armR', 'armR', [0, -0.05, 0], [0, -0.6, 0], 0.068],
  ['legL', 'legL', [0, -0.08, 0], [0, -0.86, 0], 0.088],
  ['legR', 'legR', [0, -0.08, 0], [0, -0.86, 0], 0.088],
];
const HB_HOUND = [
  ['head', 'head', [0, 0.02, 0.1], [0, 0.0, 0.24], 0.13],
  ['torso', 'spine', [0, 0, -0.4], [0, 0, 0.4], 0.2],
  ['armL', 'armL', [0, -0.05, 0], [0, -0.45, 0], 0.06],
  ['armR', 'armR', [0, -0.05, 0], [0, -0.45, 0], 0.06],
  ['legL', 'legL', [0, -0.05, 0], [0, -0.45, 0], 0.06],
  ['legR', 'legR', [0, -0.05, 0], [0, -0.45, 0], 0.06],
];

let uid = 0;
export class Unit {
  constructor(kind, opts = {}) {
    this.id = ++uid;
    this.kind = kind;
    this.team = kind === 'soldier' ? 'squad' : 'enemy';
    this.state = 'alive';
    this.q = 0;
    this.r = 0;
    this.flinch = 0;
    this.phase = Math.random() * 10;
    this.t = Math.random() * 10;
    this.moving = false;
    this.yaw = 0;

    if (kind === 'soldier') {
      const d = opts.def;
      this.def = d;
      this.name = d.name;
      this.role = d.role;
      this.maxHp = 100;
      this.maxTu = 12;
      this.acc = d.acc;
      this.weapons = d.weapons.map(makeWeapon);
      this.weaponIdx = 0;
      this.grenades = d.grenades;
      this.medkits = d.medkits;
      this.partMax = { head: 40, torso: 100, armL: 45, armR: 45, legL: 50, legR: 50 };
      this.armor = { head: 3, torso: 6 };
      this.rig = buildSoldier(d);
      this.scale = 1;
      this.overwatch = false;
      this.awake = true;
      this.setGun();
    } else {
      const d = ENEMIES[kind];
      this.def = d;
      this.name = d.name;
      this.maxHp = d.hp;
      this.maxTu = d.tu;
      this.partMax = { ...d.parts };
      this.armor = d.armor;
      this.scale = d.scale;
      this.awake = !!opts.awake;
      this.rig = kind === 'zombie' ? buildZombie() : kind === 'hound' ? buildHound() : kind === 'spitter' ? buildSpitter() : buildBrute();
    }
    this.hp = this.maxHp;
    this.tu = this.maxTu;
    this.parts = {};
    for (const p in this.partMax) this.parts[p] = this.partMax[p];
    this.root = this.rig.root;
    this.root.userData.unit = this;

    const hb = this.rig.hound ? HB_HOUND : HB_HUMAN;
    this.hitboxes = hb.map(([part, node, a, b, r]) => ({
      part, node: this.rig[node], a: new THREE.Vector3(...a), b: new THREE.Vector3(...b), r: r * this.scale,
      wa: new THREE.Vector3(), wb: new THREE.Vector3(),
    }));
    this.center = new THREE.Vector3();
    this.bound = 1.2 * this.scale;
  }

  get alive() { return this.state === 'alive'; }
  get weapon() { return this.weapons[this.weaponIdx]; }
  get crippled() { return this.parts.legL <= 0 || this.parts.legR <= 0; }
  get moveCost() { return this.crippled ? 2 : 1; }
  get accMult() {
    let m = this.acc ?? 1;
    if (this.parts.armL <= 0) m *= 1.35;
    if (this.parts.armR <= 0) m *= 1.5;
    return m;
  }

  setGun() {
    if (this.gun) this.rig.spine.remove(this.gun);
    const { gun, muzzle } = buildGun(this.weapon.id);
    gun.position.set(-0.1, 0.36, 0.28);
    this.rig.spine.add(gun);
    this.gun = gun;
    this.muzzle = muzzle;
    const pistol = this.weapon.id === 'pistol';
    this.rig.armL.rotation.set(pistol ? -1.3 : -1.4, 0, pistol ? -0.85 : -0.65);
  }

  setPos(x, z) {
    this.root.position.set(x, 0, z);
  }

  pos() {
    return this.root.position;
  }

  eye() {
    const p = this.root.position;
    return { x: p.x, y: (this.rig.hound ? 0.75 : 1.6) * this.scale, z: p.z };
  }

  aimPoint(part = 'torso') {
    this.updateHitboxes();
    const h = this.hitboxes.find((x) => x.part === part) || this.hitboxes[1];
    return h.wa.clone().add(h.wb).multiplyScalar(0.5);
  }

  muzzlePos() {
    if (!this.muzzle) return this.eye();
    this.root.updateMatrixWorld(true);
    return this.muzzle.getWorldPosition(new THREE.Vector3());
  }

  updateHitboxes() {
    this.root.updateMatrixWorld(true);
    for (const h of this.hitboxes) {
      h.wa.copy(h.a).applyMatrix4(h.node.matrixWorld);
      h.wb.copy(h.b).applyMatrix4(h.node.matrixWorld);
    }
    // bounding sphere that encloses every hitbox in its current pose (standing or lying)
    const c = this.center.set(0, 0, 0);
    for (const h of this.hitboxes) c.add(h.wa).add(h.wb);
    c.multiplyScalar(1 / (this.hitboxes.length * 2));
    let b = 0;
    for (const h of this.hitboxes) b = Math.max(b, c.distanceTo(h.wa) + h.r, c.distanceTo(h.wb) + h.r);
    this.bound = b;
  }

  hasColliders() {
    return this.state === 'alive' || (this.state === 'down' && this.parts.head > 0);
  }

  faceTowards(x, z) {
    const p = this.root.position;
    this.yaw = Math.atan2(x - p.x, z - p.z);
  }

  update(dt) {
    this.t += dt;
    const rig = this.rig;
    // smooth yaw
    let dy = this.yaw - this.root.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.root.rotation.y += dy * Math.min(1, dt * 10);
    this.flinch = Math.max(0, this.flinch - dt * 3);

    if (this.state === 'alive') {
      if (this.moving) this.phase += dt * (this.kind === 'hound' ? 14 : this.kind === 'soldier' ? 9 : 6);
      const w = this.moving ? 1 : 0;
      const s = Math.sin(this.phase);
      if (rig.hound) {
        rig.armL.rotation.x = s * 0.8 * w;
        rig.armR.rotation.x = Math.sin(this.phase + 0.6) * 0.8 * w;
        rig.legL.rotation.x = -Math.sin(this.phase + 0.3) * 0.8 * w;
        rig.legR.rotation.x = -Math.sin(this.phase + 0.9) * 0.8 * w;
        rig.spine.position.y = 0.6 + Math.abs(s) * 0.06 * w + Math.sin(this.t * 3) * 0.01;
        rig.spine.rotation.x = -this.flinch * 0.5;
      } else {
        const crip = this.crippled ? 0.4 : 1;
        rig.legL.rotation.x = s * 0.55 * w * crip;
        rig.legR.rotation.x = -s * 0.55 * w;
        rig.body.position.y = Math.abs(Math.cos(this.phase)) * 0.04 * w;
        const breathe = Math.sin(this.t * 2.2) * 0.02;
        if (this.kind === 'soldier') {
          rig.spine.rotation.x = (this.aimPitch ?? 0) + breathe - this.flinch * 0.4;
        } else {
          const base = this.kind === 'brute' ? 0.25 : this.kind === 'spitter' ? 0.2 : 0.3;
          rig.spine.rotation.x = base + breathe - this.flinch * 0.5;
          rig.spine.rotation.z = Math.sin(this.t * 1.3 + this.id) * 0.07 + Math.sin(this.phase * 0.5) * 0.1 * w;
          const armBase = this.kind === 'zombie' ? -1.35 : -0.3;
          const lunge = this.lunge || 0;
          if (this.parts.armL > 0) rig.armL.rotation.x = armBase - lunge + Math.sin(this.t * 1.7 + this.id) * 0.12 + s * 0.2 * w;
          else rig.armL.rotation.x = 0.1;
          if (this.parts.armR > 0) rig.armR.rotation.x = armBase - lunge + Math.sin(this.t * 1.5 + this.id * 2) * 0.12 - s * 0.2 * w;
          else rig.armR.rotation.x = 0.1;
          rig.armL.rotation.z = -0.1;
          rig.armR.rotation.z = 0.1;
        }
      }
    } else if (this.state === 'down' && this.rising) {
      // twitch while the virus does its work
      if (Math.random() < dt * 4) {
        rig.armL.rotation.x = -Math.random() * 1.2;
        rig.head.rotation.y = (Math.random() - 0.5) * 0.8;
      }
    }
  }
}
