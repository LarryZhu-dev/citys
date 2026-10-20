/* Original Chinese architecture assembled from measured structural parts.
 * One plan unit is one map tile. Heights use the same world scale; buildings
 * never borrow another building's footprint to make their artwork look larger.
 * Generated orthographic materials are projected onto geometry, not pasted as
 * complete building sprites. See GameArt.getPart and assets/modular/parts.json.
 */
(function (global) {
  'use strict';
  const PALETTE = Object.freeze({stone:'#a9aa94',stoneDark:'#777f70',plaster:'#ded9bd',wood:'#805d40',red:'#994d3c',roof:'#64766e',roofDark:'#3b5551',gold:'#c1a566',earth:'#927650',green:'#637d4e',ink:'#34443b'});
  const PART_KEYS = ['wall-plaster','wall-brick','foundation-stone','wood-planks','roof-tiles','roof-ridge','column-red','column-wood','beam-red','beam-wood','dougong','window-lattice','door-double','door-wood','kiln-mouth','awning-cloth'];
  const SIZES = {house:1,villa:2,well:1,watch:1,police:1,clinic:1,repair:1,temple:1,school:1,theater:1,grainShop:1,vegShop:1,fruitShop:1,fishShop:1,meatShop:1,farmland:2,vegFarm:2,orchard:2,fishing:1,pasture:2,lumber:2,quarry:2,clayPit:2,kiln:2,pottery:2,mill:2,weaver:2,winery:2,granary:2,warehouse:2,treeDeco:1,garden:2,monument:1,barracks:2,university:2,bath:2,observatory:2,harbor:2,market:2,copperMine:2,pagoda:2,wonder:3};
  const GROUPS = {residence:['house','villa'],hall:['temple','school','university','theater'],shop:['grainShop','vegShop','fruitShop','fishShop','meatShop','market'],farm:['farmland','vegFarm','orchard','pasture'],dock:['fishing','harbor'],workshop:['lumber','quarry','clayPit','copperMine','kiln','pottery','mill','weaver','winery'],storage:['granary','warehouse'],landscape:['treeDeco','garden','monument'],landmark:['pagoda','wonder','observatory'],service:['well','watch','police','clinic','repair','bath','barracks']};
  const PHASES = ['地基与台明','柱网与支架','围护与梁枋','椽架与屋架','瓦面与设备','门窗与陈设'];
  const PHASE_SPANS = [[0,.12],[.12,.31],[.31,.55],[.55,.71],[.71,.93],[.93,1]];
  const recipes = new Map(), rasterCache = new Map(),selectionCache=new Map(),measureCache=new Map(),thumbnailCache=new Map();
  const stats = {hits:0,misses:0,bytes:0,entries:0};
  const MAX_BYTES = 48 * 1024 * 1024, MAX_ENTRIES = 180;
  const clamp = (x,a,b) => Math.max(a,Math.min(b,Number(x)||0));
  const mix = (a,b,t) => a+(b-a)*t;
  const vec = (a,b,t) => a.map((v,i)=>mix(v,b[i],t));
  function category(type) { return Object.keys(GROUPS).find(k=>GROUPS[k].includes(type)) || 'service'; }
  function hash(text) { let n=2166136261;for(const c of String(text))n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0; }
  function tint(hex,factor) { const n=parseInt(hex.slice(1),16);return '#'+[n>>16,n>>8&255,n&255].map(c=>Math.round(clamp(c*factor,0,255)).toString(16).padStart(2,'0')).join(''); }

  class Plan {
    constructor(type,level) { this.type=type;this.level=level;this.size=SIZES[type];this.parts=[];this.modules=[];this.anchors=[];this.serial=0; }
    add(kind,id,phase,data={}) { this.parts.push({kind,id,phase,order:this.serial++,...data}); }
    box(id,x,y,z,w,d,h,color,material,phase=2,extra={}) { this.add('box',id,phase,{x,y,z,w,d,h,color,material,...extra}); }
    face(id,points,color,material,phase=5,extra={}) { this.add('face',id,phase,{points,color,material,...extra}); }
    line(id,a,b,color,width=.025,phase=3,extra={}) { this.add('line',id,phase,{a,b,color,width,...extra}); }
    prop(id,type,x,y,z=0,scale=1,phase=5,extra={}) { this.add('prop',id,phase,{type,x,y,z,scale,...extra}); }
    light(x,y,z,power=.65) { this.anchors.push({x,y,z,power}); }
    ground(color='#939474',material=null) { const s=this.size,inset=this.type==='well'?.22:.055;this.box('site',inset,inset,-.008,s-inset*2,s-inset*2,.008,color,material,0,{site:true,ground:true}); }
    stairs(id,x,y,z,w,depth=.22) { for(let i=0;i<3;i++)this.box(id+i,x,y+depth*(2-i)/3,z+i*.027,w,depth/3+.012,.03,PALETTE.stone,'foundation-stone',0); }
    fence(id,x,y,w,d,stone=false,roof=false) {
      const h=stone?.22:.15,c=stone?PALETTE.plaster:PALETTE.wood,m=stone?'wall-plaster':'wood-planks';
      if(!stone){
        const edges=[[[x,y],[x+w,y]],[[x,y],[x,y+d]],[[x+w,y],[x+w,y+d]],[[x,y+d],[x+w*.32,y+d]],[[x+w*.68,y+d],[x+w,y+d]]];
        edges.forEach(([a,b],edge)=>{const count=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.27));for(let i=0;i<=count;i++){const xx=mix(a[0],b[0],i/count),yy=mix(a[1],b[1],i/count);this.box(id+'-post-'+edge+'-'+i,xx-.012,yy-.012,.025,.024,.024,.20,c,'column-wood',1);}for(const z of[.09,.19])this.line(id+'-rail-'+edge+'-'+z,[...a,z],[...b,z],c,.021,2);});
        return;
      }
      this.box(id+'west',x,y,.035,.035,d,h,c,m,2);this.box(id+'back',x,y,.035,w,.035,h,c,m,2);
      this.box(id+'east',x+w-.035,y,.035,.035,d,h,c,m,2);
      this.box(id+'front-l',x,y+d-.035,.035,w*.32,.035,h,c,m,2);this.box(id+'front-r',x+w*.68,y+d-.035,.035,w*.32,.035,h,c,m,2);
      if(roof)for(const [suffix,xx,yy,ww,dd]of[['w',x-.015,y,.065,d],['b',x,y-.015,w,.065],['e',x+w-.05,y,.065,d]])this.box(id+'cap'+suffix,xx,yy,.035+h,ww,dd,.026,PALETTE.roof,'roof-tiles',4);
    }
    roof(id,x,y,w,d,z,rise=.25,style={}) {
      const e=style.eave??.055,x0=x-e,x1=x+w+e,y0=y-e,y1=y+d+e,mid=y+d/2;
      const hip=style.gable?0:Math.min(w*.24,d*.28),color=style.color||PALETTE.roof;
      const roofPoint=(u,v,front)=>[mix(mix(x0,x1,u),mix(x+hip,x+w-hip,u),v),mix(front?y1:y0,mid,v),z+rise*Math.pow(v,1.25)+(1-v)*(.045*Math.pow(Math.abs(u-.5)*2,5)-.015)];
      // Each roof strip is an individual component during construction.
      for(const front of [false,true])for(let i=0;i<Math.max(4,Math.ceil(w*8));i++){
        const n=Math.max(4,Math.ceil(w*8)),a=i/n,b=(i+1)/n;
        this.face(id+(front?'-south-':'-north-')+i,[roofPoint(a,1,front),roofPoint(b,1,front),roofPoint(b,0,front),roofPoint(a,0,front)],tint(color,front?1.08:.83),'roof-tiles',4,{roof:true,depth:x+y+w/2+d/2+.012,textureAlpha:.62,uv:[a,0,b-a,1],shade:front?.045:.18});
        this.line(id+(front?'-tileS-':'-tileN-')+i,roofPoint(a,1,front),roofPoint(a,0,front),tint(color,front?1.12:.88),.006,4,{depth:x+y+w/2+d/2+.014});
      }
      if(hip>0)for(const side of [0,1]){
        const xx=side?x1:x0,ridge=[side?x+w-hip:x+hip,mid,z+rise];
        this.face(id+'hip'+side,[ridge,[xx,y0,z+.045],[xx,y1,z+.045]],tint(color,side?.76:.92),'roof-tiles',4,{roof:true,depth:x+y+w/2+d/2+(side?.013:-.012),textureAlpha:.60,shade:side?.22:.12});
      }
      this.line(id+'ridge',[x+hip-.04,mid,z+rise+.014],[x+w-hip+.04,mid,z+rise+.014],style.gold?PALETTE.gold:tint(color,1.35),.035,5,{depth:x+y+w/2+d/2+.02});
      if(style.ornate)for(const side of[0,1]){
        const xx=side?x+w-hip:x+hip;
        this.line(id+'finial'+side,[xx,mid,z+rise],[xx+(side?.04:-.04),mid,z+rise+.045],style.gold?PALETTE.gold:tint(color,1.18),.035,5,{depth:x+y+w/2+d/2+.025});
      }
      // Generated rounded drip tiles form one continuous vertical edge. Ornate
      // halls add mirrored corner ornaments, separately installed at the end.
      const left=roofPoint(0,0,true),right=roofPoint(1,0,true);
      this.face(id+'-drip-edge',[left,right,[right[0],right[1],right[2]-.047],[left[0],left[1],left[2]-.047]],'rgba(0,0,0,0)','roof-ridge',5,{textureAlpha:.84,noOutline:true});
      if(style.ornate)for(const side of[0,1]){
        const xx=side?x1:x0,direction=side?1:-1,tip=.11;
        this.face(id+'-corner-'+side,[[xx-direction*tip,y1+.006,z+.12],[xx+direction*.025,y1+.006,z+.12],[xx+direction*.025,y1+.006,z-.02],[xx-direction*tip,y1+.006,z-.02]],'rgba(0,0,0,0)','roof-corner',5,{textureAlpha:.95,noOutline:true});
      }
      for(const front of[false,true])for(let i=0;i<4;i++){
        this.line(id+'eave'+front+i,roofPoint(i/4,0,front),roofPoint((i+1)/4,0,front),tint(color,.64),.033,4,{depth:x+y+w/2+d/2+.025});
      }
    }
    hall(id,x,y,w,d,opts={}) {
      const z=opts.z??.08,h=opts.h??.44,bays=opts.bays||3,wood=opts.red?PALETTE.red:PALETTE.wood,roofZ=z+h+.035,depth=x+y+w/2+d/2+z*.10;
      this.modules.push({id,type:'timber-hall',x,y,w,d,z,h,bays,open:!!opts.open});
      const addStart=this.parts.length;
      this.box(id+'-plinth',x-.035,y-.035,z-.075,w+.07,d+.07,.075,PALETTE.stone,'foundation-stone',0);
      this.box(id+'-floor',x,y,z-.012,w,d,.024,'#a58b62','wood-planks',0);
      for(const yy of[y+.02,y+d-.02])for(let i=0;i<=bays;i++){
        const xx=x+.025+(w-.05)*i/bays;
        this.box(id+'-post-'+yy+'-'+i,xx-.0225,yy-.0225,z,.045,.045,h,wood,opts.red?'column-red':'column-wood',1);
        this.box(id+'-shoe-'+yy+'-'+i,xx-.028,yy-.028,z-.005,.056,.056,.043,PALETTE.stone,'foundation-stone',0);
        this.box(id+'-capital-'+yy+'-'+i,xx-.045,yy-.04,z+h-.075,.09,.08,.036,wood,opts.red?'beam-red':'beam-wood',2);
        if(opts.ornate)this.face(id+'-bracket-'+yy+'-'+i,[[xx-.055,yy+.031,z+h+.01],[xx+.055,yy+.031,z+h+.01],[xx+.055,yy+.031,z+h-.07],[xx-.055,yy+.031,z+h-.07]],PALETTE.gold,'dougong',2);
      }
      for(const yy of[y,y+d-.045])this.box(id+'-longbeam-'+yy,x-.02,yy,z+h-.035,w+.04,.045,.055,wood,opts.red?'beam-red':'beam-wood',2);
      for(const xx of[x,x+w-.035])this.box(id+'-crossbeam-'+xx,xx,y,z+h-.045,.035,d,.045,wood,'beam-wood',2);
      if(!opts.open){
        this.box(id+'-backwall',x+.04,y+.025,z,.9*w,.025,h*.86,opts.brick?'#a89c80':PALETTE.plaster,opts.brick?'wall-brick':'wall-plaster',2);
        for(let i=0;i<bays;i++){
          const bayW=(w-.06)/bays,xx=x+.03+i*bayW;
          if(i!==Math.floor(bays/2))this.box(id+'-frontwall-'+i,xx,y+d-.036,z,bayW-.025,.025,h*.86,PALETTE.plaster,'wall-plaster',2);
          const door=i===Math.floor(bays/2),ww=bayW*(door?.78:.72),hh=h*(door?.82:.56),zz=z+(door?0:h*.25);
          this.face(id+'-opening-'+i,[[xx+(bayW-ww)/2,y+d-.004,zz+hh],[xx+(bayW+ww)/2,y+d-.004,zz+hh],[xx+(bayW+ww)/2,y+d-.004,zz],[xx+(bayW-ww)/2,y+d-.004,zz]],door?'#5d4934':'#576959',door?(opts.red?'door-double':'door-wood'):'window-lattice',5,{window:!door});
          if(!door)this.light(xx+bayW/2,y+d+.012,zz+hh/2,.48);
        }
        this.box(id+'-sidewall',x+w-.038,y+.05,z,.026,d-.1,h*.86,opts.brick?'#a1967e':PALETTE.plaster,opts.brick?'wall-brick':'wall-plaster',2);
        if(d>.3)this.face(id+'-sidewindow',[[x+w-.008,y+d*.26,z+h*.70],[x+w-.008,y+d*.66,z+h*.70],[x+w-.008,y+d*.66,z+h*.28],[x+w-.008,y+d*.26,z+h*.28]],'#586652','window-lattice',5,{window:true});
      }
      // Exposed rafters remain legible before the separate tile strips arrive.
      const hip=opts.gable?0:Math.min(w*.24,d*.28);
      for(let i=0;i<=bays*2;i++){
        const xx=x+w*i/(bays*2),apex=[clamp(xx,x+hip,x+w-hip),y+d/2,roofZ+(opts.rise??.24)];
        this.line(id+'-rafterN-'+i,[xx,y-.055,roofZ],apex,wood,.022,3);
        this.line(id+'-rafterS-'+i,apex,[xx,y+d+.055,roofZ],wood,.022,3);
      }
      this.line(id+'-ridgepole',[x+hip,y+d/2,roofZ+(opts.rise??.24)],[x+w-hip,y+d/2,roofZ+(opts.rise??.24)],wood,.034,3);
      this.roof(id+'-roof',x,y,w,d,roofZ,opts.rise??.24,{gable:opts.gable,color:opts.roofColor,gold:opts.gold,eave:opts.eave,ornate:opts.ornate});
      // Eaves shade the upper wall and beam ends in the same light direction as
      // the terrain art. These remain separate surfaces below the roof profile.
      if(!opts.open){
        this.face(id+'-eave-shadow-front',[[x,y+d+.006,z+h-.015],[x+w,y+d+.006,z+h-.015],[x+w,y+d+.006,z+h-.105],[x,y+d+.006,z+h-.105]],'rgba(39,49,35,.22)',null,4,{noOutline:true});
        this.face(id+'-eave-shadow-side',[[x+w+.006,y,z+h-.015],[x+w+.006,y+d,z+h-.015],[x+w+.006,y+d,z+h-.12],[x+w+.006,y,z+h-.12]],'rgba(39,49,35,.28)',null,4,{noOutline:true});
      }
      if(opts.sign)this.face(id+'-sign',[[x+w*.3,y+d+.055,z+h*.92],[x+w*.7,y+d+.055,z+h*.92],[x+w*.7,y+d+.055,z+h*.76],[x+w*.3,y+d+.055,z+h*.76]],opts.red?'#493e2b':'#46635a',null,5,{sign:opts.sign});
      // The structure is a painter group: roof tiles must cover their rafters,
      // while a separate courtyard gate can correctly occlude the entire hall.
      for(let i=addStart;i<this.parts.length;i++)this.parts[i].depth=depth+(this.parts[i].phase>=4?.015:0);
    }
  }

  function makeRecipe(type,level) {
    const p=new Plan(type,level),s=p.size,L=level;
    const hall=(...a)=>p.hall(...a),prop=(...a)=>p.prop(...a),box=(...a)=>p.box(...a);
    const yard=(id,x,y,w,d)=>box(id,x,y,.025,w,d,.015,'#bdbaa0','foundation-stone',0);
    const canopy=(id,x,y,w,d,color)=>{hall(id,x,y,w,d,{open:true,h:.38,rise:.17,roofColor:color,gable:true});};
    const jars=(id,x,y,n,scale=.7)=>{for(let i=0;i<n;i++)prop(id+i,'jar',x+(i%3)*.13,y+Math.floor(i/3)*.14,.04,scale);};
    if(['farmland','vegFarm','orchard','pasture'].includes(type))p.ground(type==='pasture'?'#8c9162':'#8d7552',null);
    else if(['quarry','clayPit','copperMine'].includes(type))p.ground(type==='clayPit'?'#ad8d64':'#939887','foundation-stone');
    else if(type==='treeDeco'||type==='garden')p.ground('#80936a',null);
    else p.ground();
    if(type==='house'){
      hall('main',.19,.15,.59,.43,{bays:2,h:.38,rise:.23,gable:true});
      p.stairs('entry',.39,.61,.025,.22,.17);
      if(L>=2){hall('porch',.28,.58,.42,.2,{open:true,h:.27,rise:.12,gable:true});jars('waterjar',.78,.55,1,.62);}
      if(L>=3){hall('kitchen',.06,.16,.15,.39,{bays:1,h:.27,rise:.17,gable:true});box('flue',.08,.18,.43,.045,.055,.4,'#9a8c75','wall-brick',4);}
      if(L>=4)p.fence('courtyard',.055,.075,.88,.83,true,true);
      if(L>=5){hall('east-wing',.78,.3,.15,.47,{bays:1,h:.30,rise:.15,gable:true});prop('planted-tree','tree',.13,.76,.05,.44);}
      if(L>=6)hall('upper-hall',.25,.19,.47,.34,{z:.61,h:.31,rise:.20,bays:2,red:true,ornate:true});
      if(L>=7){box('balcony-floor',.26,.50,.65,.46,.28,.035,PALETTE.wood,'wood-planks',2);for(let i=0;i<6;i++)box('balcony-post'+i,.26+i*.085,.77,.65,.015,.015,.12,PALETTE.red,'column-red',2);p.line('balcony-rail',[.26,.78,.77],[.71,.78,.77],PALETTE.red,.023,4);}
      if(L>=8){hall('gatehouse',.35,.81,.3,.11,{h:.27,rise:.14,bays:1,open:true,red:true,ornate:true});prop('lantern-gate','lantern',.31,.88,.28,.6);p.light(.31,.88,.28);}
      if(L>=9)hall('east-study',.79,.4,.14,.32,{z:.50,h:.28,rise:.12,bays:1,red:true});
      if(L>=10){hall('roof-pavilion',.34,.25,.3,.23,{z:1.04,h:.23,rise:.17,bays:1,open:true,red:true,gold:true,ornate:true});prop('courtyard-bonsai','tree',.8,.82,.05,.35);}
    } else if(type==='villa'){
      yard('court-paving',.28,.55,1.45,1.1);p.fence('compound',.1,.1,1.8,1.8,true,true);
      hall('main-hall',.42,.23,1.16,.58,{h:.54,bays:4,red:true,ornate:true});p.stairs('main-steps',.84,.80,.035,.32,.22);
      if(L>=2){hall('west-wing',.16,.72,.31,.91,{bays:2,h:.40,gable:true});hall('east-wing',1.53,.72,.31,.91,{bays:2,h:.40,gable:true});}
      if(L>=3){hall('entrance',.76,1.70,.48,.18,{bays:1,h:.39,open:true,red:true,ornate:true});prop('court-pine','tree',.59,1.25,.04,.67);prop('lily-pond','pond',1.23,1.26,.035,.65);}
      if(L>=4){hall('rear-study',.22,.18,.26,.4,{z:.63,h:.32,bays:1,red:true});hall('covered-walk',.53,1.50,.95,.18,{h:.30,bays:4,open:true,red:true,rise:.13});}
      if(L>=5){hall('upper-residence',.57,.3,.86,.43,{z:.85,h:.4,bays:3,red:true,ornate:true});prop('tall-lantern','lantern',1.46,1.6,.57,.85);p.light(1.46,1.6,.57,.8);}
      if(L>=6){hall('belvedere',.79,.4,.42,.27,{z:1.47,h:.29,bays:2,red:true,open:true,ornate:true,gold:true});hall('east-library',1.57,.88,.24,.54,{z:.66,h:.34,bays:1,red:true});}
    } else if(type==='well'){
      prop('well-rim','well',.5,.53,.06,.9,0);
      hall('well-canopy',.25,.24,.50,.46,{open:true,h:.35,rise:.17,bays:1});
      p.line('windlass',[.25,.45,.32],[.75,.45,.32],PALETTE.wood,.04,4);
      p.line('rope',[.5,.45,.32],[.5,.45,.12],'#b49b67',.012,5);
      prop('water-bucket','bucket',.8,.75,.06,.65);p.light(.3,.28,.44,.35);
    } else if(type==='watch'){
      hall('tower-base',.28,.28,.44,.44,{h:.66,bays:2,brick:true});
      hall('watch-balcony',.22,.22,.56,.56,{z:.84,h:.38,bays:2,open:true,red:true,ornate:true,rise:.22});
      prop('signal-bell','bell',.51,.69,1.13,.6);prop('night-lantern','lantern',.79,.72,.81,.7);p.light(.79,.72,.81,.85);
    } else if(type==='police'){
      p.fence('precinct',.08,.09,.84,.81,true,true);hall('office',.16,.17,.66,.40,{red:true,bays:3,sign:'捕'});
      prop('arms-rack','rack',.76,.73,.04,.6);prop('drum','drum',.21,.74,.04,.65);
    } else if(type==='clinic'){
      hall('clinic',.12,.15,.76,.4,{bays:3,sign:'药'});hall('herb-porch',.13,.52,.32,.25,{open:true,h:.29,rise:.13});
      for(let i=0;i<3;i++)prop('herb-bed'+i,'herbs',.56+i*.12,.74,.04,.6);
      prop('mortar','mortar',.22,.78,.04,.55);jars('medicine',.64,.57,2,.45);
    } else if(type==='repair'){
      hall('carpenter-shelter',.14,.14,.72,.42,{open:true,h:.43,bays:3,sign:'修'});
      prop('workbench','bench',.46,.67,.05,.9);prop('timber','logs',.79,.72,.04,.7);prop('tool-rack','rack',.18,.72,.04,.55);
    } else if(type==='temple'){
      box('terrace',.12,.12,.03,.76,.65,.12,PALETTE.stone,'foundation-stone',0);p.stairs('temple-stairs',.37,.76,.03,.27,.18);
      hall('sanctuary',.17,.18,.66,.48,{z:.19,h:.50,bays:3,red:true,ornate:true,gold:true,rise:.31,sign:'宁'});
      prop('incense','censer',.5,.84,.06,.6);prop('stone-lion-l','lion',.19,.81,.05,.48);prop('stone-lion-r','lion',.81,.81,.05,.48);
    } else if(type==='school'){
      hall('school-room',.12,.16,.77,.44,{bays:3,h:.44,gable:true,sign:'学'});
      prop('scholar-desk','bench',.39,.75,.04,.7);prop('book-shelf','books',.80,.73,.04,.65);prop('bamboo','bamboo',.14,.75,.04,.7);
    } else if(type==='theater'){
      box('stage',.11,.18,.03,.78,.62,.15,PALETTE.stone,'foundation-stone',0);
      hall('stage-canopy',.13,.2,.74,.48,{z:.21,h:.51,open:true,bays:3,red:true,ornate:true,gold:true,rise:.30});
      p.face('backdrop',[[.18,.24,.66],[.82,.24,.66],[.82,.24,.25],[.18,.24,.25]],'#a65641','awning-cloth',4);
      prop('stage-drum','drum',.24,.61,.22,.5);prop('stage-drum-r','drum',.78,.61,.22,.5);p.stairs('stage-steps',.4,.77,.03,.24,.15);
    } else if(['grainShop','vegShop','fruitShop','fishShop','meatShop'].includes(type)){
      const colors={grainShop:'#a7966a',vegShop:'#6e8e72',fruitShop:'#b9815b',fishShop:'#64868b',meatShop:'#a46151'},signs={grainShop:'粮',vegShop:'菜',fruitShop:'果',fishShop:'鱼',meatShop:'肉'};
      hall('shop-house',.14,.14,.72,.41,{h:.39,bays:2,gable:true,sign:signs[type]});
      p.face('cloth-canopy',[[.12,.50,.43],[.89,.50,.43],[.89,.83,.31],[.12,.83,.31]],colors[type],'awning-cloth',4);
      for(const x of[.13,.88])box('awning-post'+x,x,.81,.04,.023,.023,.29,PALETTE.wood,'column-wood',1);
      prop('sales-counter','counter',.51,.74,.04,.95,4,{goods:type.replace('Shop','')});
      if(type==='grainShop')jars('grain-jar',.2,.87,2,.55);
      if(type==='fishShop')prop('fish-tub','bucket',.83,.88,.04,.6);
      if(type==='meatShop')prop('meat-rack','meat',.2,.70,.05,.55);
    } else if(type==='market'){
      yard('market-court',.13,.15,1.74,1.72);hall('market-hall',.30,.18,1.4,.47,{bays:5,h:.49,red:true,ornate:true,sign:'市'});
      for(const [i,x,y,c,g]of[[0,.16,.84,'#78876b','veg'],[1,1.26,.84,'#b89163','grain'],[2,.16,1.40,'#a96654','fruit'],[3,1.26,1.40,'#648a87','fish']]){
        canopy('stall-'+i,x,y,.54,.3,c);prop('counter-'+i,'counter',x+.27,y+.25,.04,.65,5,{goods:g});
      }
      prop('market-banner','banner',1.02,1.7,.04,.95);p.light(.72,.7,.46,.7);p.light(1.45,1.43,.38,.55);
    } else if(type==='farmland'||type==='vegFarm'){
      p.fence('farm-fence',.09,.08,1.82,1.82);hall('tool-hut',.13,.13,.37,.32,{open:true,h:.27,rise:.16,bays:1,gable:true});
      for(let row=0;row<5;row++){
        box('soil-bed'+row,.15,.60+row*.245,.016,1.68,.17,.022,row%2?'#9b8059':'#95754e',null,0,{ground:true});
        box('irrigation'+row,.15,.56+row*.245,.015,1.68,.025,.018,'#577d76',null,2);
        for(let col=0;col<7;col++)prop('crop-'+row+'-'+col,type==='farmland'?'grain':'vegetable',.24+col*.235,.68+row*.245,.025,.82,4,{crop:true,row,col});
      }
      prop('farm-bucket','bucket',.68,.29,.03,.65);
    } else if(type==='orchard'){
      p.fence('orchard-fence',.08,.08,1.84,1.84);hall('orchard-shed',.14,.14,.44,.31,{open:true,h:.28,rise:.16,gable:true,bays:1});
      for(let row=0;row<3;row++)for(let col=0;col<3;col++)prop('fruit-tree'+row+col,'fruitTree',.40+col*.57,.65+row*.49,.035,.84,4,{crop:true});
      prop('fruit-basket','basket',.86,.28,.04,.7);
    } else if(type==='pasture'){
      p.fence('pasture-fence',.08,.08,1.84,1.84);hall('stock-shelter',.16,.14,1.10,.45,{open:true,h:.38,bays:3,gable:true});
      prop('hay-rick','hay',1.58,.45,.035,1.0);prop('water-trough','trough',1.42,1.48,.04,.8);
      prop('cow-a','cow',.58,.95,.04,1);prop('cow-b','cow',.98,1.48,.04,.9);prop('calf','cow',.43,1.54,.04,.6);
    } else if(type==='fishing'||type==='harbor'){
      const big=type==='harbor';
      box('timber-quay',.08,s*.55,.03,s-.16,s*.38,.06,'#9f8056','wood-planks',0);
      for(let i=0;i<(big?7:4);i++)box('pier-pile'+i,.12+i*(s-.24)/(big?6:3),s*.87,-.12,.055,.055,.29,PALETTE.wood,'column-wood',1);
      hall('dock-house',big?.25:.13,big?.16:.12,big?1.1:.66,big?.62:.36,{h:big?.49:.34,bays:big?4:2,gable:true,sign:big?'港':null});
      prop('moored-boat','boat',s*.55,s*.88,.07,big?1.65:.75,4);
      prop('net-frame','net',s*.79,s*.52,.09,big?1.1:.62,4);
      if(big){prop('cargo-crane','crane',1.67,.65,.04,1.25,3);prop('port-cargo','crates',.32,1.25,.1,1.2);jars('freight-jars',1.31,1.11,3,.8);}
      else prop('fish-baskets','basket',.23,.72,.1,.65);
    } else if(type==='lumber'){
      hall('saw-shelter',.18,.18,1.15,.65,{open:true,h:.48,bays:3,gable:true});
      prop('long-log-stack','logs',.55,1.36,.04,1.35,4);prop('cut-log-stack','logs',1.53,1.13,.04,.95,4);prop('saw-bench','saw',.66,.65,.10,1,4);
      prop('remaining-pine','tree',1.62,.35,.02,.85,1);
    } else if(['quarry','clayPit','copperMine'].includes(type)){
      const clay=type==='clayPit',copper=type==='copperMine';
      for(let i=0;i<4;i++)box('terrace-cut'+i,.13+i*.12,.15+i*.12,.015,1.48-i*.24,1.15-i*.14,.10-i*.019,clay?'#a58965':copper?'#8d9178':'#9da28e',clay?'wall-brick':'foundation-stone',0);
      if(copper){box('mine-opening',.39,.28,.06,.5,.1,.35,'#3c4b41',null,2);p.line('pit-lintel',[.34,.40,.44],[.98,.40,.44],PALETTE.wood,.075,2);for(const x of[.36,.94])box('pit-post'+x,x,.39,.06,.06,.07,.4,PALETTE.wood,'column-wood',1);}
      prop('mine-crane','crane',1.55,.68,.04,.95,3);hall('tool-shelter',.17,1.35,.6,.35,{open:true,h:.32,bays:2,gable:true});
      prop('mineral-stock',clay?'bricks':copper?'ore':'stone',1.12,1.50,.04,1.15,4);prop('ore-cart','cart',1.66,1.51,.05,.75,4);
    } else if(type==='kiln'){
      prop('brick-kiln','kiln',.76,.68,.04,1.6,2);box('kiln-chimney',.92,.38,.11,.21,.22,1.12,'#a18261','wall-brick',2);
      hall('drying-shed',1.34,.28,.43,.76,{open:true,h:.41,bays:2,gable:true});prop('brick-stack','bricks',.65,1.48,.04,1.4,4);prop('fuel','logs',1.55,1.4,.04,.95,4);
      p.anchors.push({effect:'kiln',x:.76,y:1.02,z:.22,smoke:[1.02,.48,1.26]});
    } else if(type==='pottery'){
      hall('pottery-house',.16,.17,1.06,.60,{bays:3,h:.46,gable:true,sign:'陶'});hall('pottery-porch',.17,.75,.78,.38,{open:true,h:.37,bays:2,gable:true,rise:.16});
      prop('potters-wheel','wheel',.55,.94,.06,.8,4);prop('pottery-kiln','kiln',1.52,.66,.05,.85,2);jars('drying-pots',.45,1.40,6,.85);prop('clay-storage','basket',1.48,1.42,.04,.9);
      p.anchors.push({effect:'kiln',x:1.52,y:.87,z:.16,smoke:[1.52,.62,.74]});p.anchors.push({effect:'potter',x:.55,y:.94,z:.23});
    } else if(type==='mill'){
      hall('mill-house',.18,.17,1.22,.70,{bays:3,h:.60,gable:true,sign:'磨'});prop('millstone','millstone',1.57,.72,.06,1.25,4);
      prop('flour-sacks','sacks',.47,1.45,.04,1.3);prop('grain-cart','cart',1.25,1.44,.04,.9);p.anchors.push({effect:'mill',x:1.57,y:.72,z:.29});
    } else if(type==='weaver'){
      hall('weaving-room',.17,.16,1.50,.61,{bays:4,h:.46,gable:true,sign:'织'});hall('loom-porch',.18,.79,.72,.45,{open:true,h:.39,bays:2,gable:true,rise:.16});
      prop('loom','loom',.54,1.07,.05,1,4);prop('cloth-rack','cloth',1.35,1.22,.05,1.15,4);prop('thread-basket','basket',.56,1.65,.05,.85);p.anchors.push({effect:'loom',x:.54,y:1.07,z:.3});
    } else if(type==='winery'){
      hall('wine-house',.17,.18,1.30,.63,{bays:3,h:.47,gable:true,sign:'酒'});jars('wine-vat',.41,1.12,6,1.20);prop('grape-press','press',1.57,1.2,.05,.95,4);p.anchors.push({effect:'press',x:1.57,y:1.2,z:.54});
    } else if(type==='granary'){
      for(const [id,x]of[['west-bin',.17],['east-bin',1.08]]){hall(id,x,.28,.73,1.10,{z:.26,h:.56,bays:2,gable:true,brick:true});for(const xx of[x+.09,x+.56])for(const yy of[.38,1.23])box(id+'stilt'+xx+yy,xx,yy,.04,.075,.075,.23,PALETTE.stone,'foundation-stone',0);}
      prop('rice-sacks','sacks',.95,1.71,.04,.85);
    } else if(type==='warehouse'){
      hall('warehouse-main',.17,.21,1.63,.85,{bays:5,h:.56,brick:true,gable:true});hall('loading-shelter',.2,1.10,1.12,.36,{open:true,h:.37,bays:3,gable:true,rise:.15});
      prop('crates-a','crates',.5,1.56,.04,1.1);prop('crates-b','crates',1.55,1.4,.04,1.1);prop('handcart','cart',1.2,1.77,.04,.62);
    } else if(type==='garden'){
      p.fence('garden-wall',.07,.07,1.86,1.86,true,true);prop('pond','pond',1.13,1.17,.035,1.5,0);hall('garden-pavilion',.24,.22,.61,.53,{open:true,h:.48,bays:2,red:true,ornate:true,rise:.26});
      prop('pine','tree',1.53,.44,.04,1);prop('bamboo','bamboo',.28,1.48,.04,1.1);prop('scholar-rock','stone',1.66,1.54,.04,.7);
      p.line('garden-bridge',[.64,1.00,.10],[1.13,1.61,.10],'#b39162',.13,4);prop('garden-lantern','lantern',.72,1.72,.39,.85);p.light(.72,1.72,.39,.5);
    } else if(type==='treeDeco')prop('ornamental-pine','tree',.5,.5,.04,1.25,4);
    else if(type==='monument'){
      box('stele-base',.25,.27,.04,.5,.44,.1,PALETTE.stone,'foundation-stone',0);box('stele',.43,.41,.14,.17,.14,.57,'#b1b7a6','foundation-stone',2);
      p.face('inscription',[[.445,.555,.62],[.585,.555,.62],[.585,.555,.24],[.445,.555,.24]],'#9aa38e',null,5,{sign:'纪'});
      p.roof('stele-cap',.40,.38,.23,.19,.73,.10,{color:'#7b8c7b'});
    } else if(type==='barracks'){
      p.fence('garrison-wall',.09,.09,1.82,1.82,true,true);hall('command-hall',.35,.18,1.30,.56,{bays:4,h:.48,red:true,sign:'营'});hall('bunkhouse',.15,.94,.42,.66,{bays:2,h:.39,gable:true});
      prop('weapon-rack','rack',1.42,1.23,.04,1.3);prop('training-dummy','dummy',.89,1.32,.05,1);prop('banner','banner',1.70,1.70,.04,1.3);prop('drum','drum',.68,1.70,.04,.85);
    } else if(type==='university'){
      p.fence('academy-wall',.08,.08,1.84,1.84,true,true);hall('lecture-hall',.37,.2,1.25,.61,{h:.58,bays:4,red:true,ornate:true,sign:'书院'});
      hall('west-library',.14,.94,.37,.68,{bays:2,h:.43,gable:true});hall('east-library',1.49,.94,.37,.68,{bays:2,h:.43,gable:true});hall('academy-gate',.74,1.66,.53,.2,{open:true,h:.42,bays:1,red:true,ornate:true});prop('academy-tree','tree',.89,1.20,.035,.75);
    } else if(type==='bath'){
      hall('bath-house',.2,.18,1.3,.72,{h:.50,bays:4,brick:true,sign:'汤'});p.fence('bath-screen',.12,.12,1.76,1.76,true,true);
      prop('warm-pool','pond',1.18,1.35,.05,1.1,4);hall('changing-room',.15,1.02,.43,.55,{bays:1,h:.35,gable:true});p.anchors.push({effect:'steam',x:1.18,y:1.35,z:.12});
    } else if(type==='observatory'){
      box('observatory-platform',.35,.30,.04,1.3,1.3,.51,'#929b85','wall-brick',0);p.stairs('observatory-steps',.83,1.52,.035,.35,.36);
      for(const [x,y]of[[.43,.38],[1.49,.38],[.43,1.47],[1.49,1.47]])box('stone-baluster'+x+y,x,y,.55,.06,.06,.24,PALETTE.stone,'foundation-stone',2);
      prop('armillary-sphere','armillary',1.0,.94,.58,1.4,4);hall('astronomer-study',.12,.18,.5,.45,{h:.33,bays:1,red:true,gable:true});p.light(1.0,.94,.66,.4);
    } else if(type==='pagoda'){
      box('pagoda-dais',.44,.43,.035,1.12,1.12,.15,PALETTE.stone,'foundation-stone',0);p.stairs('pagoda-stairs',.84,1.52,.035,.32,.26);
      for(let floor=0;floor<9;floor++){
        const w=.86-floor*.052,d=.78-floor*.048;
        hall('pagoda-tier-'+floor,1-w/2,.94-d/2,w,d,{z:.2+floor*.47,h:floor?.29:.43,bays:floor>5?1:2,red:true,ornate:floor<5,rise:.18-floor*.006,gold:floor===8});
      }
      prop('pagoda-spire','spire',1,.94,4.56,.8,5);
    } else if(type==='wonder'){
      p.fence('palace-wall',.07,.07,2.86,2.86,true,true);yard('ceremonial-path',1.13,1.39,.75,1.43);
      for(let i=0;i<3;i++)box('palace-terrace'+i,.41+i*.10,.24+i*.09,.035+i*.105,2.18-i*.2,1.47-i*.18,.11,PALETTE.stone,'foundation-stone',0);
      hall('great-hall',.64,.45,1.72,.89,{z:.39,h:.68,bays:5,red:true,ornate:true,gold:true,rise:.42});
      hall('upper-great-hall',.84,.60,1.32,.59,{z:1.34,h:.42,bays:4,red:true,ornate:true,gold:true,rise:.31});
      hall('west-corridor',.16,1.49,.43,1.05,{h:.45,bays:3,red:true,open:true});hall('east-corridor',2.41,1.49,.43,1.05,{h:.45,bays:3,red:true,open:true});
      hall('meridian-gate',1.04,2.53,.92,.31,{h:.58,bays:3,red:true,open:true,gold:true,ornate:true,rise:.29});
      p.stairs('great-hall-stair',1.17,1.66,.04,.66,.47);prop('bronze-censer','censer',1.5,2.3,.045,1.1);prop('palace-lion-a','lion',.88,2.62,.04,.82);prop('palace-lion-b','lion',2.12,2.62,.04,.82);prop('palace-pine-a','tree',.79,1.99,.04,.86);prop('palace-pine-b','tree',2.21,1.99,.04,.86);
    }
    const byPhase=Array.from({length:6},()=>[]);for(const part of p.parts)byPhase[part.phase].push(part);
    for(let phase=0;phase<6;phase++)byPhase[phase].forEach((part,i)=>{part.start=mix(...PHASE_SPANS[phase],i/byPhase[phase].length);part.end=mix(...PHASE_SPANS[phase],(i+1)/byPhase[phase].length);});
    for(const part of p.parts){
      if(part.depth===undefined)part.depth=part.x!==undefined?part.x+part.y+(part.w||0)/2+(part.d||0)/2+(part.z||0)*.1:part.points?part.points.reduce((n,v)=>n+v[0]+v[1]+v[2]*.1,0)/part.points.length:(part.a[0]+part.a[1]+part.b[0]+part.b[1])/2;
      // A site's ground surface is behind every structure on it, even when its
      // plan centre lies in front of a rear hall. Elevated floors remain in their
      // own building group, so upper storeys correctly cover lower roof skirts.
      if(part.kind==='box'&&part.phase===0&&part.z+part.h<=.4)part.ground=true;
    }
    p.parts.sort((a,b)=>Number(!!b.ground)-Number(!!a.ground)||a.depth-b.depth||a.phase-b.phase||a.order-b.order);
    return Object.freeze({type,level,size:s,category:category(type),modules:p.modules,parts:p.parts,anchors:p.anchors,signature:hash(JSON.stringify(p.parts)).toString(16)});
  }

  function recipe(type,level=1) {
    if(!Object.hasOwn(SIZES,type))return null;
    level=Math.round(clamp(level,1,type==='house'?10:type==='villa'?6:1));
    const key=type+':'+level;if(!recipes.has(key))recipes.set(key,makeRecipe(type,level));return recipes.get(key);
  }

  function state(options={}) {
    const b=options.building||{},c=options.construction??b.construction;
    const pending=!!c&&Number(c.remaining)>0;
    const from=pending?Math.floor(Number(c.fromLevel)||0):0;
    const level=Math.round(clamp(pending&&c.toLevel?c.toLevel:options.level??b.lvl??1,1,options.type==='house'?10:options.type==='villa'?6:1));
    const r=recipe(options.type,level);if(options.civ&&options.civ!=='china'||!r)return null;
    const progress=pending?clamp(1-Number(c.remaining)/Math.max(1,Number(c.total)||1),0,1):1;
    const old=from?recipe(options.type,from):null,retained=new Set(old?.parts.map(p=>p.id)||[]);
    const active=!pending&&!b.damage&&b.staffed===true&&b.idle!==true;
    const growth=Number.isFinite(b.productionTicks)?Math.floor(Math.max(0,b.productionTicks))%12:9;
    const stage=Math.floor(progress*128),selectionKey=[r.type,level,from,stage].join(':');
    let selected=selectionCache.get(selectionKey);
    if(!selected){
      const additions=Array.from({length:6},()=>[]);if(old)for(const p of r.parts)if(!retained.has(p.id))additions[p.phase].push(p.id);
      selected=r.parts.map(part=>{
        const kept=retained.has(part.id);let start=part.start,end=part.end;
        if(old&&!kept){const group=additions[part.phase],i=group.indexOf(part.id);start=mix(...PHASE_SPANS[part.phase],i/group.length);end=mix(...PHASE_SPANS[part.phase],(i+1)/group.length);}
        return {part,fraction:kept?1:clamp((stage/128-start)/Math.max(.001,end-start),0,1),retained:kept};
      }).filter(p=>p.fraction>0||p.part.site);
      selectionCache.set(selectionKey,selected);if(selectionCache.size>192)selectionCache.delete(selectionCache.keys().next().value);
    }
    return {recipe:r,progress,pending,from,active,growth,building:b,selected,night:clamp(options.night===true?1:options.night,0,1)};
  }

  function inspect(options={}) {
    const st=state(options);if(!st)return {supported:false};
    return {supported:true,type:st.recipe.type,category:st.recipe.category,level:st.recipe.level,footprint:st.recipe.size,progress:st.progress,upgradeFrom:st.from,active:st.active,growthStage:st.growth,phase:PHASES[Math.min(5,PHASE_SPANS.findIndex(v=>st.progress<v[1])<0?5:PHASE_SPANS.findIndex(v=>st.progress<v[1]))],signature:st.recipe.signature,
      parts:st.selected.map(({part,fraction,retained})=>({id:part.id,kind:part.kind,phase:PHASES[part.phase],material:part.material||null,progress:fraction,retained})),modules:st.recipe.modules};
  }

  function projection(r,width,height) {
    const tw=width/r.size,th=height/r.size;
    const point=(x,y,z=0)=>[(x-y)*tw/2,(x+y-r.size)*th/2-z*tw/2];
    return {point,tw,th};
  }
  function outline(ctx,points) {ctx.beginPath();points.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](p[0],p[1]));ctx.closePath();}
  function material(name) {
    const part=global.GameArt?.getPart?.(name);
    return part?.loaded&&part.image?part:null;
  }
  function triangle(ctx,image,src,dst,sx,sy,sw,sh) {
    const [s0,s1,s2]=src,[d0,d1,d2]=dst,det=(s1[0]-s0[0])*(s2[1]-s0[1])-(s2[0]-s0[0])*(s1[1]-s0[1]);
    if(Math.abs(det)<.000001)return;
    const ux=(s2[1]-s0[1])/det,uy=-(s1[1]-s0[1])/det,vx=-(s2[0]-s0[0])/det,vy=(s1[0]-s0[0])/det;
    const a=(d1[0]-d0[0])*ux+(d2[0]-d0[0])*uy,c=(d1[0]-d0[0])*vx+(d2[0]-d0[0])*vy;
    const b=(d1[1]-d0[1])*ux+(d2[1]-d0[1])*uy,d=(d1[1]-d0[1])*vx+(d2[1]-d0[1])*vy;
    ctx.save();outline(ctx,dst);ctx.clip();ctx.transform(a,b,c,d,d0[0]-a*s0[0]-c*s0[1],d0[1]-b*s0[0]-d*s0[1]);
    ctx.drawImage(image,sx,sy,sw,sh,0,0,1,1);ctx.restore();
  }
  function textureFace(ctx,name,points,alpha=.8,uv) {
    const m=material(name);if(!m||points.length<3)return;
    const source=m.sourceRect||[0,0,m.width||m.image.naturalWidth,m.height||m.image.naturalHeight];
    let rect=Array.isArray(source)?source:[source.x||0,source.y||0,source.width,source.height];
    if(uv)rect=[rect[0]+rect[2]*uv[0],rect[1]+rect[3]*uv[1],rect[2]*uv[2],rect[3]*uv[3]];
    if(!rect[2]||!rect[3])return;
    ctx.save();ctx.globalAlpha*=alpha;
    if(points.length===3)triangle(ctx,m.image,[[0,0],[1,0],[.5,1]],points,...rect);
    else {
      triangle(ctx,m.image,[[0,0],[1,0],[1,1]],[points[0],points[1],points[2]],...rect);
      triangle(ctx,m.image,[[0,0],[1,1],[0,1]],[points[0],points[2],points[3]],...rect);
    }
    ctx.restore();
  }
  function face(ctx,points,color,texture,alpha=.72,uv,noOutline=false,shade=0) {
    outline(ctx,points);ctx.fillStyle=color;ctx.fill();
    if(texture)textureFace(ctx,texture,points,alpha,uv);
    if(shade){outline(ctx,points);ctx.fillStyle=`rgba(24,42,32,${shade})`;ctx.fill();}
    if(noOutline)return;
    outline(ctx,points);ctx.strokeStyle='rgba(39,53,42,.30)';ctx.lineWidth=.42;ctx.stroke();
  }
  function cuboid(ctx,P,x,y,z,w,d,h,color,tex,amount=1) {
    h*=amount;if(w<=0||d<=0||h<=0)return;
    const a=P(x,y,z+h),b=P(x+w,y,z+h),c=P(x+w,y+d,z+h),d0=P(x,y+d,z+h);
    // Front elevation components include capitals and feet; only their timber
    // body is a material. Mapping an entire column onto each cuboid face repeats
    // the stone foot on beam tops and destroys the wood's intended scale.
    const structural=/^(column|beam)-/.test(tex||''),uv=structural?(tex.startsWith('column')?[.25,.12,.50,.70]:[.10,.15,.80,.70]):null;
    face(ctx,[d0,c,P(x+w,y+d,z),P(x,y+d,z)],tint(color,1.05),tex,structural?.42:.58,uv,false,.025);
    face(ctx,[b,c,P(x+w,y+d,z),P(x+w,y,z)],tint(color,.78),tex,structural?.38:.55,uv,false,.11);
    face(ctx,[a,b,c,d0],tint(color,1.16),structural?null:tex,.38);
  }
  function line(ctx,P,a,b,color,width) {const u=P(...a),v=P(...b);ctx.beginPath();ctx.moveTo(...u);ctx.lineTo(...v);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.stroke();}
  function ellipse(ctx,x,y,rx,ry,color,stroke,rotation=0) {ctx.beginPath();ctx.ellipse(x,y,Math.max(.1,rx),Math.max(.1,ry),rotation,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=.6;ctx.stroke();}}

  function drawProp(ctx,part,env,fraction=1) {
    const {P,tw,st}=env,s=part.scale||1,X=part.x,Y=part.y,Z=part.z,f=s*fraction;
    const point=(x=0,y=0,z=0)=>P(X+x*s,Y+y*s,Z+z*s);
    const cube=(x,y,z,w,d,h,color,mat)=>cuboid(ctx,P,X+x*s,Y+y*s,Z+z*s,w*s,d*s,h*s,color,mat,fraction);
    const rod=(a,b,color,width=.02)=>line(ctx,(x,y,z)=>point(x,y,z),a,b,color,width*tw/2);
    const disc=(x,y,z,r,color,ry=.45,stroke)=>{const q=point(x,y,z);ellipse(ctx,q[0],q[1],r*tw*.71*s,r*tw*.71*s*ry,color,stroke);};
    const cyl=(x,y,z,r,h,color)=>{
      const q=point(x,y,z),top=point(x,y,z+h*fraction),rx=r*tw*.71*s,ry=rx*.45;
      ctx.beginPath();ctx.moveTo(q[0]-rx,top[1]);ctx.lineTo(q[0]-rx,q[1]);ctx.ellipse(q[0],q[1],rx,ry,0,0,Math.PI);ctx.lineTo(q[0]+rx,top[1]);ctx.closePath();
      const g=ctx.createLinearGradient(q[0]-rx,0,q[0]+rx,0);g.addColorStop(0,tint(color,1.18));g.addColorStop(.55,color);g.addColorStop(1,tint(color,.7));ctx.fillStyle=g;ctx.fill();
      ellipse(ctx,top[0],top[1],rx,ry,tint(color,1.2),'rgba(48,53,39,.3)');
    };
    const seed=hash(part.id);
    switch(part.type){
      case 'tree':case 'fruitTree': {
        const growing=part.type==='fruitTree'?(st.growth<3?.66:st.growth<7?.85:1):1;
        const q=point(),variant=part.type==='fruitTree'?0:[0,1,3][seed%3];
        // The same generated tree components appear in wild terrain and gardens.
        // No independent cartoon canopy is mixed with the generated landscape.
        if(global.GameArt?.drawTerrain?.(ctx,'tree',q[0],q[1],tw*(variant===1?.30:.57)*s*growing*fraction,0,variant)){
          if(part.type==='fruitTree'&&st.growth>=8)for(let i=0;i<7;i++)ellipse(ctx,q[0]+Math.sin(i*4.3+seed)*tw*.11*s,q[1]-tw*s*(.19+.08*Math.cos(i*2.7)),.95*s,.85*s,i%2?'#c78e54':'#b56241');
        }else{
          rod([0,0,0],[.015,-.02,.65*growing],PALETTE.wood,.035);
          for(const side of[-1,1])rod([0,0,.30],[side*.14,0,.55*growing],'#71834e',.025);
        }
        break;
      }
      case 'bamboo':
        for(let i=0;i<6;i++){
          const xx=(i-2.5)*.04,yy=Math.sin(i)*.07,h=.55+(i%3)*.10;rod([xx,yy,0],[xx+.025,yy,h*fraction],'#6e8150',.017);
          for(let j=1;j<4;j++){const q=point(xx,yy,h*j/4);for(const side of[-1,1])ellipse(ctx,q[0]+side*3*s,q[1]-2*s,4*s,1.2*s,side<0?'#4c714d':'#82965c',null,side*.5);}
        }break;
      case 'grain':case 'vegetable': {
        const stage=st.pending?Math.max(0,(st.progress-.72)/.28)*4:st.growth;
        rod([-.095,-.055,.003],[.095,.055,.003],'#725d42',.014);
        if(stage<1)break;
        for(let i=0;i<5;i++){
          const x=(i%3-1)*.052,y=(Math.floor(i/3)-.5)*.075,h=.045+Math.min(1,stage/9)*.20;
          if(part.type==='grain'){
            const c=stage>=8?'#c7b469':stage>=4?'#8d9e56':'#72904d';rod([x,y,0],[x+.018,y,h*fraction],c,.012);
            rod([x,y,h*.3],[x-.05,y,h*.70],tint(c,.9),.011);rod([x+.008,y,h*.56],[x+.061,y,h*.9],c,.011);
            if(stage>=7){const q=point(x+.018,y,h);ellipse(ctx,q[0],q[1],1.1*s,2.2*s,stage>=10?'#dcc47a':'#b0af62',null,.3);}
          }else{
            const q=point(x,y,h*.25),rr=(.018+stage*.0035)*tw*s;
            for(let k=0;k<3;k++)ellipse(ctx,q[0]+Math.cos(k*2.1)*rr*.4,q[1]+Math.sin(k*2.1)*rr*.2,rr*.6,rr*.35,['#557c49','#83a665','#a3b774'][k],null,k*.8);
          }
        }break;
      }
      case 'jar':case 'bucket':case 'basket':case 'mortar':case 'censer':case 'bell': {
        const color={jar:'#a97f59',bucket:'#927956',basket:'#b99e69',mortar:'#949a87',censer:'#7e8d75',bell:'#b5a163'}[part.type];
        const r=part.type==='censer'?.15:.105,h=part.type==='bell'?.24:part.type==='mortar'?.11:.23;
        cyl(0,0,.015,r,h,color);disc(0,0,h+.017,r*.78,tint(color,.55));
        if(part.type==='jar'){disc(0,0,h+.022,r*.67,'#a77b55');disc(0,0,h+.03,r*.41,'#5c5d43');}
        if(part.type==='bucket'){rod([-.08,0,h*.6],[-.08,0,h+.13],PALETTE.wood,.017);rod([-.08,0,h+.13],[.08,0,h+.13],PALETTE.wood,.023);rod([.08,0,h+.13],[.08,0,h*.6],PALETTE.wood,.017);}
        if(part.type==='basket')for(let i=1;i<4;i++)disc(0,0,h*i/4,r,'rgba(204,183,130,.22)',.45,'rgba(84,71,47,.2)');
        if(part.type==='censer'){for(const a of[-1,1])rod([a*.1,0,.05],[a*.14,0,-.015],'#75806a',.04);rod([0,0,h],[.01,0,h+.13],'#6e6246',.012);}
        break;
      }
      case 'sacks':case 'hay': {
        for(let i=0;i<(part.type==='hay'?3:5);i++){const x=(i%3-1)*.14,y=Math.floor(i/3)*.12,q=point(x,y,.09+(i>2?.03:0));ellipse(ctx,q[0],q[1],tw*.078*s,tw*.056*s,part.type==='hay'?'#baae6c':['#c1b38c','#d1c39b','#aa9a70'][i%3],'#94845e',-.1);ctx.strokeStyle='#998758';ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(q[0]-4*s,q[1]-2*s);ctx.lineTo(q[0]+4*s,q[1]+2*s);ctx.stroke();}break;
      }
      case 'crates':case 'stone':case 'ore':case 'bricks': {
        const c=part.type==='crates'?'#a08055':part.type==='bricks'?'#aa8c69':part.type==='ore'?'#9b9270':'#a5ab97';
        for(let i=0;i<6;i++){const xx=(i%3-1)*.14,yy=Math.floor(i/3)*.15,zz=i>3?.03:0;cube(xx-.06,yy-.06,zz,.13,.13,.12,c,part.type==='crates'?'wood-planks':'foundation-stone');if(part.type==='ore')disc(xx,yy,.14,.05,'#729885');}
        cube(-.07,-.06,.12,.14,.13,.13,tint(c,1.1),part.type==='crates'?'wood-planks':'foundation-stone');break;
      }
      case 'logs':
        for(let row=0;row<2;row++)for(let i=0;i<3-row;i++){
          const y=(i-1)*.12+row*.06,z=.06+row*.09;rod([-.31,y,z],[.30,y,z],'#68533b',.093);rod([-.31,y-.01,z+.016],[.30,y-.01,z+.016],'#a58b5b',.055);
          const q=point(.30,y,z);ellipse(ctx,q[0],q[1],3.6*s,3.1*s,'#c1ab75','#705a3c');ellipse(ctx,q[0],q[1],1.8*s,1.4*s,'#b8a06d','#8c734d');
        }break;
      case 'bench':case 'counter':case 'saw': {
        for(const x of[-.22,.22])for(const y of[-.07,.07])cube(x,y,0,.035,.035,.2,PALETTE.wood,'column-wood');
        cube(-.25,-.09,.2,.53,.22,.045,'#a38558','wood-planks');
        if(part.type==='counter'){
          const c={grain:'#c8b582',veg:'#759452',fruit:'#bd734c',fish:'#8ba7a4',meat:'#b87b67'}[part.goods]||'#b29c72';
          for(let i=0;i<5;i++){const q=point(-.2+i*.095,.025,.27);ellipse(ctx,q[0],q[1],2.4*s,1.4*s,c,part.goods==='fish'?'#536d6a':null);}
        }else if(part.type==='saw'){rod([-.23,0,.29],[.25,0,.29],'#6c7773',.027);rod([-.23,-.02,.31],[-.23,-.02,.45],PALETTE.wood,.025);}
        break;
      }
      case 'books':
        cube(-.14,-.08,0,.3,.18,.45,PALETTE.wood,'wood-planks');
        for(let row=0;row<3;row++)for(let i=0;i<4;i++)cube(-.12+i*.065,.105,.05+row*.13,.045,.035,.085,['#d2c9a8','#8b9b85','#ba8c64'][i%3],null);break;
      case 'herbs':
        cube(-.08,-.07,0,.17,.15,.07,'#a99262','wood-planks');for(let i=0;i<5;i++){const q=point((i%3-1)*.04,Math.floor(i/3)*.04,.09);ellipse(ctx,q[0],q[1],2.8*s,1.7*s,i%2?'#8a9d62':'#677f4c');}break;
      case 'rack':case 'meat':
        for(const x of[-.17,.17])cube(x,-.03,0,.035,.05,.48,PALETTE.wood,'column-wood');rod([-.19,0,.45],[.23,0,.45],PALETTE.wood,.03);
        for(let i=0;i<4;i++){const x=-.12+i*.09;rod([x,0,part.type==='meat'?.18:.02],[x,0,.57],part.type==='meat'?'#b48368':'#8d7952',part.type==='meat'?.055:.012);if(part.type!=='meat'){const q=point(x,0,.61);face(ctx,[[q[0],q[1]-3*s],[q[0]-1.3*s,q[1]+2*s],[q[0]+1.3*s,q[1]+2*s]],'#99a9a0');}}break;
      case 'drum':
        cyl(0,0,.07,.12,.18,'#9e5e43');disc(0,0,.25,.12,'#d3bf83',.45,'#8f6b41');rod([-.09,0,.07],[-.13,.05,0],PALETTE.wood,.03);rod([.09,0,.07],[.13,.05,0],PALETTE.wood,.03);break;
      case 'dummy':
        rod([0,0,0],[0,0,.62],PALETTE.wood,.055);rod([-.19,0,.39],[.19,0,.39],PALETTE.wood,.035);cyl(0,0,.3,.075,.2,'#b7a577');disc(0,0,.64,.065,'#baab7b',.8);break;
      case 'banner':
        rod([0,0,0],[0,0,.92],PALETTE.wood,.027);rod([0,0,.84],[.27,0,.84],PALETTE.wood,.02);
        face(ctx,[point(.03,0,.84),point(.27,0,.84),point(.27,0,.44),point(.03,0,.50)],'#9f6148','awning-cloth',.56);break;
      case 'lantern': {
        rod([0,0,-.32],[0,0,.12],PALETTE.wood,.023);const q=point(0,0,0);ellipse(ctx,q[0],q[1],3.8*s,4.7*s,st.night>.2?'#e1be72':'#b58056','#805e3d');rod([-.06,0,.11],[.06,0,.11],'#5d5d43',.025);break;
      }
      case 'pond': {
        const q=point();ellipse(ctx,q[0],q[1],.30*tw*s,.17*tw*s,'#a7a58b','#6e806f',-.04);ellipse(ctx,q[0],q[1]-.5*s,.265*tw*s,.145*tw*s,'#5b938b','#8fae9a',-.04);
        for(let i=0;i<6;i++){const a=i*2.4,rr=.17*tw*s;ellipse(ctx,q[0]+Math.sin(a)*rr,q[1]+Math.cos(a)*rr*.42,2.8*s,1.5*s,i%2?'#8fac70':'#73995f');}break;
      }
      case 'well':
        cyl(0,0,.02,.19,.21,'#a4a78d');disc(0,0,.24,.14,'#425e58');disc(0,0,.215,.105,'#6e9d90');for(let i=0;i<8;i++){const a=i*Math.PI/4;rod([Math.cos(a)*.15,Math.sin(a)*.15,.245],[Math.cos(a)*.19,Math.sin(a)*.19,.245],'#d0ceb0',.016);}break;
      case 'cow': {
        const q=point(0,0,.2);ellipse(ctx,q[0],q[1],10*s,5.5*s,'#b5ae8d','#796c51');const head=point(.23,-.02,.22);ellipse(ctx,head[0],head[1],3.7*s,3*s,'#988868');for(const x of[-.14,.13])for(const y of[-.07,.07])rod([x,y,.17],[x,y,0],'#6e654e',.025);rod([.22,-.03,.29],[.28,-.10,.37],'#d3c9a0',.016);rod([.22,.02,.29],[.28,.09,.37],'#d3c9a0',.016);break;
      }
      case 'trough':cube(-.24,-.08,0,.48,.17,.11,'#968c6b','wood-planks');face(ctx,[point(-.19,-.04,.12),point(.19,-.04,.12),point(.19,.05,.12),point(-.19,.05,.12)],'#66958a');break;
      case 'boat': {
        const v=[[-.38,0,.09],[-.25,-.13,0],[.25,-.13,0],[.43,0,.13],[.25,.13,0],[-.25,.13,0]];
        face(ctx,v.map(a=>point(...a)),'#8a6a44','wood-planks');face(ctx,[point(-.25,.13,0),point(.25,.13,0),point(.43,0,.13),point(.27,.15,-.10),point(-.26,.15,-.10)],'#65543a');
        for(let i=0;i<4;i++)rod([-.23+i*.15,-.1,.025],[-.23+i*.15,.1,.025],'#bd9a62',.026);
        rod([-.12,-.22,.10],[.12,.25,.10],PALETTE.wood,.025);
        if(s>1){rod([.03,0,0],[.03,0,.62],PALETTE.wood,.024);face(ctx,[point(.03,0,.58),point(.31,0,.51),point(.31,0,.19),point(.03,0,.22)],'#c6b887','awning-cloth',.56);}break;
      }
      case 'net':
        for(const x of[-.19,.19])rod([x,0,0],[x,0,.55],PALETTE.wood,.025);
        for(let i=0;i<7;i++){const x=-.19+i*.063;rod([x,0,.15],[x,0,.5],'rgba(118,113,77,.65)',.008);const z=.15+i*.058;rod([-.19,0,z],[.19,0,z],'rgba(118,113,77,.65)',.008);}break;
      case 'crane':
        for(const x of[-.15,.15])rod([x,0,0],[0,0,.85],PALETTE.wood,.043);rod([-.28,-.08,.65],[.36,.1,.94],PALETTE.wood,.047);rod([.28,.08,.9],[.28,.08,.16],'#b7a071',.013);cube(.23,.04,.07,.15,.14,.09,'#9a8c65','wood-planks');break;
      case 'cart':
        cube(-.19,-.12,.12,.4,.25,.13,'#a58b60','wood-planks');for(const y of[-.15,.15]){const q=point(0,y,.1);ellipse(ctx,q[0],q[1],4*s,4*s,'#6f6747','#b29b68');}rod([.17,-.08,.13],[.42,-.08,.13],PALETTE.wood,.024);rod([.17,.08,.13],[.42,.08,.13],PALETTE.wood,.024);break;
      case 'kiln': {
        cyl(0,0,.02,.25,.20,'#a38262');
        const q=point(0,0,.25),rx=.25*tw*.71*s,ry=.34*tw*.50*s*fraction;
        const g=ctx.createLinearGradient(q[0]-rx,q[1]-ry,q[0]+rx,q[1]);g.addColorStop(0,'#bcaa82');g.addColorStop(.55,'#9a7d5b');g.addColorStop(1,'#705d45');
        ctx.beginPath();ctx.moveTo(q[0]-rx,q[1]);ctx.bezierCurveTo(q[0]-rx,q[1]-ry*.8,q[0]-rx*.5,q[1]-ry,q[0],q[1]-ry);ctx.bezierCurveTo(q[0]+rx*.5,q[1]-ry,q[0]+rx,q[1]-ry*.8,q[0]+rx,q[1]);ctx.closePath();ctx.fillStyle=g;ctx.fill();
        for(let i=1;i<5;i++){ctx.beginPath();ctx.ellipse(q[0],q[1]-ry*i/6,rx*Math.sqrt(1-(i/6)**2),ry*.16,0,0,Math.PI);ctx.strokeStyle='rgba(76,64,43,.25)';ctx.lineWidth=.7;ctx.stroke();}
        const mouth=[point(-.105,.235,.23),point(.105,.235,.23),point(.105,.235,.02),point(-.105,.235,.02)];face(ctx,mouth,'#423c2d','kiln-mouth',.92);
        break;
      }
      case 'wheel':case 'millstone':
        cyl(0,0,.04,part.type==='millstone'?.19:.13,.14,'#969781');cyl(0,0,.19,part.type==='millstone'?.20:.15,.07,'#b0af94');rod([0,0,.27],[.20,.01,.27],PALETTE.wood,.034);if(part.type==='wheel')cyl(0,0,.27,.055,.09,'#b5946c');break;
      case 'loom':
        for(const x of[-.18,.18])for(const y of[-.1,.12])cube(x,y,0,.035,.035,.47,PALETTE.wood,'column-wood');rod([-.18,-.09,.47],[.21,-.09,.47],PALETTE.wood,.034);
        for(let i=0;i<12;i++)rod([-.16+i*.03,-.07,.45],[-.16+i*.03,.13,.2],i%3?'#d4c8a2':'#89a6a1',.009);cube(-.2,.1,.15,.43,.08,.03,PALETTE.wood,'wood-planks');break;
      case 'cloth':
        for(const x of[-.23,.23])rod([x,0,0],[x,0,.60],PALETTE.wood,.025);rod([-.25,0,.57],[.25,0,.57],PALETTE.wood,.028);
        for(let i=0;i<3;i++)face(ctx,[point(-.22+i*.16,0,.56),point(-.08+i*.16,0,.56),point(-.08+i*.16,.01,.15),point(-.22+i*.16,.01,.18)],['#b1846b','#85a399','#c3b98c'][i],'awning-cloth',.62);break;
      case 'press':
        cyl(0,0,.02,.16,.20,'#a2855a');for(const x of[-.2,.2])cube(x,-.04,0,.045,.06,.61,PALETTE.wood,'column-wood');rod([-.23,0,.59],[.25,0,.59],PALETTE.wood,.055);rod([0,0,.21],[0,0,.67],'#968156',.028);rod([-.16,0,.67],[.16,0,.67],PALETTE.wood,.024);break;
      case 'armillary': {
        cube(-.12,-.12,0,.24,.24,.16,PALETTE.stone,'foundation-stone');rod([0,0,.16],[0,0,.42],'#968351',.042);const q=point(0,0,.53),rr=.21*tw*s;ctx.strokeStyle='#bca866';ctx.lineWidth=1.4*s;
        for(const [a,b,r]of[[rr,rr*.37,0],[rr*.38,rr,.25],[rr*.8,rr*.63,-.66]]){ctx.beginPath();ctx.ellipse(q[0],q[1],a,b,r,0,Math.PI*2);ctx.stroke();}rod([-.24,0,.3],[.24,0,.76],'#baa165',.016);break;
      }
      case 'lion':
        cube(-.13,-.10,0,.27,.22,.08,PALETTE.stone,'foundation-stone');const q=point(0,0,.22);ellipse(ctx,q[0],q[1],5*s,6*s,'#a3aa93','#7b8a78');const head=point(.02,-.015,.40);ellipse(ctx,head[0],head[1],4*s,4*s,'#b1b7a1','#7f8d79');rod([-.08,.07,.08],[-.08,.07,.23],'#919d86',.05);rod([.08,.07,.08],[.08,.07,.23],'#919d86',.05);break;
      case 'spire':
        rod([0,0,0],[0,0,.63],PALETTE.gold,.027);for(let i=0;i<5;i++)disc(0,0,.10+i*.09,.12-i*.018,PALETTE.gold);disc(0,0,.67,.055,'#cfba75',.9);break;
    }
  }

  function paintPart(ctx,item,env) {
    const {part,fraction}=item,{P,tw,st}=env;
    if(part.kind==='box'){
      if(part.site){
        // A compacted earth court sits flush with the land; it is not a large
        // pale display plinth. Actual stone terraces are independent components.
        if(['treeDeco','lumber'].includes(st.recipe.type))return;
        const farm=st.recipe.category==='farm';
        const border=farm?[[0,0],[1,0],[1,1],[0,1]]:[[.08,.12],[.42,.06],[.84,.10],[.95,.36],[.88,.86],[.62,.96],[.20,.88],[.06,.59]];
        const points=border.map(([u,v])=>P(part.x+part.w*u,part.y+part.d*v,0));
        ctx.save();ctx.globalAlpha*=farm?.85:.20;face(ctx,points,part.color,null,0,null,true);ctx.restore();
      }else cuboid(ctx,P,part.x,part.y,part.z,part.w,part.d,part.h,part.color,part.material,fraction);
    }
    else if(part.kind==='line')line(ctx,P,part.a,vec(part.a,part.b,fraction),part.color,Math.max(.45,part.width*tw/2));
    else if(part.kind==='face'){
      let points=part.points;
      if(fraction<1&&points.length===4)points=[points[0],vec(points[0],points[1],fraction),vec(points[3],points[2],fraction),points[3]];
      const screen=points.map(v=>P(...v)),uv=part.uv&&fraction<1?[part.uv[0],part.uv[1],part.uv[2]*fraction,part.uv[3]]:part.uv;face(ctx,screen,part.color,part.material,part.textureAlpha??.78,uv,part.noOutline,part.shade);
      if(part.window){
        const q=screen.reduce((a,b)=>[a[0]+b[0]/screen.length,a[1]+b[1]/screen.length],[0,0]);
        if(st.night>.08&&(st.active||['house','villa'].includes(st.recipe.type)&&(st.building.pop??1)>0)){
          ctx.save();outline(ctx,screen);ctx.fillStyle=`rgba(235,190,107,${.27+st.night*.36})`;ctx.fill();ctx.restore();
        }
        // Fine mullions remain clear when a generated opening is still loading.
        if(!material(part.material)){for(const f of[.25,.5,.75]){const a=vec(screen[0],screen[1],f),b=vec(screen[3],screen[2],f);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.strokeStyle='rgba(61,65,44,.65)';ctx.lineWidth=.65;ctx.stroke();}
        ctx.beginPath();ctx.moveTo(...vec(screen[0],screen[3],.5));ctx.lineTo(...vec(screen[1],screen[2],.5));ctx.stroke();}
      }
      if(part.sign){
        const a=screen[0],b=screen[1],d=screen[3],w=Math.hypot(b[0]-a[0],b[1]-a[1]),h=Math.hypot(d[0]-a[0],d[1]-a[1]);
        if(w>2&&h>2){ctx.save();ctx.transform((b[0]-a[0])/w,(b[1]-a[1])/w,(d[0]-a[0])/h,(d[1]-a[1])/h,a[0],a[1]);ctx.fillStyle='#d4bd7e';ctx.font=`${Math.max(4,h*.78)}px "Noto Serif SC","Songti SC",serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(part.sign,w/2,h/2,w*.88);ctx.restore();}
      }
    }else if(part.kind==='prop')drawProp(ctx,part,env,fraction);
  }

  const PROP_HEIGHT = {tree:1.45,fruitTree:1.3,bamboo:.85,grain:.30,vegetable:.20,crane:1.1,banner:1.1,armillary:1.02,spire:.8,lantern:.2,kiln:.7,cloth:.7,loom:.6,press:.75,net:.65,cow:.5,boat:.75,lion:.5};
  function measure(options={}) {
    const r=recipe(options.type,options.level||options.building?.lvl||1);if(!r)return null;
    const width=Math.max(1,Number(options.width)||r.size*84),height=Math.max(1,Number(options.height)||width/2),{point:P,tw}=projection(r,width,height);
    const key=[r.type,r.level,width,height].join(':');if(measureCache.has(key))return measureCache.get(key);
    const all=[];
    for(const p of r.parts){
      if(p.kind==='box')for(const x of[p.x,p.x+p.w])for(const y of[p.y,p.y+p.d])for(const z of[p.z,p.z+p.h])all.push(P(x,y,z));
      else if(p.kind==='line')all.push(P(...p.a),P(...p.b));
      else if(p.kind==='face')all.push(...p.points.map(v=>P(...v)));
      else if(p.kind==='prop'){const q=P(p.x,p.y,p.z),s=p.scale||1,h=(PROP_HEIGHT[p.type]||.6)*tw/2*s;all.push([q[0]-tw*.4*s,q[1]-h],[q[0]+tw*.4*s,q[1]+tw*.1*s]);}
    }
    const x=Math.floor(Math.min(-width*.51,...all.map(p=>p[0]))-4),y=Math.floor(Math.min(-height*.5,...all.map(p=>p[1]))-5);
    const result=Object.freeze({x,y,width:Math.ceil(Math.max(width*.51,...all.map(p=>p[0]))+8-x),height:Math.ceil(Math.max(height*.5,...all.map(p=>p[1]))+6-y)});
    measureCache.set(key,result);if(measureCache.size>256)measureCache.delete(measureCache.keys().next().value);return result;
  }

  function cacheKey(st,width,height,scale) {
    const partsRevision=global.GameArt?.partsRevision??PART_KEYS.reduce((n,key)=>n+!!material(key),0);
    return [st.recipe.type,st.recipe.level,st.from,Math.floor(st.progress*128),st.active?1:0,st.recipe.category==='farm'?st.growth:0,Math.round(st.night*6),st.building.damage?1:0,(st.building.pop??1)>0?1:0,partsRevision,width.toFixed(2),height.toFixed(2),scale].join(':');
  }
  function trimCache(){while(rasterCache.size>MAX_ENTRIES||stats.bytes>MAX_BYTES){const key=rasterCache.keys().next().value,entry=rasterCache.get(key);rasterCache.delete(key);stats.bytes-=entry.bytes;}stats.entries=rasterCache.size;}
  function clearCache(){rasterCache.clear();thumbnailCache.clear();stats.bytes=0;stats.entries=0;}
  function newCanvas(width,height){if(typeof document!=='undefined'&&document.createElement){const c=document.createElement('canvas');c.width=width;c.height=height;return c;}if(typeof OffscreenCanvas!=='undefined')return new OffscreenCanvas(width,height);return null;}
  function paintStatic(ctx,st,width,height) {
    const {point:P,tw,th}=projection(st.recipe,width,height),env={P,tw,th,st};
    for(const part of st.selected)if(part.part.ground)paintPart(ctx,part,env);
    // Roof cast shadows and plinth contact shadows are laid on the court before
    // the buildings, with a consistent upper-left sun. Construction gains them
    // only when the relevant structure has appeared.
    for(const module of st.recipe.modules){
      const built=st.selected.some(p=>p.part.id===module.id+'-longbeam-'+module.y&&p.fraction>0);
      if(!built)continue;
      const {x,y,w,d,z,h}=module,reach=Math.min(.36,(z+h)*.3);
      const points=[[x,y,.002],[x+w,y,.002],[x+w+reach,y+d+reach*.35,.002],[x+reach,y+d+reach*.35,.002]].map(v=>P(...v));
      face(ctx,points,'rgba(34,48,31,.18)',null,0,null,true);
      const q=P(x+w/2,y+d/2,.005);ellipse(ctx,q[0],q[1]+1,w*tw*.32,d*th*.43,'rgba(28,40,27,.12)');
    }
    for(const part of st.selected)if(!part.part.ground)paintPart(ctx,part,env);
    if(st.building.damage){ctx.save();ctx.globalAlpha=.32;for(const v of st.recipe.modules.slice(0,2))line(ctx,P,[v.x+v.w*.35,v.y+v.d+.015,v.z+v.h*.75],[v.x+v.w*.55,v.y+v.d+.015,v.z+.06],'#484837',1.5);ctx.restore();}
  }
  function bakeMoonlight(ctx,canvas,night) {
    if(night<=0)return;
    // Only new static cache entries pay this readback. Multiplying straight RGB
    // preserves edge alpha exactly; a multiply fill followed by destination-in
    // would darken partially transparent pixels twice and leave colored halos.
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),data=pixels.data;
    const red=1-.26918*night,green=1-.19882*night,blue=1-.10859*night;
    for(let i=0;i<data.length;i+=4){
      if(!data[i+3])continue;
      data[i]*=red;data[i+1]*=green;data[i+2]*=blue;
    }
    ctx.putImageData(pixels,0,0);
  }
  function paintNightEmission(st,width,height,bounds,scale) {
    const windowLit=st.active||['house','villa'].includes(st.recipe.type)&&(st.building.pop??1)>0;
    const emits=p=>p.part.window&&windowLit||p.part.kind==='prop'&&p.part.type==='lantern';
    if(st.night<=.08||!st.selected.some(emits))return null;
    const canvas=newCanvas(Math.ceil(bounds.width*scale),Math.ceil(bounds.height*scale)),ctx=canvas?.getContext('2d');if(!ctx)return null;
    ctx.setTransform(scale,0,0,scale,-bounds.x*scale,-bounds.y*scale);
    const {point:P,tw,th}=projection(st.recipe,width,height),env={P,tw,th,st:{...st,night:0}};
    let hasEmission=false;
    // Replay the same painter order as the architecture. Foreground walls,
    // roofs and foliage erase emission behind them; a rear window can never
    // shine through a courtyard roof just because lighting is composited last.
    for(const item of st.selected){
      if(hasEmission){ctx.globalCompositeOperation='destination-out';paintPart(ctx,item,env);}
      if(!emits(item))continue;
      ctx.globalCompositeOperation='source-over';const {part,fraction}=item;
      if(part.window){
        let points=part.points;
        if(fraction<1&&points.length===4)points=[points[0],vec(points[0],points[1],fraction),vec(points[3],points[2],fraction),points[3]];
        outline(ctx,points.map(v=>P(...v)));ctx.fillStyle=`rgba(235,190,107,${.27+st.night*.36})`;ctx.fill();
      }else{
        const q=P(part.x,part.y,part.z),s=part.scale||1;
        ellipse(ctx,q[0],q[1],3.8*s,4.7*s,'#e1be72','#805e3d');
      }
      hasEmission=true;
    }
    ctx.globalCompositeOperation='source-over';return canvas;
  }
  function drawDynamic(ctx,st,width,height,time) {
    const {point:P,tw}=projection(st.recipe,width,height),lights=[];
    const bright=st.night>.05,inhabited=['house','villa'].includes(st.recipe.type)&&(st.building.pop??1)>0;
    const litAnchors=st.pending&&st.from?recipe(st.recipe.type,st.from).anchors:st.recipe.anchors;
    if(bright&&(!st.pending||st.from>0)&&(st.active||inhabited||st.recipe.category==='landscape'))for(const a of litAnchors.filter(a=>!a.effect)){const q=P(a.x,a.y,a.z);lights.push({x:q[0],y:q[1],r:Math.max(15,tw*.34),power:a.power});}
    if(st.active)for(const a of st.recipe.anchors.filter(a=>a.effect)){
      const q=P(a.x,a.y,a.z),phase=time*1.6+(st.building.productionTicks||0)*.18;
      if(a.effect==='kiln'){
        const r=tw*.036,heat=.82+Math.sin(phase*3)*.12;ellipse(ctx,q[0],q[1],r*heat,r*1.2,'#cc823f');ellipse(ctx,q[0],q[1]-r*.15,r*.50,r*.72,'#e7be68');
        if(bright)lights.push({x:q[0],y:q[1],r:tw*.4,power:.8});
        if(a.smoke){const tip=P(...a.smoke);for(let i=0;i<3;i++){const t=(time*.24+i/3)%1;ellipse(ctx,tip[0]+Math.sin(t*3+i)*tw*.016,tip[1]-t*tw*.19,tw*(.015+t*.023),tw*(.011+t*.014),`rgba(118,119,101,${(1-t)*.19})`);}}
      }else if(a.effect==='steam'){
        for(let i=0;i<3;i++){const t=(time*.16+i/3)%1;ellipse(ctx,q[0]+(i-1)*tw*.07,q[1]-t*tw*.18,tw*.06,tw*.027,`rgba(215,222,192,${(1-t)*.20})`);}
      }else if(a.effect==='mill'||a.effect==='potter'){
        const r=a.effect==='mill'?tw*.11:tw*.055;ctx.beginPath();ctx.moveTo(q[0]+Math.cos(phase)*r,q[1]+Math.sin(phase)*r*.45);ctx.lineTo(q[0]-Math.cos(phase)*r,q[1]-Math.sin(phase)*r*.45);ctx.strokeStyle=a.effect==='mill'?'#776b49':'#a8865e';ctx.lineWidth=1.6;ctx.stroke();
      }else if(a.effect==='loom'){
        const offset=Math.sin(phase*2)*tw*.065;ctx.fillStyle='#a77349';ctx.fillRect(q[0]+offset-2,q[1]-1,4,2);
      }else if(a.effect==='press'){
        const r=tw*.075;ctx.beginPath();ctx.moveTo(q[0]-Math.cos(phase)*r,q[1]-Math.sin(phase)*r*.3);ctx.lineTo(q[0]+Math.cos(phase)*r,q[1]+Math.sin(phase)*r*.3);ctx.strokeStyle=PALETTE.wood;ctx.lineWidth=1.7;ctx.stroke();
      }
    }
    // A carpenter and a small timber pile follow the actual build state. Stalled
    // construction remains still; no unrelated global scaffolding animation.
    if(st.pending){
      const s=st.recipe.size,q=P(s*.77,s*.84,.03),working=st.building.idle!==true&&!st.building.damage;
      if(global.Citizens?.draw){
        global.Citizens.draw(ctx,{id:'construction-'+(st.building.id??st.recipe.type),role:'builder',action:working?'work':'rest',phase:working?time*4:0,opacity:1,direction:{x:1,y:0}},q[0],q[1],time*1000,{night:st.night});
      }else{
        const arm=working?Math.sin(time*4)*1.5:0;
        ctx.strokeStyle='#8d7452';ctx.lineWidth=Math.max(1,tw*.017);ctx.beginPath();ctx.moveTo(q[0]-4,q[1]+2);ctx.lineTo(q[0]-6,q[1]-1);ctx.moveTo(q[0]-1,q[1]+2);ctx.lineTo(q[0]-2,q[1]-2);ctx.stroke();
        ctx.fillStyle='#8e9279';ctx.fillRect(q[0]-4,q[1]-6,3,5);ellipse(ctx,q[0]-2.5,q[1]-7,2,1,'#bfa879');
        ctx.strokeStyle='#8a7352';ctx.beginPath();ctx.moveTo(q[0]-2,q[1]-5);ctx.lineTo(q[0]+1+arm,q[1]-4-arm);ctx.stroke();
      }
      if(bright){const lamp=P(s*.24,s*.85,.12);ellipse(ctx,lamp[0],lamp[1],1.7,2.5,'#d6b777');lights.push({x:lamp[0],y:lamp[1],r:tw*.30,power:.5});}
    }
    return lights;
  }

  function draw(ctx,options={}) {
    const st=state(options);if(!st||!ctx)return false;
    const width=Math.max(1,Number(options.width)||st.recipe.size*84),height=Math.max(1,Number(options.height)||width/2),cx=Number(options.cx)||0,cy=Number(options.cy)||0;
    const bounds=measure({type:st.recipe.type,level:st.recipe.level,width,height});
    const transform=ctx.getTransform?.(),deviceScale=transform?Math.hypot(transform.a,transform.b):1,scale=Math.min(6,Math.max(1,Math.ceil(deviceScale*2)/2));
    const key=cacheKey(st,width,height,scale);let cached=rasterCache.get(key);
    ctx.save();ctx.translate(cx,cy);
    if(cached){stats.hits++;rasterCache.delete(key);rasterCache.set(key,cached);ctx.drawImage(cached.canvas,bounds.x,bounds.y,bounds.width,bounds.height);}
    else {
      stats.misses++;const canvas=newCanvas(Math.ceil(bounds.width*scale),Math.ceil(bounds.height*scale)),drawing=canvas?.getContext('2d');
      if(drawing){
        drawing.setTransform(scale,0,0,scale,-bounds.x*scale,-bounds.y*scale);drawing.imageSmoothingEnabled=true;drawing.imageSmoothingQuality='high';
        const night=Math.round(st.night*6)/6;
        paintStatic(drawing,{...st,night:0},width,height);
        if(night>0){
          bakeMoonlight(drawing,canvas,night);
          const emission=paintNightEmission({...st,night},width,height,bounds,scale);
          if(emission)drawing.drawImage(emission,bounds.x,bounds.y,bounds.width,bounds.height);
        }
        cached={canvas,bytes:canvas.width*canvas.height*4};rasterCache.set(key,cached);stats.bytes+=cached.bytes;trimCache();ctx.drawImage(canvas,bounds.x,bounds.y,bounds.width,bounds.height);
      }
      else paintStatic(ctx,st,width,height);
    }
    const lights=drawDynamic(ctx,st,width,height,Number(options.time)||0).map(light=>({...light,x:light.x+cx,y:light.y+cy,masked:true}));ctx.restore();
    return {modular:true,recipe:st.recipe.type,lights,bounds:{x:bounds.x+cx,y:bounds.y+cy,width:bounds.width,height:bounds.height},progress:st.progress,active:st.active};
  }
  function thumbnail(ctx,options={}) {
    const r=recipe(options.type,options.level||1);if(!r||options.civ&&options.civ!=='china')return false;
    const w=Number(options.width)||160,h=Number(options.height)||124,pad=options.padding??8;
    const bounds=measure({type:options.type,level:options.level,width:r.size*84,height:r.size*42}),scale=Math.min((w-pad*2)/bounds.width,(h-pad*2)/bounds.height);
    ctx.save();ctx.translate((w-bounds.width*scale)/2-bounds.x*scale,(h-bounds.height*scale)/2-bounds.y*scale);ctx.scale(scale,scale);
    const result=draw(ctx,{...options,cx:0,cy:0,width:r.size*84,height:r.size*42,night:options.night||0});ctx.restore();return result;
  }
  function thumbnailURL(type,civ='china',level=1) {
    if(civ!=='china'||!recipe(type,level))return '';
    const key=[type,level,global.GameArt?.partsRevision||0].join(':');if(thumbnailCache.has(key))return thumbnailCache.get(key);
    const canvas=newCanvas(192,160),ctx=canvas?.getContext('2d');if(!ctx||!canvas.toDataURL)return '';
    thumbnail(ctx,{type,civ,level,width:192,height:160,padding:8});const url=canvas.toDataURL('image/png');thumbnailCache.set(key,url);
    if(thumbnailCache.size>96)thumbnailCache.delete(thumbnailCache.keys().next().value);return url;
  }
  const ready=Promise.all([global.GameArt?.partsReady,global.GameArt?.ready]).then(()=>{clearCache();if(global.dispatchEvent&&typeof Event!=='undefined')global.dispatchEvent(new Event('modular-art-ready'));});
  global.ModularBuildings={draw,thumbnail,thumbnailURL,measure,recipe,inspect,clearCache,ready,stats,supportedTypes:Object.freeze(Object.keys(SIZES)),phases:Object.freeze(PHASES),version:1};

})(typeof window==='undefined'?globalThis:window);
