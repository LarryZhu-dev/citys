# 界面原画与图集重建

这里永久保留了本项目 48 个原创界面图标及 4 张九切面板的生成原图、完整提示词、来源记录和机械排图脚本。`sources/.gdignore` 阻止 Godot 将这些制作源文件作为运行资源导入。游戏只加载上一层的三张图集、四张面板与 `manifest.json`。

## 原图与来源

- `ui-resources-original.png`：粮食、蔬菜、水果、鱼、肉、木材、石料、黏土、铜矿、砖、陶器、布、面包、酒、金币、人口，共 16 个图标。
- `ui-actions-original.png`：营造、道路、世界、视野、菜单、仓库、任务、保存、读取、回城、缩放、昼夜、拆除、取消，共 16 个按钮。
- `ui-controls-original.png`：暂停、继续、设置、帮助、迁移、确认、交易、导入导出、新城、勾选状态、覆盖图、速度、锁，共 16 个按钮。
- `ui-panels-original.png`：前视宣纸青铜边框、胡桃木、浅纸卡片、红漆金边，共 4 张材质面板。
- `ui-generation-record.json`：生成服务、日期、四次完整提示词、原始工具输出名称、样式参考关系及 SHA-256。`source` 与 `styleReference` 相对于本目录解析。

四张原图由 `image_gen.imagegen` 实际生成。按钮补充图以主按钮原图作为样式参考。没有复制《模拟帝国》或其他游戏的美术；生成内容的使用仍受相应生成服务条款约束。

## 重建

从仓库根目录执行以下命令。推荐在 Python 虚拟环境中安装依赖；脚本不访问网络、不调用生图服务，也不需要 `work/` 中的文件。

```sh
python -m pip install -r godot/art/ui/sources/requirements.txt
python godot/art/ui/sources/build-ui-atlases.py
```

图标部分按 alpha 连通域识别每张原图中的 16 个对象，按行列排序后分别裁切、隔离并居中放入 384×384 的透明单元。图标只执行机械裁切与排图，不放大源像素，不重绘原画。输出覆盖上一层的 `resources.png`、`actions.png`、`controls.png` 和 `manifest.json`。三张运行图集均为 1536×1536 RGBA；manifest 的 `rect` 是完整单元，`content_rect` 是原画内容在整张图集上的绝对坐标。

面板部分从四格原图机械裁出原生 512 像素以上的对象，按九宫格分别重采样边角、边条和中心，归一为 512×512 的 `paper.png`、`wood.png`、`card.png`、`red.png`。这一步缩小过大的原生装饰边框，保留原画材质，不用程序重绘。`manifest.panels` 保留原图裁切区、源边距和最终边距。Godot `StyleBoxTexture` 四边的 `texture_margin_*` 应分别取 paper=32、wood=24、card=16、red=20。大窗口用 paper，普通短按钮用 card，以免小按钮被纸面板的大包角挤满。已审查 580×710 面板、480×42 木条和 440×48 按钮的九切效果。

保留的依赖版本用于复现当前排图。`ui-validation.json` 记录本次静态校验，48 格最外侧 12 像素全部透明。Godot 导入图集与面板后，可从仓库根目录验证导入纹理、全部 AtlasTexture 区域和四张面板尺寸：

```sh
godot --headless --path godot --script res://art/ui/sources/check-ui.gd
```

这个校验脚本从源码目录直接运行，供编辑阶段使用，不纳入游戏逻辑或 Web 导出。运行资源路径仍为 `res://art/ui/*.png` 和 `res://art/ui/manifest.json`；manifest 的 `generation_record` 是仓库相对的制作记录路径，不是运行时加载依赖。
