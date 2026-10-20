# 万城纪：下一任务继续验收

更新时间：2026-10-20。本文用于在新 Codex Cloud 任务中接续现有成果，不能据此声称线上业务已经验收通过。

## 项目与当前事实

| 项目 | 值 |
| --- | --- |
| 源码分支 | `codex/wanchengji-release`，在现有 Git 仓库中继续 |
| Vercel 项目 | `wanchengji` |
| Vercel 项目 ID | `prj_vLp3krayQRErSYJyoMic8C01dEJ1` |
| 正式地址 | https://wanchengji.vercel.app |
| 健康接口 | https://wanchengji.vercel.app/api/health |
| 本次修复部署 | `dpl_BFx8ZVaToeKfpkT1wH7ZtPZnEFV8`，平台状态 **READY** |
| 在线范围 | 账号、云存档、公开参观、休闲排行、异步玩家交易；没有实时共同建城或战争 |

用户已连接 Vercel 和 Neon，生产 `DATABASE_URL` 已确认存在；未读取或输出它的值。不要再次要求用户发送数据库连接串、口令或部署令牌。Vercel 连接器使用默认范围可以创建和部署项目；显式团队参数及部分日志接口曾返回 403，不能把它们当作游戏接口返回。

修复前，用户浏览器提供生产健康接口的 `SERVICE_UNAVAILABLE` 503 结果，确认请求已到 API，但数据库未就绪。已修复 Neon / PgBouncer 不兼容的启动超时参数，改为事务内 `SET LOCAL`，并补齐超时、故障连接回收、初始化锁和脱敏诊断。修复已部署，**修复后的线上健康结果及双账号完整验收仍待确认**。

本地证据：本轮 `npm test` 64 项中 62 通过、2 项专用数据库检查跳过；一次性 PostgreSQL 17 直连回归 20 通过、1 项仅连接池检查跳过；PgBouncer 1.26.0 严格事务连接池回归 21 / 21 通过。真实复现旧参数被拒绝，新存储成功完成在线结算。`npm run build` 与 `git diff --check` 已通过。详情见 [VALIDATION.md](VALIDATION.md)。

## 为什么需要新任务

用户已经在环境 UI 发布了新的网络配置。官方规则是：重新发布环境只作用于新任务，现有任务保留原环境状态。本任务因此仍受旧的包管理器域名白名单限制，代理拒绝目标站点；不要再让用户重复改网络、反复重启，也不要编辑策略文件、清除代理或绕过网络限制。[官方说明](https://help.openai.com/en/articles/20001545-using-codex-cloud) · [环境文档](https://learn.chatgpt.com/docs/environments/cloud-environments)

新任务应选择已经发布的环境和同一源码仓库，检出 `codex/wanchengji-release`。通过 `environment_status` 确认新实例实际策略已生效后再访问站点。新任务不会自动继承旧任务未提交的修改或 `work/`；先确认分支包含上述修复和 `tests/production-smoke.cjs`，不要从旧半成品重新开始。

此网络限制与生产数据库 503 是两回事：前者限制本任务的验收工具，后者来自用户浏览器到达正式 API 后的真实失败。

## 继续执行

在含 `package.json` 的游戏目录操作，使用 Node.js 22.9 或以上版本，已验证 Node.js 24。先安装依赖并检查交付分支：

```sh
git branch --show-current
npm ci
npm test
npm run build
```

浏览器验收需要 Chromium；脚本优先使用 `CHROMIUM_PATH`，然后查找 `/usr/bin/chromium`，否则使用 Playwright 浏览器。若环境未提供浏览器，可用常规 Playwright 安装流程准备，保留继承代理和 CA 配置。

确认新环境允许目标站点后，先做只读检查：

```sh
curl --max-time 30 --fail-with-body --silent --show-error https://wanchengji.vercel.app/api/health
```

预期 HTTP 200：

```json
{"ok":true,"storage":"postgres","persistent":true,"production":true,"competitive":false}
```

若仍为 503，记录不含秘密的 `error.code` 与顶层 `diagnostic.category`。新诊断区分连接池参数、认证、权限、TLS、DNS、连接及查询超时；先按实际类别定位，不凭本地复现直接宣称根因。只需要脱敏健康结果，不需要用户提供密钥。若代理明确拒绝目标，停止请求并核对新实例与已发布环境的关联，不能改用直连回避。

健康检查通过后运行正式生产验收入口：

```sh
SMOKE_BASE_URL=https://wanchengji.vercel.app npm run test:production
```

该命令使用已入源码的 `tests/production-smoke.cjs`，不依赖旧任务被忽略的 `work/production-smoke.cjs`。它显式将继承的 HTTPS/HTTP 代理传给 Chromium 和 Playwright API 上下文，保留 TLS 校验。不要把 `tests/browser.cjs` 指向生产：本地脚本使用固定测试口令，会留下公开城市及额外挂单。

生产脚本会创建两个随机强口令验收账号，实际点击浏览器注册和上传私有城市；短暂公开卖家城市验证参观、只读行为、返回自己的城市及休闲排行；随后恢复私有，再完成一笔 1 木材 / 1 金币交易，核对双方库存、卖家收款、账本和独立会话恢复。它也检查页面错误和运行资源加载。若有其他玩家抢先买走测试订单，按失败处理并清理，不制造额外交易追赶。

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

排行榜为客户端模拟的休闲榜，不具有竞技防作弊保证；沙盒不能上榜或挂单。账户恢复/修改密码尚未实现。本轮华夏已采用 30 个新部件装配 42 种非道路建筑，住宅 10/6 级逐级扩建；其余四文明保留整栋资产和三档住宅美术。新增不规则地形只应用于新城市，不能为展示效果重置玩家旧档。继续工作时保留这些范围说明，不把现有作品描述成已全面超过商业原作。
