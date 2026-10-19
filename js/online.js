"use strict";
window.OnlineUI = (() => {
  let user=null, cloud=null, revision=null, health=null, tab='cloud', opened=false, busy=false;
  let previousSpeed=0, visiting=false, home=null, notice='', error='', conflict=false, auth='login';
  let rows=[], mine=[], publicDraft=null, syncMeta, pendingTrade=null, replaceConfirm=false;
  try{pendingTrade=JSON.parse(localStorage.getItem('empires-pending-trade')||'null');}catch{}
  const key='empires-cloud-session-v1';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>Math.floor(Number(v)||0).toLocaleString('zh-CN');
  const civ=id=>typeof CIVILIZATIONS!=='undefined'?(CIVILIZATIONS[id]?.name||id):id;
  const cityKey=()=>`${S.seed??''}:${S.civilization??''}:${S.cityName??''}`;
  const snapshot=()=>serializeState();
  const resource=k=>GOODS[k]?.name||k;
  function restore(state){
    const result=hydrateState(state);
    if(result===false)throw new Error('城市存档格式不兼容');
    if(result?.tiles)S=result;
    if(typeof selectedTile!=='undefined')selectedTile=null;
    hover=null;selTool=null;markRoadDirty();renderAll();
  }
  async function request(path,options={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const r=await fetch('/api/'+path,{credentials:'same-origin',cache:'no-store',signal:controller.signal,...options,headers:{'Content-Type':'application/json',...options.headers}});
      let data;try{data=await r.json();}catch{throw new Error('在线服务未启用。请使用游戏服务器启动，或完成部署数据库配置。');}
      if(!r.ok){
        if(r.status===409&&data.save){cloud=data.save;conflict=true;}
        const e=new Error(data.error?.message||data.message||`请求失败（${r.status}）`);e.status=r.status;throw e;
      }
      return data;
    }catch(e){if(e.name==='AbortError')throw new Error('连接超时。本地城市仍然安全，请稍后重试。');throw e;}
    finally{clearTimeout(timer);}
  }
  const post=(path,data={})=>request(path,{method:'POST',body:JSON.stringify(data)});
  function meta(){if(syncMeta!==undefined)return syncMeta;try{syncMeta=JSON.parse(localStorage.getItem(SAVE_KEY)||'null')?.cloudSync||null;}catch{syncMeta=null;}return syncMeta;}
  function remember(){syncMeta={userId:user?.id,revision,clientRevision:cloud?.clientRevision??revision,cityKey:cityKey(),baseline:cloud?.state?{goods:cloud.state.goods,gold:cloud.state.gold}:null};}
  function accept(saved,apply=false){cloud=saved;revision=saved?.revision??0;conflict=false;if(apply&&saved?.state)restore(saved.state);remember();if(save()===false)throw new Error('云端已保存，但本地保存失败。请导出当前城市以保留此设备的进度。');}
  // Only a server-only market update can be rebased. Another device's PUT moves
  // clientRevision and must go through the explicit conflict/download flow.
  function mergeMarketUpdates(){
    const m=meta();
    if(!user||!cloud||!m?.baseline||m.userId!==user.id||m.cityKey!==cityKey()||cloud.revision<=m.revision||cloud.clientRevision!==m.clientRevision)return false;
    const goods={...S.goods},gold=S.gold+(cloud.state.gold-m.baseline.gold);
    if(!Number.isFinite(gold)||gold<0)return false;
    for(const k of Object.keys(GOODS)){
      goods[k]=(goods[k]||0)+(cloud.state.goods[k]||0)-(m.baseline.goods[k]||0);
      if(!Number.isFinite(goods[k])||goods[k]<0)return false;
    }
    S.goods=goods;S.gold=gold;accept(cloud);save();renderAll();
    notice='已接收集市结算，并保留此设备上的城市建设进度。';return true;
  }
  function account(data){
    user=data.user;cloud=data.save;const m=meta();
    revision=!cloud?0:m?.userId===user.id&&m.cityKey===cityKey()&&m.revision===cloud.revision?m.revision:null;
    conflict=!!cloud&&revision===null;
    if(conflict)mergeMarketUpdates();
  }
  async function refreshAccount(){try{account(await request('account/me'));}catch(e){if(e.status===401){user=null;cloud=null;revision=null;}else throw e;}}
  function root(){let el=document.querySelector('#onlineModal');if(!el){el=document.createElement('div');el.id='onlineModal';document.body.appendChild(el);}el.classList.remove('modal');el.classList.add('online-overlay');return el;}
  function render(){
    if(!opened)return;
    const el=root();el.classList.add('is-open');
    el.innerHTML=`<section class="online-card" role="dialog" aria-modal="true" aria-label="世界港口">
      <header class="online-heading"><div><span class="online-eyebrow">THE WORLD BEYOND YOUR WALLS</span><h2>世界港口</h2></div><button class="online-close" data-action="close" aria-label="关闭在线窗口">×</button></header>
      <div class="online-account"><i class="online-status ${health?.ok?'ready':''}"></i><span>${health?.ok?(health.storage==='local'?'本地在线服务 · 持久存储':'云端服务已连接'):'连接在线服务'}${user?' · '+esc(user.username):''}</span>${user?'<button data-action="logout">退出账号</button>':''}</div>
      <nav class="online-tabs" aria-label="在线功能">${[['cloud','云端存档'],['cities','城市漫游'],['leaderboard','繁荣榜'],['market','交易集市']].map(([id,label])=>`<button data-tab="${id}" class="${tab===id?'active':''}">${label}</button>`).join('')}</nav>
      <div class="online-content" aria-busy="${busy}">${error?`<div class="online-notice error" role="alert">${esc(error)}</div>`:''}${notice?`<div class="online-notice" role="status">${esc(notice)}</div>`:''}
      ${conflict&&user&&(tab==='cloud'||tab==='market')?'<div class="online-notice warning">云端已有另一个版本。请先在「云端存档」下载城市，再继续同步或交易，避免覆盖另一设备的进度。</div>':''}
      ${pendingTrade?.userId===user?.id?'<div class="online-notice warning">上次交易尚未确认。重复确认使用同一流水号，不会重复扣款。 <button data-action="retryTrade">确认上次交易结果</button></div>':''}
      ${tab==='cloud'?cloudHTML():tab==='market'?marketHTML():citiesHTML()}</div>
      <footer class="online-footer"><span>${busy?'正在处理，请稍候…':'本地自动存档始终可用'}</span><button data-action="refresh">刷新</button></footer></section>`;
    el.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{if(busy)return;tab=b.dataset.tab;loadTab();});
    el.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action,b));
    el.querySelector('#cityPublic')?.addEventListener('change',e=>{publicDraft=e.target.checked;});
    el.querySelector('#onlineAuth')?.addEventListener('submit',authenticate);
    el.querySelector('#onlineTrade')?.addEventListener('submit',placeTrade);
    if(busy)el.querySelectorAll('button,input,select').forEach(b=>b.disabled=true);
  }
  function cloudHTML(){
    if(!user)return `<div class="online-intro"><span class="online-emblem">◇</span><h3>让你的文明跨越设备</h3><p>保存城市，与真实城主交换物资，将你的都城开放给访客。</p></div>
      <form id="onlineAuth" class="online-form"><label>城主名<input name="username" autocomplete="username" required minlength="3" maxlength="24" placeholder="3–24 个中文、字母或数字"></label><label>密码<input name="password" type="password" autocomplete="${auth==='register'?'new-password':'current-password'}" required minlength="10" maxlength="128" placeholder="至少 10 个字符"></label><button class="primary" type="submit">${auth==='register'?'创建城主账号':'登录账号'}</button></form><button class="online-text-button" data-action="auth">${auth==='register'?'已有账号？登录':'第一次抵达？创建账号'}</button>`;
    return `<div class="online-save-grid"><article><span class="online-eyebrow">THIS DEVICE</span><h3>${esc(S.cityName||'我的城市')}</h3><p>${esc(civ(S.civilization))} · 人口 ${num(S.pop)} · 第 ${num(S.tick)} 回合</p><p class="online-muted">${S.mode==='sandbox'?'自由沙盒':'文明征程'} · 本地自动存档</p></article><article><span class="online-eyebrow">CLOUD ARCHIVE</span><h3>${cloud?esc(cloud.city?.name||cloud.state?.cityName||'云端城市'):'尚无云端城市'}</h3><p>${cloud?'版本 '+cloud.revision+' · '+num(cloud.state?.pop)+' 人':'首次上传后即可跨设备继续'}</p><p class="online-muted">每位城主拥有一个云端城市</p></article></div>
      <label class="online-check"><input id="cityPublic" type="checkbox" ${(publicDraft??cloud?.city?.public)?'checked':''}>开放城市，允许其他玩家参观</label><div class="online-actions"><button class="primary" data-action="upload" ${conflict?'disabled':''}>上传当前城市</button><button data-action="download" ${!cloud?'disabled':''}>下载云端城市</button><button data-action="backup">恢复上次云端切换备份</button></div>
      ${cloud&&(cloud.state.seed!==S.seed||cloud.state.civilization!==S.civilization)?`<div class="online-notice warning">${replaceConfirm?'将备份原云城，并以当前新城替换。原城市的挂单必须先撤回。 <button data-action="replaceCity">确认替换为当前新城</button>':'已在此设备建立另一座城市。 <button data-action="confirmReplace">以此新城替换云城</button>'}</div>`:''}
      <p class="online-muted">异步交易结算会自动合并，保留本地建设。多设备同时修改城市时需要下载最新版本；下载前自动备份本地城市。公开城市会展示布局与发展数据。</p>`;
  }
  function citiesHTML(){
    const board=tab==='leaderboard';
    return `<div class="online-section-title"><h3>${board?'文明的繁荣足迹':'沿着商路，发现新城'}</h3><p>${board?'真实玩家的休闲城市榜。模拟在客户端运行，榜单不用于竞技或奖励。':'只展示城主主动开放的城市。参观为只读，不改变你的存档。'}</p></div>${rows.length?`<div class="online-city-list">${rows.map((c,i)=>`<article class="online-city"><span class="online-rank">${board?String(c.rank||i+1).padStart(2,'0'):'◇'}</span><div><h4>${esc(c.name)}</h4><p>${esc(c.owner)} · ${esc(civ(c.civilization))}</p></div><div class="online-city-value"><b>${num(c.population)}</b><span>居民</span></div><button data-action="visit" data-id="${esc(c.id)}">参观</button></article>`).join('')}</div>`:`<div class="online-empty"><span>⌑</span><h3>${busy?'正在探寻城市…':'世界等待第一座开放的城市'}</h3><p>没有示例城主或虚拟排行。登录后上传城市，并开启公开参观，即可出现在这里。</p></div>`}`;
  }
  function tradeHTML(t,own=false){
    const isMine=own||t.sellerId===user?.id||t.seller?.id===user?.id,available=['open','active'].includes(t.status||'open');
    const seller=typeof t.seller==='string'?t.seller:t.seller?.username||t.sellerName||'城主';
    return `<article class="online-trade"><div><h4>${esc(resource(t.resource))} <span>× ${num(t.quantity)}</span></h4><p>${isMine?'我的委托':esc(seller)} · 单价 ${num(t.unitPrice)}</p></div><b>${num(t.quantity*t.unitPrice)} <small>金币</small></b>${available?`<button data-action="${isMine?'cancelTrade':'buyTrade'}" data-id="${esc(t.id)}" ${!user||conflict||S.mode==='sandbox'?'disabled':''}>${isMine?'撤回':'购买'}</button>`:`<span class="online-muted">${({sold:'已成交',cancelled:'已撤回',canceled:'已撤回'})[t.status]||esc(t.status)}</span>`}</article>`;
  }
  function marketHTML(){return `<div class="online-section-title"><h3>把余裕换成新的可能</h3><p>挂单即托管物资；成交时金币与货物一次结算。交易期间城市暂停。</p></div>
    ${!user?'<div class="online-notice">请先在云端存档中登录，以发布或购买挂单。</div>':S.mode==='sandbox'?'<div class="online-notice warning">沙盒城市不参与交易。请使用文明征程城市。</div>':`<form id="onlineTrade" class="online-trade-form"><label>货物<select name="resource">${Object.keys(GOODS).map(k=>`<option value="${esc(k)}">${esc(resource(k))} · 库存 ${num(S.goods[k])}</option>`).join('')}</select></label><label>数量<input type="number" name="quantity" value="10" min="1" max="100000" step="1" required></label><label>单价 / 金币<input type="number" name="unitPrice" value="2" min="1" max="100000" step="1" required></label><button class="primary" type="submit" ${conflict?'disabled':''}>托管出售</button></form>`}
    <div class="online-market-summary">你的金币 <b>${num(S.gold)}</b><span>成交与撤单后自动更新存档</span></div>${rows.length?`<div class="online-trade-list">${rows.map(t=>tradeHTML(t)).join('')}</div>`:'<div class="online-empty"><span>◇</span><h3>集市暂时没有挂单</h3><p>其他城主发布的真实交易会出现在这里。</p></div>'}${mine.length?`<h4 class="online-subheading">我的近期委托</h4><div class="online-trade-list">${mine.map(t=>tradeHTML(t,true)).join('')}</div>`:''}<p class="online-muted">休闲玩家市场，不涉及真实货币。客户端模拟数据不能作为竞技公平性凭证。</p>`;}
  async function run(fn){if(busy)return;busy=true;error='';notice='';render();try{await fn();}catch(e){error=e.message||'在线请求失败';}finally{busy=false;render();}}
  async function loadRows(){const d=await request(tab==='market'?'trades':tab);rows=d.trades||d.cities||d.entries||[];mine=d.mine||[];}
  async function loadTab(){rows=[];mine=[];await run(async()=>{if(tab==='cloud')await refreshAccount();else await loadRows();});}
  async function authenticate(event){event.preventDefault();const f=new FormData(event.currentTarget);await run(async()=>{account(await post('account/'+auth,{username:f.get('username'),password:f.get('password')}));notice='已连接城主账号。';});}
  async function upload(){
    if(!user)throw new Error('请先登录');if(conflict||revision===null)throw new Error('请先下载云端最新城市，再同步或交易。');if(visiting)throw new Error('参观城市不能上传');
    const isPublic=publicDraft??cloud?.city?.public??false;
    const send=()=>request('save',{method:'PUT',body:JSON.stringify({revision,state:snapshot(),city:{name:S.cityName||'未命名城市',public:isPublic}})});
    let d;try{d=await send();}catch(e){if(e.status!==409||!mergeMarketUpdates())throw e;d=await send();}
    accept(d.save);save();notice='城市已安全上传 · 版本 '+revision;
  }
  async function download(){const d=await request('save');if(!d.save)throw new Error('云端尚无存档');try{localStorage.setItem('empires-before-cloud-download',JSON.stringify({...snapshot(),cloudSync:meta()}));}catch{throw new Error('本地空间不足，无法备份当前城市。请先导出存档后下载。');}accept(d.save,true);center();notice='已恢复云端城市，原本地城市已自动备份。';}
  async function completeTrade(path,body,label){
    if(pendingTrade&&pendingTrade.userId===user.id&&(pendingTrade.path!==path||JSON.stringify({...pendingTrade.body,requestId:undefined,revision:undefined})!==JSON.stringify({...body,requestId:undefined,revision:undefined})))throw new Error('请先确认上次交易结果，再发起新的交易。');
    const intent=pendingTrade?.userId===user.id?pendingTrade:{userId:user.id,path,body,label};pendingTrade=intent;
    try{localStorage.setItem('empires-pending-trade',JSON.stringify(intent));}catch{throw new Error('无法保存交易流水号，请先导出城市并清理本地存储。');}
    let d;try{d=await post(intent.path,intent.body);}catch(e){if(e.status&&e.status<500){pendingTrade=null;localStorage.removeItem('empires-pending-trade');}throw e;}
    pendingTrade=null;localStorage.removeItem('empires-pending-trade');accept(d.save,true);notice=intent.label;
    try{if(tab==='market')await loadRows();}catch{notice+=' 列表暂时无法刷新，可稍后点击刷新；本次交易已完成。';}
  }
  async function placeTrade(event){
    event.preventDefault();const f=new FormData(event.currentTarget),body={resource:f.get('resource'),quantity:Number(f.get('quantity')),unitPrice:Number(f.get('unitPrice'))};
    await run(async()=>{if(S.mode==='sandbox')throw new Error('沙盒城市不能参与交易');if(pendingTrade?.userId===user.id)throw new Error('请先确认上次交易结果。');await upload();await completeTrade('trades',{...body,revision,requestId:crypto.randomUUID()},'委托已发布，货物已由集市托管。');});
  }
  async function transact(id,method){await run(async()=>{if(pendingTrade?.userId===user.id)throw new Error('请先确认上次交易结果。');await upload();await completeTrade('trades/'+encodeURIComponent(id)+'/'+method,{revision,requestId:crypto.randomUUID()},method==='buy'?'交易完成，货物已送达城市仓库。':'委托已撤回，物资已退回仓库。');});}
  function center(){if(typeof centerOnCity==='function')centerOnCity();else fitView();}
  async function visit(id){await run(async()=>{const d=await request('cities/'+encodeURIComponent(id));save();home={state:snapshot(),view:{...view},speed:previousSpeed};restore(d.state);visiting=true;setSpeed(0);center();close(false);let bar=document.createElement('div');bar.id='cityVisitBar';bar.className='city-visit-bar';bar.innerHTML=`<span>正在参观 <b>${esc(d.city?.name||S.cityName)}</b> · 只读</span><button>返回我的城市</button>`;document.body.appendChild(bar);bar.querySelector('button').onclick=exitVisit;});}
  function exitVisit(){if(!home)return;const h=home;home=null;visiting=false;restore(h.state);Object.assign(view,h.view);setSpeed(h.speed);save();document.querySelector('#cityVisitBar')?.remove();}
  async function action(a,b){
    if(busy)return;if(a==='close')close();else if(a==='auth'){auth=auth==='login'?'register':'login';render();}
    else if(a==='refresh')loadTab();else if(a==='upload')run(upload);else if(a==='download')run(download);
    else if(a==='confirmReplace'){replaceConfirm=true;render();}
    else if(a==='replaceCity')run(async()=>{const latest=(await request('save')).save;if(!latest)throw new Error('云端城市不存在，请刷新。');localStorage.setItem('empires-before-cloud-download',JSON.stringify(latest.state));const d=await request('save',{method:'PUT',body:JSON.stringify({revision:latest.revision,state:snapshot(),city:{name:S.cityName,public:publicDraft??false}})});accept(d.save);replaceConfirm=false;notice='已备份原云城，并上传当前新城。';});
    else if(a==='retryTrade')run(async()=>{if(!pendingTrade||pendingTrade.userId!==user?.id)throw new Error('当前账号没有待确认交易。');await completeTrade(pendingTrade.path,pendingTrade.body,pendingTrade.label);});
    else if(a==='backup')run(async()=>{let data;try{data=JSON.parse(localStorage.getItem('empires-before-cloud-download')||'null');}catch{}if(!data)throw new Error('还没有云端切换备份。');restore(data);syncMeta=data.cloudSync||null;save();center();revision=null;conflict=!!cloud;notice='已恢复原本地城市。请导出存档保存；云端版本保持不变。';});
    else if(a==='visit')visit(b.dataset.id);else if(a==='buyTrade')transact(b.dataset.id,'buy');else if(a==='cancelTrade')transact(b.dataset.id,'cancel');
    else if(a==='logout')run(async()=>{await post('account/logout');user=null;revision=null;cloud=null;conflict=false;syncMeta=null;save();notice='已退出账号。本地城市仍在此设备。';});
  }
  async function open(){if(visiting){toast('请先返回自己的城市，再使用世界港口');return;}if(opened)return;previousSpeed=speed;setSpeed(0);opened=true;publicDraft=null;error='';notice='';render();await run(async()=>{health=await request('health');await refreshAccount();});if(!error&&tab!=='cloud')loadTab();root().querySelector('.online-close')?.focus();}
  function close(resume=true){opened=false;const el=root();el.innerHTML='';el.classList.remove('is-open');if(resume&&!visiting)setSpeed(previousSpeed);document.querySelector('#onlineBtn')?.focus();}
  document.addEventListener('keydown',e=>{if(!opened)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();if(!busy)close();}else if(e.key==='Tab'){const all=[...root().querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')],first=all[0],last=all.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}else if(e.code==='Space'&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))e.stopImmediatePropagation();},true);
  return {open,close,exitVisit,saveMetadata(){const m=meta();return m?.cityKey===cityKey()?m:null;},restoreMetadata(m){syncMeta=m||null;revision=null;conflict=!!cloud;},get visiting(){return visiting;},get opened(){return opened;}};
})();
