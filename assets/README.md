# 帝国新纪美术资源

本目录的图像由 `image_gen.imagegen` 按本项目提示词原创生成，未提取或复制《模拟帝国》的资源。生成记录见 `generation-record.json`，复用范围和动画说明见 `manifest.json`。

- `atlases/`：保留的九张原始透明 PNG 图集。
- `sprites/`：144 张已分离、透明 WebP 素材，运行时总计约 5.84 MiB。
- `sprites.json`：每张素材的尺寸、原始图集区域及锚点。
- `construction-animation.webp`：4 行 × 4 列的规范施工动画图集，每帧 375 × 296 像素。四行依次为地基、墙体、屋顶完成和中心透明的升级脚手架。
- `hero.webp`：原创五文明都城全景。

## 游戏接口

`js/assets.js` 提供 `window.GameArt`。`ready` 完成默认文明、共用资源和施工资源预载；`preloadCivilization(civ)` 可预载另外四种文明。

`drawBuilding(ctx, {type, civ, level, cx, cy, width, height})` 中 `cx/cy` 是足印中心，`width/height` 是地面菱形的宽高。素材保持自身比例，底部锚在 `cy + height / 2`。成功返回 `true`；尚未加载返回 `false`，渲染器可显示即时后备图形。

`drawConstruction(ctx, {cx, cy, width, height, progress, time, upgrade, fromLevel})` 单独绘制施工阶段；升级时保留已有建筑并叠加第四行脚手架。`time` 的单位是毫秒。

`drawTerrain` 提供地表纹理、植物和矿石。`thumbnail(type,civ,level)` 返回可用于 UI 的图片 URL；`metadata` 提供尺寸、灯点和按文明人工校准的窑炉烟口位置。正常运营动画和昼夜光照由渲染器运行时绘制。

## 重新打包

安装 Pillow、NumPy、SciPy 后运行 `python assets/build-atlases.py`。可传一个或多个图集名只重做相应图集，如 `python assets/build-atlases.py construction`。脚本仅裁切、规整和压缩已生成图像，不用程序绘画替代生成素材。
