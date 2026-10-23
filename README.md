# World City / 四城模型与本地漫游归档

北京、上海、广州、深圳的原始 Blender 工程，以及 Three.js 本地城市漫游网站。私有归档；未部署在线网站。本地预览服务已按要求停止。

## 下载和恢复

需安装 Git LFS、Python 3.9+、Node.js 20.19+ 或 22.12+。

```sh
git lfs install
git clone https://github.com/zstar1003/worldcity.git
cd worldcity
git lfs pull
python3 scripts/restore_assets.py
cd city-explorer
npm ci
npm run dev
```

浏览器打开 http://127.0.0.1:4173/ 。停止服务按 Ctrl+C。构建用 `npm run build`，测试用 `node --test tests/*.test.mjs`。

## 内容

- `city-explorer/`：网站代码、锁定依赖清单、转换工具、测试、说明。
- `archives/source-*.tar.gz`：四城原始工程、模型各版本及其关联数据、贴图、脚本和许可证。
- `archives/browser-*.tar.gz`：网页完整建筑 GLB、无减面分块、植被、原材质纹理、HDR、游客角色与显示 LUT。
- `archives/manifest.json`：每个归档及其中每个文件的大小、SHA-256，供恢复后完整性验证。

模型采用无损压缩归档并通过 Git LFS 存储，不做减面或纹理重采样。恢复脚本保留目录结构，遇到本地修改文件会停止而非覆盖。没有上传可重新生成的 node_modules、dist，以及渲染视频、临时日志和诊断缓存。本地原件全部保留。GitHub 默认 ZIP 下载可能只有 LFS 指针，请按上面命令克隆并运行 git lfs pull。

网站支持第一/第三人称、行走、跳跃、按视野加载建筑。多层玻璃与间接光仍与 Blender 离线渲染有差异。原城市资产权利以用户及各工程原许可证为准；角色和其他第三方来源说明随资产保留，本仓库不重新授予所有模型的统一许可。
