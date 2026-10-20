# 万城纪：部署、运维与在线接口

2026-10-20 已发布 **2.0 Godot Web** 至 https://wanchengji.vercel.app 。Vercel 返回 READY、aliasError:null，正式域名已指向该版本。

- 源码：`f09ce363bcf17412dce3cf16d67029dd4d27276a`，分支 `codex/wanchengji-release`。
- 部署：`dpl_G56kMxriHDk4ypkF6rfMUiAAT48h`，通过 GitHub 固定提交构建，Node.js 24、区域 iad1。
- 不变地址：https://wanchengji-d25hieuu7-larry-zhus-projects-e7157b21.vercel.app 。
- 产物：Godot 4.6.3 Compatibility 单线程；WASM gzip 9,471,510 bytes、PCK gzip 33,040,012 bytes，摘要见 `engine-web/manifest.json`。

用户已连接 Neon，生产 `DATABASE_URL` 变量已确认存在，未读取值。历史健康检查返回503；连接池兼容性修复此前随1.1发布，本地数据库回归通过，但**生产健康和真实双账号线上流程仍未复验**。当前执行环境出站策略及连接器403阻止直接验收；没有再次要求用户提供密钥或重复应用同一环境配置。READY 仅证明构建与域名发布成功。

连接池修复移除了 PostgreSQL 启动报文中的 `options`，改用同一事务内的 `SET LOCAL statement_timeout` 和 `SET LOCAL lock_timeout`，保留 TLS 校验；查询异常时销毁连接，避免超时后复用未完成的事务。严格 PgBouncer 1.26 回归真实复现了旧参数被拒绝，新实现通过全部 21 项数据库及 HTTP 测试。这个结果证明修复有效，但尚不能单独认定它就是生产 503 的唯一原因。[Neon 官方说明](https://neon.com/docs/connect/connection-errors#unsupported-startup-parameter)

## 1. 本地运行与目录

使用 Node.js 22.9 或以上版本；本项目已在 Node.js 24 验证。

```sh
npm ci
cp .env.example .env
npm start
```

打开 `http://localhost:3000`。`npm start` 同时提供游戏与 `/api`，默认监听 `0.0.0.0:3000`；开发热重启使用 `npm run dev`。不要以直接打开 `index.html` 或仅运行静态文件服务器的方式验证在线功能。

未提供数据库且不是生产环境时，账号、云存档和交易真实写入 `work/local-online.json`。写入使用进程内队列、临时文件、`fsync` 和原子替换。这个适配器只支持**单进程本地开发**，不是多副本或 Serverless 的生产存储。删除它会丢失开发账号与所有在线记录。

| 路径 | 用途 |
| --- | --- |
| `js/`、`assets/`、`index.html`、CSS | 浏览器游戏与美术资源 |
| `server/` | API、校验、持久化与本地 HTTP 服务 |
| `api/index.js` | Vercel Node 函数入口 |
| `public/` | `npm run build` 生成的静态发布文件 |
| `.env`、`work/` | 本地配置和开发数据；已排除出 Git |
| `tests/online.test.cjs` | 真实 HTTP 集成测试 |

`public/` 发布 HTML/CSS、六个运行时 JS、Godot Web 引擎/资源包和七张在线表单共用美术。`engine-web/game.wasm.gz` 与 `game.pck.gz` 由已审核 Godot 源码导出；构建校验 SHA-256 后以原扩展名输出压缩数据，`vercel.json` 为它们显式设置 `Content-Encoding: gzip` 与 MIME。Godot 导出无需在 Vercel 重跑。不要删除这两个编码响应头，否则浏览器不能加载引擎。CSP 允许 `wasm-unsafe-eval`，未开放普通 JavaScript `unsafe-eval`。

原始图集、旧 Canvas、旧精灵、生成脚本和测试文件不发布为静态网页；账号数据和 `.env` 不进入构建。本地服务使用相同压缩响应和静态文件白名单。

## 2. 环境变量

| 变量 | 设置与作用 |
| --- | --- |
| `DATABASE_URL` | 生产必需。PostgreSQL 连接字符串；Vercel 推荐供应商提供的连接池地址 |
| `APP_ORIGIN` | 正式游戏的准确来源，如 `https://game.example.com`，不要带路径或末尾 `/`；用于写请求同源验证 |
| `NODE_ENV` | 私人服务器生产环境设为 `production`；该模式禁止本地文件后端 |
| `VERCEL` | Vercel 自动提供；不要为了绕开生产校验而删除或伪造 |
| `PORT` | 本地/私人服务器端口，默认 `3000`；Vercel 函数不使用它监听端口 |
| `HOST` | 本地监听地址，默认 `0.0.0.0`；私人服务器反向代理部署建议 `127.0.0.1` |
| `DATA_FILE` | 仅开发文件后端可用；默认 `work/local-online.json` |
| `TEST_DATABASE_URL` | 只供集成测试连接独立、可丢弃的 PostgreSQL 测试库 |

`DATABASE_URL` 必须是 PostgreSQL 驱动连接串，不能填 Supabase 项目 HTTP URL、匿名访问密钥或服务角色 API 密钥。供应商可能自动注入 `POSTGRES_URL` 等变量；本代码只读取 **`DATABASE_URL`**，需要将正确连接串明确配置到这个名字。

连接串示意，不包含可用凭据：

```text
postgresql://USER:PASSWORD@POOL_HOST:5432/DATABASE?sslmode=verify-full
```

密码中的特殊字符需要 URL 编码。使用供应商推荐的 TLS 参数和受信任证书；代码不会设置 `rejectUnauthorized:false`。每个应用实例的 `pg` 连接池上限为 3，连接超时 5 秒；SQL 执行与锁等待也有超时。项目自动创建 `citys_documents` 表，数据库角色需要相应建表和表读写权限。

## 3. Vercel + PostgreSQL 部署

Vercel 当前通过 Marketplace 接入外部 PostgreSQL，可选择 Neon、Supabase 等供应商；不应再按旧教程寻找独立的第一方 Vercel Postgres 产品。Serverless 应优先使用供应商支持的连接池连接。[官方存储说明](https://vercel.com/docs/marketplace-storage)

1. 在供应商创建数据库，将其区域尽量设在 Vercel 函数所在区域附近；取得支持事务的 PostgreSQL 连接池 URL。数据库的免费额度、备份保留期和休眠规则由所选方案决定。
2. 在 Vercel 导入仓库，Root Directory 指向包含 `package.json` 与 `vercel.json` 的游戏目录。Framework Preset 选择 **Other**，Node.js 选择支持的 22.x 或 24.x。
3. Install Command 设置 `npm ci`，Build Command 为 `npm run build`，Output Directory 为 `public`。后两项已由 `vercel.json` 指定。
4. 在 Vercel Project Settings → Environment Variables 添加生产 `DATABASE_URL`。确认正式域名后设置 `APP_ORIGIN`，例如 `https://你的项目.vercel.app`。
5. Preview 使用**独立测试数据库**。不要让临时分支代码和生产共用账号、交易与流水。Preview 的域名可能变化，可以不设置 Preview 的 `APP_ORIGIN`，让代码按当前 HTTPS Host 验证；生产建议固定域名。
6. 部署或重新部署。修改环境变量后必须产生新部署，让新配置生效。添加自定义域名后，也应同步更新 `APP_ORIGIN` 并重新部署。
7. 执行下方验收步骤，再开放给玩家。

静态文件与函数属于同一次 Vercel 部署，不需要单独运行 `npm start`。`outputDirectory` 控制静态发布目录；根目录 `api/` 下的 Node 函数由平台构建，函数依赖会包含 `server/` 与 `pg`。[官方项目配置](https://vercel.com/docs/project-configuration/vercel-json)

如果按文件列表上传源码，必要集合是 `package.json`、`package-lock.json`、`vercel.json`、`api/`、`server/`、HTML/CSS、`js/`，以及上述运行美术文件。不要上传 `work/`、`tests/`、`research/`、原始 PNG、旧版 `game.js`、本地 `.env`、`node_modules/` 或已有 `public/`；云端会重新安装依赖并构建。Git 部署可以保留源码原始素材，构建白名单会阻止它们进入静态输出。

### API 路由兼容性

本项目没有使用 Next.js，因此不依赖 `[...path].js` 的 Next.js 捕获路由。配置采用一个明确的 Node 入口：

```json
{
  "functions": { "api/index.js": { "maxDuration": 30 } },
  "rewrites": [
    { "source": "/api/:__path*", "destination": "/api/index" }
  ]
}
```

Vercel 将来源中捕获的 `__path` 转为函数查询参数。例如 `/api/account/login` 到达同一个函数并携带 `__path=account/login`；`server/vercel.cjs` 恢复业务路径后交给 API。已使用官方 `@vercel/routing-utils` 编译此配置，转换结果无错误，并检查了多层交易路径。入口还兼容 Vercel 提供的已解析 `request.body`，损坏 JSON 的惰性 getter 会返回 400。[官方重写说明](https://vercel.com/docs/routing/rewrites) · [官方 Node 函数说明](https://vercel.com/docs/functions/runtimes/node-js)

这是配置与入口的本地验证，**不能代替在目标 Vercel 项目进行一次真实部署验收**。当前生产构建已完成，目标域名及未完成的线上检查见本文开头。

### 发布后的验收

```sh
curl -i https://你的正式域名/api/health
```

应返回 HTTP 200，且包含：

```json
{"ok":true,"storage":"postgres","persistent":true,"production":true,"competitive":false}
```

- `DATABASE_NOT_CONFIGURED` / HTTP 503：当前部署没有 `DATABASE_URL`。生产代码不会改用临时文件。
- `SERVICE_UNAVAILABLE` / HTTP 503：连接、权限、TLS 或查询故障；健康检查额外返回只含类别和是否可重试的 `diagnostic`，例如 `DB_POOLER_OPTIONS_UNSUPPORTED`、`DB_AUTH_FAILED`、`DB_CONNECTION_TIMEOUT`。服务端日志也只记录脱敏类别，不暴露连接串、SQL 或驱动原始消息。检查供应商状态与对应类别，避免把凭据粘贴到公开工单。
- HTML 404：优先检查 Root Directory、`api/index.js`、重写规则及 Functions 构建记录。
- 写操作 403 `CROSS_ORIGIN`：检查浏览器实际域名与 `APP_ORIGIN` 是否完全一致。

随后用两个不同浏览器会话创建两个测试城主：上传城市、公开参观、发布一笔低价物资、由另一账号购买、让卖家重新同步。确认货物、金币、建筑进度与版本均正确；关闭公开开关后，访客应无法再读取该城市。两账号退出再登录后仍应读取相同存档。正式上线前清理测试账号需运维处理；当前没有自助删号界面。

项目另提供显式生产验收脚本，必须先确认目标域名可访问、数据库健康，再运行：

```sh
SMOKE_BASE_URL=https://wanchengji.vercel.app npm run test:production
```

脚本使用两个随机强口令测试账号，验证真实浏览器注册、私有云档、短暂公开参观、单笔成交和独立会话恢复。结束时撤销测试账号未成交挂单、将测试城市设为私有并登出；账号及已成交流水保留为私有记录。口令仅保存到被 Git 忽略的 `work/private/`，清理失败时保留该文件并通过 `SMOKE_RECOVER_FILE=work/private/production-smoke-具体编号.json npm run test:production` 重试清理。不要用本地 `tests/browser.cjs` 指向生产。

脚本遵循继承的 HTTP/HTTPS 代理并保留 TLS 校验。Codex Cloud 中修改网络规则后需重新发布环境，并在新任务中验收；现有任务继续使用原来的环境状态。新任务不会自动继承本任务的未提交代码，必须先保存源码并检出交付分支。[官方环境说明](https://help.openai.com/en/articles/20001545-using-codex-cloud)

## 4. 私人服务器备选

如果 Vercel 的区域、费用或访问条件不合适，可以把**整个游戏与 API**部署到私人服务器，继续使用 PostgreSQL，无需改客户端地址。保持一个 HTTPS 域名，浏览器请求仍然是相对路径 `/api/...`。

在服务器部署仓库、安装 Node.js 与依赖，使用专门的非 root 系统用户运行。通过受限环境文件或服务管理器配置 `NODE_ENV=production`、`DATABASE_URL`、`APP_ORIGIN`、`HOST=127.0.0.1` 和 `PORT=3000`。使用 systemd 等进程管理器托管：

```ini
[Unit]
Description=Empire New Era game
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=citys
WorkingDirectory=/srv/citys/current
EnvironmentFile=/etc/citys.env
ExecStart=/usr/bin/node /srv/citys/current/server/index.cjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

上述目录、账号与 Node 路径需要按服务器实际安装修改。环境文件只允许管理员和服务所需身份读取。入口前可使用 Caddy 自动管理 HTTPS，例如：

```caddyfile
game.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

仅向公网开放 80/443；游戏进程与数据库端口不必公开。私有代理环境下，本应用按直连来源地址进行 IP 限流，多个玩家可能共享代理额度。正式扩大人数前，应在反向代理配置可靠限流，并只对受信代理实现客户端 IP 传递；不要让任意外部请求伪造 `X-Forwarded-For` 绕过限流。

生产 cookie 带 `Secure`，因此不能把 HTTP 公网端口作为正式入口。本地 HTTPS 终止在 Caddy/Nginx 后，仍应保留正确 `APP_ORIGIN`。

## 5. 备份、恢复与回滚

### 备份

优先启用 PostgreSQL 供应商的自动备份与时间点恢复；至少建立每日备份，并明确可接受的数据丢失时间。额外导出时可使用 `pg_dump`，连接凭据通过运维秘密管理或标准 PostgreSQL 环境配置提供，不要写进仓库或命令历史：

```sh
mkdir -p backups
pg_dump --format=custom --no-owner --no-acl --file=backups/citys-backup.dump
```

这里假定 `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER` 等已指向正确数据库；密码使用受限凭据存储或交互输入。备份文件包含账号哈希、有效会话、城市与交易流水，需要加密保存并限制访问。使用与服务器兼容的 PostgreSQL 客户端版本。

**备份和恢复必须覆盖整个数据库事务状态**：城市、托管订单、幂等记录与流水必须来自同一一致性快照。只恢复 `saves`、只退回某个卖家库存，或删掉成交记录，会破坏交易守恒。浏览器 JSON 导出只能作为个人城市备份，不能替代服务器经济账本备份。

### 恢复

1. 在独立环境创建一个空的恢复数据库，保留当前库及备份；先不要修改生产连接。
2. 通过受控连接配置指向恢复环境，执行 `pg_restore --exit-on-error --no-owner --no-acl --dbname=citys_restore backups/citys-backup.dump`。不要在仍有玩家交易的库上直接覆盖恢复。
3. 用单独的预览部署验证登录、云档、订单状态、交易流水及版本。不应只检查首页能否打开。
4. 正式切换前暂停新写入，记录切换时点和可能损失的进度；更新生产 `DATABASE_URL` 并重新部署，确认健康检查和双账号交易。
5. 若恢复点早于近期会话或交易，可在维护窗口撤销已恢复的会话，要求玩家重新登录、备份本地城市并重新下载云端。不要直接自动上传恢复前缓存的城市快照。

当前没有内置维护模式、恢复后台或自动备份任务；这些步骤由数据库平台、反向代理与运维执行。建议在公开运营前至少完成一次恢复演练。

### 应用回滚

Vercel 可以回到先前成功的生产部署，但应用回滚不会自动恢复外部数据库，也不能假设当前项目环境变量会替换旧部署的配置。回滚后需要再次核查健康检查、数据库目标与 API 协议版本。[官方回滚说明](https://vercel.com/docs/instant-rollback)

私人服务器可按发布版本保留目录，将服务切回上一已验证版本后重启。数据库结构或状态格式升级应向后兼容；涉及不兼容迁移时，需要同时设计数据库恢复方案。不要为了回滚页面而恢复旧交易库存。

## 6. 安全、账号与经济边界

- 密码使用随机独立盐与 scrypt；会话令牌随机生成，数据库只存令牌哈希。cookie 为 HttpOnly、SameSite=Lax，生产再加 Secure；会话有效期 14 天，每账号最多保留 5 个登录会话。
- **当前没有邮箱绑定、忘记密码、修改密码、修改用户名、账号自助删除或双因素认证。忘记密码后无法通过产品界面找回账号**。建议使用密码管理器，并告知首批玩家这一限制；不要承诺未实现的账号恢复服务。
- 写接口校验来源，拒绝浏览器跨站写请求。无 Origin 的非浏览器 API 客户端仍可使用有效会话调用；它们不会因此绕过身份与权限检查。
- 请求体上限 3 MB；资源、数值、地形、建筑类型、完整占地与升级状态有白名单验证，地图接受 8–96 格每边，当前新城市为 64×64。公开快照不包含私人日志、密码或会话。
- 限流记录写入持久数据库：每 IP 300 次/分钟，认证每 IP 30 次/15 分钟、每用户名 12 次/15 分钟，注册每 IP 10 次/小时。
- 模拟仍在客户端运行，玩家可修改客户端存档。本系统的原子托管、库存非负和版本冲突保护**不等于防作弊**。排行榜是公开经营城市的休闲榜，不用于竞技奖励或现金交易；沙盒不参加排行和交易。
- PostgreSQL 采用逐实体 JSONB 文档和数据库事务级 advisory lock，跨实例交易具备一致性。当前全局写事务锁和列表扫描面向小规模社区；没有声称完成大规模容量压测。扩大运营需细粒度锁、索引分页、监控和服务端权威模拟。

## 7. API 合约

所有响应为 JSON，错误格式为 `{error:{code,message},save?}`。写请求使用 `Content-Type: application/json`，浏览器携带同源会话 cookie。时间字段为 ISO 8601 UTC；UI 可按玩家时区显示。

| 方法与路径 | 请求 | 响应要点 |
| --- | --- | --- |
| `GET /api/health` | 无 | `{ok,storage,persistent,production,competitive:false}`；不可用为 503 |
| `POST /api/account/register` | `{username,password}` | 201 `{user,save}`，设置会话 cookie |
| `POST /api/account/login` | `{username,password}` | `{user,save}`，设置会话 cookie |
| `POST /api/account/logout` | `{}` | 撤销当前会话，`{ok:true}` |
| `GET /api/account/me` | 会话 | `{user,save}`；未登录 401 |
| `GET /api/save` | 会话 | `{save:null或Save}` |
| `PUT /api/save` | `{revision,state,city:{name,public}}` | `{save:Save}`；版本不符为 409，附云端 `save` |
| `GET /api/cities` | 无 | `{cities:[城市摘要]}`，最多 100 条公开城市 |
| `GET /api/cities/:id` | 无 | `{city:摘要,state:清洗后的完整快照}`；私有城市 404 |
| `GET /api/leaderboard` | 无 | `{entries:[摘要及rank],competitive:false}`，最多 100 条 |
| `GET /api/trades` | 会话可选 | `{trades:活跃挂单,mine:本人最近参与的订单}`，每组最多 100 条 |
| `POST /api/trades` | `{revision,resource,quantity,unitPrice,requestId}` | 201 `{trade,save}`；立即托管库存 |
| `POST /api/trades/:id/buy` | `{revision,requestId}` | `{trade,save,duplicate?}`；整单成交 |
| `POST /api/trades/:id/cancel` | `{revision,requestId}` | `{trade,save,duplicate?}`；只允许卖家撤单 |
| `GET /api/ledger` | 会话 | `{entries:本人最近100条交易流水}` |

`user` 只含 `id`、`username`。用户名 3–24 个中文、字母、数字、下划线或短横线，不区分英文字母大小写；密码 10–128 个字符。每个账号只有一个云端城市。

`Save` 包含 `revision`、`clientRevision`、`state`、`city:{id,name,public}`、`updatedAt`。`state` 采用游戏的 `serializeState()` 格式；恢复使用 `hydrateState()`。公开城市摘要包含 `id,name,owner,ownerId,civilization,mode,population,buildings,score,updatedAt`。

`Trade` 包含 `id,sellerId,seller,resource,quantity,unitPrice,totalPrice,status,buyerId,createdAt,closedAt`，状态为 `open`、`sold`、`cancelled`。数量与单价各为 1–100000 的整数，总价不得超过 10 亿，每人最多 20 笔活跃挂单。不存在部分成交；不能购买自己的挂单。

### 版本与幂等协议

初次保存提交 `revision:0`。每次客户端 PUT 增加 `revision`，同时令 `clientRevision=revision`。市场操作增加相关玩家的 `revision`，保留 `clientRevision`；成交同时更新买卖双方、订单、幂等记录和流水，全部成功或全部回滚。

交易前，客户端暂停模拟并上传当前城市；成功后采用返回的完整 `save` 与新版本。`requestId` 推荐 UUID；网络重试同一操作使用同一个值。改变请求内容却复用 ID 会返回 409，重复购买或撤单不会再次转移货物。

卖家继续本地建设期间可能收到他人付款。客户端保留最后同步的资源、金币、城市标识和两个版本号；若云端 `clientRevision` 没变，可将“云端库存 − 同步基线库存”的差额合并到本地，再用新的 `revision` 保存，保留建筑进度。结果出现负库存或城市不一致时拒绝合并。

如果 `clientRevision` 变化，说明另一设备上传了整个城市，不可只替换版本号后重试旧快照。应先备份本地，再下载云端，由玩家决定下一步。存在活跃挂单时不能切换种子、文明或模式；同一种子的沙盒不能转为经营城市。

## 8. 测试与验证范围

```sh
npm test
npm run test:online
npm run build
```

在线测试不使用假用户响应或 mock HTTP：测试启动真实随机端口服务并发送请求。当前 12 项在线检查覆盖本地重启持久化、账号会话、公开权限、损坏存档、完整占地、版本冲突、托管与幂等、并发购买、购买/撤单竞态、卖家建设进度合并、CSRF、请求上限、限流及 Vercel 重写入口。

已另外在临时 PostgreSQL 17 实例验证持久化和交易测试，两个独立 API 实例同时操作同一个数据库，确认共享限流与单次结算。最新新增的 Vercel 入口检查在本地真实 HTTP 环境验证；外部 Vercel 构建已完成，线上业务验收仍待完成。

要复验 PostgreSQL，将 `TEST_DATABASE_URL` 通过测试环境秘密配置指向**专用一次性数据库**，再运行 `npm run test:online`。测试会创建账号、城市和交易，并触发真实限流；不要指向生产库。连续复用同一测试数据库可能受上一轮限流影响，建议每轮新建测试库。

上线验收不能仅凭测试通过：还需在目标域名确认 PostgreSQL 健康状态、会话 cookie、嵌套 API 路径、公开参观和两账号交易，并记录数据库备份与恢复负责人。
