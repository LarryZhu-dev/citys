'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const project = path.join(root, 'godot');
const output = path.join(root, 'work', 'components-test');
const godot = process.env.GODOT_BIN || 'godot';
const catalogContext = vm.createContext({ document: { querySelector: () => ({ getContext: () => ({}) }) } });
vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), catalogContext);
const catalog = JSON.parse(vm.runInContext(`JSON.stringify({
  buildings:Object.entries(BUILD).filter(([type,d])=>type!=='road'&&(!d.civilization||d.civilization==='china'))
    .map(([type,d])=>({type,size:d.size,levels:type==='house'?HOUSE_LEVELS.length:type==='villa'?VILLA_LEVELS.length:1}))
})`, catalogContext));
let report;

function runGodot(args, logName) {
  const result = spawnSync(godot, args, { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  const logs = (result.stdout || '') + (result.stderr || '');
  fs.writeFileSync(path.join(output, logName), logs);
  assert.ifError(result.error);
  assert.equal(result.status, 0, logs.slice(-16000));
  assert.doesNotMatch(logs, /SCRIPT ERROR:|Parse Error:|ERROR:/, logs.slice(-16000));
  return logs;
}

test.before(() => {
  fs.mkdirSync(output, { recursive: true });
  const manifest = path.join(project, 'art/components/manifest.json');
  assert.ok(fs.existsSync(manifest), 'Fresh components manifest must be generated before running the real renderer tests');
  const input = path.join(output, 'catalog.json'), result = path.join(output, 'report.json');
  fs.writeFileSync(input, JSON.stringify(catalog));
  // Import on clean checkouts. A coordinated integration run can reuse the
  // import another process has just completed, without competing for the editor.
  // The probe still loads and inspects the actual imported Texture2D resources.
  if (process.env.COMPONENTS_PREIMPORTED !== '1') {
    runGodot(['--headless', '--path', project, '--editor', '--import', '--quit'], 'import.log');
  }
  fs.rmSync(result, { force: true });
  runGodot(['--headless', '--path', project, '--script', path.join(__dirname, 'godot/components.gd'), '--', input, result], 'probe.log');
  assert.ok(fs.existsSync(result), 'Godot did not produce its renderer report');
  report = JSON.parse(fs.readFileSync(result, 'utf8'));
});

test('all 42 Chinese building types, 10 house levels and 6 villa levels use imported component artwork', () => {
  assert.deepEqual(report.errors, [], 'Actual Godot renderer probe reported errors');
  assert.equal(catalog.buildings.length, 42);
  assert.equal(report.recipes.length, 56);
  assert.deepEqual(Object.keys(report.recipe_sizes).sort(), catalog.buildings.map(item => item.type).sort());
  for (const item of catalog.buildings) assert.equal(report.recipe_sizes[item.type], item.size, `${item.type} production footprint differs from the simulation`);
  assert.equal(report.recipes.filter(recipe => recipe.type === 'house').length, 10);
  assert.equal(report.recipes.filter(recipe => recipe.type === 'villa').length, 6);
  assert.equal(report.manifest.complete, true);
  assert.deepEqual(report.manifest.missing_parts, []);
  assert.ok(Object.keys(report.assets).length >= 54);
  assert.equal(Object.keys(report.assets).length, report.manifest.expected_parts);
  assert.deepEqual(report.missing_assets, []);
  assert.equal(report.image_only, true);
  assert.ok(report.textures.length > 0);
  for (const recipe of report.recipes) {
    const label = `${recipe.type}:${recipe.level}`;
    assert.equal(recipe.size, catalog.buildings.find(item => item.type === recipe.type).size, label);
    assert.ok(recipe.leaves.length > 1, `${label} must be assembled from multiple genuine parts`);
    assert.equal(recipe.nodes.length, recipe.leaves.length, `${label} must load every part as a real image node`);
    assert.equal(recipe.preview_nodes, recipe.leaves.length, `${label} catalogue preview must use the same production components`);
    for (const node of recipe.nodes) {
      assert.equal(node.primitive_node, true, `${label}/${node.leaf_id} retains an unbatchable Polygon2D instead of the production image primitive`);
      assert.equal(node.texture_loaded, true, `${label}/${node.leaf_id}`);
      assert.match(node.texture, /^res:\/\/art\/components\/components-\d+\.webp$/, `${label}/${node.leaf_id}`);
      assert.ok(node.quad_vertices >= 3);
      assert.equal(node.uv_vertices, node.quad_vertices);
      assert.equal(node.color_vertices, node.quad_vertices);
      assert.equal(node.finite_quad, true);
      assert.equal(node.finite_uv, true);
      assert.equal(node.uv_in_region, true, `${label}/${node.leaf_id} samples another atlas component`);
    }
  }
});

test('actual CanvasItem draw submissions retain every original image corner, UV and per-leaf installation channel', () => {
  const leaves = report.recipes.reduce((sum, recipe) => sum + recipe.leaves.length, 0);
  assert.ok(report.primitive_checks > leaves, 'Real _draw notifications must be observed throughout construction, previews and upgrades');
  assert.ok(report.submitted_triangles >= report.primitive_checks);
  for (const recipe of report.recipes) for (const part of recipe.appearance) {
    assert.ok(part.draw_revision > 0, `${recipe.type}:${recipe.level}/${part.leaf_id} has never actually drawn`);
    assert.equal(part.submitted_triangles, part.faces.length);
    assert.ok(part.faces.length > 0 && part.faces.every(face => face.length === 3),
      `${recipe.type}:${recipe.level}/${part.leaf_id} must submit real textured triangle primitives`);
  }
});

test('each referenced component has real nonempty alpha pixels and no complete-building asset key', () => {
  const allowed = new Set(report.material_keys);
  const hashes = new Set();
  const generation = JSON.parse(fs.readFileSync(path.join(root, report.manifest.generation_record), 'utf8'));
  for (const sheet of ['W1', 'K1']) {
    const record = generation.sheets.find(item => item.sheet === sheet);
    assert.equal(record?.original_generation_record?.accepted, true, `${sheet} directional parts require their explicit assembled-image review; merely existing on disk is insufficient`);
    const source = fs.readFileSync(path.join(root, record.original_generation_record.source));
    const hash = crypto.createHash('sha256').update(source).digest('hex');
    assert.equal(record.original_generation_record.sha256, hash, `${sheet} accepted review belongs to different source pixels`);
    assert.equal(record.sha256, hash, `${sheet} packing record belongs to different source pixels`);
  }
  for (const [key, asset] of Object.entries(report.assets)) {
    assert.doesNotMatch(key, /(?:^|[_/-])(?:house|villa|whole|building|complete|architecture|room|roof)(?:$|[_/-])/i);
    assert.ok(asset.width > 8 && asset.height > 8, `${key} source region is too small`);
    assert.ok(asset.opaque_pixels > 100, `${key} cannot be an empty or placeholder sprite`);
    assert.ok(asset.transparent_pixels > 0, `${key} must retain its cutout alpha`);
    assert.equal(asset.width * asset.height, asset.opaque_pixels + asset.transparent_pixels);
    assert.ok(asset.width < asset.atlas_width || asset.height < asset.atlas_height, `${key} cannot substitute a complete atlas sheet`);
    assert.match(asset.source, /^godot\/art\/components\/sources\//);
    assert.ok(fs.existsSync(path.join(root, asset.source)), `${key} original generated source is missing`);
    hashes.add(asset.pixel_hash);
  }
  assert.equal(hashes.size, Object.keys(report.assets).length, 'Different component labels must not alias identical pixel crops');
  for (const recipe of report.recipes) for (const leaf of recipe.leaves) {
    assert.ok(allowed.has(leaf.asset), `${recipe.type}:${recipe.level}/${leaf.id} uses an undeclared component`);
    assert.ok(report.assets[leaf.asset], `${recipe.type}:${recipe.level}/${leaf.id} references missing art`);
    assert.equal(leaf.kind, 'leaf');
  }
});

test('actual leaves have unique identities, finite geometry and bounded footprint extents', () => {
  let attachedWindows = 0;
  for (const recipe of report.recipes) {
    const ids = new Set(), label = `${recipe.type}:${recipe.level}`;
    for (const leaf of recipe.leaves) {
      assert.ok(typeof leaf.id === 'string' && leaf.id.length > 0);
      assert.equal(ids.has(leaf.id), false, `${label} duplicate leaf id ${leaf.id}`);
      ids.add(leaf.id);
      assert.equal(leaf.ground.length, 2);
      assert.equal(leaf.extent.length, 3);
      for (const number of [...leaf.ground, ...leaf.extent, leaf.elevation]) assert.ok(Number.isFinite(number), `${label}/${leaf.id} non-finite geometry`);
      assert.ok(leaf.extent.every(number => number > 0), `${label}/${leaf.id} nonpositive extent`);
      for (const field of ['full_structure', 'roof', 'style']) assert.equal(leaf[field], undefined, `${label}/${leaf.id} contains a legacy whole-module field`);
      if (['tiles_gray', 'tiles_green', 'tiles_glazed', 'thatch_course'].includes(leaf.asset)) {
        assert.ok(leaf.extent[0] <= .251 && leaf.extent[1] <= .151, `${label}/${leaf.id} replaces individual tile courses with a complete roof`);
      }
      assert.ok(leaf.elevation >= -.03 && leaf.elevation + leaf.extent[2] <= 8, `${label}/${leaf.id} unbounded elevation`);
      // Small eaves, garden foliage and dock fittings may overhang a tile.
      // A separate whole house outside its logical footprint cannot pass.
      for (let axis = 0; axis < 2; axis++) {
        const min = leaf.ground[axis] - leaf.extent[axis] / 2, max = leaf.ground[axis] + leaf.extent[axis] / 2;
        assert.ok(min >= -.25 && max <= recipe.size + .25, `${label}/${leaf.id} footprint ${min}..${max} exceeds ${recipe.size} tiles`);
      }
      if (/^window_/.test(leaf.asset) && leaf.id.includes('/window/')) {
        const wall = recipe.leaves.find(item => item.id === leaf.id.replace('/window/', '/bay/'));
        assert.ok(wall && /^wall_/.test(wall.asset), `${label}/${leaf.id} lacks its actual supporting wall bay`);
        assert.equal(leaf.face, wall.face);
        const normal = leaf.face === 'x' ? 1 : 0, tangent = 1 - normal;
        const wallFace = wall.ground[normal] + wall.extent[normal] / 2;
        const fittingBack = leaf.ground[normal] - leaf.extent[normal] / 2;
        assert.ok(fittingBack >= wallFace + .0001 && fittingBack <= wallFace + .015,
          `${label}/${leaf.id} is buried in its wall or floats away from it`);
        assert.ok(Math.abs(leaf.ground[tangent] - wall.ground[tangent]) + leaf.extent[tangent] / 2 <= wall.extent[tangent] / 2 + 1e-6,
          `${label}/${leaf.id} extends beyond its supporting wall bay`);
        assert.ok(leaf.elevation >= wall.elevation && leaf.elevation + leaf.extent[2] <= wall.elevation + wall.extent[2] + 1e-6);
        attachedWindows++;
      }
    }
  }
  assert.ok(attachedWindows > 0, 'The catalogue must exercise actual wall-mounted windows');
});

test('buildings and residence stages differ in real images and physical arrangement, not labels', () => {
  const signatures = new Map();
  for (const recipe of report.recipes) {
    const round = pairs => pairs.map(pair => pair.map(value => Math.round(value * 1000) / 1000));
    const geometry = recipe.appearance.map(part => JSON.stringify([
      report.assets[part.asset].pixel_hash, round(part.polygon), round(part.uvs), part.faces,
    ])).sort();
    const signature = crypto.createHash('sha256').update(JSON.stringify(geometry)).digest('hex');
    const label = `${recipe.type}:${recipe.level}`;
    assert.equal(signatures.has(signature), false, `${label} renders identically to ${signatures.get(signature)} after all names and IDs are removed`);
    signatures.set(signature, label);
  }
});

test('wall fittings and higher overlapping components follow their actual physical draw order', () => {
  let fittings = 0, verticalPairs = 0;
  for (const recipe of report.recipes) {
    const label = `${recipe.type}:${recipe.level}`;
    assert.equal(recipe.sort_cycles, 0, `${label} has contradictory drawing constraints`);
    const parts = new Map(recipe.appearance.map(part => [part.leaf_id, part]));
    const records = recipe.leaves.map(leaf => {
      const part = parts.get(leaf.id), xs = part.polygon.map(point => point[0]), ys = part.polygon.map(point => point[1]);
      // Node2D transforms store float32 coordinates while the reported order is
      // a GDScript float64; compare within the transform's subpixel precision.
      assert.ok(Math.abs(part.node_y - part.sort_y) < .0001, `${label}/${leaf.id} draws at a different Y-sort position from its declared order`);
      return { leaf, part, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    });
    for (const { leaf, part } of records) {
      if (!/^window_/.test(leaf.asset) || !leaf.id.includes('/window/')) continue;
      const wall = parts.get(leaf.id.replace('/window/', '/bay/'));
      assert.ok(wall && part.sort_y > wall.sort_y, `${label}/${leaf.id} is drawn behind its supporting wall`);
      fittings++;
    }
    for (let i = 0; i < records.length; i++) for (let j = i + 1; j < records.length; j++) {
      const a = records[i], b = records[j];
      if (a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY) continue;
      // The production image geometry has a 0.001-tile minimum thickness:
      // clipped slivers can be smaller in the recipe but still overlap in 3D.
      const aTop = a.leaf.elevation + Math.max(.001, a.leaf.extent[2]);
      const bTop = b.leaf.elevation + Math.max(.001, b.leaf.extent[2]);
      if (aTop <= b.leaf.elevation + .0001) {
        assert.ok(a.part.sort_y < b.part.sort_y, `${label} lower ${a.leaf.id} covers higher ${b.leaf.id}`);
        verticalPairs++;
      } else if (bTop <= a.leaf.elevation + .0001) {
        assert.ok(b.part.sort_y < a.part.sort_y, `${label} lower ${b.leaf.id} covers higher ${a.leaf.id}`);
        verticalPairs++;
      }
    }
  }
  assert.ok(fittings > 0 && verticalPairs > 0, 'Draw-order checks must exercise real wall fittings and stacked image components');
});

test('real texture UVs implement cropping, rotation and triangular caps, and multi-face image parts are complete', () => {
  let cropped = 0, rotated = 0, triangular = 0, multiFace = 0;
  const area = polygon => Math.abs(polygon.reduce((sum, point, i) => {
    const next = polygon[(i + 1) % polygon.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)) / 2;
  for (const recipe of report.recipes) for (const part of recipe.appearance) {
    const leaf = recipe.leaves.find(item => item.id === part.leaf_id), meta = report.manifest.parts[part.asset];
    const label = `${recipe.type}:${recipe.level}/${part.leaf_id}`;
    let expected;
    if (meta.source_planes) {
      multiFace++;
      expected = ['top', 'side_x', 'side_y'].flatMap(key => meta.source_planes[key] || []);
      assert.equal(expected.length, part.polygon.length, `${label} omits a declared image face`);
      assert.ok(part.faces.length > 0, `${label} cannot render a multi-face image as one self-intersecting polygon`);
      const covered = new Set(), faceAreas = new Map();
      for (const face of part.faces) {
        assert.ok(face.length >= 3, `${label} degenerate face`);
        assert.ok(face.every(index => Number.isInteger(index) && index >= 0 && index < part.polygon.length), `${label} invalid face index`);
        const group = Math.floor(face[0] / 4);
        assert.ok(face.every(index => Math.floor(index / 4) === group), `${label} joins unrelated source planes`);
        const faceArea = area(face.map(index => part.polygon[index]));
        assert.ok(faceArea > 1e-6, `${label} flattened image plane`);
        faceAreas.set(group, (faceAreas.get(group) || 0) + faceArea);
        face.forEach(index => covered.add(index));
      }
      assert.equal(covered.size, part.polygon.length, `${label} omits plane vertices`);
      for (let group = 0; group < part.polygon.length / 4; group++) {
        const expectedArea = area(part.polygon.slice(group * 4, group * 4 + 4));
        assert.ok(Math.abs(faceAreas.get(group) - expectedArea) < .001, `${label} duplicates or leaves a gap in an image plane`);
      }
    } else {
      let left = 0, top = 0, right = 1, bottom = 1;
      if (leaf.uv_crop && meta.kind === 'surface') {
        cropped++;
        const [x0, y0, x1, y1] = meta.plane_bounds || [0, 0, 1, 1];
        const [u, v, width, height] = leaf.uv_crop;
        left = x0 + (x1 - x0) * u; top = y0 + (y1 - y0) * v;
        right = left + (x1 - x0) * width; bottom = top + (y1 - y0) * height;
      }
      expected = [[left, top], [right, top], [right, bottom], [left, bottom]];
      const turns = ((leaf.uv_turns || 0) % 4 + 4) % 4;
      if (turns) rotated++;
      expected = expected.map((_, index, points) => points[(index + turns) % 4]);
      if (leaf.surface_triangle) {
        triangular++;
        expected = leaf.surface_triangle.map(index => expected[index]);
      }
      assert.ok(area(part.polygon) > 1e-6, `${label} has no visible image area`);
    }
    assert.equal(part.uvs.length, expected.length, `${label} UV topology`);
    for (let i = 0; i < expected.length; i++) for (let axis = 0; axis < 2; axis++) {
      assert.ok(Math.abs(part.uvs[i][axis] - expected[i][axis]) < 1e-5, `${label} ignores UV crop/rotation/plane mapping at vertex ${i}`);
    }
  }
  assert.ok(cropped > 0 && rotated > 0 && triangular > 0 && multiFace > 0, 'The real catalogue must exercise each supported source mapping');
});

test('foundation, frame, walls, rafters and tile courses follow the production installation schedule', () => {
  assert.deepEqual(report.phase_limits, [0, .12, .3, .53, .66, .91, 1]);
  const expectedPhases = {
    post_wood: 1, post_red: 1, beam_wood: 1, beam_painted: 1, dougong: 1,
    wall_earth: 2, wall_plaster: 2, wall_timber: 2, wall_brick: 2,
    door_wood: 2, door_red: 2, window_lattice: 2, window_paper: 2,
    rafter: 3, tiles_gray: 4, tiles_green: 4, tiles_glazed: 4, thatch_course: 4,
    eave_gray: 4, eave_gold: 4, ridge_gray: 4, ridge_gold: 4,
  };
  for (const recipe of report.recipes) {
    const label = `${recipe.type}:${recipe.level}`;
    const ordered = (before, after, reason) => {
      if (!before.length || !after.length) return;
      const done = Math.max(...before.map(leaf => recipe.schedule[leaf.id][0] + recipe.schedule[leaf.id][1]));
      const start = Math.min(...after.map(leaf => recipe.schedule[leaf.id][0]));
      assert.ok(done <= start + 1e-6, `${label} ${reason}`);
    };
    const select = (phase, pattern) => recipe.leaves.filter(leaf => leaf.phase === phase && pattern.test(leaf.asset));
    ordered(select(1, /^post_/), select(1, /^beam_|^brace_/), 'installs beams before their supporting posts');
    ordered(select(1, /^beam_|^brace_/), select(1, /^dougong$/), 'installs brackets before the timber frame');
    ordered(select(2, /^wall_/), select(2, /^door_/), 'installs doors before the wall bays');
    ordered(select(2, /^door_/), select(2, /^window_/), 'installs windows before doors');
    ordered(select(4, /^tiles_|^thatch_course$|^fabric_/), select(4, /^eave_|^ridge_|^rope$/), 'installs eaves or ridges before roof courses');
    ordered(select(4, /^eave_/), select(4, /^ridge_|^rope$/), 'installs the ridge before eaves');
    for (const leaf of recipe.leaves) {
      assert.ok(Number.isInteger(leaf.phase) && leaf.phase >= 0 && leaf.phase < 6, `${label}/${leaf.id}`);
      if ((leaf.asset === 'stone_block' && leaf.id.includes('/block/') && !leaf.id.startsWith('stele/block/'))
        || (leaf.asset === 'stone_step' && leaf.id.includes('/step/'))) {
        assert.equal(leaf.phase, 0, `${label}/${leaf.id} structural foundation or stair appears after construction has started above it`);
      }
      if (expectedPhases[leaf.asset] !== undefined) {
        const expected = leaf.asset.startsWith('beam_') && leaf.face === 'ground' ? 0
          : leaf.asset.startsWith('beam_') && leaf.id.startsWith('boat/gunwale/') ? 5
          : leaf.asset.startsWith('ridge_') && leaf.role === 'ornament' ? 5
            : expectedPhases[leaf.asset];
        assert.equal(leaf.phase, expected, `${label}/${leaf.id} installs ${leaf.asset} in the wrong structural phase`);
      }
      const [start, duration] = recipe.schedule[leaf.id];
      assert.ok(Number.isFinite(start) && Number.isFinite(duration) && duration > 0);
      assert.ok(start + 1e-6 >= report.phase_limits[leaf.phase], `${label}/${leaf.id} starts before its structural phase`);
      assert.ok(start + duration <= report.phase_limits[leaf.phase + 1] + 1e-6, `${label}/${leaf.id} overlaps the next structural phase`);
    }
    for (const target of recipe.targets) {
      assert.equal(target.real_leaf, true, `${label} exposes an invented worker installation point`);
      assert.ok(target.progress >= 0 && target.progress < 1);
    }
    for (const sample of recipe.samples) for (const [phase, amounts] of Object.entries(sample.phases)) {
      if (amounts.maximum <= .00001) continue;
      for (const [prior, installed] of Object.entries(sample.phases)) {
        if (Number(prior) < Number(phase)) assert.ok(installed.minimum >= .99999, `${label} phase ${phase} appears before phase ${prior} is physically installed at ${sample.progress}`);
      }
    }
  }
});

test('construction and all adjacent residential upgrades retain actual component node identities', () => {
  for (const recipe of report.recipes) {
    const label = `${recipe.type}:${recipe.level}`;
    assert.equal(recipe.identity_stable, true, `${label} replaces its component nodes at completion`);
    assert.equal(recipe.installation_monotonic, true, `${label} uninstalls an already installed part`);
    for (const sample of recipe.samples) assert.equal(sample.nodes, recipe.leaves.length, `${label} swapped to a whole-building completion sprite`);
    assert.equal(recipe.samples[0].maximum, 0, `${label} appears fully built before construction starts`);
    assert.ok(recipe.samples.at(-1).minimum >= .99999, `${label} finishes with missing construction components`);
  }
  assert.equal(report.upgrades.length, 14);
  assert.ok(report.upgrades.some(upgrade => upgrade.retained > 0), 'The probe must actually exercise shared components');
  for (const upgrade of report.upgrades) {
    const label = `${upgrade.type} ${upgrade.from}→${upgrade.to}`;
    assert.equal(upgrade.retained_stable, true, `${label} replaced an unchanged installed component`);
    assert.equal(upgrade.target_stable, true, `${label} replaced a target component at completion`);
    assert.equal(upgrade.finished_matches_target, true, `${label} leaves old construction fragments behind`);
    assert.equal(upgrade.finished_visible, true, `${label} finishes with hidden or incomplete components`);
  }
});

test('native construction workers reach real leaves, climb continuously and freeze on pause or disconnected roads', () => {
  const logs = runGodot(['--headless', '--path', project, '--script', path.join(__dirname, 'godot/construction-workers.gd')], 'workers.log');
  const match = logs.match(/^CONSTRUCTION_WORKERS\s+(\{[^\n]+\})\s*$/m);
  assert.ok(match, 'The production worker test must emit its assertion report');
  const result = JSON.parse(match[1]);
  const atlas = JSON.parse(fs.readFileSync(path.join(project, 'art/workers/workers-atlas.json'), 'utf8'));
  assert.deepEqual(result.failures, []);
  assert.ok(result.checks >= 250);
  assert.equal(result.supportedTypes, 42);
  assert.equal(result.atlasFrames, Object.keys(atlas.sprites).length);
  assert.ok(result.atlasFrames >= 20);
});

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

test('runtime and active export configuration contain no deleted whole-building artwork or Canvas entry points', () => {
  assert.equal(fs.existsSync(path.join(project, 'art/architecture')), false);
  const runtime = [
    path.join(root, 'index.html'), path.join(project, 'project.godot'), path.join(project, 'export_presets.cfg'),
    path.join(project, 'main.gd'), ...filesUnder(path.join(project, 'world')),
    ...filesUnder(path.join(project, 'ui')), ...filesUnder(path.join(root, 'js')),
    path.join(root, 'server/build.cjs'), path.join(root, 'server/export-godot.cjs'),
  ].filter(file => /\.(?:html|godot|cfg|gd|gdshader|js|cjs)$/.test(file));
  for (const file of runtime) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /(?:res:\/\/art\/|assets\/)architecture\//, file);
    assert.doesNotMatch(source, /js\/(?:assets|modular-buildings|renderer|input|ui|citizens)\.js/, file);
  }
  assert.ok(fs.existsSync(path.join(project, 'art/components/sources/.gdignore')), 'Generated sources and packing scripts must be excluded from active Godot exports');
  for (const texture of report.textures) assert.match(texture, /^res:\/\/art\/components\/components-\d+\.webp$/);
});
