"use strict";
/* Original civilizations share a ruleset; each changes economic planning. */
const CIVILIZATIONS = {
  china: {
    id:"china", name:"华夏", subtitle:"山河为卷 · 百工兴邦", color:"#c79b51", icon:"山", em:"🏯",
    description:"以木构庭院与青瓦重檐延展城市。建设迅速，百工繁荣，适合循序渐进的经营者。",
    bonuses:["建设时间 −15%","木材与工艺产出 +15%","专属建筑：九重宝塔"],
    modifiers:{construction:0.85,wood:1.15,craft:1.15,tax:1,trade:1,agri:1,mining:1,immigration:1},
    landmark:"pagoda", wonderName:"万象宫城", cityNames:["云京","长宁","临川"],
    palette:{roof:"#344f53",wall:"#e0cba7",accent:"#b4563d",ground:"#6f8656",light:"#ffc572"},
  },
  egypt: {
    id:"egypt", name:"埃及", subtitle:"长河之畔 · 日轮永耀", color:"#dfb65e", icon:"日", em:"𓂀",
    description:"在河谷绿洲筑起砂岩城邦。丰沛矿产与灌溉农业让宏伟石造建筑更快成形。",
    bonuses:["石料、粘土与铜矿 +25%","临水农场产量额外 +20%","专属建筑：守望狮身像"],
    modifiers:{construction:1,wood:1,craft:1,tax:1,trade:1,agri:1,mining:1.25,riverFarm:0.2,immigration:1},
    landmark:"sphinx", wonderName:"曙光金字塔", cityNames:["日轮城","青尼罗","沙海之门"],
    palette:{roof:"#c39951",wall:"#e7ce94",accent:"#2d8d94",ground:"#b5a16a",light:"#ffd788"},
  },
  greece: {
    id:"greece", name:"希腊", subtitle:"群星与海 · 理性之城", color:"#8fbac9", icon:"海", em:"🏛️",
    description:"白石柱廊与海蓝屋顶环绕公共广场。文化吸引新居民，高效税制支持城市扩张。",
    bonuses:["税收 +20%","移民速度 +20%","专属建筑：哲人广场"],
    modifiers:{construction:1,wood:1,craft:1,tax:1.2,trade:1,agri:1,mining:1,immigration:1.2},
    landmark:"agora", wonderName:"星海圣殿", cityNames:["星海城","风帆湾","白石港"],
    palette:{roof:"#4c7e9a",wall:"#ece2cc",accent:"#6d9cae",ground:"#8e9e71",light:"#ffe3a1"},
  },
  persia: {
    id:"persia", name:"波斯", subtitle:"商路千里 · 花园之国", color:"#72ada6", icon:"风", em:"🕌",
    description:"穹顶、风塔与水渠组成绿洲都市。商队让稀缺物资易于获取，仓储支持广域贸易。",
    bonuses:["商队买价 −20%，卖价 +20%","仓储容量 +25%","专属建筑：风塔庭院"],
    modifiers:{construction:1,wood:1,craft:1,tax:1,trade:1.2,storage:1.25,agri:1,mining:1,immigration:1},
    landmark:"windTower", wonderName:"千园王庭", cityNames:["千泉城","琉璃关","星沙城"],
    palette:{roof:"#3f8e91",wall:"#dec39a",accent:"#e0b44f",ground:"#a5a277",light:"#ffd18a"},
  },
  aztec: {
    id:"aztec", name:"阿兹特克", subtitle:"万物生长 · 太阳之民", color:"#8fb477", icon:"叶", em:"☀️",
    description:"阶梯神庙与翠绿田野相依。丰饶农业支撑快速增长的人口，并以花园平衡工业。",
    bonuses:["农业产量 +25%","花园与树木美化效果 +50%","专属建筑：太阳祭台"],
    modifiers:{construction:1,wood:1,craft:1,tax:1,trade:1,agri:1.25,mining:1,beauty:1.5,immigration:1},
    landmark:"sunTemple", wonderName:"太阳阶梯", cityNames:["翠日城","雨林之心","翡翠台"],
    palette:{roof:"#668678",wall:"#c9b494",accent:"#ba6746",ground:"#668950",light:"#ffc56a"},
  },
};
function getCivilization(id){ const key=id || (S && S.civilization); return Object.hasOwn(CIVILIZATIONS,key) ? CIVILIZATIONS[key] : CIVILIZATIONS.china; }
function civilizationBonus(key){ return getCivilization().modifiers[key] ?? 1; }
