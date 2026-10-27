import { hexDist } from './hex.js';
import { wait } from './tween.js';
import { sfx } from './audio.js';

// Enemy phase: reanimations, reinforcements, then each creature hunts the nearest operative.
export async function enemyTurn(game) {
  const W = game.world;

  for (const e of game.enemies) {
    if (e.state !== 'down' || !e.rising) continue;
    e.riseIn--;
    if (e.riseIn <= 0) {
      if (!W.unitAt(W.cell(e.q, e.r))) await game.reanimate(e);
    } else if (W.cell(e.q, e.r).vis) {
      game.ui.log(`The downed ${e.name} is twitching violently...`, 'warn');
    }
  }

  if (game.alarm && game.turn % 2 === 0) game.reinforce([Math.random() < 0.5 ? 'hound' : 'zombie']);
  else if (game.turn >= 3 && game.turn % 3 === 0) game.reinforce(['zombie']);

  const order = game.enemies.filter((e) => e.alive);
  for (const e of order) {
    if (game.over) return;
    if (!e.alive) continue;
    if (e.justRose) { e.justRose = false; continue; }
    e.tu = e.maxTu;
    if (!e.awake) {
      const sees = game.squad.some((s) => s.alive && hexDist(e, s) <= e.def.notice && W.canSee(e, s, 40));
      if (!sees) continue;
      e.awake = true;
      if (e.root.visible) game.ui.log(`The ${e.name} has noticed you!`, 'bad');
    }
    await act(game, e);
  }
  await wait(0.3);
}

async function act(game, e) {
  const W = game.world;
  const def = e.def;
  if (e.root.visible) {
    game.rig.focus(e.pos().x, e.pos().z);
    const pan = game.pan(e.pos());
    if (e.kind === 'hound') sfx.growl(pan);
    else if (e.kind === 'brute') sfx.roar(pan);
    else if (Math.random() < 0.6) sfx.groan(pan, 0.8);
    await wait(0.4);
  }
  let guard = 0;
  while (e.alive && e.tu > 0 && guard++ < 6 && !game.over) {
    const targets = game.squad.filter((s) => s.alive);
    if (!targets.length) return;
    targets.sort((a, b) => hexDist(e, a) - hexDist(e, b));
    const tgt = targets[0];
    const d = hexDist(e, tgt);

    if (def.ranged && e.tu >= def.ranged.tu) {
      const rt = targets.find((s) => { const dd = hexDist(e, s); return dd >= 2 && dd <= def.ranged.range && W.canSee(e, s, 40); });
      if (rt) {
        e.root.visible = true;
        game.rig.focus(e.pos().x, e.pos().z);
        await game.spit(e, rt);
        e.tu -= def.ranged.tu;
        continue;
      }
    }

    if (d === 1) {
      if (e.tu >= def.melee.tu) {
        e.root.visible = true;
        await game.melee(e, tgt);
        e.tu = 0; // an attack ends the creature's activation
        continue;
      }
      break;
    }

    const steps = Math.floor(e.tu / e.moveCost);
    if (steps <= 0) break;
    const adjacentToSquad = (c) => targets.some((s) => hexDist(c, s) === 1);
    let path = W.findPath(e, (c) => W.passable(c, e) && adjacentToSquad(c), tgt);
    if (!path) {
      // blocked by other creatures: plan through them and advance as far as possible
      path = W.findPath(e, (c) => hexDist(c, tgt) <= 1, tgt, true);
      if (path) {
        const cut = path.findIndex((c) => !W.passable(c, e));
        if (cut >= 0) path = path.slice(0, cut);
      }
    }
    if (!path || !path.length) break;
    let stopIf = null;
    if (def.ranged) {
      stopIf = (c) => targets.some((s) => {
        const dd = hexDist(c, s);
        return dd >= 2 && dd <= def.ranged.range - 1 && W.los({ x: c.x, y: 1.6, z: c.z }, s.aimPoint('torso'));
      });
    }
    const before = e.tu;
    await game.moveUnit(e, path.slice(0, steps), { stopIf });
    if (e.tu === before) break;
  }
}
