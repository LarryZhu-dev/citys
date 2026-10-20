'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const file of ['index.html', 'style.css', 'online.css', 'js']) {
  fs.cpSync(path.join(root, file), path.join(output, file), { recursive: true });
}
// Publish only browser assets. Original generation atlases, production records,
// previews and asset tooling remain in the source repository for future edits.
const assetRoot = path.join(root, 'assets');
const spriteFiles = fs.readdirSync(path.join(assetRoot, 'sprites'))
  .filter(name => /^[A-Za-z0-9_-]+\.webp$/.test(name))
  .map(name => `sprites/${name}`);
const metadata = JSON.parse(fs.readFileSync(path.join(assetRoot, 'sprites.json'), 'utf8'));
const publishedSprites = new Set(spriteFiles);
for (const [key, entry] of Object.entries(metadata)) {
  if (!publishedSprites.has(entry.file)) throw new Error(`Missing runtime sprite for ${key}: ${entry.file}`);
}
fs.mkdirSync(path.join(output, 'assets', 'sprites'), { recursive: true });
for (const file of ['hero.webp', 'sprites.json', ...spriteFiles]) {
  fs.copyFileSync(path.join(assetRoot, file), path.join(output, 'assets', file));
}
const partsRoot=path.join(assetRoot,'modular');
const partsMetadata=JSON.parse(fs.readFileSync(path.join(partsRoot,'parts.json'),'utf8'));
const partsFiles=new Set();
for(const [key,entry] of Object.entries(partsMetadata.parts)) {
  if(!/^parts\/[A-Za-z0-9_-]+\.webp$/.test(entry.file)||!fs.existsSync(path.join(partsRoot,entry.file))) throw new Error(`Missing or invalid modular part: ${key}`);
  partsFiles.add(entry.file);
}
fs.mkdirSync(path.join(output,'assets','modular','parts'),{recursive:true});
for(const file of ['parts.json',...partsFiles])fs.copyFileSync(path.join(partsRoot,file),path.join(output,'assets','modular',file));
console.log(`Built static game with ${spriteFiles.length} sprites and ${partsFiles.size} modular parts; original atlases and tooling excluded. Online API remains a Vercel Node function.`);
