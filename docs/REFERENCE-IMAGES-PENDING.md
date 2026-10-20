# 《模拟帝国》待核验图片目录

用户随后直接上传了可查看的华夏城市截图，已据此完成[实际视觉拆解](REFERENCE-VISUAL-2026-10-20.md)并开始重制。以下网络来源仍保持原有核验状态；取得一张附件不代表已经看过下表的所有图片。

更新：2026-10-20。目标游戏为 TKG 的 **Sim Empire / 模拟帝国**，Steam App ID `1041710`、Android 包名 `com.trueknownewgame.ec2`。本目录记录本轮新增来源，不是已经提取的游戏资产。

## 读取状态

本轮图片搜索、网页读取和直接图片打开的返回内容均为 `text`。部分文本含 `ImageDisplayed`，但没有 `image` 内容块、图片字节或本地图片文件，**因此这些图片均未完成实际像素阅读**。下表对象来自网页正文、标题或搜索索引，不能视为从图像中观察得到的建筑细节。

后续用户已安装 TinyFish，并成功执行了一次只读浏览器任务。它提取了住宅布局帖的 15 个图片地址，但指定原图截图超时；任务终态及详细查询均未返回图像附件或截图地址。下表依然不是已下载素材目录。该任务原始结果（含 15 个地址及远端观察报告）保存于 `work/research-v3/tinyfish-taptap-run-8c7b1851.json`，详见[本轮修订状态](REVISION-3-PENDING.md)。

执行环境仍为受限网络；直接请求 TapTap / OurPlay 图片的 HTTPS CONNECT 返回 403 后已停止该路径，未改代理、未使用中转绕过。百度图片 CDN 通过搜索工具打开也返回 403。无像素时不测量屋顶、门窗、占地或人物大小，不把图纸当实机贴图，不从文字描述生成“原版提取件”。

用户已明确无需视频；本轮追加研究只搜图片。已使用的具体对象关键词包括华夏粮仓、中国工坊、民宅等级、简易棚屋、制陶场、织布坊以及 `Sim Empire Chinese buildings house granary farm` 和 `Sim Empire China cart`。人物和马车暂未找到能实际阅读像素的近景参考。

## 住宅升级：六个步骤图

页面：[百度经验《模拟帝国怎么升级住宅》](https://jingyan.baidu.com/article/5d6edee221e5b3d8ebdeec2d.html)，2020-09-17，正文标明演示游戏版本 2.3.4.4。

正文可确认这是“简易棚屋→低矮草屋”的手动升级流程。正文没有明确文明，**暂不能认定是华夏建筑外观**。六个步骤各有配图，属于操作截图候选，不是布局图纸。以下步骤名称来自正文；没有观察过对应画面。

| 步骤 | 正文对应对象 | 直接图片 URL | 读取结果 | 图纸 |
|---|---|---|---|---|
| 1 | 选中简易棚屋 | [图片 1](https://exp-picture.cdn.bcebos.com/890dfb4a2f27e7ef216873b719dd3340b7f3f5c7.jpg?x-bce-process=image%2Fresize%2Cm_lfit%2Cw_500%2Climit_1%2Fformat%2Cf_auto%2Fquality%2Cq_80) | 图片请求 403；无像素 | 正文指向操作截图，待视觉核验 |
| 2 | 点击住宅信息 | 尚未解析；页面第 2 步配图 | 页面有图片链接；未取得原图 URL / 像素 | 同上 |
| 3 | 住宅住满后点击升级图标 | 尚未解析；页面第 3 步配图 | 页面有图片链接；未取得原图 URL / 像素 | 同上 |
| 4 | 简易棚屋升级为低矮草屋的消耗页 | [图片 4](https://exp-picture.cdn.bcebos.com/2e66f9ef28066b0199b32bf63df39187021cf3c7.jpg?x-bce-process=image%2Fresize%2Cm_lfit%2Cw_500%2Climit_1%2Fformat%2Cf_auto%2Fquality%2Cq_80) | 图片请求 403；无像素 | 同上 |
| 5 | 升级中的加速操作 | 尚未解析；页面第 5 步配图 | 页面有图片链接；未取得原图 URL / 像素 | 同上 |
| 6 | 使用沙漏完成升级 | [图片 6](https://exp-picture.cdn.bcebos.com/8b3643dd884ce54a2849ff59a3066b0193ddf7c7.jpg?x-bce-process=image%2Fresize%2Cm_lfit%2Cw_500%2Climit_1%2Fformat%2Cf_auto%2Fquality%2Cq_80) | 图片请求 403；无像素 | 同上 |

缺失 URL 保留为待解析项；不在已明确拒绝访问的 CDN 上重复试探，也不编造路径。

## TapTap 建筑与城市候选

| 编号 | 页面 | 直接图片 URL | 对象判断依据 | 实际像素 | 是否图纸 |
|---|---|---|---|---|---|
| T01 | [《萌新基本常识（上部）》](https://www.taptap.cn/moment/645150624224119324?group_id=189904) | [中国段配图](https://img2-tc.tapimg.com/moment/etag/FkrkG2646eNwFv4Nh019RVNosMJL.jpg/_tap_ugc.jpg) | 正文文明分段中的中国配图；不能由标题确认图中具体建筑 | 未读；直接打开仅返回文字标记 | 尚未视觉确认 |
| T02 | [《没钱，要亏死了，伐木场都建造不出来》](https://www.taptap.cn/moment/438742610970937322) | [第 1 张图](https://img2-tc.tapimg.com/moment/etag/FvSZJVuS25mfINyUmvcf9gkJXSIq.jpg/_tap_ugc.jpg) | 帖子标题；不能据标题断言图中已经存在伐木场或确认文明 | 未读；搜索工具打开超时 | 尚未视觉确认 |
| T03 | [同上](https://www.taptap.cn/moment/438742610970937322) | 尚未解析；页面第 2 张配图 | 页面存在第二张配图 | 未读 | 尚未视觉确认 |
| T04 | [普通、高级住宅与工业区布局帖](https://www.taptap.cn/moment/261001895466764010) | [普通住宅相关图](https://img2-tc.tapimg.com/bbcode/etag/llLAvAsHuzlBzm_o5fBrcb4NBVuO.png/_tap_ugc.jpg) | 页面正文分段，根代理读取记录 | 未读；仅返回文字标记 | 页面混合图纸与效果图；逐张待核验 |
| T05 | [同上](https://www.taptap.cn/moment/261001895466764010) | [高级住宅相关图](https://img2-tc.tapimg.com/bbcode/etag/Fl2QeM3DKVVkChXp5BqVceALLUsT.jpg/_tap_ugc.jpg) | 页面正文分段，根代理读取记录 | 未读；仅返回文字标记 | 同上 |
| T06 | [同上](https://www.taptap.cn/moment/261001895466764010) | [页面图片 12](https://img2-tc.tapimg.com/bbcode/etag/lhhoafXg3bt2gy3oofv_tfK3u7eX.png/_tap_ugc.jpg) | 仅确认该页面图片链接；具体建筑未确认 | 未读；仅返回文字标记 | 同上 |
| T07 | [同上](https://www.taptap.cn/moment/261001895466764010) | [页面图片 14](https://img2-tc.tapimg.com/bbcode/etag/FrQ4pCaHBVlduqZlQ_ReioYUkjFr.jpg/_tap_ugc.jpg) | 同上 | 未读；仅返回文字标记 | 同上 |
| T08 | [同上](https://www.taptap.cn/moment/261001895466764010) | [页面图片 15](https://img2-tc.tapimg.com/bbcode/etag/FosD2wJUlvXx2vXkJ39WewTu286W.jpg/_tap_ugc.jpg) | 同上 | 未读；仅返回文字标记 | 同上 |
| T09 | [同上](https://www.taptap.cn/moment/261001895466764010) | [页面图片 16](https://img2-tc.tapimg.com/bbcode/etag/Fq-IZHdZzcDqtLosyoUMWS1kPd2j.jpg/_tap_ugc.jpg) | 同上 | 未读；仅返回文字标记 | 同上 |
| T10 | [华夏／华夏夜景帖](https://www.taptap.cn/moment/429236140092950497?group_id=189904) | [页面图片 3](https://img2-tc.tapimg.com/bbcode/etag/lkFpo4HtgFMgOxrvcXUFYZu9nPOH.jpg/_tap_ugc.jpg) | 正文含“华夏”和“华夏夜景”标题；本轮未从像素确定哪张是白昼或夜景 | 未读；搜索工具仅文字标记，本机 CONNECT 403 | 尚未视觉确认 |
| T11 | [同上](https://www.taptap.cn/moment/429236140092950497?group_id=189904) | [页面图片 4](https://img2-tc.tapimg.com/bbcode/etag/ljFBl08uoY6YlUxYv6-h1M_IPY0q.jpg/_tap_ugc.jpg) | 同上 | 未读；仅返回文字标记 | 尚未视觉确认 |

## 补充来源与排除项

| 页面 | 已核对内容 | 使用限制 |
|---|---|---|
| [ZOL《模拟帝国布局图分享与攻略》](https://game.zol.com.cn/1011/10119220.html) | 正文串联早期规划、住宅建设、华夏夜景与奇迹建设，图片链接 42–52。图片 42–43 对应规划阶段，44–52 的上下文涉及实机进展 | 未取得图片像素，也尚未解析原图 URL。网页的阶段叙述只能用于定位参考，不能推导建筑可见形状或计时准确性 |
| [SteamDB 的 Sim Empire 截图区](https://steamdb.info/app/1041710/screenshots/) | 可读 App ID、开发者 TKG 和 Steam 商店名；页面内容未列出实机截图，仅产品图标等资产链接 | 不是已获取的实机图集，不把商店封面当构件测量依据 |
| [TapTap《模拟帝国布局分享攻略》](https://www.taptap.cn/moment/546480156168947526) | 正文明确前两组为希腊、阿兹特克，最后一组才是华夏图纸 | 不是华夏实机建筑特写；不能把其他文明或规划图混入华夏美术 |
| [3DM《粮店》相关攻略](https://shouyou.3dmgame.com/gl/247153.html) | 图片搜索将该页与粮仓等对象关联；索引描述指向阿兹特克文明 | 尚未像素核验；不可拿来充当华夏粮仓外观 |

## 获得像素后的分析表

先交叉核对同一建筑至少两张实机图，再决定能否裁出完整构件。每个采样保留原始尺寸和来源，不从网页缩略图猜测精度。

| 样本 | 建筑／等级依据 | 原图像素尺寸 | 同画面道路两轴 | 地块占用与轮廓 | 可完整分离构件 | 局部遮挡构件 | 完全遮挡、需要原创生成的构件 | 人物／门洞相对尺度 |
|---|---|---|---|---|---|---|---|---|
| 待取得原图 | 未核验 | 未测量 | 未测量 | 未测量 | 未确认 | 未确认 | 未确认 | 未测量 |

优先补齐住宅早期与后期、商铺、工坊、公共建筑、粮仓／货栈五类；每类至少三个外形不同的样本。人物和马车另建样本表，静态截图只能确认外观与可见姿态，不能证明动作帧数、步态连续性或运输逻辑。
