// Analytic ray tests used by the ballistic simulation. Everything is plain math on {x,y,z}
// so the Monte-Carlo hit preview can fire hundreds of rays per frame cheaply.

// A vertical convex prism described by horizontal slab normals + a vertical extent.
// Hex prisms, rotated boxes and octagonal "cylinders" are all expressed this way.
export class ConvexCollider {
  constructor({ x, z, normals, half, ymin = 0, ymax, owner, bound }) {
    this.x = x;
    this.z = z;
    this.normals = normals; // [[nx, nz], ...] unit vectors
    this.half = half; // half-extent along each normal
    this.ymin = ymin;
    this.ymax = ymax;
    this.owner = owner;
    const b = bound ?? Math.max(...half) * 1.42;
    const hy = (ymax - ymin) / 2;
    this.cy = ymin + hy;
    this.br2 = b * b + hy * hy;
  }

  static hexPrism(x, z, size, ymin, ymax, owner) {
    const ap = (size * SQRT3_2);
    const normals = [0, 60, 120].map((a) => [Math.cos(a * DEG), Math.sin(a * DEG)]);
    return new ConvexCollider({ x, z, normals, half: [ap, ap, ap], ymin, ymax, owner, bound: size });
  }

  static box(x, z, angle, hx, hz, ymin, ymax, owner) {
    const c = Math.cos(angle), s = Math.sin(angle);
    // local x axis -> world (c, -s) for a rotation.y of `angle` in three.js
    const normals = [[c, -s], [s, c]];
    return new ConvexCollider({ x, z, normals, half: [hx, hz], ymin, ymax, owner, bound: Math.hypot(hx, hz) });
  }

  static cylinder(x, z, radius, ymin, ymax, owner) {
    const normals = [0, 45, 90, 135].map((a) => [Math.cos(a * DEG), Math.sin(a * DEG)]);
    return new ConvexCollider({ x, z, normals, half: [radius, radius, radius, radius], ymin, ymax, owner, bound: radius * 1.09 });
  }

  contains(px, py, pz) {
    if (py < this.ymin || py > this.ymax) return false;
    for (let i = 0; i < this.normals.length; i++) {
      const n = this.normals[i];
      const d = n[0] * (px - this.x) + n[1] * (pz - this.z);
      if (d < -this.half[i] || d > this.half[i]) return false;
    }
    return true;
  }
}

const DEG = Math.PI / 180;
const SQRT3_2 = Math.sqrt(3) / 2;

// Returns { t, nx, ny, nz } or null. `d` must be normalized.
export function rayConvex(o, d, c, maxT) {
  // broadphase: bounding sphere
  const ox = o.x - c.x, oy = o.y - c.cy, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - c.br2;
  if (cc > 0 && b > 0) return null;
  if (b * b - cc < 0) return null;

  let tNear = -Infinity, tFar = Infinity;
  let nx = 0, ny = 0, nz = 0;
  const ns = c.normals;
  for (let i = 0; i < ns.length; i++) {
    const n = ns[i];
    const denom = n[0] * d.x + n[1] * d.z;
    const dist = n[0] * ox + n[1] * oz;
    const h = c.half[i];
    if (Math.abs(denom) < 1e-9) {
      if (dist < -h || dist > h) return null;
      continue;
    }
    let tEnter, tExit, sign;
    if (denom > 0) { tEnter = (-h - dist) / denom; tExit = (h - dist) / denom; sign = -1; }
    else { tEnter = (h - dist) / denom; tExit = (-h - dist) / denom; sign = 1; }
    if (tEnter > tNear) { tNear = tEnter; nx = n[0] * sign; ny = 0; nz = n[1] * sign; }
    if (tExit < tFar) tFar = tExit;
    if (tNear > tFar) return null;
  }
  // vertical slab
  if (Math.abs(d.y) < 1e-9) {
    if (o.y < c.ymin || o.y > c.ymax) return null;
  } else {
    let tEnter, tExit, sign;
    if (d.y > 0) { tEnter = (c.ymin - o.y) / d.y; tExit = (c.ymax - o.y) / d.y; sign = -1; }
    else { tEnter = (c.ymax - o.y) / d.y; tExit = (c.ymin - o.y) / d.y; sign = 1; }
    if (tEnter > tNear) { tNear = tEnter; nx = 0; ny = sign; nz = 0; }
    if (tExit < tFar) tFar = tExit;
    if (tNear > tFar) return null;
  }
  if (tFar < 0) return null;
  const t = Math.max(0, tNear);
  if (t > maxT) return null;
  return { t, nx, ny, nz };
}

export function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - cc;
  if (h < 0) return null;
  const sq = Math.sqrt(h);
  let t = -b - sq;
  if (t < 0) t = -b + sq;
  return t >= 0 ? t : null;
}

export function rayCapsule(o, d, a, b, r) {
  const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
  const oax = o.x - a.x, oay = o.y - a.y, oaz = o.z - a.z;
  const baba = bax * bax + bay * bay + baz * baz;
  let best = null;
  if (baba > 1e-9) {
    const bard = bax * d.x + bay * d.y + baz * d.z;
    const baoa = bax * oax + bay * oay + baz * oaz;
    const rdoa = d.x * oax + d.y * oay + d.z * oaz;
    const oaoa = oax * oax + oay * oay + oaz * oaz;
    const A = baba - bard * bard;
    if (A > 1e-9) {
      const B = baba * rdoa - baoa * bard;
      const C = baba * oaoa - baoa * baoa - r * r * baba;
      const h = B * B - A * C;
      if (h >= 0) {
        const t = (-B - Math.sqrt(h)) / A;
        const y = baoa + t * bard;
        if (t >= 0 && y > 0 && y < baba) best = t;
      }
    }
  }
  const ta = raySphere(o, d, a, r);
  if (ta !== null && (best === null || ta < best)) best = ta;
  const tb = raySphere(o, d, b, r);
  if (tb !== null && (best === null || tb < best)) best = tb;
  return best;
}
