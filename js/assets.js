"use strict";
/* Original AI-generated art; see assets/manifest.json for provenance.
 * Coordinates: cx/cy = ground footprint center; width/height = footprint size.
 */
(function(global){
  const CIVS = ['china','egypt','greece','persia','aztec'];
  const CORE = ['house1','house2','house3','palace','temple','market','well','granary','workshop','school','barracks','farm','harbor','garden','theater','observatory'];
  const COMMON = ['watch','police','clinic','repair','grainShop','vegShop','fruitShop','fishShop','meatShop','lumber','quarry','clayPit','kiln','mill','weaver','winery'];
  const NATURAL = ['grass','sand','water','road','oak','cypress','palm','cherry','stone','copper','clay','reeds','monument','pasture','orchard','bath'];
  const LANDMARKS = ['pagoda','china-wonder','sphinx','egypt-wonder','agora','greece-wonder','windTower','persia-wonder','sunTemple','aztec-wonder','university','bath','copperMine','warehouse','vegFarm','harbor'];
  const MATERIAL_PARTS=['roof-tiles','wall-plaster','wall-brick','foundation-stone','wood-planks','awning-cloth'];
  const STRUCTURE_PARTS=['column-red','column-wood','beam-red','beam-wood','dougong','roof-ridge','window-lattice','door-double','door-wood','kiln-mouth','roof-corner','wood-railing'];
  const RIG_PARTS=['head','torso','upper-arm','forearm','thigh','shin','shoe','hammer','hoe','pole','basket','hat'].map(name=>'people/'+name);
  const PART_NAMES=[...MATERIAL_PARTS,...STRUCTURE_PARTS,...RIG_PARTS];
  const cache = new Map(), failures = new Set(), rasterCache = new Map();
  const RASTER_CACHE_LIMIT_BYTES=64*1024*1024,RASTER_CACHE_LIMIT_ENTRIES=384;
  let rasterCacheBytes=0,rasterCacheHits=0,rasterCacheMisses=0,rasterCacheEvictions=0;
  const partCache=new Map();
  let partMetadata={},partsRevision=0;
  let artRefreshQueued=false;
  let atlasMetadata = {};
  const baseURL = new URL('../assets/', document.currentScript?.src || new URL('js/assets.js',location.href));
  const aliases = { wonder:'palace',pagoda:'temple',sphinx:'palace',agora:'school',windTower:'observatory',sunTemple:'temple',farmland:'farm',vegFarm:'farm',fishing:'harbor',warehouse:'granary',pottery:'workshop',university:'school',copperMine:'quarry' };
  const shared = {treeDeco:'oak',monument:'monument',pasture:'pasture',orchard:'orchard',bath:'bath'};
  function civName(civ){ return CIVS.includes(civ) ? civ : 'china'; }
  function buildingKey(type,civ='china',level=1){
    civ=civName(civ);
    if(type==='wonder')return 'landmarks/'+civ+'-wonder';
    if(LANDMARKS.includes(type))return 'landmarks/'+type;
    if(type==='house') type=level<=3?'house1':level<=6?'house2':'house3';
    if(type==='villa') type=level<=2?'house2':'house3';
    if(type==='road')return 'terrain/road';
    if(shared[type])return 'terrain/'+shared[type];
    if(COMMON.includes(type))return 'common/'+type;
    type=aliases[type]||type;
    if(COMMON.includes(type))return 'common/'+type;
    return civ+'/'+(CORE.includes(type)?type:'workshop');
  }
  function url(key){return new URL('sprites/'+key.replaceAll('/','-')+'.webp',baseURL).href;}
  function load(key){
    if(cache.has(key))return cache.get(key).promise;
    const image=new Image(); image.decoding='async';
    const entry={image,loaded:false};
    entry.promise=new Promise(resolve=>{
      image.onload=()=>{entry.loaded=true;global.invalidateRenderer?.();resolve(true);};
      image.onerror=()=>{failures.add(key);resolve(false);};
    });
    cache.set(key,entry); image.src=url(key); return entry.promise;
  }
  function raster(key,image,width,ctx,night=0){
    // Physical pixel demand includes the actual canvas transform (DPR × zoom).
    // Near/beyond native resolution draw the original, never a tiny cached mip.
    const transform=ctx.getTransform?.();
    const scale=transform?Math.max(Math.hypot(transform.a,transform.b),Math.hypot(transform.c,transform.d)):1;
    const demand=Math.max(1,Math.abs(width)*scale);
    const nightBucket=Math.round(Math.max(0,Math.min(1,Number(night)||0))*12);
    const native=demand>=image.naturalWidth*.85;
    if(native&&!nightBucket)return image;
    const targetWidth=native?image.naturalWidth:Math.min(image.naturalWidth,Math.max(16,Math.ceil(demand/16)*16));
    const id=key+':'+targetWidth+':night'+nightBucket;
    if(rasterCache.has(id)){
      const cached=rasterCache.get(id);rasterCache.delete(id);rasterCache.set(id,cached);
      rasterCacheHits++;return cached;
    }
    rasterCacheMisses++;
    const canvas=document.createElement('canvas');
    canvas.width=targetWidth;canvas.height=Math.max(1,Math.round(targetWidth*image.naturalHeight/image.naturalWidth));
    const drawing=canvas.getContext('2d',{willReadFrequently:!!nightBucket});drawing.imageSmoothingEnabled=true;drawing.imageSmoothingQuality='high';
    drawing.drawImage(image,0,0,canvas.width,canvas.height);
    if(nightBucket){
      // Bake moonlight once. Alter RGB only: transparent edges retain their alpha
      // and no per-frame filter/full-screen blend is needed by the renderer.
      const n=nightBucket/12,pixels=drawing.getImageData(0,0,canvas.width,canvas.height);
      const data=pixels.data,r=1-.26918*n,g=1-.19882*n,b=1-.10859*n;
      for(let i=0;i<data.length;i+=4){
        data[i]=Math.round(data[i]*r);data[i+1]=Math.round(data[i+1]*g);data[i+2]=Math.round(data[i+2]*b);
      }
      drawing.putImageData(pixels,0,0);
    }
    const bytes=canvas.width*canvas.height*4;
    if(bytes<=RASTER_CACHE_LIMIT_BYTES){
      rasterCache.set(id,canvas);rasterCacheBytes+=bytes;
      while(rasterCache.size>RASTER_CACHE_LIMIT_ENTRIES||rasterCacheBytes>RASTER_CACHE_LIMIT_BYTES){
        const oldest=rasterCache.keys().next().value,removed=rasterCache.get(oldest);
        rasterCache.delete(oldest);rasterCacheBytes-=removed.width*removed.height*4;rasterCacheEvictions++;
      }
    }
    return canvas;
  }
  function partURL(name){return new URL('modular/parts/'+name.replaceAll('/','-')+'.webp',baseURL).href;}
  function thumbnail(type,civ='china',level=1){
    const assembled=global.ModularBuildings?.thumbnailURL?.(type,civ,level);
    return assembled||url(buildingKey(type,civ,level));
  }
  function notifyPartChange(){
    partsRevision++;global.invalidateRenderer?.();
    if(artRefreshQueued)return;
    artRefreshQueued=true;
    (global.requestAnimationFrame||global.setTimeout)(()=>{
      artRefreshQueued=false;
      if(typeof S!=='undefined'&&S)global.refreshArt?.();
      global.paintBuildingThumbnails?.(document);
      // The civilization picker is outside refreshArt's build/info panels.
      for(const card of document.querySelectorAll('[data-civ]')){
        const image=card.querySelector('.civ-art img');if(!image)continue;
        const next=thumbnail('wonder',card.dataset.civ,3);
        if(image.getAttribute('src')!==next){image.src=next;image.hidden=false;if(image.nextElementSibling)image.nextElementSibling.hidden=true;}
      }
      global.dispatchEvent(new CustomEvent('gameart:change',{detail:{partsRevision}}));
    });
  }
  if(document.readyState!=='complete')global.addEventListener('load',()=>notifyPartChange(),{once:true});
  function getPart(name){
    if(!PART_NAMES.includes(name))return null;
    if(partCache.has(name))return partCache.get(name);
    const image=new Image();image.decoding='async';
    const entry={name,image,loaded:false,url:partURL(name),width:0,height:0,sourceRect:[0,0,0,0],...partMetadata[name]};
    entry.promise=new Promise(resolve=>{
      image.onload=()=>{
        entry.loaded=true;entry.width=image.naturalWidth;entry.height=image.naturalHeight;
        entry.sourceRect=[0,0,entry.width,entry.height];
        if(MATERIAL_PARTS.includes(name)){
          // Mirrored assembly makes opposite edges match without modifying the
          // generated source texture; the original stays available as image.
          const texture=document.createElement('canvas');texture.width=entry.width*2;texture.height=entry.height*2;
          const context=texture.getContext('2d');
          for(let row=0;row<2;row++)for(let column=0;column<2;column++){
            context.save();context.translate(column?texture.width:0,row?texture.height:0);
            context.scale(column?-1:1,row?-1:1);context.drawImage(image,0,0);context.restore();
          }
          entry.texture=texture;entry.repeatMode='mirror';entry.textureTileable=true;
        }
        notifyPartChange();resolve(true);
      };
      image.onerror=()=>{failures.add('part/'+name);resolve(false);};
    });
    partCache.set(name,entry);image.src=entry.url;return entry;
  }
  function drawPart(ctx,name,x,y,width,height,options={}){
    const part=getPart(name);if(!part?.loaded)return false;
    const h=height??width*part.height/part.width;
    if(!Number.isFinite(width)||!Number.isFinite(h)||width<=0||h<=0)return false;
    const image=raster('part/'+name,part.image,width,ctx,options.night||0);
    if(options.rotation||options.flipX||options.flipY||options.opacity!==undefined){
      ctx.save();ctx.translate(x,y);if(options.rotation)ctx.rotate(options.rotation);
      ctx.scale(options.flipX?-1:1,options.flipY?-1:1);
      if(options.opacity!==undefined)ctx.globalAlpha*=Math.max(0,Math.min(1,options.opacity));
      ctx.drawImage(image,-(options.anchorX||0)*width,-(options.anchorY||0)*h,width,h);ctx.restore();
    }else ctx.drawImage(image,x-(options.anchorX||0)*width,y-(options.anchorY||0)*h,width,h);
    return true;
  }
  const partsReady=Promise.all([
    ...PART_NAMES.map(name=>getPart(name).promise),
    fetch(new URL('modular/parts.json',baseURL)).then(response=>response.json()).then(data=>{
      partMetadata=data.parts||{};
      for(const [name,part]of partCache){
        if(partMetadata[name])Object.assign(part,partMetadata[name],{url:partURL(name)});
      }
      notifyPartChange();
    }).catch(()=>{})
  ]);
  function draw(ctx,key,cx,cy,width,height,frame,night=0){
    if(key.startsWith('construction/stage')&&!/-[0-3]$/.test(key))key+='-'+((frame||0)%4);
    const entry=cache.get(key);
    if(!entry){load(key);return false;}
    if(!entry.loaded)return false;
    const im=entry.image,footHeight=height??width/2;
    const drawHeight=width*im.naturalHeight/im.naturalWidth;
    ctx.drawImage(raster(key,im,width,ctx,night),cx-width/2,cy+footHeight/2-drawHeight,width,drawHeight);
    return true;
  }
  function drawBuilding(ctx,options){
    const {type,civ='china',level=1,cx,cy,width,height,night=0}=options;
    return draw(ctx,buildingKey(type,civ,level),cx,cy,width,height,undefined,night);
  }
  function drawConstruction(ctx,options){
    const {cx,cy,width,height,progress=0,time=0,fromLevel=0,upgrade=false,night=0}=options;
    const stage=(upgrade||fromLevel>0)?4:Math.min(3,Math.floor(Math.max(0,Math.min(.999,progress))*3)+1);
    const frame=stage===3?Math.min(3,Math.floor(Math.max(0,progress-2/3)*12)):Math.floor(time/240)%4;
    return draw(ctx,'construction/stage'+stage,cx,cy,width,height,frame,night);
  }
  function drawTerrain(ctx,type,cx,cy,width,height,variant=0,night=0){
    if(type==='tree')type=['oak','cypress','palm','cherry'][Math.abs(variant|0)%4];
    if(!NATURAL.includes(type))return false;
    const key='terrain/'+type,entry=cache.get(key);
    if(!entry){load(key);return false;} if(!entry.loaded)return false;
    if(['grass','sand','water','road'].includes(type)){
      ctx.save();ctx.beginPath();ctx.moveTo(cx,cy-height/2);ctx.lineTo(cx+width/2,cy);ctx.lineTo(cx,cy+height/2);ctx.lineTo(cx-width/2,cy);ctx.closePath();ctx.clip();
      ctx.drawImage(raster(key,entry.image,width*1.08,ctx,night),cx-width*.54,cy-height*.54,width*1.08,height*1.08);ctx.restore();return true;
    }
    const scale=type==='oak'||type==='cherry'?1.15:type==='cypress'||type==='palm'?.9:1;
    return draw(ctx,key,cx,cy,width*scale,height,undefined,night);
  }
  function preloadCivilization(civ){return Promise.all(CORE.map(type=>load(civName(civ)+'/'+type)));}
  const ready=Promise.all([
    partsReady,
    preloadCivilization('china'),...COMMON.map(type=>load('common/'+type)),...NATURAL.map(type=>load('terrain/'+type)),
    ...LANDMARKS.map(type=>load('landmarks/'+type)),
    ...Array.from({length:16},(_,i)=>load('construction/stage'+(Math.floor(i/4)+1)+'-'+(i%4))),
    fetch(new URL('sprites.json',baseURL)).then(r=>r.json()).then(data=>{atlasMetadata=data;}).catch(()=>{})
  ]);
  function metadata(type,civ,level){
    const key=type.includes('/')?type:buildingKey(type,civ,level),data=atlasMetadata[key]||{};
    return {...data,key,url:url(key),lights:lightPoints(key),smoke:smokePoint(key)};
  }
  function lightPoints(key){
    const kind=key.split('/')[1];
    if(['farm','garden','pasture','orchard','oak','cypress','palm','cherry','monument','grass','sand','water','road'].includes(kind))return [];
    if(kind==='well')return [{x:.53,y:.56}];
    if(kind==='palace')return [{x:.35,y:.53},{x:.62,y:.56},{x:.50,y:.73}];
    if(kind==='house3')return [{x:.69,y:.43},{x:.31,y:.61},{x:.64,y:.73}];
    return [{x:.38,y:.62},{x:.65,y:.68}];
  }
  function smokePoint(key){
    const kind=key.split('/')[1];
    if(kind==='workshop'){
      const mouths={china:{x:.67,y:.14},egypt:{x:.49,y:.21},greece:{x:.46,y:.20},persia:{x:.30,y:.24},aztec:{x:.48,y:.27}};
      return mouths[key.split('/')[0]]||null;
    }
    if(kind==='kiln')return {x:.36,y:.12};
    return null;
  }
  global.GameArt={ready,url,draw,drawBuilding,drawTerrain,drawConstruction,preloadCivilization,load,buildingKey,metadata,
    getPart,drawPart,partURL,partsReady,partNames:Object.freeze(PART_NAMES.slice()),
    thumbnail,hero:new URL('hero.webp',baseURL).href,
    get errors(){return [...failures];},get loaded(){return [...cache.values()].filter(e=>e.loaded).length;},get rasterCacheSize(){return rasterCache.size;},
    get rasterCacheStats(){return {entries:rasterCache.size,bytes:rasterCacheBytes,limitBytes:RASTER_CACHE_LIMIT_BYTES,limitEntries:RASTER_CACHE_LIMIT_ENTRIES,hits:rasterCacheHits,misses:rasterCacheMisses,evictions:rasterCacheEvictions};},
    get partsRevision(){return partsRevision;},get partsLoaded(){return [...partCache.values()].filter(part=>part.loaded).length;}
  };
})(window);
