'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const file of ['index.html', 'style.css', 'online.css']) {
  fs.cpSync(path.join(root, file), path.join(output, file), { recursive: true });
}
fs.mkdirSync(path.join(output,'js'),{recursive:true});
for(const file of ['data.js','civilizations.js','simulation.js','godot-bridge.js','online.js','godot-loader.js'])fs.copyFileSync(path.join(root,'js',file),path.join(output,'js',file));
// Godot is exported in the reviewed development environment. Vercel only copies
// those reproducible artifacts; it does not install a 1.2 GB engine toolchain.
const engineRoot=path.join(root,'engine-web');
const engineManifest=JSON.parse(fs.readFileSync(path.join(engineRoot,'manifest.json'),'utf8'));
const crypto=require('node:crypto'),zlib=require('node:zlib');
fs.mkdirSync(path.join(output,'engine-web'),{recursive:true});
for(const entry of engineManifest.files){
 if(!['game.wasm','game.pck'].includes(entry.file))throw new Error('Unexpected Godot artifact');
 const compressed=fs.readFileSync(path.join(engineRoot,entry.file+'.gz'));
 const raw=zlib.gunzipSync(compressed);
 if(crypto.createHash('sha256').update(raw).digest('hex')!==entry.sha256)throw new Error('Godot artifact checksum mismatch: '+entry.file);
 // Served with Content-Encoding:gzip and the original MIME type.
 fs.writeFileSync(path.join(output,'engine-web',entry.file),compressed);
}
for(const file of ['game.js','game.audio.worklet.js','game.audio.position.worklet.js','manifest.json'])fs.copyFileSync(path.join(engineRoot,file),path.join(output,'engine-web',file));
fs.mkdirSync(path.join(output,'assets','ui'),{recursive:true});
for(const file of ['actions.png','controls.png','resources.png','paper.png','wood.png','card.png','red.png'])fs.copyFileSync(path.join(root,'godot','art','ui',file),path.join(output,'assets','ui',file));
console.log('Built Godot Web, shared HUD artwork and simulation bridge. Legacy Canvas and unused sprite assets are excluded; online API remains a Vercel Node function.');
