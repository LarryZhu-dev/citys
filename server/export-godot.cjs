'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),project=path.join(root,'godot'),output=path.join(root,'engine-web');
const {sourceDigest}=require('./godot-source.cjs');
fs.mkdirSync(output,{recursive:true});
function configureTextures(directory){
 let changed=false;
 for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  if(entry.name==='sources'||entry.name==='.godot')continue;
  const file=path.join(directory,entry.name);
  if(entry.isDirectory())changed=configureTextures(file)||changed;
  else if(/\.(?:png|webp)\.import$/.test(file)){
   const text=fs.readFileSync(file,'utf8'),configured=text.replace('mipmaps/generate=false','mipmaps/generate=true');
   if(configured!==text){fs.writeFileSync(file,configured);changed=true;}
  }
 }
 return changed;
}
configureTextures(path.join(project,'art'));
const run=args=>{
 const r=spawnSync(process.env.GODOT_BIN||'godot',args,{cwd:root,encoding:'utf8',maxBuffer:12*1024*1024});
 const logs=(r.stdout||'')+(r.stderr||'');
 fs.mkdirSync(path.join(root,'work'),{recursive:true});
 fs.writeFileSync(path.join(root,'work',args.includes('--export-release')?'godot-export.log':'godot-import.log'),logs);
 if(r.error||r.status!==0||/SCRIPT ERROR:|Parse Error:|ERROR: Failed to load script/.test(logs)){console.error(logs.slice(-12000));throw r.error||new Error('Godot import/export failed');}
};
run(['--headless','--path',project,'--editor','--import','--quit']);
if(configureTextures(path.join(project,'art')))run(['--headless','--path',project,'--editor','--import','--quit']);
run(['--headless','--path',project,'--export-release','Web']);
const files=[];
for(const file of ['game.wasm','game.pck']){
 const raw=fs.readFileSync(path.join(output,file)),gz=zlib.gzipSync(raw,{level:9});
 fs.writeFileSync(path.join(output,file+'.gz'),gz);
 files.push({file,rawBytes:raw.length,gzipBytes:gz.length,sha256:crypto.createHash('sha256').update(raw).digest('hex')});
}
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({engine:'Godot 4.6.3',renderer:'Compatibility',threads:false,sourceSha256:sourceDigest(project),files},null,2)+'\n');
console.log('Exported Godot Web:',files.map(f=>`${f.file} ${(f.gzipBytes/1048576).toFixed(1)} MiB transferred`).join(', '));
