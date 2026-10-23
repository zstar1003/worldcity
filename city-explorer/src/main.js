import './style.css';
import * as THREE from 'three';
import { createScene } from './scene.js';
import { CityModel } from './models.js';
import { Navigation } from './navigation.js';

const cities = [
  { id: 'beijing', name: '北京', english: 'BEIJING', district: '中轴线 · 国贸', description: '沿着城市的中轴，走进古老与当代。' },
  { id: 'shanghai', name: '上海', english: 'SHANGHAI', district: '陆家嘴 · 滨江', description: '穿过江岸与高楼，看见另一种上海。' },
  { id: 'guangzhou', name: '广州', english: 'GUANGZHOU', district: '珠江新城 · 海心沙', description: '顺着珠江的风，在街道之间慢下来。' },
  { id: 'shenzhen', name: '深圳', english: 'SHENZHEN', district: '福田中心区', description: '在摩天楼与街道之间，重新发现城市。' },
];
const $ = (id) => document.getElementById(id);
const app = createScene($('viewport'));
let model = null, loading = false, sequence = 0, quality = 'high', currentCity;
let navigationBusy = false, toastTimer, lastFpsTime = 0, frameCount = 0, fps = 0;
const navigation = new Navigation(app.camera, app.renderer.domElement, app.scene, updateMode, toast);

function toast(message) {
  $('toast').textContent = message; $('toast').classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4000);
}

function updateMode(mode) {
  app.temporal.reset();
  document.body.dataset.mode = mode;
  document.querySelectorAll('[data-mode]').forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  $('walk-hint').hidden = mode !== 'first' || document.pointerLockElement === app.renderer.domElement;
  $('keyboard-hint').innerHTML = mode === 'orbit'
    ? '<kbd>拖动</kbd> 旋转 <kbd>滚轮</kbd> 缩放 <kbd>右键</kbd> 平移'
    : '<kbd>W A S D</kbd> 移动 <kbd>Shift</kbd> 加速 <kbd>拖动</kbd> 环视 <kbd>空格</kbd> 跳跃';
}

function setProgress(message, value) {
  $('loading-message').textContent = message;
  $('progress-fill').style.width = `${Math.round(value * 100)}%`;
  $('progress-label').textContent = `${Math.round(value * 100)}%`;
}

function setControlsDisabled(disabled) {
  navigation.suspended = disabled;
  document.querySelectorAll('[data-mode],.place-button,#overview-button,#jump-button').forEach((button) => { button.disabled = disabled; });
}

async function loadCity(id) {
  const city = cities.find((entry) => entry.id === id) || cities[3];
  if (loading && currentCity?.id === city.id) return;
  const token = ++sequence;
  loading = true; navigationBusy = false; currentCity = city;
  navigation.setMode('orbit'); navigation.model = null; navigation.hasWalked = false;
  model?.dispose(); model = null;
  app.renderer.renderLists.dispose();
  $('loading').classList.remove('hidden'); $('retry-button').hidden = true;
  $('loading-title').textContent = `正在走近${city.name}`;
  setProgress('读取城市资源清单', 0);
  $('city-title').replaceChildren(document.createTextNode(city.name), Object.assign(document.createElement('span'), { textContent: city.english }));
  $('city-number').textContent = `0${cities.indexOf(city) + 1} / 04`;
  $('city-description').textContent = city.description;
  $('location-label').textContent = city.district;
  $('render-label').textContent = '准备城市资源'; $('places').replaceChildren();
  document.querySelectorAll('[data-city]').forEach((button) => button.classList.toggle('active', button.dataset.city === city.id));
  setControlsDisabled(true);
  const incoming = new CityModel(city.id, app.scene, app.renderer, app.camera);
  model = incoming;
  try {
    await app.ready;
    await incoming.load((message, progress) => { if (token === sequence) setProgress(message, progress); });
    if (token !== sequence) { incoming.dispose(); return; }
    app.setLighting(incoming.meta, incoming.renderSettings); navigation.setCity(incoming);
    incoming.meta.spawns.forEach((spawn, index) => {
      const button = document.createElement('button'); button.className = 'place-button';
      const number = document.createElement('span'); number.className = 'place-number'; number.textContent = `0${index + 1}`;
      const name = document.createElement('span'); name.className = 'place-name'; name.textContent = spawn.name;
      const arrow = document.createElement('span'); arrow.className = 'place-arrow'; arrow.textContent = '↗';
      button.append(number, name, arrow); button.addEventListener('click', () => enterWalk('third', index));
      $('places').appendChild(button);
    });
    setProgress('完成材质准备，正在进入', 0.99);
    await new Promise((resolve) => setTimeout(resolve, 0));
    app.updateShadows(navigation.orbit.target, 'orbit');
    await app.renderer.compileAsync(app.scene, app.camera);
    if (token !== sequence) return;
    app.render();
    setProgress('采集周围建筑的玻璃倒影', .99);
    incoming.reflections.capture(app.camera.position, navigation.avatar); app.temporal.reset(); app.render();
    loading = false; lastFpsTime = clock.elapsedTime; frameCount = 0;
    $('loading').classList.add('hidden'); setControlsDisabled(false);
    $('render-label').textContent = '完整建筑 · 原尺寸贴图';
    history.replaceState(null, '', `#${city.id}`);
  } catch (error) {
    if (token !== sequence) return;
    console.error('City loading failed', error);
    loading = false;
    $('loading-title').textContent = `${city.name}暂时没有打开`;
    $('loading-message').textContent = `${error.message}。模型体积较大，请使用桌面浏览器并重试。`;
    $('progress-label').textContent = '加载未完成'; $('retry-button').hidden = false;
    $('render-label').textContent = '模型加载未完成';
  }
}

async function enterWalk(mode, spawnIndex) {
  if (!model || loading || navigationBusy) return;
  if (mode === 'orbit') {
    const current=model;navigationBusy=true;setControlsDisabled(true);navigation.overview();
    $('loading').classList.remove('hidden');$('loading-title').textContent='正在载入城市全景';
    try{await current.prepareNavigation((value)=>setProgress('加载当前视野的完整高清建筑',value),app.camera,app.camera.position);current.reflections.capture(app.camera.position,navigation.avatar);app.temporal.reset();}
    catch(error){console.error(error);toast('城市全景载入失败，请重试。');}
    finally{if(model===current){navigationBusy=false;setControlsDisabled(false);$('loading').classList.add('hidden');$('location-label').textContent=currentCity.district;}}
    return;
  }
  const current = model;
  navigationBusy = true; setControlsDisabled(true);
  try {
    if (mode === 'third') await navigation.avatarReady;
    navigation.setMode(mode);
    if (spawnIndex !== undefined) navigation.goTo(spawnIndex);
    $('loading').classList.remove('hidden'); $('loading-title').textContent = '正在载入目的地高清街区';
    await current.prepareNavigation((value) => setProgress('保留完整建筑、原尺寸纹理和地面碰撞', value), app.camera, navigation.position);
    app.updateShadows(navigation.position, mode); app.render();
    current.reflections.capture(navigation.position, navigation.avatar);
  } catch(error) { console.error(error); toast('高清街区载入失败，请重试地标。'); return; }
  finally { if(model===current){ navigationBusy=false; setControlsDisabled(false); $('loading').classList.add('hidden'); } }
  if (model !== current) return;
  app.temporal.reset();
  $('location-label').textContent = current.meta.spawns[navigation.spawnIndex || 0].name;
  $('render-label').textContent = '街道漫游 · 地面与碰撞已启用';
  current.loadNearFoliage((value) => {
    if (model === current) $('render-label').textContent = `载入近处原始树木 ${Math.round(value * 100)}%`;
  }).then(() => {
    if (model === current) $('render-label').textContent = '完整建筑 · 近处原始树木';
  }).catch((error) => { console.error(error); toast('原始树木加载失败，远景树木仍可显示。'); });
}

function showDialog(content) {
  if (document.pointerLockElement) document.exitPointerLock();
  navigation.keys.clear(); $('dialog-content').innerHTML = content; $('info-dialog').showModal();
}

function showDetails() {
  if (!model?.meta) return;
  const counts = model.meta.counts;
  const triangles = counts.architectureExportTriangles || counts.exportedArchitectureTriangles || counts.architectureBaseTriangles;
  showDialog(`<div class="eyebrow">MODEL / LOCAL</div><h2>${currentCity.name}，真实模型在浏览器中</h2>
    <div class="stat-grid"><div><strong>${(triangles / 1e6).toFixed(2)} M</strong><span>建筑三角面 · 未做减面</span></div><div><strong>${Math.round(model.meta.filesBytes['architecture.glb'] / 1048576)} MB</strong><span>完整建筑资源</span></div><div><strong>${Number(counts.foliageInstances).toLocaleString()}</strong><span>原场景植被实例</span></div><div><strong>${fps} FPS</strong><span>当前浏览器实测</span></div></div>
    <p>建筑按视野逐块加载、提前加载周边区域，离开后释放；不减面、不量化。近处使用原始树木网格，远处使用原树渲染的透明图像。</p>
    <p>原有图片纹理保留原尺寸；程序化窗格、铺装和草地从原节点烘焙，按距离加载 256 / 1024 / 2048 纹理。微表面噪声重复方式、玻璃和间接光与离线 Cycles 仍有差异。第一、第三人称使用建筑三角面碰撞和实际地面高度。</p>
    <p>“原生高清”使用屏幕原生分辨率；“流畅显示”降低屏幕采样并关闭实时阴影，不改动源文件。全部城市资源由本机提供，没有上传云端。</p>`);
}

cities.forEach((city, index) => {
  const button = document.createElement('button'); button.dataset.city = city.id;
  button.innerHTML = `<span class="nav-index">0${index + 1}</span>${city.name}`;
  button.addEventListener('click', () => loadCity(city.id)); $('city-nav').appendChild(button);
});
document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => enterWalk(button.dataset.mode)));
$('overview-button').addEventListener('click', () => enterWalk('orbit'));
$('speed-select').addEventListener('change', (event) => { navigation.speed = Number(event.target.value); });
$('quality-select').addEventListener('change', (event) => { quality = event.target.value; app.setQuality(quality); });
$('retry-button').addEventListener('click', () => loadCity(currentCity.id));
$('details-button').addEventListener('click', showDetails);
$('help-button').addEventListener('click', () => showDialog(`<div class="eyebrow">HOW TO EXPLORE</div><h2>用自己的视角，走进城市。</h2><ul><li><b>自由观察：</b>鼠标拖动旋转，滚轮缩放，右键拖动平移。</li><li><b>第一人称：</b>点击画面锁定鼠标，移动鼠标环视；按 Esc 释放。也支持按住画面拖动。</li><li><b>第三人称：</b>跟随旅行者，按住画面拖动环视，滚轮调整跟随距离。</li><li><b>移动：</b>WASD 或方向键行走，Shift 加速，空格跳跃。触屏可用方向按钮和跳跃键。</li><li><b>地标：</b>点击右侧地标直接到达；“返回城市全景”回到原始观景相机。</li><li><b>显示：</b>卡顿时选择“流畅显示”。四城资源较大，切城会释放上一城。</li></ul><p>原始建模范围之外，以及没有可行走地面的区域会限制移动。</p>`));
$('fullscreen-button').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { toast('当前窗口不支持全屏，可使用浏览器全屏功能。'); }
});
document.querySelector('.dialog-close').addEventListener('click', () => $('info-dialog').close());
$('info-dialog').addEventListener('click', (event) => { if (event.target === $('info-dialog')) $('info-dialog').close(); });
window.addEventListener('resize', () => app.resize());
window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id !== currentCity?.id) loadCity(id); });
app.renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault(); $('loading').classList.remove('hidden'); $('loading-title').textContent = '图形设备需要恢复';
  $('loading-message').textContent = '浏览器显存不足或图形上下文已重置，请刷新页面重试。';
  $('retry-button').hidden = false; $('retry-button').onclick = () => location.reload();
});

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1), elapsed = clock.elapsedTime;
  if (!model || loading) return;
  if (!navigationBusy) navigation.update(delta, elapsed);
  if (!navigationBusy && navigation.mode !== 'orbit' && navigation.keys.size === 0 && navigation.jumpPhysics.grounded && model.reflections.position.distanceToSquared(navigation.position) > 100 ** 2 && model.stream.queue.length === 0 && model.stream.pending.size === 0) { model.reflections.capture(navigation.position, navigation.avatar); app.temporal.reset(); }
  if (!navigationBusy) model.updateStreaming(app.camera, navigation.mode === "orbit" ? app.camera.position : navigation.position, elapsed);
  model.updateVegetation(app.camera, elapsed, quality === 'high');
  app.updateShadows(navigation.mode === 'orbit' ? navigation.orbit.target : navigation.position, navigation.mode);
  app.render();
  $('viewport').dataset.jumpState = JSON.stringify({grounded:navigation.jumpPhysics.grounded,height:navigation.jumpPhysics.height,y:navigation.position.y});
  frameCount++;
  if (elapsed - lastFpsTime >= 1) {
    fps = Math.round(frameCount / (elapsed - lastFpsTime)); frameCount = 0; lastFpsTime = elapsed;
    const stream = model.stream?.stats;
    const texturePending=model.spatialMaterials?.stats.pending;
    if (stream) $('render-label').textContent = stream.failed ? `高清块加载失败 ${stream.failed} · 点击地标重试` : `原始高清 ${stream.resident}/${stream.total} 块 · 资源 ${stream.residentMB} MB${stream.queued + stream.inflight ? ' · 补载中' : texturePending ? ' · 细节加载中' : ''}`;
    $('viewport').dataset.diagnostics = JSON.stringify(window.__CITY_WALK__.state);
    $('fps').textContent = `${fps} FPS`; $('altitude').textContent = `${Math.round(app.camera.position.y)} m`;
  }
}
window.__CITY_WALK__ = {
  get state() { return { city: currentCity?.id, loading, mode: navigation.mode, navigationReady: model?.navigationReady, grounded: navigation.jumpPhysics.grounded, verticalSpeed: navigation.jumpPhysics.velocity, jumpHeight: navigation.jumpPhysics.height,
    stream: model?.stream?.stats, materialDetail: model?.spatialMaterials?.stats, renderSize: [app.renderer.domElement.width, app.renderer.domElement.height], camera: app.camera.position.toArray(), player: navigation.position.toArray(), fps,
    drawCalls: app.temporal.stats?.calls, renderedTriangles: app.temporal.stats?.triangles,
    geometries: app.renderer.info.memory.geometries, textures: app.renderer.info.memory.textures,
    depthMode: app.renderer.capabilities.reversedDepthBuffer ? "reverse" : "log", nearTrees: model?.detailCount, architectureMeshes: model?.meshes.length }; },
};
updateMode('orbit'); animate(); loadCity(location.hash.slice(1) || 'shenzhen');
