import * as THREE from 'three';
import { hexToWorld, offsetToAxial, key, DIRS, hexDist, SQRT3 } from './hex.js';
import { ConvexCollider, rayConvex, rayCapsule, raySphere } from './collision.js';
import { mat } from './units.js';

// Legend: # wall  r wall+alarm beacon  = low wall  c crate  b fuel barrel  v car  t dead tree  p pillar
//         l lamp post  d desk  . ground  , interior floor  E extraction  S squad start  X enemy spawn
//         Z shambler  H hound  P spitter  B brute  a ammo  m medkit  K sample case
export const MAP = [
  '################################',
  '#..t.....t..#,,,,,,,#,,,,,,,,,,#',
  '#.....X.....#,,d,,,,r,,,,K,,,,,#',
  '#.t.........#,,,,,,,#,,d,,,,d,,#',
  '#....EEEE...#,,,Z,,,,,,,,,B,,,,#',
  '#...EEEEE..l#,,,,,,,#,,,,,,,,,,#',
  '#....EEEE...###,,####,,,,,,,,,,#',
  '#.......t...#,,,,,,,#####,,##r##',
  '#.t.........#,p,,,,p,,,,,,,,,,X#',
  '#.....c.....,,,,,,,,,,,,P,,,,,,#',
  '#....cc..t..#,p,,,,p,,,#,,,,d,,#',
  '#...........######,,####,,,,,,,#',
  '#..t...=.........c..l..#####,###',
  '#......=...v.v...cc.........b..#',
  '#..Z...=...v.v.......Z.........#',
  '#.....l........==....b...vv....#',
  '#...b....c.........H.....vv..t.#',
  '#......cc....vv...........m....#',
  '#..a.........vv......===.......#',
  '#.......Z..........c.....l.....#',
  '#...t.......===........t...t...#',
  '#......m...........a...........#',
  '#..X.........SSSS..............#',
  '################################',
];

const WALL_H = 2.5;
const PERIMETER_H = 0.7;
const ENTITY = { Z: 'zombie', H: 'hound', P: 'spitter', B: 'brute' };
const ITEMS = { a: 'ammo', m: 'medkit', K: 'sample' };

export class World {
  constructor(scene) {
    this.scene = scene;
    this.cells = new Map();
    this.cellList = [];
    this.obstacles = [];
    this.colliders = [];
    this.units = [];
    this.items = [];
    this.spawns = [];
    this.extraction = [];
    this.squadStart = [];
    this.enemyStart = [];
    this.lights = [];
    this.build();
  }

  cell(q, r) {
    return this.cells.get(key(q, r));
  }

  build() {
    const rows = MAP.length, cols = MAP[0].length;
    const raw = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const ch = MAP[row][col];
        const { q, r } = offsetToAxial(col, row);
        const { x, z } = hexToWorld(q, r);
        const c = { q, r, col, row, x, z, ch, obstacle: null, item: null, floor: 'out', vis: 0, seen: false, idx: 0 };
        this.cells.set(key(q, r), c);
        this.cellList.push(c);
        raw.push(c);
      }
    }
    // floor type: interior if char is ',' or entity with mostly interior neighbours
    for (const c of raw) {
      if (c.ch === ',') c.floor = 'in';
      else if (c.ch === 'E') c.floor = 'pad';
      else if ('.#r=cbvtpl'.includes(c.ch)) c.floor = c.ch === 'd' ? 'in' : 'out';
      else {
        const n = this.neighborCells(c).filter((o) => o.ch === ',' || o.ch === 'd').length;
        c.floor = n >= 3 ? 'in' : 'out';
      }
      if (c.ch === 'd') c.floor = 'in';
    }
    this.minX = Math.min(...raw.map((c) => c.x));
    this.maxX = Math.max(...raw.map((c) => c.x));
    this.minZ = Math.min(...raw.map((c) => c.z));
    this.maxZ = Math.max(...raw.map((c) => c.z));

    this.buildFloor();
    this.buildObstacles();

    for (const c of raw) {
      if (ENTITY[c.ch]) this.enemyStart.push({ kind: ENTITY[c.ch], cell: c });
      if (ITEMS[c.ch]) this.addItem(c, ITEMS[c.ch]);
      if (c.ch === 'S') this.squadStart.push(c);
      if (c.ch === 'X') this.spawns.push(c);
      if (c.ch === 'E') this.extraction.push(c);
    }
    this.buildExtraction();
  }

  neighborCells(c) {
    const out = [];
    for (const [dq, dr] of DIRS) {
      const n = this.cell(c.q + dq, c.r + dr);
      if (n) out.push(n);
    }
    return out;
  }

  buildFloor() {
    const geo = new THREE.CylinderGeometry(0.97, 0.97, 0.12, 6);
    geo.translate(0, -0.06, 0);
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.0 });
    const inst = new THREE.InstancedMesh(geo, m, this.cellList.length);
    inst.receiveShadow = true;
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    this.cellList.forEach((c, i) => {
      c.idx = i;
      mtx.makeTranslation(c.x, 0, c.z);
      inst.setMatrixAt(i, mtx);
      const v = Math.random() * 0.06;
      if (c.floor === 'in') col.setRGB(0.36 + v, 0.37 + v, 0.39 + v * 0.5);
      else if (c.floor === 'pad') col.setRGB(0.32, 0.33, 0.3);
      else {
        const g = Math.random();
        if (g < 0.35) col.setRGB(0.2 + v, 0.24 + v, 0.15 + v); // dead grass
        else col.setRGB(0.24 + v, 0.24 + v, 0.25 + v); // cracked asphalt
      }
      c.baseColor = col.clone();
      inst.setColorAt(i, col.clone().multiplyScalar(0.15));
    });
    this.scene.add(inst);
    this.floorMesh = inst;
    // dark underlay so seams read as a grid
    const under = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: 0x030405 }));
    under.rotation.x = -Math.PI / 2;
    under.position.set((this.minX + this.maxX) / 2, -0.13, (this.minZ + this.maxZ) / 2);
    this.scene.add(under);
  }

  addObstacle(ob) {
    ob.destroyed = false;
    this.obstacles.push(ob);
    for (const c of ob.cells) c.obstacle = ob;
    for (const col of ob.colliders) this.colliders.push(col);
    if (ob.mesh) this.scene.add(ob.mesh);
    return ob;
  }

  buildObstacles() {
    const wallCells = this.cellList.filter((c) => c.ch === '#' || c.ch === 'r');
    const wallGeo = new THREE.CylinderGeometry(1, 1, WALL_H, 6);
    wallGeo.translate(0, WALL_H / 2, 0);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallCells.length);
    walls.castShadow = true;
    walls.receiveShadow = true;
    const capGeo = new THREE.CylinderGeometry(1, 1, 0.08, 6);
    const caps = new THREE.InstancedMesh(capGeo, mat(0x1c1e21), wallCells.length);
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    const rows = MAP.length, cols = MAP[0].length;
    const q = new THREE.Quaternion();
    wallCells.forEach((c, i) => {
      // the map's outer boundary is a low barrier so it never hides the squad from the camera
      const edge = c.row === 0 || c.row === rows - 1 || c.col === 0 || c.col === cols - 1;
      const h = edge ? PERIMETER_H : WALL_H;
      mtx.compose(new THREE.Vector3(c.x, 0, c.z), q, new THREE.Vector3(1, h / WALL_H, 1));
      walls.setMatrixAt(i, mtx);
      mtx.makeTranslation(c.x, h + 0.04, c.z);
      caps.setMatrixAt(i, mtx);
      const interior = this.neighborCells(c).some((n) => n.ch === ',');
      const v = Math.random() * 0.05;
      if (interior) col.setRGB(0.42 + v, 0.4 + v, 0.37 + v);
      else col.setRGB(0.3 + v, 0.3 + v, 0.31 + v);
      walls.setColorAt(i, col);
      this.addObstacle({ kind: 'wall', cells: [c], colliders: [ConvexCollider.hexPrism(c.x, c.z, 1, -0.1, h, null)], hp: Infinity, cover: edge ? 'half' : 'full', mat: 'stone' });
      if (c.ch === 'r') this.addBeacon(c);
    });
    for (const ob of this.obstacles) ob.colliders.forEach((k) => (k.owner = ob));
    this.scene.add(walls, caps);

    const seen = new Set();
    for (const c of this.cellList) {
      switch (c.ch) {
        case '=': this.addLowWall(c); break;
        case 'c': this.addCrate(c); break;
        case 'b': this.addBarrel(c); break;
        case 't': this.addTree(c); break;
        case 'p': this.addPillar(c); break;
        case 'l': this.addLamp(c); break;
        case 'd': this.addDesk(c); break;
        case 'v': if (!seen.has(c)) this.addCar(c, seen); break;
      }
    }
    // interior strip lights
    for (const [col, row, color] of [[16, 3, 0xbfd8ff], [17, 9, 0xbfd8ff], [26, 9, 0xff4433], [24, 3, 0xbfd8ff]]) {
      const { q, r } = offsetToAxial(col, row);
      const { x, z } = hexToWorld(q, r);
      const L = new THREE.PointLight(color, 14, 11, 1.5);
      L.position.set(x, 2.4, z);
      this.scene.add(L);
      this.lights.push({ light: L, base: 14, flicker: color !== 0xff4433 ? 0.15 : 0, pulse: color === 0xff4433 });
    }
  }

  finishObstacle(ob) {
    ob.colliders.forEach((k) => (k.owner = ob));
    ob.maxHp = ob.hp;
    return this.addObstacle(ob);
  }

  addLowWall(c) {
    const g = new THREE.Group();
    g.position.set(c.x, 0, c.z);
    const sand = mat(0x6b604a, { roughness: 1 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.45, 2, 6).rotateZ(Math.PI / 2), sand);
      b.position.set(Math.cos(a) * 0.45, 0.2 + (i % 3) * 0.28, Math.sin(a) * 0.45);
      b.rotation.y = -a + Math.PI / 2;
      b.castShadow = b.receiveShadow = true;
      g.add(b);
    }
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.9, 0.9, 6), sand);
    core.position.y = 0.45;
    core.castShadow = core.receiveShadow = true;
    g.add(core);
    this.finishObstacle({ kind: 'sandbags', cells: [c], mesh: g, colliders: [ConvexCollider.hexPrism(c.x, c.z, 0.92, 0, 0.95, null)], hp: 160, cover: 'half', mat: 'dirt' });
  }

  addCrate(c) {
    const a = Math.random() * 0.6 - 0.3;
    const s = 1.05 + Math.random() * 0.15;
    const h = 0.95 + Math.random() * 0.15;
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, h, s), mat(0x6e5232, { roughness: 0.9 }));
    m.position.set(c.x, h / 2, c.z);
    m.rotation.y = a;
    m.castShadow = m.receiveShadow = true;
    const band = new THREE.Mesh(new THREE.BoxGeometry(s + 0.02, 0.08, s + 0.02), mat(0x3a2a18));
    band.position.y = h * 0.25;
    m.add(band);
    const band2 = band.clone();
    band2.position.y = -h * 0.25;
    m.add(band2);
    this.finishObstacle({ kind: 'crate', cells: [c], mesh: m, colliders: [ConvexCollider.box(c.x, c.z, a, s / 2, s / 2, 0, h, null)], hp: 55, cover: 'half', mat: 'wood' });
  }

  addBarrel(c) {
    const g = new THREE.Group();
    g.position.set(c.x, 0, c.z);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 1.0, 12), mat(0x9c2a1a, { roughness: 0.55, metalness: 0.4 }));
    m.position.y = 0.5;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.12, 12), mat(0xd8b020, { emissive: 0x3a2a00 }));
    stripe.position.y = 0.6;
    g.add(stripe);
    this.finishObstacle({ kind: 'barrel', cells: [c], mesh: g, colliders: [ConvexCollider.cylinder(c.x, c.z, 0.36, 0, 1.0, null)], hp: 12, cover: 'half', mat: 'metal', explosive: true });
  }

  addTree(c) {
    const g = new THREE.Group();
    g.position.set(c.x + (Math.random() - 0.5) * 0.3, 0, c.z + (Math.random() - 0.5) * 0.3);
    const bark = mat(0x2a221c, { roughness: 1 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.3, 4.2, 7), bark);
    trunk.position.y = 2.1;
    trunk.castShadow = true;
    g.add(trunk);
    for (let i = 0; i < 5; i++) {
      const len = 1 + Math.random() * 1.3;
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.08, len, 5), bark);
      br.geometry.translate(0, len / 2, 0);
      br.position.y = 1.8 + i * 0.45;
      br.rotation.set(0.6 + Math.random() * 0.6, Math.random() * Math.PI * 2, 0, 'YXZ');
      br.castShadow = true;
      g.add(br);
    }
    g.rotation.y = Math.random() * 6;
    this.finishObstacle({ kind: 'tree', cells: [c], mesh: g, colliders: [ConvexCollider.cylinder(g.position.x, g.position.z, 0.26, 0, 4.2, null)], hp: Infinity, cover: 'half', mat: 'wood' });
  }

  addPillar(c) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, WALL_H, 10), mat(0x55524c));
    m.position.set(c.x, WALL_H / 2, c.z);
    m.castShadow = m.receiveShadow = true;
    this.finishObstacle({ kind: 'pillar', cells: [c], mesh: m, colliders: [ConvexCollider.cylinder(c.x, c.z, 0.4, 0, WALL_H, null)], hp: Infinity, cover: 'full', mat: 'stone' });
  }

  addDesk(c) {
    const a = Math.random() * Math.PI;
    const g = new THREE.Group();
    g.position.set(c.x, 0, c.z);
    g.rotation.y = a;
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.75), mat(0x7b7f86, { metalness: 0.5, roughness: 0.5 }));
    top.position.y = 0.8;
    const front = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 0.05), mat(0x5a5e66, { metalness: 0.4 }));
    front.position.set(0, 0.42, 0.33);
    const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.32, 0.05), mat(0x111111, { emissive: 0x1a5070, emissiveIntensity: 1.5 }));
    monitor.position.set(-0.2, 1.05, -0.1);
    g.add(top, front, monitor);
    g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    this.finishObstacle({ kind: 'desk', cells: [c], mesh: g, colliders: [ConvexCollider.box(c.x, c.z, a, 0.7, 0.38, 0, 0.84, null)], hp: 45, cover: 'half', mat: 'metal' });
  }

  addLamp(c) {
    const g = new THREE.Group();
    g.position.set(c.x, 0, c.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 3.6, 8), mat(0x222428, { metalness: 0.6 }));
    pole.position.y = 1.8;
    pole.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.6), mat(0x222428));
    head.position.set(0, 3.6, 0.2);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.4), mat(0xffb060, { emissive: 0xffa040, emissiveIntensity: 4 }).clone());
    bulb.position.set(0, 3.53, 0.25);
    g.add(pole, head, bulb);
    const L = new THREE.PointLight(0xffa850, 30, 14, 1.4);
    L.position.set(c.x, 3.3, c.z + 0.25);
    this.scene.add(L);
    this.lights.push({ light: L, base: 30, flicker: c.col === 6 ? 0.6 : 0.05, bulb });
    this.finishObstacle({ kind: 'lamp', cells: [c], mesh: g, colliders: [ConvexCollider.cylinder(c.x, c.z, 0.1, 0, 3.6, null)], hp: Infinity, cover: 'none', mat: 'metal' });
  }

  addCar(c, seen) {
    seen.add(c);
    const order = [0, 5, 4, 1, 2, 3];
    let other = null;
    for (const i of order) {
      const n = this.cell(c.q + DIRS[i][0], c.r + DIRS[i][1]);
      if (n && n.ch === 'v' && !seen.has(n)) { other = n; break; }
    }
    const cells = other ? [c, other] : [c];
    if (other) seen.add(other);
    const cx = other ? (c.x + other.x) / 2 : c.x;
    const cz = other ? (c.z + other.z) / 2 : c.z;
    const ang = other ? Math.atan2(other.x - c.x, other.z - c.z) : 0; // car's local z points along the pair
    const len = other ? 3.4 : 1.6, wid = 1.55;
    const colors = [0x3a4a5a, 0x5a2a22, 0x4a4a40, 0x2a3a2a, 0x6a6a6a];
    const paint = mat(colors[(Math.random() * colors.length) | 0], { metalness: 0.5, roughness: 0.6 });
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = ang + (Math.random() - 0.5) * 0.12;
    const lower = new THREE.Mesh(new THREE.BoxGeometry(wid, 0.7, len), paint);
    lower.position.y = 0.55;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(wid * 0.9, 0.55, len * 0.5), paint);
    cabin.position.set(0, 1.15, -len * 0.05);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(wid * 0.92, 0.4, len * 0.42), mat(0x0c1218, { metalness: 0.9, roughness: 0.15 }));
    glass.position.set(0, 1.17, -len * 0.05);
    g.add(lower, cabin, glass);
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.25, 10).rotateZ(Math.PI / 2), mat(0x111111));
      w.position.set((x * wid) / 2, 0.33, z * len * 0.32);
      g.add(w);
    }
    if (Math.random() < 0.5) {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.05), mat(0xffeeaa, { emissive: 0xffeeaa, emissiveIntensity: 2 }));
      head.position.set(0.45, 0.65, len / 2 + 0.01);
      g.add(head);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    const colliders = [
      ConvexCollider.box(cx, cz, g.rotation.y, wid / 2, len / 2, 0, 0.9, null),
      ConvexCollider.box(cx, cz, g.rotation.y, (wid * 0.9) / 2, len * 0.25, 0.9, 1.42, null),
    ];
    this.finishObstacle({ kind: 'car', cells, mesh: g, colliders, hp: Infinity, cover: 'half', mat: 'metal' });
  }

  addBeacon(c) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.25, 10), mat(0xff2010, { emissive: 0xff1000, emissiveIntensity: 3 }).clone());
    m.position.set(c.x, WALL_H + 0.2, c.z);
    this.scene.add(m);
    const L = new THREE.PointLight(0xff2200, 18, 12, 1.4);
    L.position.set(c.x, WALL_H + 0.6, c.z);
    this.scene.add(L);
    this.lights.push({ light: L, base: 18, pulse: true, bulb: m });
  }

  addItem(c, type) {
    const g = new THREE.Group();
    g.position.set(c.x, 0, c.z);
    let color;
    if (type === 'ammo') {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.32), mat(0x3d4a2a));
      b.position.y = 0.14;
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.04, 0.34), mat(0x2a331c));
      lid.position.y = 0.3;
      g.add(b, lid);
      color = 0xffd050;
    } else if (type === 'medkit') {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.22, 0.32), mat(0xe8e8e0));
      b.position.y = 0.11;
      const x1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.01, 0.06), mat(0xd02020, { emissive: 0x500000 }));
      x1.position.y = 0.225;
      const x2 = x1.clone();
      x2.rotation.y = Math.PI / 2;
      g.add(b, x1, x2);
      color = 0x60ff80;
    } else {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.38, 0.14), mat(0xb8bcc4, { metalness: 0.8, roughness: 0.3 }));
      b.position.y = 0.3;
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.15), mat(0x40e0ff, { emissive: 0x40e0ff, emissiveIntensity: 3 }));
      glow.position.y = 0.34;
      g.add(b, glow);
      color = 0x40e0ff;
      const L = new THREE.PointLight(0x40e0ff, 4, 5, 1.5);
      L.position.y = 0.8;
      g.add(L);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.rotation.z = Math.PI / 6;
    ring.position.y = 0.02;
    g.add(ring);
    g.traverse((o) => { if (o.isMesh && o !== ring) o.castShadow = true; });
    g.visible = false;
    this.scene.add(g);
    const it = { type, cell: c, mesh: g, ring };
    c.item = it;
    this.items.push(it);
    return it;
  }

  removeItem(it) {
    this.scene.remove(it.mesh);
    it.cell.item = null;
    this.items.splice(this.items.indexOf(it), 1);
  }

  buildExtraction() {
    const cx = this.extraction.reduce((s, c) => s + c.x, 0) / this.extraction.length;
    const cz = this.extraction.reduce((s, c) => s + c.z, 0) / this.extraction.length;
    this.extractCenter = new THREE.Vector3(cx, 0, cz);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.9, 40), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.55, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cx, 0.015, cz);
    this.scene.add(ring);
    const hMat = new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.55, depthWrite: false });
    for (const [w, d, x] of [[0.3, 2.2, -0.7], [0.3, 2.2, 0.7], [1.4, 0.3, 0]]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(w, d), hMat);
      b.rotation.x = -Math.PI / 2;
      b.position.set(cx + x, 0.016, cz);
      this.scene.add(b);
    }
    const flare = new THREE.PointLight(0x40ff60, 10, 10, 1.3);
    flare.position.set(cx + 2, 0.6, cz + 1);
    this.scene.add(flare);
    this.lights.push({ light: flare, base: 10, flicker: 0.35, flare: true });
    this.flarePos = new THREE.Vector3(cx + 2, 0.15, cz + 1);
  }

  // ---------- queries ----------
  unitAt(c) {
    for (const u of this.units) if (u.alive && u.q === c.q && u.r === c.r) return u;
    return null;
  }

  passable(c, mover) {
    if (!c || c.obstacle) return false;
    const u = this.unitAt(c);
    return !u || u === mover;
  }

  // Dijkstra flood: returns Map key -> {cost, prev, cell}
  reachable(unit, budget) {
    const start = this.cell(unit.q, unit.r);
    const res = new Map([[key(start.q, start.r), { cost: 0, prev: null, cell: start }]]);
    const frontier = [start];
    const step = unit.moveCost;
    while (frontier.length) {
      frontier.sort((a, b) => res.get(key(a.q, a.r)).cost - res.get(key(b.q, b.r)).cost);
      const c = frontier.shift();
      const cc = res.get(key(c.q, c.r)).cost;
      for (const n of this.neighborCells(c)) {
        if (!this.passable(n, unit)) continue;
        const nc = cc + step;
        if (nc > budget) continue;
        const k = key(n.q, n.r);
        const ex = res.get(k);
        if (!ex || ex.cost > nc) {
          res.set(k, { cost: nc, prev: c, cell: n });
          frontier.push(n);
        }
      }
    }
    return res;
  }

  pathFromReach(reach, cell) {
    const path = [];
    let k = key(cell.q, cell.r);
    let e = reach.get(k);
    while (e && e.prev) {
      path.unshift(e.cell);
      e = reach.get(key(e.prev.q, e.prev.r));
    }
    return path;
  }

  // A* toward any cell satisfying goal(); `ignoreUnits` lets enemies plan through crowds.
  findPath(unit, goal, target, ignoreUnits = false, limit = 4000) {
    const start = this.cell(unit.q, unit.r);
    const open = [start];
    const g = new Map([[start, 0]]);
    const prev = new Map();
    const h = (c) => hexDist(c, target);
    let iter = 0;
    while (open.length && iter++ < limit) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (g.get(open[i]) + h(open[i]) < g.get(open[bi]) + h(open[bi])) bi = i;
      const c = open.splice(bi, 1)[0];
      if (goal(c)) {
        const path = [];
        let x = c;
        while (x !== start) { path.unshift(x); x = prev.get(x); }
        return path;
      }
      for (const n of this.neighborCells(c)) {
        if (n.obstacle) continue;
        if (!ignoreUnits && !this.passable(n, unit)) continue;
        const ng = g.get(c) + 1;
        if (!g.has(n) || ng < g.get(n)) {
          g.set(n, ng);
          prev.set(n, c);
          if (!open.includes(n)) open.push(n);
        }
      }
    }
    return null;
  }

  // Cover around a cell: list of {dir, type, x, z, angle}
  coverAt(c) {
    const out = [];
    DIRS.forEach(([dq, dr], i) => {
      const n = this.cell(c.q + dq, c.r + dr);
      if (n && n.obstacle && n.obstacle.cover !== 'none') {
        out.push({ dir: i, type: n.obstacle.cover, x: (c.x + n.x) / 2, z: (c.z + n.z) / 2, angle: Math.atan2(n.x - c.x, n.z - c.z) });
      }
    });
    return out;
  }

  // ---------- ballistics ----------
  refreshHitboxes() {
    for (const u of this.units) if (u.hasColliders()) u.updateHitboxes();
  }

  // Nearest hit along a ray against obstacles, unit hitboxes and the ground.
  trace(o, d, maxT, { ignore = null, units = true, ground = true, obstacles = true } = {}) {
    let best = { t: maxT, type: 'none' };
    if (obstacles) {
      for (const c of this.colliders) {
        const r = rayConvex(o, d, c, best.t);
        if (r && r.t < best.t) best = { t: r.t, type: 'obstacle', obstacle: c.owner, normal: { x: r.nx, y: r.ny, z: r.nz } };
      }
    }
    if (units) {
      for (const u of this.units) {
        if (u === ignore || !u.hasColliders()) continue;
        const bt = raySphere(o, d, u.center, u.bound);
        if (bt === null || bt > best.t + u.bound * 2) continue;
        for (const hb of u.hitboxes) {
          if (u.state === 'down' && hb.part !== 'head' && hb.part !== 'torso') continue;
          const t = rayCapsule(o, d, hb.wa, hb.wb, hb.r);
          if (t !== null && t < best.t) best = { t, type: 'unit', unit: u, part: hb.part, normal: { x: -d.x, y: -d.y, z: -d.z } };
        }
      }
    }
    if (ground && d.y < -1e-6) {
      const t = -o.y / d.y;
      if (t >= 0 && t < best.t) best = { t, type: 'ground', normal: { x: 0, y: 1, z: 0 } };
    }
    best.point = { x: o.x + d.x * best.t, y: o.y + d.y * best.t, z: o.z + d.z * best.t };
    return best;
  }

  // Obstacle-only line of sight between two points.
  los(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const dist = Math.hypot(dx, dy, dz);
    const d = { x: dx / dist, y: dy / dist, z: dz / dist };
    for (const c of this.colliders) {
      if (c.owner.kind === 'lamp' || c.owner.kind === 'tree') continue;
      const r = rayConvex(a, d, c, dist - 0.05);
      if (r && r.t > 0.05) return false;
    }
    return true;
  }

  canSee(viewer, target, range = 17) {
    const e = viewer.eye();
    const p = target.pos();
    const dist = Math.hypot(p.x - e.x, p.z - e.z);
    if (dist > range) return false;
    if (hexDist(viewer, target) <= 1) return true;
    target.updateHitboxes();
    const hb = target.hitboxes;
    return this.los(e, hb[0].wa) || this.los(e, hb[1].wb) || this.los(e, hb[1].wa);
  }

  // Updates per-cell visibility and fog colouring from the squad's viewpoints.
  computeVisibility(squad, range = 17) {
    const col = new THREE.Color();
    for (const c of this.cellList) {
      let v = false;
      for (const s of squad) {
        if (!s.alive) continue;
        const e = s.eye();
        const d = Math.hypot(c.x - e.x, c.z - e.z);
        if (d > range) continue;
        if (d < 1.6 || this.los(e, { x: c.x, y: 0.6, z: c.z })) { v = true; break; }
        if (c.obstacle && this.los(e, { x: c.x, y: c.obstacle.colliders[0].ymax + 0.05, z: c.z })) { v = true; break; }
      }
      c.vis = v;
      if (v) c.seen = true;
      const k = v ? 1 : c.seen ? 0.42 : 0.12;
      this.floorMesh.setColorAt(c.idx, col.copy(c.baseColor).multiplyScalar(k));
      if (c.item) c.item.mesh.visible = c.seen;
    }
    this.floorMesh.instanceColor.needsUpdate = true;
  }

  // ---------- destruction ----------
  destroyObstacle(ob) {
    if (ob.destroyed) return;
    ob.destroyed = true;
    if (ob.mesh) this.scene.remove(ob.mesh);
    for (const c of ob.cells) c.obstacle = null;
    this.colliders = this.colliders.filter((k) => k.owner !== ob);
    // leave some rubble
    if (ob.kind === 'crate' || ob.kind === 'desk' || ob.kind === 'sandbags') {
      const c = ob.cells[0];
      for (let i = 0; i < 5; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.2 + Math.random() * 0.3, 0.06, 0.1 + Math.random() * 0.2), mat(ob.kind === 'crate' ? 0x4a3622 : ob.kind === 'sandbags' ? 0x5a5040 : 0x55585e));
        m.position.set(c.x + (Math.random() - 0.5) * 1.2, 0.03, c.z + (Math.random() - 0.5) * 1.2);
        m.rotation.y = Math.random() * 3;
        m.receiveShadow = true;
        this.scene.add(m);
      }
    }
  }

  updateLights(t) {
    for (const L of this.lights) {
      let k = 1;
      if (L.pulse) k = 0.25 + 0.75 * Math.max(0, Math.sin(t * 4));
      if (L.flicker && Math.random() < L.flicker * 0.15) k *= Math.random() * 0.6;
      if (L.flare) k = 0.75 + Math.sin(t * 23) * 0.12 + Math.sin(t * 7.3) * 0.13;
      L.light.intensity = L.base * k;
      if (L.bulb) L.bulb.material.emissiveIntensity = 0.5 + 3 * k;
    }
  }
}

export { SQRT3 };
