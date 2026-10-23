import * as THREE from 'three';

// Index-only spatial partitions share original vertex buffers and preserve every face.
export async function partitionCity(root, progress) {
  root.updateMatrixWorld(true);
  const sources = [];
  root.traverse((mesh) => {
    if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh || Array.isArray(mesh.material)) return;
    const geometry = mesh.geometry, count = geometry.index?.count || geometry.attributes.position.count;
    geometry.computeBoundingBox();
    const size = geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld).getSize(new THREE.Vector3());
    if (count > 90000 && Math.max(size.x, size.z) > 550) sources.push(mesh);
  });
  const center = new THREE.Vector3(), point = new THREE.Vector3();
  for (let mi = 0; mi < sources.length; mi++) {
    const source = sources[mi], geometry = source.geometry, position = geometry.attributes.position;
    const indices = geometry.index, count = indices?.count || position.count;
    const buckets = new Map();
    for (let i = 0; i < count; i += 3) {
      const a = indices ? indices.getX(i) : i, b = indices ? indices.getX(i + 1) : i + 1, c = indices ? indices.getX(i + 2) : i + 2;
      center.set((position.getX(a)+position.getX(b)+position.getX(c))/3,
        (position.getY(a)+position.getY(b)+position.getY(c))/3,
        (position.getZ(a)+position.getZ(b)+position.getZ(c))/3).applyMatrix4(source.matrixWorld);
      const key = `${Math.floor(center.x/250)}:${Math.floor(center.z/250)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(a,b,c);
    }
    if (buckets.size < 2) continue;
    const replacement = new THREE.Group(); replacement.name = source.name;
    replacement.position.copy(source.position); replacement.quaternion.copy(source.quaternion); replacement.scale.copy(source.scale);
    for (const [key, list] of buckets) {
      const part = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(geometry.attributes)) part.setAttribute(name, attribute);
      part.setIndex(new THREE.BufferAttribute(new Uint32Array(list),1));
      const bounds = new THREE.Box3();
      for (const index of list) bounds.expandByPoint(point.fromBufferAttribute(position,index));
      part.boundingBox = bounds; part.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
      const mesh = new THREE.Mesh(part,source.material); mesh.name = `${source.name} [${key}]`;
      replacement.add(mesh);
    }
    source.parent.add(replacement); source.removeFromParent();
    // The source geometry was never uploaded; shared attributes are owned by the partitions.
    if (mi % 3 === 0) { progress((mi+1)/sources.length); await new Promise((resolve) => setTimeout(resolve, 0)); }
  }
  root.updateMatrixWorld(true);
}
