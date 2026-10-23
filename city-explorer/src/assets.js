import { DefaultLoadingManager } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const base = import.meta.env?.BASE_URL || '/';
let manifest = {};
export const assetURL = (path) => base + path.replace(/^\//, '');
function entryFor(url) {
  const absolute = new URL(url, globalThis.location?.href || 'http://localhost/');
  if (globalThis.location && absolute.origin !== location.origin) return;
  return manifest[decodeURI(absolute.pathname).slice(base.length)];
}
export async function initializeAssets() {
  if (import.meta.env?.MODE !== 'pages') return;
  const response = await fetch(assetURL('asset-manifest.json'));
  if (!response.ok) throw new Error('城市资源索引加载失败，请刷新重试');
  manifest = await response.json();
  // Three.js also resolves external GLB textures through this manager.
  DefaultLoadingManager.setURLModifier((url) => {
    const entry = entryFor(url);
    return entry && !entry.gzip ? assetURL(entry.url) : url;
  });
}
export async function fetchAsset(url, options) {
  const entry = entryFor(url);
  const response = await fetch(entry ? assetURL(entry.url) : url, options);
  if (!response.ok || !entry?.gzip) return response;
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip')));
}
export async function loadGLB(url) {
  const response = await fetchAsset(url);
  if (!response.ok) throw new Error(`模型加载失败：HTTP ${response.status}`);
  return new GLTFLoader().parseAsync(await response.arrayBuffer(), url.slice(0, url.lastIndexOf('/') + 1));
}
