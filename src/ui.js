import * as THREE from 'three';
import { PART_LABEL } from './units.js';

const $ = (id) => document.getElementById(id);
const v3 = new THREE.Vector3();

export class UI {
  constructor(game) {
    this.game = game;
    this.labels = new Map();
    this.floats = [];
    this.labelRoot = $('labels');
  }

  show(id, on = true) {
    $(id).classList.toggle('hidden', !on);
  }

  startHud() {
    for (const id of ['top-left', 'roster', 'unit-panel', 'enemy-list']) this.show(id);
    this.show('title', false);
  }

  setObjective(text, turn) {
    $('objective').innerHTML = text;
    $('turn').textContent = `Turn ${turn}`;
  }

  roster(squad, selected) {
    const el = $('roster');
    el.innerHTML = '';
    for (const s of squad) {
      const c = document.createElement('div');
      c.className = 'card' + (s === selected ? ' sel' : '') + (s.alive ? '' : ' dead');
      c.style.setProperty('--band', '#' + s.def.band.toString(16).padStart(6, '0'));
      const tags = [];
      if (s.overwatch) tags.push('<span class="tag ow">OW</span>');
      if (s.hasSample) tags.push('<span class="tag case">CASE</span>');
      if (s.alive && s.crippled) tags.push('<span class="tag bad">LEG</span>');
      c.innerHTML = `<div class="nm"><span>${s.name}</span><span>${tags.join('')}</span></div>
        <div class="mini"><div style="width:${Math.max(0, (s.hp / s.maxHp) * 100)}%"></div></div>
        <div class="tu">${s.alive ? `${s.role} · AP ${(s.tu / 3).toFixed(1)} · ${s.weapon.def.short} ${s.weapon.ammo}/${s.weapon.def.mag}` : 'KIA'}</div>`;
      if (s.alive) c.onclick = () => this.game.select(s);
      el.appendChild(c);
    }
  }

  unitPanel(u, mode, costPreview = 0) {
    if (!u) { this.show('unit-panel', false); return; }
    this.show('unit-panel', true);
    $('up-name').textContent = u.name;
    $('up-role').textContent = u.role;
    $('up-status').innerHTML = (u.overwatch ? '<span class="tag ow">OVERWATCH</span>' : '') + (u.hasSample ? '<span class="tag case">CARRYING V-7</span>' : '');
    $('up-hp').style.width = Math.max(0, (u.hp / u.maxHp) * 100) + '%';
    $('up-hp-t').textContent = `${Math.max(0, Math.ceil(u.hp))} / ${u.maxHp}`;
    const ap = $('up-ap');
    ap.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const lo = i * 3;
      const have = Math.max(0, Math.min(3, u.tu - lo)) / 3;
      const after = Math.max(0, Math.min(3, u.tu - costPreview - lo)) / 3;
      const p = document.createElement('div');
      p.className = 'pip' + (costPreview > 0 && after < have ? ' cost' : '');
      p.innerHTML = `<div style="transform:scaleX(${have})"></div>`;
      if (costPreview > 0 && after < have) {
        p.innerHTML = `<div style="transform:scaleX(${have});background:var(--warn)"></div><div style="transform:scaleX(${after})"></div>`;
      }
      ap.appendChild(p);
    }
    const parts = Object.keys(u.parts).map((k) => {
      const bad = u.parts[k] <= 0;
      return `<span class="${bad ? 'bad' : ''}">${PART_LABEL[k]} ${bad ? 'DISABLED' : Math.ceil((u.parts[k] / u.partMax[k]) * 100) + '%'}</span>`;
    });
    $('up-parts').innerHTML = parts.join(' · ');
    const w = u.weapon;
    $('up-weapon').innerHTML = `<b>${w.def.name}</b> · ${w.ammo}/${w.def.mag} rds · ${w.reserve} mag${w.reserve === 1 ? '' : 's'} · ${w.def.tu / 3} AP/shot · Grenades ${u.grenades} · Medkits ${u.medkits}`;

    const g = this.game;
    const acts = [
      ['1', 'Aim', 'aim', g.canFire(u)],
      ['2', 'Swap', 'swap', u.weapons.length > 1],
      ['3', 'Reload', 'reload', g.canReload(u)],
      ['4', 'Grenade', 'grenade', u.grenades > 0 && u.tu >= 6],
      ['5', 'Medkit', 'medkit', u.medkits > 0 && u.tu >= 4],
      ['6', 'Overwatch', 'overwatch', g.canFire(u) && !u.overwatch],
    ];
    const el = $('actions');
    el.innerHTML = '';
    for (const [k, label, act, enabled] of acts) {
      const b = document.createElement('button');
      b.innerHTML = `<span class="k">${k}</span>${label}`;
      b.disabled = !enabled || g.busy;
      if (mode === act) b.classList.add('active');
      b.onclick = () => g.action(act);
      el.appendChild(b);
    }
    const end = document.createElement('button');
    end.className = 'end';
    end.innerHTML = '<span class="k">⏎</span>End Turn';
    end.disabled = g.busy;
    end.onclick = () => g.endTurn();
    el.appendChild(end);
  }

  enemyList(enemies) {
    const el = $('enemy-list');
    el.innerHTML = '';
    for (const e of enemies) {
      const c = document.createElement('div');
      c.className = 'enemy-chip' + (e.alive ? '' : ' down');
      c.textContent = `${e.name} ${Math.max(0, Math.ceil(e.hp))}`;
      c.onclick = () => this.game.aimAt(e);
      el.appendChild(c);
    }
  }

  log(msg, cls = '') {
    const el = $('log');
    const line = document.createElement('div');
    line.className = 'log-line ' + cls;
    line.innerHTML = msg;
    el.appendChild(line);
    while (el.children.length > 8) el.removeChild(el.firstChild);
    setTimeout(() => { line.style.opacity = '0.35'; }, 7000);
  }

  banner(title, sub = '', cls = '') {
    const b = $('banner');
    b.className = 'show ' + cls;
    $('banner-t').textContent = title;
    $('banner-s').textContent = sub;
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => { b.className = cls; }, 1600);
  }

  hint(html) {
    if (!html) { this.show('hint', false); return; }
    $('hint').innerHTML = html;
    this.show('hint', true);
  }

  tooltip(html, x, y) {
    const t = $('tooltip');
    if (!html) { t.classList.add('hidden'); return; }
    t.innerHTML = html;
    t.style.left = x + 'px';
    t.style.top = y + 'px';
    t.classList.remove('hidden');
  }

  reticle(on, cx, cy, rOuter, rInner, cls = '') {
    const r = $('reticle');
    if (!on) { r.classList.add('hidden'); this.show('aim-info', false); return; }
    r.classList.remove('hidden');
    r.setAttribute('class', cls);
    const set = (id, attrs) => { const e = $(id); for (const k in attrs) e.setAttribute(k, attrs[k]); };
    set('ret-outer', { cx, cy, r: Math.max(3, rOuter) });
    set('ret-inner', { cx, cy, r: Math.max(2, rInner) });
    set('ret-dot', { cx, cy });
    const g = Math.max(6, rOuter) + 4, L = 10;
    set('ret-h1', { x1: cx - g - L, y1: cy, x2: cx - g, y2: cy });
    set('ret-h2', { x1: cx + g, y1: cy, x2: cx + g + L, y2: cy });
    set('ret-v1', { x1: cx, y1: cy - g - L, x2: cx, y2: cy - g });
    set('ret-v2', { x1: cx, y1: cy + g, x2: cx, y2: cy + g + L });
    const info = $('aim-info');
    const iw = info.offsetWidth || 240, ih = info.offsetHeight || 160;
    const right = cx + g + L + 24 + iw < window.innerWidth;
    info.style.left = (right ? cx + g + L : cx - g - L - iw - 48) + 'px';
    info.style.top = Math.max(ih / 2 + 8, Math.min(window.innerHeight - ih / 2 - 8, cy)) + 'px';
  }

  aimInfo(html) {
    $('aim-info').innerHTML = html;
    this.show('aim-info', !!html);
  }

  floatText(pos, text, color = '#fff', sub = '') {
    const el = document.createElement('div');
    el.className = 'ftext';
    el.style.color = color;
    el.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
    this.labelRoot.appendChild(el);
    this.floats.push({ el, pos: new THREE.Vector3(pos.x, pos.y, pos.z), t: 0, dx: (Math.random() - 0.5) * 30 });
  }

  updateLabels(camera, units, dt) {
    const w = window.innerWidth, h = window.innerHeight;
    const aiming = this.game.mode === 'aim';
    for (const u of units) {
      let el = this.labels.get(u);
      const show = u.root.visible && u.state !== 'dead' && !(u.state === 'down' && !u.rising) && !aiming;
      if (!show) { if (el) el.style.display = 'none'; continue; }
      if (!el) {
        el = document.createElement('div');
        el.className = 'ulabel ' + u.team;
        this.labelRoot.appendChild(el);
        this.labels.set(u, el);
      }
      v3.set(u.root.position.x, (u.rig.hound ? 1.1 : 2.05) * u.scale + (u.state === 'down' ? -1.4 : 0), u.root.position.z).project(camera);
      if (v3.z > 1) { el.style.display = 'none'; continue; }
      el.style.display = 'block';
      el.style.left = ((v3.x + 1) / 2) * w + 'px';
      el.style.top = ((1 - v3.y) / 2) * h + 'px';
      const pct = Math.max(0, (u.hp / u.maxHp) * 100);
      const key = `${u.state}|${Math.ceil(u.hp)}|${u.overwatch}|${u.hasSample}|${u.rising}|${u.awake}`;
      if (el.dataset.k !== key) {
        el.dataset.k = key;
        if (u.state === 'down') el.innerHTML = `<div class="twitch">⚠ twitching</div>`;
        else {
          const icons = (u.overwatch ? '<span class="ic">◉ </span>' : '') + (u.hasSample ? '<span class="ic">▣ </span>' : '') + (u.team === 'enemy' && !u.awake ? '<span class="dim">z </span>' : '');
          el.innerHTML = `<div class="nm">${icons}${u.team === 'squad' ? u.name.split(' ')[0] : ''}</div><div class="hpb"><div style="width:${pct}%"></div></div>`;
        }
      }
    }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.t += dt;
      v3.copy(f.pos).project(camera);
      f.el.style.left = ((v3.x + 1) / 2) * w + f.dx * f.t + 'px';
      f.el.style.top = ((1 - v3.y) / 2) * h - f.t * 50 + 'px';
      f.el.style.opacity = String(Math.max(0, 1 - Math.max(0, f.t - 0.8) / 0.7));
      if (v3.z > 1) f.el.style.display = 'none';
      if (f.t > 1.5) {
        f.el.remove();
        this.floats.splice(i, 1);
      }
    }
  }

  endScreen(title, body) {
    $('end-title').innerHTML = title;
    $('end-body').innerHTML = body;
    this.show('end', true);
  }
}
