'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('curved roof courses preserve individual images, eight-sided tower supports and bounded component counts', () => {
  const root = path.resolve(__dirname, '..');
  const result = spawnSync(process.env.GODOT_BIN || 'godot', [
    '--headless', '--path', path.join(root, 'godot'),
    '--script', path.join(__dirname, 'godot/roof-recipes.gd'),
  ], { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  assert.ifError(result.error);
  const output = (result.stdout || '') + (result.stderr || '');
  assert.equal(result.status, 0, output);
  assert.doesNotMatch(output, /SCRIPT ERROR:|Parse Error:|ERROR:/);
  const match = output.match(/^ROOF_RECIPES (.+)$/m);
  assert.ok(match, 'The actual Godot recipes and projection code must produce the report');
  const report = JSON.parse(match[1]);
  assert.deepEqual(report.failures, []);
  assert.equal(Object.keys(report.counts).length, 56);
  assert.ok(report.projectedParts > 500, 'The production catalogue must exercise nonrectangular image placement');
});
