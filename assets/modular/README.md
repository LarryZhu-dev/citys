# 中式模块化美术 / 角色拆件

此目录是独立生成的结构件、正交材质和人物骨骼部件，不是把旧整栋建筑裁碎。全部原图与提示词保存在 `originals/` 和 `generation-record.json`。

- 6 张 512×512 正交材质：灰瓦、白灰墙、灰砖、石基、木板、粗布。
- 12 个正视结构件：红柱、木柱、红梁、木梁、斗拱、瓦脊、格窗、红双门、木双门、炉口、翘檐、栏杆。
- 12 个人物/工具拆件：头、躯干、上臂、前臂、大腿、小腿、鞋、锤、锄、扁担、筐、斗笠。

结构件和人物均使用真实透明 alpha，无外部背景晕染。运行时结构件与人物使用无损 WebP；材质使用质量 97 WebP。`build-parts.py` 只分离和裁切生成像素，并记录区域，没有用程序插图替代生图。

## 运行时

只需发布 `parts.json` 与 `parts/*.webp`。`GameArt.partsReady` 完成加载；`partsRevision` 每次加载更新，供装配器清除首次占位缓存。

`GameArt.getPart(name)` 返回 `image, loaded, width, height, sourceRect, url, kind` 以及 metadata。结构件使用直接名称，人物名称以 `people/` 开头。`sourceRect` 是裁切后图片的完整区域；`atlasRect` 记录原始图集区域。

材料 `image` 保持原始 512×512 图像。原图边缘不是严格无缝，`texture` 是运行时以原图构成的 2×2 镜像画布，可连续重复，`repeatMode` 为 `mirror`。不要把原始图直接当作已校准无缝材质。

`GameArt.drawPart(ctx,name,x,y,width,height,options)` 在左上位置绘制，成功为 `true`，未就绪为 `false`。可选 `rotation`、`flipX`、`flipY`、`opacity`、`anchorX`、`anchorY`。也可由调用方控制完整 Canvas 骨骼/投影变换。

人物 metadata 中 `anchor` 是归一化旋转关节，`tip` 是远端连接点，`worldSize` 是建议相对成人高度的显示尺寸。躯干另有肩/髋位置。将左右臂腿镜像后独立旋转即可拼装，不需要更换整个人物帧。

缓存依据实际 Canvas 变换的物理像素需求（包括 DPR 与缩放）。像素需求接近源图尺寸时直接绘制原图，不会先降采样再放大。
