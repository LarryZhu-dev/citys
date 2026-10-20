'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');

test('actual actor clocks, frame selection, low-FPS movement and retargeting preserve simulation semantics',()=>{
  const result=spawnSync(process.env.GODOT_BIN||'godot',[
    '--headless','--path',path.join(root,'godot'),
    '--script',path.join(__dirname,'godot/actor-motion.gd')
  ],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
  const log=(result.stdout||'')+(result.stderr||'');
  fs.mkdirSync(path.join(root,'work/actor-motion'),{recursive:true});
  fs.writeFileSync(path.join(root,'work/actor-motion/logic.log'),log);
  assert.ifError(result.error);
  assert.equal(result.status,0,log);
  assert.doesNotMatch(log,/SCRIPT ERROR:|Parse Error:|ERROR:/,log);
  const match=log.match(/^ACTOR_MOTION (.+)$/m);
  assert.ok(match,'Godot must return actual runtime assertions');
  const report=JSON.parse(match[1]);
  assert.deepEqual(report.failures,[]);
  assert.ok(report.checks>=34);
  assert.equal(report.visualAcceptance,false,'This logic test cannot certify unseen replacement artwork');
});
