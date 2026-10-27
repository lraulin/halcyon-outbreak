// Weapon definitions. `spread` is the half-angle (degrees) of the cone that contains every shot;
// half of all shots land inside spread / sqrt(2) (the inner reticle circle).
export const WEAPONS = {
  carbine: {
    name: 'K-90 Carbine', short: 'Carbine', dmg: 26, pellets: 1, burst: 3, spread: 2.0, range: 30,
    tu: 6, mag: 24, reserve: 3, armorPierce: 0, sound: 'rifle', burstDelay: 0.1, recoil: 0.18,
  },
  shotgun: {
    name: 'Breacher-12 Shotgun', short: 'Shotgun', dmg: 14, pellets: 8, burst: 1, spread: 5.5, range: 10,
    tu: 6, mag: 6, reserve: 3, armorPierce: 0, sound: 'shotgun', burstDelay: 0, recoil: 0,
  },
  dmr: {
    name: 'Longwatch DMR', short: 'DMR', dmg: 72, pellets: 1, burst: 1, spread: 0.55, range: 60,
    tu: 9, mag: 5, reserve: 3, armorPierce: 8, sound: 'sniper', burstDelay: 0, recoil: 0,
  },
  pdw: {
    name: 'Wasp PDW', short: 'PDW', dmg: 16, pellets: 1, burst: 5, spread: 3.0, range: 18,
    tu: 6, mag: 30, reserve: 2, armorPierce: 0, sound: 'smg', burstDelay: 0.065, recoil: 0.12,
  },
  pistol: {
    name: 'Vigil .45 Pistol', short: 'Pistol', dmg: 30, pellets: 1, burst: 1, spread: 2.3, range: 20,
    tu: 3, mag: 9, reserve: 2, armorPierce: 2, sound: 'pistol', burstDelay: 0, recoil: 0,
  },
};

export function makeWeapon(id) {
  const def = WEAPONS[id];
  return { id, def, ammo: def.mag, reserve: def.reserve };
}

// Damage multiplier for distance beyond effective range.
export function rangeFalloff(def, dist) {
  if (dist <= def.range) return 1;
  return Math.max(0.25, 1 - (dist - def.range) / (def.range * 1.5));
}

// Random direction inside a cone of half-angle `spreadRad` around unit vector d (uniform over the disc).
export function perturb(d, spreadRad, out = { x: 0, y: 0, z: 0 }) {
  // orthonormal basis around d
  let ux, uy, uz;
  if (Math.abs(d.y) < 0.95) { ux = d.z; uy = 0; uz = -d.x; } else { ux = 0; uy = -d.z; uz = d.y; }
  let l = Math.hypot(ux, uy, uz);
  ux /= l; uy /= l; uz /= l;
  const vx = d.y * uz - d.z * uy, vy = d.z * ux - d.x * uz, vz = d.x * uy - d.y * ux;
  const r = Math.tan(spreadRad * Math.sqrt(Math.random()));
  const phi = Math.random() * Math.PI * 2;
  const a = Math.cos(phi) * r, b = Math.sin(phi) * r;
  out.x = d.x + ux * a + vx * b;
  out.y = d.y + uy * a + vy * b;
  out.z = d.z + uz * a + vz * b;
  l = Math.hypot(out.x, out.y, out.z);
  out.x /= l; out.y /= l; out.z /= l;
  return out;
}
