import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {transferLocomotion} from '../src/character-animation.js';
globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:2048,height:2048,close(){}});globalThis.ProgressEvent=class{constructor(type,init){this.type=type;Object.assign(this,init)}};
async function load(path){const b=await fs.readFile(path);return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
const target=await load('public/characters/rocketbox-male-09/tourist.glb'),source=await load('public/characters/traveler.glb');
const getSkeleton=(root)=>{let result;root.traverse(o=>{if(o.isSkinnedMesh&&(!result||o.skeleton.bones.length>result.bones.length))result=o.skeleton});return result};
const targetRig=getSkeleton(target.scene),sourceRig=getSkeleton(source.scene);
target.scene.rotation.y=Math.PI;target.scene.updateMatrixWorld(true);
// Calibrate the target A-pose to source T-pose without changing inverse bind matrices.
source.scene.updateMatrixWorld(true);
for(const side of ['Left','Right'])for(const [part,child]of [['Arm','ForeArm'],['ForeArm','Hand']]){
 const find=(rig,part)=>rig.bones.find(b=>b.name==='mixamorig'+side+part);
 const tb=find(targetRig,part),tc=find(targetRig,child),sb=find(sourceRig,part),sc=find(sourceRig,child);
 const from=tc.getWorldPosition(new THREE.Vector3()).sub(tb.getWorldPosition(new THREE.Vector3())).normalize();
 const to=sc.getWorldPosition(new THREE.Vector3()).sub(sb.getWorldPosition(new THREE.Vector3())).normalize();
 const world=new THREE.Quaternion().setFromUnitVectors(from,to).multiply(tb.getWorldQuaternion(new THREE.Quaternion()));
 tb.quaternion.copy(tb.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));target.scene.updateMatrixWorld(true);
}
const clips=transferLocomotion(target.scene,targetRig,source.scene,sourceRig,source.animations.filter(c=>c.name!=='TPose'));
const report={bones:targetRig.bones.length,mappedBones:targetRig.bones.filter(b=>sourceRig.bones.some(s=>s.name===b.name)).map(b=>b.name),clips:[]};
for(const c of clips){const mixer=new THREE.AnimationMixer(target.scene);mixer.clipAction(c).play();const bounds=[];for(const time of [0,c.duration*.25,c.duration*.5,c.duration*.75]){mixer.setTime(time);target.scene.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(target.scene,true);bounds.push({time,min:box.min.toArray(),max:box.max.toArray(),joints:Object.fromEntries(targetRig.bones.filter(b=>/mixamorig(Left|Right)?(Hips|Head|Spine2|Arm|ForeArm|Hand|UpLeg|Leg|Foot)$/.test(b.name)).map(b=>[b.name,b.getWorldPosition(new THREE.Vector3()).toArray()]))});}report.clips.push({name:c.name,duration:c.duration,tracks:c.tracks.length,allFinite:c.tracks.every(t=>Array.from(t.values).every(Number.isFinite)),bounds});mixer.stopAllAction();}
await fs.writeFile('audit/avatar-animation-validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify({bones:report.bones,mapped:report.mappedBones.length,clips:report.clips.map(({name,tracks,allFinite})=>({name,tracks,allFinite}))}));
