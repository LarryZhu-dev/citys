/* Persistent visual citizens. Their routes use the complete road graph, never
 * the camera's visible tiles. They illustrate work; they do not alter economy. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Citizens = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
  const FARM = new Set(['farmland','vegFarm','orchard','pasture']);
  const CRAFT = new Set(['lumber','quarry','clayPit','copperMine','kiln','pottery','weaver','mill','bakery','winery','repair']);
  const key = (x,y) => x + ',' + y;
  const point = k => k.split(',').map(Number);
  function hash(s) { let h=2166136261; for(const c of String(s))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0; }
  function createSimulation(definitions) {
    let state=null, roads=new Map(), components=new Map(), locations=new Map(), citizens=new Map(), signature='', roadSignature='', sinceScan=0, clock=0, pathSearches=0, pathVisits=0;
    const defs=()=>definitions || (typeof BUILD!=='undefined'?BUILD:{});
    function doors(x,y,size) {
      const result=[];
      for(let i=0;i<size;i++)for(const [a,b]of [[x+i,y-1],[x+i,y+size],[x-1,y+i],[x+size,y+i]])if(roads.has(key(a,b)))result.push(key(a,b));
      return [...new Set(result)];
    }
    function liveRoad(k) {
      if(!k)return false;
      const [x,y]=point(k),exists=state?.tiles?.[y]?.[x]?.b?.type==='road';
      // A movement check can discover a demolition before the periodic full scan.
      if(!exists&&roads.has(k))sinceScan=.6;
      return exists;
    }
    function availableJob(o) {
      if(!o||!o.doors.length||o.b.damage||o.b.idle)return false;
      if(state.tiles[o.y]?.[o.x]?.b!==o.b)return false;
      return !!(o.b.construction||o.b.staffed||!defs()[o.b.type]?.workers);
    }
    function path(start, goals) {
      if(!roads.has(start)||!goals.length||!liveRoad(start))return null;
      const component=components.get(start);
      const targets=new Set(goals.filter(k=>components.get(k)===component&&liveRoad(k)));
      if(!targets.size)return null;
      pathSearches++;
      const queue=[start], previous=new Map([[start,null]]);
      for(let head=0;head<queue.length;head++) {
        const current=queue[head];pathVisits++;
        if(targets.has(current)){const route=[];for(let n=current;n!==null;n=previous.get(n))route.push(n);return route.reverse();}
        for(const next of roads.get(current)||[])if(!previous.has(next)&&liveRoad(next)){previous.set(next,current);queue.push(next);}
      }
      return null;
    }
    function scan(initialPopulation=false) {
      const tiles=state.tiles, found=[], nextRoads=new Map();let h=2166136261;
      for(let y=0;y<tiles.length;y++)for(let x=0;x<tiles[y].length;x++) {
        const b=tiles[y][x]?.b;if(!b)continue;
        if(b.type==='road'){const k=key(x,y);nextRoads.set(k,[]);h=Math.imul(h^(y*tiles[y].length+x+1),16777619);}
        else if(!b.origin||(b.origin[0]===x&&b.origin[1]===y))found.push({id:String(b.id??key(x,y)),x,y,b,size:defs()[b.type]?.size||1});
      }
      const nextRoadSignature=h+':'+nextRoads.size;
      const nextSignature=nextRoadSignature+':'+found.map(o=>[o.id,o.x,o.y,o.b.type,!!o.b.construction,o.b.staffed,Math.ceil((o.b.pop||0)/6)].join('/')).join(';');
      if(nextSignature===signature)return;
      signature=nextSignature;
      if(nextRoadSignature!==roadSignature){
        roadSignature=nextRoadSignature;roads=nextRoads;components.clear();
        for(const [k,links]of roads){const [x,y]=point(k);for(const [dx,dy]of DIRS)if(roads.has(key(x+dx,y+dy)))links.push(key(x+dx,y+dy));}
        // Reject disconnected destinations in O(doors), instead of repeating a full BFS per job.
        let component=0;
        for(const start of roads.keys())if(!components.has(start)){
          const queue=[start];components.set(start,component++);
          for(let i=0;i<queue.length;i++)for(const next of roads.get(queue[i]))if(!components.has(next)){components.set(next,components.get(start));queue.push(next);}
        }
      }
      locations=new Map(found.map(o=>[o.id,{...o,doors:doors(o.x,o.y,o.size)}]));
      const wanted=new Set();
      for(const home of locations.values()) {
        if(!['house','villa'].includes(home.b.type)||!home.b.pop||!home.doors.length||(home.b.construction&&!home.b.construction.fromLevel))continue;
        const count=Math.min(3,Math.ceil(home.b.pop/6));
        for(let i=0;i<count&&wanted.size<60;i++) {
          const id=home.id+':'+i;wanted.add(id);
          if(!citizens.has(id)) {
            const start=home.doors[i%home.doors.length],[x,y]=point(start);
            citizens.set(id,{id,home:home.id,node:start,x,y,from:null,to:null,edge:0,route:[],step:0,direction:{x:1,y:0},action:'rest',role:'visitor',phase:0,wait:1+(hash(id)%30)/10,trip:0,opacity:initialPopulation?1:0,retiring:false});
          }
        }
      }
      for(const e of citizens.values())e.retiring=!wanted.has(e.id);
    }
    function assign(e, homeward=false) {
      if(!roads.has(e.node)||!liveRoad(e.node))return false;
      let destination, route;
      if(homeward) {
        destination=locations.get(e.home);
        route=destination&&path(e.node,destination.doors);
      } else {
        const component=components.get(e.node);
        const jobs=[...locations.values()].filter(o=>o.id!==e.home&&!['house','villa','treeDeco','monument','road'].includes(o.b.type)&&availableJob(o)&&o.doors.some(k=>components.get(k)===component&&liveRoad(k)));
        // Stay within a useful commute; vary choices only at the end of a trip.
        jobs.sort((a,b)=>Math.abs(a.x-e.x)+Math.abs(a.y-e.y)-Math.abs(b.x-e.x)-Math.abs(b.y-e.y));
        const candidates=jobs.slice(0,12), offset=hash(e.id+':'+e.trip)%Math.max(1,candidates.length);
        for(let i=0;i<candidates.length;i++){const job=candidates[(i+offset)%candidates.length],p=path(e.node,job.doors);if(p&&p.length<100){destination=job;route=p;break;}}
      }
      if(!destination||!route)return false;
      e.goal=destination.id;e.homeward=homeward;e.role=homeward?e.role:destination.b.construction?'builder':FARM.has(destination.b.type)?'farmer':CRAFT.has(destination.b.type)?'worker':'carrier';
      e.route=route;e.step=0;e.action='walk';e.wait=0;
      if(route.length===1)arrive(e);
      return true;
    }
    function arrive(e) {
      e.route=[];e.from=null;e.to=null;e.edge=0;
      if(!e.homeward&&!availableJob(locations.get(e.goal))){if(!assign(e,true)){blocked(e);e.homeward=true;}return;}
      e.action=e.homeward?'rest':'work';e.wait=e.homeward?3+(hash(e.id)%40)/10:7+(hash(e.id+e.trip)%70)/10;
      const goal=locations.get(e.goal);if(goal)e.direction={x:goal.x+goal.size/2-e.x,y:goal.y+goal.size/2-e.y};
      e.trip++;
    }
    function blocked(e) {e.route=[];e.from=null;e.to=null;e.edge=0;e.action='blocked';e.wait=1;}
    function advance(e, dt) {
      if(e.retiring){e.opacity=Math.max(0,e.opacity-dt*.35);if(e.opacity===0)citizens.delete(e.id);return;}
      e.opacity=Math.min(1,e.opacity+dt*2);
      if(e.action==='work') {
        const job=locations.get(e.goal),inactive=!availableJob(job)||(e.role==='builder'&&!job.b.construction);
        if(inactive&&!assign(e,true)){e.action='blocked';e.homeward=true;e.wait=1;}
      }
      if(e.action==='walk') {
        let budget=dt*(.42+(hash(e.id)%13)/100);
        while(budget>0&&e.action==='walk') {
          if(!e.to) {
            const next=e.route[e.step+1];
            if(!next){arrive(e);break;}
            if(!liveRoad(e.node)||!liveRoad(next)){blocked(e);break;}
            e.from=e.node;e.to=next;e.edge=0;
          }
          const [ax,ay]=point(e.from),[bx,by]=point(e.to);
          // If the next road is demolished, walk back along this same edge.
          // Never snap to a new path or teleport to another connected component.
          if(!liveRoad(e.to)) {
            const moved=Math.min(e.edge,budget);e.edge-=moved;budget-=moved;e.direction={x:ax-bx,y:ay-by};
            e.x=ax+(bx-ax)*e.edge;e.y=ay+(by-ay)*e.edge;e.phase+=moved*9;
            if(e.edge<=0){e.node=e.from;blocked(e);}break;
          }
          const moved=Math.min(1-e.edge,budget);e.edge+=moved;budget-=moved;e.direction={x:bx-ax,y:by-ay};
          e.x=ax+(bx-ax)*e.edge;e.y=ay+(by-ay)*e.edge;e.phase+=moved*9;
          if(e.edge>=1-1e-9){e.node=e.to;e.step++;e.from=null;e.to=null;e.edge=0;if(e.step>=e.route.length-1)arrive(e);}
        }
      } else {
        e.wait-=dt;if(e.action==='work')e.phase+=dt*3;
        if(e.wait<=0) {
          const homeward=e.action==='work'||e.homeward&&e.action==='blocked';
          if(!assign(e,homeward)){e.action='blocked';e.wait=2;}
        }
      }
    }
    function update(next, deltaSeconds, options={}) {
      if(!next?.tiles){state=null;citizens.clear();roads.clear();components.clear();return;}
      const changed=state!==next;
      if(changed){state=next;roads.clear();components.clear();locations.clear();citizens.clear();signature='';roadSignature='';sinceScan=1;clock=0;pathSearches=0;pathVisits=0;}
      const speed=Math.max(0,Math.min(4,Number(options.speed??1))),dt=Math.max(0,Math.min(.2,Number(deltaSeconds)||0))*speed;
      sinceScan+=Math.max(0,Number(deltaSeconds)||0);clock+=dt;
      if(sinceScan>=.6||!signature){scan(changed);sinceScan=0;}
      if(dt===0)return;
      for(const e of [...citizens.values()])advance(e,dt);
    }
    function collect(){return [...citizens.values()];}
    function inspect(){return{count:citizens.size,roads:roads.size,clock,pathSearches,pathVisits,entities:collect().map(e=>({...e,direction:{...e.direction},route:e.route.slice()}))};}
    return {update,collect,inspect,findPath:path};
  }
  function draw(ctx,e,x,y,time,options={}) {
    if(e.opacity<=0)return;
    const walking=e.action==='walk',working=e.action==='work',motion=options.reducedMotion?0:1;
    const stride=Math.sin(e.phase)*motion,beat=Math.sin(e.phase*1.5)*motion;
    const dx=e.direction.x-e.direction.y,back=e.direction.x+e.direction.y<0;
    const facing=dx<0?-1:1,scale=.94+(hash(e.id)%11)/100;
    ctx.save();ctx.translate(x,y);ctx.scale(facing*scale,scale);ctx.globalAlpha*=e.opacity;
    ctx.fillStyle='rgba(20,30,24,.25)';ctx.beginPath();ctx.ellipse(0,.35,2.6,1.1,0,0,Math.PI*2);ctx.fill();
    const art=typeof window!=='undefined'?window.GameArt:null;
    function part(name,px,py,w,h,rotation=0,ax=.5,ay=.1,color='#715641') {
      ctx.save();ctx.translate(px,py);ctx.rotate(rotation);
      const ok=art?.drawPart?.(ctx,'people/'+name,-w*ax,-h*ay,w,h,{night:options.night||0});
      if(!ok){ctx.fillStyle=color;ctx.fillRect(-w*ax,-h*ay,w,h);}
      ctx.restore();
    }
    function limb(px,py,angle,lowerAngle,upper,lower,length,width,color) {
      part(upper,px,py,width,length,angle,.5,.1,color);
      const ex=px-Math.sin(angle)*length*.86,ey=py+Math.cos(angle)*length*.86;
      part(lower,ex,ey,width*.9,length,angle+lowerAngle,.5,.1,color);
      return{x:ex-Math.sin(angle+lowerAngle)*length*.85,y:ey+Math.cos(angle+lowerAngle)*length*.85};
    }
    const leg=walking?stride*.52:working&&e.role==='farmer'?.12:0;
    const left=limb(-.8,-4.6,leg,Math.max(0,-leg)*.65,'thigh','shin',2.7,1.45,'#3d4c4c');
    const right=limb(.8,-4.6,-leg,Math.max(0,leg)*.65,'thigh','shin',2.7,1.45,'#465858');
    part('shoe',left.x,left.y,2.1,1,0,.3,.35,'#343b35');part('shoe',right.x,right.y,2.1,1,0,.3,.35,'#343b35');
    const lean=working&&e.role==='farmer'?.14:0,bob=walking?Math.abs(stride)*.2:0;
    const arm=walking?-stride*.5:working?(e.role==='builder'?-1.1+beat*.7:e.role==='farmer'?-.65+beat*.35:.1):.1;
    limb(-1.4,-8.8+bob,-arm*.6,.13,'upper-arm','forearm',2.25,1.4,'#547b87');
    part('torso',0,-9.6+bob,4.1,5.2,lean,.5,.1,'#62848b');
    const hand=limb(1.3,-8.8+bob,arm,.12,'upper-arm','forearm',2.25,1.45,'#547b87');
    part('head',0,-9.4+bob,3.1,3.5,0,.5,.9,'#c6a074');
    if(back){ctx.fillStyle='#3d3930';ctx.beginPath();ctx.ellipse(0,-11.4+bob,1.4,1.1,0,0,Math.PI*2);ctx.fill();}
    if(e.role==='farmer'||e.role==='worker')part('hat',0,-12+bob,5.2,2.2,0,.5,.6,'#ae8d54');
    if(working&&e.role==='builder')part('hammer',hand.x,hand.y,3,4.5,arm-.7,.5,.8,'#706b5d');
    else if(working&&e.role==='farmer')part('hoe',hand.x,hand.y,3.2,7,arm-.5,.5,.4,'#8c6a41');
    else if(e.role==='carrier'||e.role==='worker')part('basket',2.1,-5.5,3.3,3.4,0,.5,.2,'#9c794a');
    ctx.restore();
  }
  return {...createSimulation(),createSimulation,draw};
});
