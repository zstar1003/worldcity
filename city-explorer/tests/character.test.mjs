import assert from 'node:assert/strict';
import * as THREE from 'three';
import {transferLocomotion} from '../src/character-animation.js';
function rig(){const root=new THREE.Group();root.scale.setScalar(.01);root.rotation.x=Math.PI/2;const hip=new THREE.Bone();hip.name='Hip';hip.position.set(0,-.5,-102);const leg=new THREE.Bone();leg.name='Leg';leg.position.y=-50;hip.add(leg);root.add(hip);root.updateMatrixWorld(true);return {root,hip,leg,skeleton:new THREE.Skeleton([hip,leg])};}
const target=rig(),source=rig();const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.2);
const clip=new THREE.AnimationClip('Walk',1,[new THREE.QuaternionKeyframeTrack('Leg.quaternion',[0,1],[0,0,0,1,...q])]);
const clips=transferLocomotion(target.root,target.skeleton,source.root,source.skeleton,[clip]);
assert.deepEqual(target.hip.position.toArray(),[0,-.5,-102]);
assert(clips[0].tracks.every(t=>t.values.every(Number.isFinite)));
const mixer=new THREE.AnimationMixer(target.root);mixer.clipAction(clips[0]).play();mixer.update(.5);
assert.deepEqual(target.hip.position.toArray(),[0,-.5,-102]);
assert(target.leg.quaternion.angleTo(new THREE.Quaternion())>.05);
console.log('PASS: nested scaled skeleton preserves hip coordinates and transfers leg rotation.');
