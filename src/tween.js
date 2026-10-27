// Frame-driven tweens so game logic can `await` animations.
const active = [];

export const linear = (k) => k;
export const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
export const easeOut = (k) => 1 - Math.pow(1 - k, 3);
export const easeIn = (k) => k * k * k;

export function tween(duration, fn, ease = easeInOut) {
  return new Promise((res) => {
    active.push({ t: 0, duration: Math.max(duration, 1e-4), fn, ease, res });
  });
}

export function wait(sec) {
  return tween(sec, () => {}, linear);
}

export function updateTweens(dt) {
  for (let i = active.length - 1; i >= 0; i--) {
    const tw = active[i];
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.duration);
    tw.fn(tw.ease(k), k);
    if (k >= 1) {
      active.splice(active.indexOf(tw), 1);
      tw.res();
    }
  }
}
