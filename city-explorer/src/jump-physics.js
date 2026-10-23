import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
export const JUMP_SPEED = 5.4;
export const GRAVITY = 18;

export function walkableSurface(hit) {
  return hit.face && hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).y > .35;
}

export class JumpPhysics {
  constructor(eyeHeight = 1.7) { this.eyeHeight = eyeHeight; this.reset(); }
  reset() { this.grounded = true; this.velocity = 0; this.height = 0; this.groundY = null; }
  jump(position) {
    if (!this.grounded) return false;
    this.groundY = position.y - this.eyeHeight; this.height = 0;
    this.grounded = false; this.velocity = JUMP_SPEED;
    return true;
  }
  update(position, delta, hits) {
    if (this.grounded) { this.groundY = position.y - this.eyeHeight; this.height = 0; return; }
    const steps = Math.max(1, Math.ceil(delta / (1 / 120))), dt = delta / steps;
    for (let i = 0; i < steps && !this.grounded; i++) {
      const previousFoot = position.y - this.eyeHeight;
      const nextY = position.y + this.velocity * dt - .5 * GRAVITY * dt * dt;
      this.velocity -= GRAVITY * dt;
      if (nextY > position.y) {
        // Sweep from eye level through the next head position, including head clearance.
        const roof = hits(position.clone(), UP, nextY - position.y + .08)[0];
        if (roof) {
          position.y = roof.point.y - .08; this.velocity = 0;
          this.height = Math.max(0, position.y - this.eyeHeight - this.groundY);
          continue;
        }
      } else {
        const nextFoot = nextY - this.eyeHeight;
        const ground = hits(new THREE.Vector3(position.x, previousFoot + .12, position.z), DOWN, previousFoot - nextFoot + .14)
          .find((hit) => walkableSurface(hit) && hit.point.y <= previousFoot + .12);
        if (ground) {
          position.y = ground.point.y + this.eyeHeight; this.velocity = 0;
          this.grounded = true; this.groundY = ground.point.y; this.height = 0; break;
        }
      }
      position.y = nextY;
      if (this.groundY !== null) this.height = Math.max(0, position.y - this.eyeHeight - this.groundY);
    }
  }
}

// Add a restrained athletic pose on top of the retargeted locomotion pose.
export function poseJump(bones, verticalSpeed, yaw = 0) {
  const tuck = verticalSpeed > 0 ? .7 : .35;
  const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, yaw);
  const rotations = { mixamorigLeftUpLeg: .42 * tuck, mixamorigRightUpLeg: .28 * tuck,
    mixamorigLeftLeg: -.8 * tuck, mixamorigRightLeg: -.62 * tuck,
    mixamorigLeftArm: .25, mixamorigRightArm: .25,
    mixamorigLeftForeArm: .4, mixamorigRightForeArm: .4 };
  for (const [name, angle] of Object.entries(rotations)) {
    const bone = bones.get(name); if (!bone) continue;
    bone.updateWorldMatrix(true, false);
    const world = new THREE.Quaternion().setFromAxisAngle(right, angle).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    bone.updateWorldMatrix(false, true);
  }
}
