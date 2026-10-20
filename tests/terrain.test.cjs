const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function game() {
  const canvas = { getContext: () => ({}) };
  const context = vm.createContext({
    document: { querySelector: () => canvas }, window: {},
    toast() {}, log() {}, save() {}, renderAll() {}, renderBuildList() {}, renderTasks() {},
  });
  for (const file of ['data','civilizations','simulation']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file+'.js'),'utf8'),context,{filename:file+'.js'});
  }
  return { run: code => vm.runInContext(code,context), context };
}
function components(tiles, type) {
  const visited = new Set(), groups = [];
  for (let y=0;y<tiles.length;y++) for (let x=0;x<tiles[y].length;x++) {
    const start = x+','+y;
    if (tiles[y][x].t!==type || visited.has(start)) continue;
    const queue = [[x,y]], xs = [], ys = [];
    visited.add(start);
    for (let i=0;i<queue.length;i++) {
      const [cx,cy] = queue[i]; xs.push(cx); ys.push(cy);
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx=cx+dx, ny=cy+dy, key=nx+','+ny;
        if (tiles[ny]?.[nx]?.t===type && !visited.has(key)) { visited.add(key); queue.push([nx,ny]); }
      }
    }
    const width=Math.max(...xs)-Math.min(...xs)+1, height=Math.max(...ys)-Math.min(...ys)+1;
    groups.push({area:queue.length,width,height,rectangle:queue.length===width*height});
  }
  return groups;
}

const seeds=['campaign-integration','woods','37','hill-fog','delta-20'];

test('the same world seed reproduces terrain and variants without consulting global randomness',()=>{
  const g=game();
  g.run('Math.random=()=>{throw new Error("Unseeded terrain randomness")};');
  const first=g.run("JSON.stringify(generateTerrain('repeatable','china'))");
  g.run("generateTerrain('unrelated','egypt')");
  assert.equal(g.run("JSON.stringify(generateTerrain('repeatable','china'))"),first);
  assert.doesNotThrow(()=>g.run("newGame({seed:'repeatable',civilization:'china'})"));
});

test('changing the seed changes river courses, resource extents and land cover',()=>{
  const g=game();
  const a=g.run("generateTerrain('western-river','china')").flat();
  const b=g.run("generateTerrain('eastern-river','china')").flat();
  assert.ok(a.filter((tile,i)=>tile.t!==b[i].t).length>4096*.2);
  assert.ok(a.filter((tile,i)=>(tile.t==='water')!==(b[i].t==='water')).length>100);
  for (const kind of ['tree','stone','clay','copper']) {
    assert.ok(a.some((tile,i)=>(tile.t===kind)!==(b[i].t===kind)),kind+' should vary with seed');
  }
});

test('large woods, ore deposits and water bodies have irregular outlines and varying areas',()=>{
  const g=game(), sizes=Object.fromEntries(['water','tree','stone','clay','copper'].map(k=>[k,new Set()]));
  for (const seed of seeds) {
    const tiles=g.run(`generateTerrain(${JSON.stringify(seed)},'china')`);
    for (const kind of Object.keys(sizes)) {
      const groups=components(tiles,kind).filter(g=>g.area>=5);
      assert.ok(groups.length>=2,seed+' needs multiple usable '+kind+' groups');
      // Tiny two- or four-cell fragments can be rectangular by chance; a whole resource landscape cannot.
      assert.ok(groups.filter(g=>!g.rectangle).length/groups.length>=.6,seed+' '+kind+' is dominated by filled rectangles');
      for (const group of groups) sizes[kind].add(group.area);
    }
  }
  for (const [kind,areas] of Object.entries(sizes)) assert.ok(areas.size>=8,kind+' should have several deposit scales');
});

test('grass remains the dominant open ground in every civilization while soil blending is spatially continuous',()=>{
  const g=game();
  for (const civilization of ['china','egypt','greece','persia','aztec']) {
    const tiles=g.run(`generateTerrain('grass-first',${JSON.stringify(civilization)})`).flat();
    const grass=tiles.filter(t=>t.t==='grass').length, dirt=tiles.filter(t=>t.t==='sand').length;
    assert.ok(grass>dirt*1.5,civilization+' should have more grass than exposed yellow soil');
  }
  let adjacentDifference=0,distantDifference=0;
  for (let y=2;y<60;y+=5) for (let x=2;x<45;x+=5) {
    const a=g.run(`terrainVisualAt(${x+.25},${y+.35},'continuous')`);
    const near=g.run(`terrainVisualAt(${x+.251},${y+.351},'continuous')`);
    const far=g.run(`terrainVisualAt(${x+13.25},${y+3.35},'continuous')`);
    assert.ok(Object.values(a).every(Number.isFinite));
    assert.ok(a.groundBlend>=0&&a.groundBlend<=1);
    adjacentDifference+=Math.abs(a.groundBlend-near.groundBlend);
    distantDifference+=Math.abs(a.groundBlend-far.groundBlend);
  }
  assert.ok(adjacentDifference<distantDifference/100,'fractional samples must not reveal square tile colour jumps');
});

test('multiple seeds preserve a connected, dry settlement and accessible deposits for every mining tier',()=>{
  const g=game();
  for (const seed of [...seeds,'mountain-pass','low-tide','resource-start']) {
    g.run(`newGame({seed:${JSON.stringify(seed)},civilization:'china'})`);
    assert.equal(g.run('MAP_W===64&&MAP_H===64'),true);
    assert.equal(g.run("buildings().filter(o=>['house','farmland','lumber'].includes(o.b.type)).every(o=>connectedToMain(o.x,o.y,BUILD[o.b.type].size)&&footprint(o.x,o.y,BUILD[o.b.type].size).every(([, ,t])=>t.t!=='water'))"),true,seed);
    assert.equal(g.run("canBuildAt('well',48,13).ok"),true,seed+' water service spot');
    assert.equal(g.run("footprint(48,22,2).some(([, ,t])=>t.t==='tree')"),true,seed+' starter timber');
    for (const type of ['quarry','clayPit','copperMine']) {
      const reachable=g.run(`(()=>{
        const seen=new Set(['50,14']),queue=[[50,14]];
        for(let i=0;i<queue.length;i++)for(const [dx,dy]of DIRS){
          const [x,y]=queue[i],nx=x+dx,ny=y+dy,key=nx+','+ny,t=tileAt(nx,ny);
          if(!t||seen.has(key)||t.t==='water'&&t.b?.type!=='road'||t.b&&t.b.type!=='road')continue;
          seen.add(key);queue.push([nx,ny]);
        }
        for(let y=18;y<=35;y++)for(let x=37;x<=60;x++){
          if(!canBuildAt('${type}',x,y).ok)continue;
          if(footprint(x,y,2).some(([tx,ty])=>DIRS.some(([dx,dy])=>seen.has((tx+dx)+','+(ty+dy)))))return true;
        }
        return false;
      })()`);
      assert.equal(reachable,true,seed+' needs reachable '+type);
    }
    assert.equal(g.run("(()=>{for(let y=15;y<29;y++)for(let x=54;x<63;x++)if(canBuildAt('fishing',x,y).ok)return true;return false})()"),true,seed+' nearby fishing');
  }
});

test('old terrain is preserved on import and renderer fields need no saved metadata',()=>{
  const g=game();
  g.run("newGame({seed:'old-layout'});var oldState=JSON.parse(JSON.stringify(serializeState()));oldState.tiles[3][3].t='clay';delete oldState.tiles[3][3].variant;var oldTypes=JSON.stringify(oldState.tiles.map(row=>row.map(tile=>tile.t)));var oldVisual=JSON.stringify(terrainVisualAt(3.25,3.75,oldState.seed));");
  assert.equal(g.run('hydrateState(oldState)'),true);
  assert.equal(g.run('JSON.stringify(S.tiles.map(row=>row.map(tile=>tile.t)))===oldTypes'),true);
  assert.equal(g.run('JSON.stringify(terrainVisualAt(3.25,3.75,S.seed))===oldVisual'),true);
  assert.equal(g.run('tileAt(3,3).t'), 'clay');
});
