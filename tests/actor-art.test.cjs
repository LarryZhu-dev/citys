'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const workers = () => read('godot/art/workers/workers-atlas.json');
const citizens = () => read('godot/art/citizens/logistics-atlas.json');

function completeSequences(atlas, actions, minimumFrames) {
  assert.equal(atlas.version, 4);
  assert.equal(atlas.directions, 4);
  for (const action of actions) {
    for (let direction = 0; direction < 4; direction++) {
      const sequence = atlas.animations[`${action}/${direction}`];
      assert.ok(sequence, `${action}/${direction} must have its own animation`);
      assert.ok(sequence.frames.length >= minimumFrames);
      const sources = new Set();
      for (const name of sequence.frames) {
        const sprite = atlas.sprites[name];
        assert.ok(sprite, `Missing pose ${name}`);
        assert.match(sprite.source_frame_sha256, /^[a-f0-9]{64}$/);
        sources.add(sprite.source_frame_sha256);
      }
      // Necessary provenance/integration check, deliberately not a substitute
      // for looking at opposing feet, moving joints and continuous playback.
      assert.ok(sources.size >= 4, `${action}/${direction} needs distinct source poses`);
      assert.ok(sequence.cycles_per_tile > 0 && sequence.fps > 0);
    }
  }
}

test('every worker operation has four-view articulated poses, including loading and climbing', () => {
  completeSequences(workers(), ['walk', 'timber', 'brick', 'load', 'hammer', 'climb'], 8);
});

test('all three citizen roles have independent walking/work sequences and the horse has a real pose sequence', () => {
  completeSequences(citizens(), [
    'water_walk', 'water_work', 'merchant_walk', 'merchant_work',
    'artisan_walk', 'artisan_work', 'horse_walk'
  ], 4);
});

test('atlas regions, pivots and separate wheels remain usable on mobile texture limits', () => {
  for (const atlas of [workers(), citizens()]) {
    const [width, height] = atlas.texture_size;
    assert.ok(width <= 4096 && height <= 4096);
    for (const [name, sprite] of Object.entries(atlas.sprites)) {
      const [x, y, w, h] = sprite.rect;
      assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= width && y + h <= height, name);
      assert.ok(sprite.pivot.length === 2 && sprite.pivot.every(Number.isFinite), name);
      assert.ok(sprite.world_scale > 0 && sprite.world_scale < 1, name);
    }
  }
  const atlas = citizens();
  for (const vehicle of ['horse_cart', 'handcart']) {
    for (let direction = 0; direction < 4; direction++) {
      for (const loaded of [0, 1]) {
        const sprite = atlas.sprites[`${vehicle}/${direction}/${loaded}`];
        assert.ok(sprite, 'both cargo states must be drawn');
        assert.ok(sprite.wheels.length >= 1, 'painted wheel must be an independent rotating part');
        for (const wheel of sprite.wheels) {
          assert.ok(atlas.sprites[wheel.sprite]);
          assert.ok(wheel.center.every(Number.isFinite) && wheel.radius > 0);
          assert.ok(wheel.axis.length === 2 && wheel.axis.every(Number.isFinite));
        }
      }
    }
  }
});

test('rejected individual actor paintings are absent from production', () => {
  const files = fs.readdirSync(path.join(root, 'godot/art/citizens'));
  assert.equal(files.filter(file => /^artisan-(?:\d|atlas)/.test(file)).length, 0);
  for (const directory of ['workers', 'citizens']) {
    const sources = fs.readdirSync(path.join(root, 'godot/art', directory, 'sources'));
    assert.equal(sources.filter(file => /^(?:workers|walk|timber|brick|artisan|logistics-people|logistics-vehicles)-original\.png$/.test(file)).length, 0);
  }
});
