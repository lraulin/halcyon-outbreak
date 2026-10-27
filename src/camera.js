import * as THREE from 'three';

// Tactical orbit camera + over-the-shoulder aim camera, with smooth blending between them.
export class CameraRig {
  constructor(camera, dom, bounds) {
    this.camera = camera;
    this.dom = dom;
    this.bounds = bounds;
    this.target = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, 0, bounds.maxZ - 6);
    this.goal = this.target.clone();
    this.yaw = 0;
    this.goalYaw = 0;
    this.pitch = 0.95;
    this.dist = 19;
    this.goalDist = 19;
    this.mode = 'tactical';
    this.keys = new Set();
    this.aimPos = new THREE.Vector3();
    this.aimLook = new THREE.Vector3();
    this.aimFov = 50;
    this.fov = 50;
    this.blend = 1; // smoothing speed boost right after mode switches
    this.desiredPos = new THREE.Vector3();
    this.desiredQuat = new THREE.Quaternion();
    this.tmpCam = new THREE.PerspectiveCamera();
    this.shake = 0;

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  focus(x, z, instant = false) {
    this.goal.set(x, 0, z);
    if (instant) this.target.copy(this.goal);
  }

  rotate(step) {
    this.goalYaw += step * (Math.PI / 3);
  }

  zoom(delta) {
    if (this.mode === 'aim') {
      this.aimFov = THREE.MathUtils.clamp(this.aimFov * (delta > 0 ? 1.12 : 0.89), 14, 60);
    } else {
      this.goalDist = THREE.MathUtils.clamp(this.goalDist * (delta > 0 ? 1.1 : 0.9), 7, 40);
    }
  }

  setAim(pos, look) {
    this.aimPos.copy(pos);
    this.aimLook.copy(look);
  }

  setMode(m) {
    if (m !== this.mode) {
      this.mode = m;
      this.blend = 0;
      if (m === 'aim') this.aimFov = 50;
    }
  }

  forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  update(dt, shake = 0) {
    if (this.mode === 'tactical') {
      const sp = 14 * dt * (this.dist / 19);
      const f = this.forward();
      const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      let mx = 0, mz = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
      if (mx || mz) {
        this.goal.addScaledVector(f, mz * sp).addScaledVector(r, mx * sp);
      }
      const b = this.bounds;
      this.goal.x = THREE.MathUtils.clamp(this.goal.x, b.minX - 4, b.maxX + 4);
      this.goal.z = THREE.MathUtils.clamp(this.goal.z, b.minZ - 4, b.maxZ + 4);
    }

    const k = 1 - Math.exp(-dt * 7);
    this.target.lerp(this.goal, k);
    this.yaw += (this.goalYaw - this.yaw) * (1 - Math.exp(-dt * 9));
    this.dist += (this.goalDist - this.dist) * k;

    const cam = this.camera;
    if (this.mode === 'tactical') {
      const cp = Math.cos(this.pitch);
      this.desiredPos.set(
        this.target.x + Math.sin(this.yaw) * cp * this.dist,
        this.target.y + Math.sin(this.pitch) * this.dist,
        this.target.z + Math.cos(this.yaw) * cp * this.dist,
      );
      this.tmpCam.position.copy(this.desiredPos);
      this.tmpCam.lookAt(this.target);
      this.fovGoal = 50;
    } else {
      this.desiredPos.copy(this.aimPos);
      this.tmpCam.position.copy(this.aimPos);
      this.tmpCam.lookAt(this.aimLook);
      this.fovGoal = this.aimFov;
    }
    this.desiredQuat.copy(this.tmpCam.quaternion);

    this.blend = Math.min(1, this.blend + dt * 1.6);
    const speed = this.blend >= 1 ? 30 : 4 + this.blend * 8;
    const kk = 1 - Math.exp(-dt * speed);
    cam.position.lerp(this.desiredPos, kk);
    cam.quaternion.slerp(this.desiredQuat, kk);
    this.fov += (this.fovGoal - this.fov) * (1 - Math.exp(-dt * 10));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    if (shake > 0) {
      const s = shake * shake * 0.35;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    }
  }
}
