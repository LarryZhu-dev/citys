# Godot Web 实现

本项目使用 Godot 4.6.3、GDScript、Compatibility/WebGL 2、单线程 Web 导出。Godot 实际负责地图、相机、世界输入、建筑组件、人物、着色器、覆盖层和游戏 HUD。经济与旧档适配继续使用经过回归的 JavaScript，通过 `JavaScriptBridge.get_interface("CityBridge")` 交换快照和操作。不是在 Godot 窗口里展示旧 Canvas 游戏。

## 本地运行与导出

仓库中的 `engine-web/` 是已导出的运行产物，`npm ci && npm start` 即可运行，不要求每位玩家安装 Godot。Web 需要 WebAssembly 与 WebGL 2。`godot/main.gd` 当前按 Web 浏览器桥启动，直接按编辑器 F6 不会运行 JavaScript 经济；请导出后经 HTTP 打开。

修改 Godot 源码后安装 Godot **4.6.3** 与对应官方 Web 导出模板，解压 `web_nothreads_release.zip` 与 `web_nothreads_debug.zip` 至 `work/godot-toolchain/templates/`，然后执行：

```sh
npm run engine:export
npm run build
npm run test:godot
npm run test:browser
```

导出脚本先检查 GDScript 导入错误，再打包并生成 SHA-256 清单。`.wasm.gz` 与 `.pck.gz` 是可部署原件，`server/build.cjs` 验证解压摘要后按引擎需要的文件名发布。HTTP 显式发送 `Content-Encoding: gzip` 和正确 WASM MIME；Vercel 无需安装 Godot。CSP 仅新增 `wasm-unsafe-eval`，没有开放 JavaScript `unsafe-eval`。

## 场景与数据

- `godot/main.gd`：浏览器桥、场景装配、低频快照同步。
- `godot/world/world.gd`：64×64 世界、相机、鼠标/触摸与 GPU 地表。
- `godot/world/buildings.gd`、`building_parts.gd`：单个图片构件、逐件施工、升级、生产、灯火与地面深度排序。
- `godot/world/construction_workers.gd`：工地搬运、安装、返程与离场，使用真实施工时钟和构件安装点。
- `godot/world/citizens.gd`：持久物流任务的可视化、取水与补货人物、载货/空车返程、连续位置插值。
- `godot/ui/hud.gd`、`minimap.gd`：纹理 HUD、响应式面板、目录、库存、档案、舆图。
- `js/godot-bridge.js`：动作校验、旧档桥、自动存档与在线窗口互操作。
- `js/simulation.js`、`data.js`：真实时间经营、离线结算、服务与人口。
- `js/online.js`：真实账户/云存/公开参观/排行/原子交易；账户输入等表单保留 HTML，使用同一套原画素材。

逻辑格投影为 `(x−y)×64, (x+y)×32`。建筑构件、植被与居民共享地面排序空间，屋顶的高度只改变视觉子节点偏移。相机缩放不生成 CPU 像素缓存。地表噪声纹理与地形/道路掩码仅在种子或布局变化时更新。

墙面、门窗、布面、瓦排各自投影到对应的等距平面，柱梁和器物通过独立锚点定位。纹理四边形只承载单个图片构件，不使用整栋图片或几何建筑作为后备。道路材质由已建成住宅等级与美化决定，施工目标等级不提前改变路面。矿产按连通区域生成连续高度场，采场占地压平以减少遮挡。

建筑叶片保留独立节点，但通过 `draw_primitive` 提交原图片三角面，使 GLES3 能合并连续批次；不采用逐项打断批次的 `Polygon2D`。72 张构件图片在一个 4096×4096 图集中保持原始像素，通过各自 UV 取样。合批不生成整栋图片，也不把人物与相邻楼的深度排序压成单个建筑层级。

`logisticsSnapshot()` 向 Godot 提供真实任务、路线、阶段、货物与连续位置；人物不再自行随机生成通勤。生产成品先成为在途货物，卸货才加入库存；水和商铺存货保存在各建筑内。存档保留任务身份及路段进度，云端校验数量、路线、阶段与货物数值。旧 v5 存档兼容初始化，保留库存且不凭空补发运输产物。

Godot GUI 使用官方触摸鼠标仿真，并启用 Web 移动虚拟键盘；地图过滤仿真的鼠标事件，仅处理真实 ScreenTouch/Drag，避免一次触摸产生两次建造。HUD 以 CSS 像素计算布局和安全区，不把桌面控件整张缩小到手机。

## 美术与原作研究

原作参考包括[玩法介绍](https://www.taptap.cn/moment/15204415484987958)、[华夏城市截图](https://www.ourplay.net/rank/detail/118382)、[Steam 城市与夜景画面](https://steamcommunity.com/app/1041710)、[华夏布局参考](https://www.7723.cn/strategy/81194.html)。参考用途为城市密度、层次、屋瓦尺度和暖灯/冷环境关系；没有把原作素材导入本作。

原先整顶、房屋翼、炉体和帐篷图片全部弃用，并删除 `godot/art/architecture/` 与历史 Canvas 素材。新建筑图片仅来自 `godot/art/components/`：基础石块、台阶、柱梁、墙段、独立门窗、斜撑、斗拱、椽条、短瓦排、檐条、脊帽、布面和生产器具。帐篷用立杆、布面与绳索组装，窑炉使用局部砌体、炉口和逐层烟道，屋面用短排连续覆盖。

每个构件有稳定标识、图片来源、地面锚点、尺度、朝向和安装阶段。施工显示这些实际构件，完工继续保留原节点；升级保留未改变的构件并拆换发生变化的部分。工人使用权威工程时间执行搬运、安装和返回，暂停、断路与参观冻结动作，完成后离场。原图、完整提示词及机械裁切图集工具保存在对应 `godot/art/*/sources/`，该目录由 `.gdignore` 排除运行导入。

夜景是每种材质的冷月光着色与独立暖色发光层，不使用 DOM 压暗整个游戏。美术应以实际地图截图判断，原画精度不等于最终拼装质量。缩小纹理开启 mipmap，避免细瓦和树叶闪烁；源分辨率、占地和锚点由组件元数据控制。

## 经营与验证边界

新建城市仅开放华夏，其他地区显示未开放。旧文明存档的数据继续兼容；新美术和首发平衡专注华夏。建设从分钟延伸到小时/约 30 小时的华夏奇观，生产批次 5–30 分钟。完整原作数值表未得到验证，本作自拟与有来源的历史数字分开记录于 [TIMING.md](TIMING.md)。

运行中的暂停与在线事务会冻结经济并消费时钟水位；关闭页面后重新载入则按离线规则结算。离线自动经营最多 8 小时、既有施工最多 72 小时；这是本作便利规则，不声称是原作规则。自由营造提供 1/4/60 倍，征程始终按真实时间。

自动化覆盖经济、存档迁移、账户与交易以及 Godot Web 的真实鼠标/触摸。软件 GPU 的 Headless Chromium 性能数据不能代替 iPhone/Android 真机结果；不以同步绘制函数的耗时冒充实际帧率。完整测试结果与线上验收状态见根目录 `VALIDATION.md`。

## 当前发布

2026-10-20 的 2.1 独立图片构件版由 GitHub 固定提交 `288ed36a7b9f92dd5b454f345d681c2564b3079d` 构建，部署 `dpl_H48dPZXLTp8SV5F1SeUfxvMKEPfF` 已 READY，正式域名 https://wanchengji.vercel.app 已绑定。实际浏览器通过范围与仍低的软件 GPU 帧率见 [VALIDATION.md](../VALIDATION.md)；生产健康、真实手机持续性能仍未完成验收。
