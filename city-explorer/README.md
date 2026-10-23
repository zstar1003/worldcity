# 在城 · City Walk

本地四城高精度建筑漫游：北京、上海、广州、深圳。浏览器地址：http://127.0.0.1:4173/ 。所有模型由本机提供，没有上传云端。

## 启动

在本目录运行 `npm run dev`，或双击 `启动本地漫游.command`。如已有服务运行，直接打开浏览器地址。需安装 Node.js；依赖已经装在本目录。`npm run build` 生成 dist，`npm run preview` 预览构建。

## 操作

- 自由观察：拖动旋转、右键平移、滚轮缩放。
- 第一人称：WASD / 方向键移动，拖动环视或单击画面锁定鼠标，Esc 释放。
- 第三人称：WASD 行走，拖动改变朝向，滚轮调整跟随距离。Shift 加速，空格或屏幕“跳跃”按钮起跳；落地后可再次跳跃。
- 右侧地标可直接进入街道；返回城市全景可回到原始观景相机。
- 原生高清 / 流畅显示仅调整屏幕采样与阴影，不减建筑面数。

## 保真范围

建筑使用完整求值后的网格，保留原始贴图尺寸；不减面、不量化。四城建筑约 594–1245 万三角面。原始 .blend 未改动，哈希和导出统计见 audit/。

建筑真正按视野从独立 GLB 文件请求，不再先下载整座城。四城分别为北京 722、上海 427、广州 974、深圳 1067 个空间块。250×160×250 米单元按三角面质心分配，保存所有原始属性字节和节点变换。远处可见的天际线仍加载完整几何；附近 180 米和扩展视锥提前加载。每次 3 个请求，离开视野后保留 4–12 秒再释放；650 MiB 是离屏缓存回收目标，不会用减面强制压低可见几何。全景仍可能需要大部分资源。

原始图片原尺寸保留。170 个此前丢失空间变化的程序材质从原 Blender 节点生成 2K 图，含窗格、道路和铺装。按材质最近可见距离使用 256 / 1024 / 2048 纹理层：240 米以内请求 2K、1200 米以内请求 1K，含滞回区间；离开视野后释放。原尺寸 2K 文件不变。范围极大的同材质表面可能保持高层级，显存占用取决于当前视野。详见 audit/SPATIAL_MATERIALS.md。

原场景大量重复树木展开后可达数十亿三角面。近景 65 米内按距离加载原树网格，高质量最多 16 棵且约 500 万面预算（单棵超预算时优先保留最近一棵）；流畅模式 8 棵 / 200 万面。远处仍为原树渲染的透明图，层级切换可见。真实树木只在进入漫游后加载。

这是建筑模型的实时 PBR 版本，不是实景扫描。程序窗格空间图案恢复，但三维 Noise 平面采样后的全域相位、玻璃折射、体积、位移和间接光不等同于离线 Cycles。不会凭空增加源模型中没有的街景细节。

## 资源校验与重建

- `python3 tools/build_stream_tiles.py`：从原 architecture.glb 生成无减面的独立块。
- `python3 tools/compact_stream_metadata.py`：去除每块未使用的材质元数据。
- `python3 tools/verify_stream_tiles.py`：独立比较全部三角形位置/法线/UV 指纹、材质归属、对象变换和原图片字节；报告 audit/stream-fidelity.json。
- 原节点纹理脚本及独立验证见 audit/SPATIAL_MATERIALS.md。
- `node tests/stream.test.mjs` 验证前后视锥、远景保留、离屏回收、材质坐标及批处理三角面守恒。

## 画面稳定处理

- 优先使用浮点反向深度，浏览器不支持时回退对数深度，减少大型城市中相邻表面的深度冲突。
- 4× MSAA、植被 alpha-to-coverage 平滑叶片轮廓。
- 8 相位亚像素采样、深度重投影、邻域颜色裁剪的时间抗锯齿；切城、切视角、传送及窗口缩放时清空历史。
- 原生屏幕分辨率；移动时降低历史帧权重，减少拖影与过度柔化。
- 材质使用 mipmap 和最大各向异性过滤，纹理层级采用滞回避免反复切换。
- 自然比例东亚成年男性游客，保留原皮肤/服装纹理；Idle / Walk / Run 重定向、世界轴跳跃姿态、地面和屋顶扫掠碰撞、接触阴影。跳跃高度约 0.81 米，禁止空中二段跳。

在集成 GPU 上完整城市全景比街道视角更重。页面左下显示当前实测 FPS；性能取决于显卡、分辨率和取景范围。

## 资源来源

城市资源来自此工作区用户已有模型。当前人物使用 Microsoft Rocketbox 官方 Male_Adult_09（MIT），7426 三角面、80 骨骼、原始 2K 贴图尺寸，黑色上衣/牛仔裤/运动鞋。来源及完整许可证位于 public/characters/rocketbox-male-09/。来源没有声明国籍，网站中作为虚构的中国游客形象。

https://github.com/microsoft/Microsoft-Rocketbox/tree/master/Assets/Avatars/Adults/Male_Adult_09

Idle / Walk / Run 动作继续使用 Three.js r180 示例 Soldier.glb（示例注明来自 Mixamo），经过 A→T 姿态校准后重定向。跳跃由导航物理与程序姿态驱动。原示例文件和许可证保留在 public/characters/。

## 源渲染外观恢复

四城 render-settings.json 保存原 Blender 世界强度、方向、曝光以及建筑材质镀膜参数。网页使用从原 Blender OCIO 生成的 64³ RGBA16F LUT，还原 AgX Medium High Contrast；只应用一次 .3 EV 曝光，输出不再二次套 sRGB。实测色彩误差见 audit/RENDER_DIFFERENCES.md。

玻璃恢复原镀膜 IOR/F0、镀膜下层吸收颜色；广州自定义 Transparent/Glossy 材质不再转换为金属漆，保留透明分支、原混合反射强度和颜色。Fresnel 混合使用 Schlick 近似，不等同于完整 Cycles 节点图。天空反射按原角度旋转，取消额外半球补光。反向深度阴影在首次绘制前初始化。

玻璃使用 1024 像素本地立方体反射探针：进入全景/地标时采集已加载的建筑，行走跨越 100 米后停下且分块载完时更新。原 HDR 继续照明场景。探针关闭人物并回到原 HDR 采集，避免自反射反馈；它是附近场景反射的近似，不能提供逐表面准确的光线追踪和不可见/未加载建筑反射。

## GitHub Pages 部署

推送 main 后，`.github/workflows/pages.yml` 自动下载并校验五个 browser 归档、运行测试，再发布四城网站。原始 Blender 工程保留在仓库 LFS 归档中，不进入网页发布包。

Pages 使用 `/worldcity/` 路径。`scripts/prepare_pages.py` 对运行时 GLB、JSON、LUT 二进制使用 gzip 无损压缩，并按 SHA-256 合并完全相同的资源；每份压缩资源都校验解压字节与原件一致。不会减面、量化顶点或缩小贴图。未使用的整城 architecture.glb 副本和旧角色不进入部署包。浏览器通过 DecompressionStream 解压后，继续按原有视野分块加载。发布体积约 968 MiB，接近 Pages 的容量上限。

本地复现线上构建：

```sh
python3 scripts/prepare_pages.py
cd city-explorer
npm run build:pages
npx vite preview --outDir dist-pages --base /worldcity/
```

首次加载需要下载当前视野的高清模型，速度受网络和设备性能影响；建议使用桌面端现代浏览器。此站点为 WebGL 实时渲染，并不等同于 Blender 离线渲染效果。
