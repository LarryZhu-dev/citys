'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('native construction labels use real time, track the camera, avoid HUD controls and bound dense-site drawing', () => {
  const root = path.resolve(__dirname, '..');
  const result = spawnSync(process.env.GODOT_BIN || 'godot', [
    '--headless', '--quit-after', '900', '--path', path.join(root, 'godot'),
    '--script', path.join(__dirname, 'godot/construction-labels.gd'),
  ], { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  const output = (result.stdout || '') + (result.stderr || '');
  fs.mkdirSync(path.join(root, 'work/construction-labels'), { recursive: true });
  fs.writeFileSync(path.join(root, 'work/construction-labels/logic.log'), output);
  assert.ifError(result.error);
  assert.equal(result.status, 0, output);
  assert.doesNotMatch(output, /SCRIPT ERROR:|Parse Error:|ERROR:/);
  const match = output.match(/^CONSTRUCTION_LABELS (\{[^\n]+\})$/m);
  assert.ok(match, 'The production native label script must emit its checks');
  const report = JSON.parse(match[1]);
  assert.deepEqual(report.failures, []);
  assert.ok(report.checks >= 50);
  assert.equal(report.passive, true);
});
