import * as THREE from 'three';

// Align the Rocketbox A-pose with the animation source's T-pose without editing skin binds.
export function calibrateArmPose(targetRoot, targetSkeleton, sourceRoot, sourceSkeleton) {
  targetRoot.updateMatrixWorld(true); sourceRoot.updateMatrixWorld(true);
  const find = (skeleton, side, part) => skeleton.bones.find((bone) => bone.name.replace(':', '') === `mixamorig${side}${part}`);
  for (const side of ['Left', 'Right']) {
    for (const [part, child] of [['Arm', 'ForeArm'], ['ForeArm', 'Hand']]) {
      const bone = find(targetSkeleton, side, part), next = find(targetSkeleton, side, child);
      const source = find(sourceSkeleton, side, part), sourceNext = find(sourceSkeleton, side, child);
      if (!bone || !next || !source || !sourceNext) continue;
      const from = next.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
      const to = sourceNext.getWorldPosition(new THREE.Vector3()).sub(source.getWorldPosition(new THREE.Vector3())).normalize();
      const world = new THREE.Quaternion().setFromUnitVectors(from, to).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
      bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
      targetRoot.updateMatrixWorld(true);
    }
  }
}

// Transfer world-space rotation deltas, preserving the target's proportions and root position.
export function transferLocomotion(targetRoot, targetSkeleton, sourceRoot, sourceSkeleton, clips) {
  targetRoot.updateMatrixWorld(true); sourceRoot.updateMatrixWorld(true);
  const capture = (skeleton) => skeleton.bones.map((bone) => ({bone,position:bone.position.clone(),quaternion:bone.quaternion.clone(),scale:bone.scale.clone()}));
  const targetPose=capture(targetSkeleton), sourcePose=capture(sourceSkeleton);
  const restore=(pose,root)=>{for(const p of pose){p.bone.position.copy(p.position);p.bone.quaternion.copy(p.quaternion);p.bone.scale.copy(p.scale);}root.updateMatrixWorld(true);};
  const sourceBones = new Map(sourceSkeleton.bones.map((bone) => [bone.name, bone]));
  const pairs = targetSkeleton.bones.filter((bone) => sourceBones.has(bone.name)).map((bone) => ({
    bone, source: sourceBones.get(bone.name),
    sourceBindInverse: sourceBones.get(bone.name).getWorldQuaternion(new THREE.Quaternion()).invert(),
    targetBind: bone.getWorldQuaternion(new THREE.Quaternion()),
  }));
  const mixer = new THREE.AnimationMixer(sourceRoot), result = [];
  const rotation = new THREE.Quaternion(), parent = new THREE.Quaternion();
  for (const clip of clips) {
    restore(sourcePose,sourceRoot); restore(targetPose,targetRoot);
    const action = mixer.clipAction(clip); action.reset().play();
    const frames = Math.ceil(clip.duration * 30) + 1;
    const times = Float32Array.from({length:frames},(_,index)=>index*clip.duration/(frames-1));
    const values = pairs.map(()=>new Float32Array(frames*4));
    for (let frame=0;frame<frames;frame++) {
      mixer.setTime(times[frame]); sourceRoot.updateMatrixWorld(true);
      for (let i=0;i<pairs.length;i++) {
        const {bone,source,sourceBindInverse,targetBind}=pairs[i];
        source.getWorldQuaternion(rotation).multiply(sourceBindInverse).multiply(targetBind);
        bone.parent.getWorldQuaternion(parent).invert();
        bone.quaternion.copy(parent.multiply(rotation)); bone.updateWorldMatrix(false,false);
        bone.quaternion.toArray(values[i],frame*4);
      }
    }
    result.push(new THREE.AnimationClip(clip.name,clip.duration,pairs.map(({bone},i)=>new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`,times,values[i]))));
    action.stop();
  }
  restore(targetPose,targetRoot); mixer.uncacheRoot(sourceRoot);
  return result;
}
