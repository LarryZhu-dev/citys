# 任务驱动行人与运输资产

这里保留两批新的原始生图、完整提示词与 SHA-256；旧工匠原图和当时已有的提取记录也一并保留。新图由 `image_gen.imagegen` 生成，没有导入《模拟帝国》素材。旧提示词未在旧记录中保存，未补造。`.gdignore` 阻止制作源文件作为运行资源导入。

`build-logistics-atlas.py` 用 Pillow、NumPy、SciPy 执行 alpha 连通域裁切及固定画布排图；它读取本目录的两张新原图和上一层已保留的 16 张旧工匠独立帧，不依赖 `work/`。从仓库根目录运行：

```sh
python godot/art/citizens/sources/build-logistics-atlas.py
```

输出 `logistics-atlas.webp` 与 `logistics-atlas.json`。48 格共享一张 2816×2112 RGBA 图集，单格 352×352、统一脚底/轮轴基准。水工和商贩各四向两姿态，旧工匠四向四帧，马车和手车各四向空/满载关键姿态。方向顺序是西北、东北、西南、东南，匹配地图地轴屏幕斜率 ±0.5。马车采用关键姿态与轮转、轻微颠簸；这不是完整独立马匹骨骼动画。

透明像素 RGB 显式归零，以 WebP `lossless=True, exact=True` 保存，避免编码器将透明区域改写成彩色块。运行导入启用 mipmap 与 `fix_alpha_border`。源图的衣褶、车辆和人物本体来自生图；水面、车轮转动与装卸时的身体倾斜由代码表现。

`CityCitizens.sync_city(buildings, city)` 只读取 `city.logistics.jobs`；没有任务就不制造路人。任务 ID 持续绑定 actor，角色位置来自 route、segment、segmentProgress/edgeSeconds，最多沿当前授权道路进行 1.1 秒快照间预测；等待、暂停、断路均停止。装卸阶段可沿仍有效的已授权路段补完到门口，不越过目的地。货物可见性只读 `isLoaded`；空车返程读取持久 `vehicle`，不从已清空的货物重新推断。城市种子/身份切换或经营时钟倒退会清空旧插值，避免 ID 复用造成跨城瞬移。

`test-logistics.gd` 是原生测试，不进入运行逻辑。它检查 16 项任务对应、连续位移、朝向、暂停、断路/修复、换城、读旧档、空车车型与装卸边界。执行：

```sh
godot --headless --path godot --script res://art/citizens/sources/test-logistics.gd
```

有 X11 显示时同一测试还会创建包含 7 个真实格式任务的原生场景，检查日夜绘制、透明边及 mipmap 采样；截图写入临时 `work/`。可见交通诊断包含最多 12 个任务样本的 ID、角色、载具、坐标、阶段、载货状态和朝向。没有进行浏览器测试；网页桥接由根集成测试另验。
