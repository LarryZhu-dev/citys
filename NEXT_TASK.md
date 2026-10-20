# 万城纪 2.0 Godot Web：下一任务继续验收

更新时间：2026-10-20。本文用于接续 Godot Web 迁移成果。2.0 的完整本地引擎在线回归已通过；2.0 生产部署与真实生产闭环仍须单独验证，不能用 1.1 的部署状态替代。

## 项目与当前事实

| 项目 | 值 |
| --- | --- |
| 源码分支 | `codex/wanchengji-release`，在现有 Git 仓库中继续 |
| Vercel 项目 | `wanchengji` |
| Vercel 项目 ID | `prj_vLp3krayQRErSYJyoMic8C01dEJ1` |
| 正式地址 | https://wanchengji.vercel.app |
| 健康接口 | https://wanchengji.vercel.app/api/health |
| 历史 1.1 部署 | `dpl_ugErgBDikzSZxdV3DL1aMoTbJbJ7`，平台状态 **READY**，不代表 2.0 已部署 |
| 当前本地实现 | Godot 4.6.3 / Compatibility / WebGL 2 / 单线程 Web，经济与在线服务保留 JavaScript |
| 2.0 新城范围 | 华夏；其他文明的新建入口暂不开放，旧文明存档兼容保留 |
| 在线范围 | 账号、云存档、公开参观、休闲排行、异步玩家交易；没有实时共同建城或战争 |

历史 1.1 游戏提交为 `0726558892d4e3ab5ffb4f8ae9c0b94db2d97dc6`，不包含本轮 Godot 迁移。迁移新任务前必须确认交付分支已包含 `godot/`、`engine-web/`、`js/godot-bridge.js` 及适配后的测试；未提交的工作目录不会自动进入新任务。

Godot 负责世界、相机、地图输入、组件建筑、人物、材质、夜景与主 HUD；`CityBridge` 连接既有 JS 模拟与在线事务。在线账号、存档、参观和市场表单仍使用真实 DOM。旧 Canvas HUD 的 `#foundCity`、`#quickPauseBtn`、`GameArt.ready` 等不能再作为验收入口。引擎实现与导出步骤见 [docs/GODOT.md](docs/GODOT.md)，经济时长与证据边界见 [docs/TIMING.md](docs/TIMING.md)。

用户已连接 Vercel 和 Neon，生产 `DATABASE_URL` 已确认存在；未读取或输出它的值。不要再次要求用户发送数据库连接串、口令或部署令牌。Vercel 连接器使用默认范围可以创建和部署项目；显式团队参数及部分日志接口曾返回 403，不能把它们当作游戏接口返回。

修复前，用户浏览器提供生产健康接口的 `SERVICE_UNAVAILABLE` 503 结果，确认请求已到 API，但数据库未就绪。已修复 Neon / PgBouncer 不兼容的启动超时参数，改为事务内 `SET LOCAL`，并补齐超时、故障连接回收、初始化锁和脱敏诊断。修复已部署，**修复后的线上健康结果及双账号完整验收仍待确认**。

2.0 本地证据：`node --test tests/online.test.cjs` 13 / 13 通过；最终优化导出的 `node tests/browser.cjs` 输出 **GODOT ENGINE PASS**，覆盖双账号注册、公开上传、成交后保留本地新增建筑、只读参观、刷新后云同步基线、v4 云档下载迁移后 v5 回传、丢响应同流水号重试、成交后的列表刷新失败、390×844 移动在线窗口，且无浏览器或引擎脚本错误。测试对每个页面严格等待 `window.godotReady`，不是仅 JS 桥预检。交易暂停一小时后的重试不会补发离线收益。该守恒回归固定浏览器 Date，计时器与真实引擎照常运行；时间经济另有专门回归。

历史数据库证据：一次性 PostgreSQL 17 直连回归 20 通过、1 项仅连接池检查跳过；PgBouncer 1.26.0 严格事务连接池回归 21 / 21 通过，已复现旧参数被拒绝、新存储成功结算。最新全套测试、真实点击与画面验证以 [VALIDATION.md](VALIDATION.md) 为准，不把这些本地结果描述为生产已通过。

## 为什么需要新任务

用户已经在环境 UI 发布了新的网络配置。官方规则是：重新发布环境只作用于新任务，现有任务保留原环境状态。本任务因此仍受旧的包管理器域名白名单限制，代理拒绝目标站点；不要再让用户重复改网络、反复重启，也不要编辑策略文件、清除代理或绕过网络限制。[官方说明](https://help.openai.com/en/articles/20001545-using-codex-cloud) · [环境文档](https://learn.chatgpt.com/docs/environments/cloud-environments)

新任务应选择已经发布的环境和同一源码仓库，检出 `codex/wanchengji-release`。通过 `environment_status` 确认新实例实际策略已生效后再访问站点。新任务不会自动继承旧任务未提交的修改或 `work/`；先确认分支包含本轮 2.0 源码、导出包、上述数据库修复及 `tests/production-smoke.cjs`，不要退回 1.1 的 Canvas 验收路径。

此网络限制与生产数据库 503 是两回事：前者限制本任务的验收工具，后者来自用户浏览器到达正式 API 后的真实失败。

## 继续执行

在含 `package.json` 的游戏目录操作，使用 Node.js 22.9 或以上版本，已验证 Node.js 24。先安装依赖并检查交付分支：

```sh
git branch --show-current
npm ci
npm test
npm run build
npm run test:godot
npm run test:browser
```

两个浏览器套件顺序运行，避免软件 GPU 竞争。`test:godot` 负责真实引擎鼠标/触摸及主 HUD；`test:browser` 通过 `CityBridge.dispatch('new_city', JSON.stringify(...))` 准备城市，然后操作真实在线 DOM，并等待完整引擎 ready。`TEST_BRIDGE_ONLY=1` 仅供排查桥与 API，不得用它替代完整引擎通过。

浏览器验收需要 Chromium、WebAssembly 和 WebGL 2；脚本优先使用 `CHROMIUM_PATH`，然后查找 `/usr/bin/chromium`，否则使用 Playwright 浏览器。若环境未提供浏览器，可用常规 Playwright 安装流程准备，保留继承代理和 CA 配置。仓库内 `engine-web/` 是已导出的压缩运行包，`npm run build` 检查摘要并准备部署；只在修改 GDScript / Godot 美术后按 [导出说明](docs/GODOT.md) 执行 `npm run engine:export`。

确认新环境允许目标站点后，先做只读检查：

```sh
curl --max-time 30 --fail-with-body --silent --show-error https://wanchengji.vercel.app/api/health
```

预期 HTTP 200：

```json
{"ok":true,"storage":"postgres","persistent":true,"production":true,"competitive":false}
```

若仍为 503，记录不含秘密的 `error.code` 与顶层 `diagnostic.category`。新诊断区分连接池参数、认证、权限、TLS、DNS、连接及查询超时；先按实际类别定位，不凭本地复现直接宣称根因。只需要脱敏健康结果，不需要用户提供密钥。若代理明确拒绝目标，停止请求并核对新实例与已发布环境的关联，不能改用直连回避。

确认目标已部署 2.0（入口实际加载 `js/godot-loader.js` 与 `engine-web/`，不是历史 1.1 页面），并且健康检查通过后运行正式生产验收入口：

```sh
SMOKE_BASE_URL=https://wanchengji.vercel.app npm run test:production
```

该命令使用已入源码的 `tests/production-smoke.cjs`，不依赖旧任务被忽略的 `work/production-smoke.cjs`。它显式将继承的 HTTPS/HTTP 代理传给 Chromium 和 Playwright API 上下文，保留 TLS 校验。不要把 `tests/browser.cjs` 指向生产：本地脚本使用固定测试口令，会留下公开城市及额外挂单。

生产脚本严格等待真正的 `godotReady`，通过 Godot 桥创建两座华夏征程新城，再创建两个随机强口令验收账号，实际点击在线表单注册和上传私有 v5 城市；短暂公开卖家城市验证参观、只读行为、返回自己的城市及休闲排行；随后恢复私有，再完成一笔 1 木材 / 1 金币交易，核对双方库存、卖家收款、账本和独立会话恢复。它保持隔离账号会话，只激活一个 WebGL 页面，避免低性能验收机器争用 GPU；生产脚本不固定模拟时间。它也检查引擎脚本错误及 `engine-web`、JS、HUD 资源加载。若有其他玩家抢先买走测试订单，按失败处理并清理，不制造额外交易追赶。本轮未运行生产验收脚本，适配完成不等于生产通过。

## 清理与报告

无论正常完成或 JavaScript 异常，脚本都会分别尝试撤销两个验收账号自己的未成交挂单、以最新云版本将城市设为私有、确认公开详情为 404 且榜单和公开列表不再含测试城市，然后退出会话。撤单失败仍会尝试私有化，不操作其他玩家的数据。

当前没有删号接口，验收账号和已成交/撤销流水会作为私有记录保留；不能报告为“已删除所有测试数据”。进程被强行终止或网络完全中断时，`finally` 清理不保证完成。需检查输出报告的 `success` 和所有 `cleanup` 项。

产物位于 Git 忽略的 `work/`：

- `work/production-smoke-*-report.json`：检查与清理结果，不含账号口令。
- `work/production-smoke-*.png`：浏览器截图。
- `work/private/production-smoke-*.json`：含验收账号口令的清理恢复文件，文件权限 0600、目录 0700。不得提交、上传为交付件或打印内容；未完成清理前不要丢失。

如清理失败，保留原恢复文件，在同一目标上只重试清理，不再创建新账号：

```sh
SMOKE_RECOVER_FILE=work/private/production-smoke-实际编号.json npm run test:production
```

恢复文件包含原目标地址。若迁移任务时需要继续清理，应以受控方式保留该文件，不能把含口令文件推入仓库。脚本执行成功后，把脱敏结论、执行时间与部署版本补入 `VALIDATION.md`；截图或报告也应先检查内容再作为交付件分享。

## 重要剩余验收

1. 确认修复版本生产健康为 PostgreSQL / persistent / production，并完成上述真实生产闭环；未完成前不声称在线功能已经正式验收。
2. 生产额外验证“卖家挂单后继续本地建造、其他玩家成交、卖家同步仍保留新增建筑”，以及真实弱网下的同流水号重试与旧版本冲突处理。当前本地浏览器与数据库回归已覆盖这些核心行为，但生产 smoke 只做最小成交，不包含继续建造的完整情景。
3. 在真实 iOS / Android 设备、Safari、较慢网络和密集夜景下检查操作与帧率；已有桌面 Chromium 和手机尺寸模拟不等于真实设备验收。
4. 对生产数据库进行容量评估，配置自动备份并在隔离环境恢复演练；不得把破坏性集成测试指向生产。`TEST_DATABASE_URL` / `TEST_PGBOUNCER_URL` 仅供可丢弃数据库。

排行榜为客户端模拟的休闲榜，不具有竞技防作弊保证；沙盒不能上榜或挂单。账户恢复/修改密码尚未实现。2.0 首发专注华夏，使用新组件图集、逐阶段施工、材质夜景与真实道路通勤；其余文明不作为新建可选项。新存档 v5 使用真实时间：生产批次 5–30 分钟，施工分钟至约 30 小时；离线自动经营上限 8 小时、既有施工上限 72 小时，是本作便利规则，并非已证实的原作规则。运行时暂停和在线事务冻结经济；关闭后重载按离线规则处理。v4 旧档保留建设完成比例，不能重置玩家城市。继续工作时保留这些范围说明，不把现有作品描述成已全面超过商业原作。
