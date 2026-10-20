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
- `godot/world/buildings.gd`、`building_parts.gd`：中尺度建筑组件、逐阶段施工、升级、生产、灯火与真实地面深度排序。
- `godot/world/citizens.gd`：持久居民、道路通勤、四朝向步态。
- `godot/ui/hud.gd`、`minimap.gd`：纹理 HUD、响应式面板、目录、库存、档案、舆图。
- `js/godot-bridge.js`：动作校验、旧档桥、自动存档与在线窗口互操作。
- `js/simulation.js`、`data.js`：真实时间经营、离线结算、服务与人口。
- `js/online.js`：真实账户/云存/公开参观/排行/原子交易；账户输入等表单保留 HTML，使用同一套原画素材。

逻辑格投影为 `(x−y)×64, (x+y)×32`。建筑构件、植被与居民共享地面排序空间，屋顶的高度只改变视觉子节点偏移。相机缩放不生成 CPU 像素缓存。地表噪声纹理与地形/道路掩码仅在种子或布局变化时更新。

Godot GUI 使用官方触摸鼠标仿真，并启用 Web 移动虚拟键盘；地图过滤仿真的鼠标事件，仅处理真实 ScreenTouch/Drag，避免一次触摸产生两次建造。HUD 以 CSS 像素计算布局和安全区，不把桌面控件整张缩小到手机。

## 美术与原作研究

原作参考包括[玩法介绍](https://www.taptap.cn/moment/15204415484987958)、[华夏城市截图](https://www.ourplay.net/rank/detail/118382)、[Steam 城市与夜景画面](https://steamcommunity.com/app/1041710)、[华夏布局参考](https://www.7723.cn/strategy/81194.html)。参考用途为城市密度、层次、屋瓦尺度和暖灯/冷环境关系；没有把原作素材导入本作。

本轮生成中尺度完整瓦顶、屋脊、粉墙翼、营业店面、工坊、院门、院墙与炉体，再用不同配方组装建筑。精致结构细节保留在原画中；施工使用地基、骨架、墙体、屋面与完工细节阶段，升级可以拆换旧顶。新增独立资源和动作原画、四种九切面板、四朝向工匠以及自然树木。原图、提示词和机械图集工具保存在对应 `godot/art/*/sources/`，该目录由 `.gdignore` 排除运行导入。

夜景是每种材质的冷月光着色与独立暖色发光层，不使用 DOM 压暗整个游戏。美术应以实际地图截图判断，原画精度不等于最终拼装质量。缩小纹理开启 mipmap，避免细瓦和树叶闪烁；源分辨率、占地和锚点由组件元数据控制。

## 经营与验证边界

新建城市仅开放华夏，其他地区显示未开放。旧文明存档的数据继续兼容；新美术和首发平衡专注华夏。建设从分钟延伸到小时/约 30 小时的华夏奇观，生产批次 5–30 分钟。完整原作数值表未得到验证，本作自拟与有来源的历史数字分开记录于 [TIMING.md](TIMING.md)。

运行中的暂停与在线事务会冻结经济并消费时钟水位；关闭页面后重新载入则按离线规则结算。离线自动经营最多 8 小时、既有施工最多 72 小时；这是本作便利规则，不声称是原作规则。自由营造提供 1/4/60 倍，征程始终按真实时间。

自动化覆盖经济、存档迁移、账户与交易以及 Godot Web 的真实鼠标/触摸。软件 GPU 的 Headless Chromium 性能数据不能代替 iPhone/Android 真机结果；不以同步绘制函数的耗时冒充实际帧率。完整测试结果与线上验收状态见根目录 `VALIDATION.md`。

## 当前发布

2026-10-20 的正式部署由 GitHub 固定提交 `ec00cd196dab306d626003af78b3b082bf3c5e47` 构建，地址 https://wanchengji.vercel.app 。部署 READY 和本地浏览器通过的范围见 `VALIDATION.md`；生产健康、真实手机持续性能仍未完成验收。
