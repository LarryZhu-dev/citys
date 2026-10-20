'use strict';

/* Local HUD and interaction regression. Screenshots are review artifacts, not
 * automatic approval of architecture, animation quality, or artistic fidelity.
 * This test always creates its own loopback server and disposable data store.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
catch (error) {
  if (process.env.PLAYWRIGHT_MODULE) throw error;
  playwright = require('/opt/codex/cua_node/lib/node_modules/playwright');
}
const { chromium } = playwright;
const { createServer } = require('../server/index.cjs');

const project = path.resolve(__dirname, '..');
const output = path.join(project, 'work');
const reportPath = path.join(output, 'visual-report.json');
const devices = [
  { name: 'desktop', width: 1440, height: 900, dpr: 1, touch: false },
  { name: 'portrait', width: 390, height: 844, dpr: 2, touch: true },
  { name: 'landscape', width: 844, height: 390, dpr: 2, touch: true },
];
const report = {
  purpose: 'Local DOM, HUD, module loading, map gestures and building placement regression.',
  limitation: 'Screenshots require human review. These checks do not approve artistic quality, fidelity, animation quality, or parity with another game.',
  productionAccess: false,
  startedAt: new Date().toISOString(),
  success: false,
  devices: [],
  pageErrors: [],
  resourceErrors: [],
  cleanup: {},
};
let browser, server, temporaryDirectory, activePage, activeDevice;

function staticResource(url, base) {
  const parsed = new URL(url);
  return parsed.origin === base && (
    parsed.pathname === '/' || parsed.pathname === '/index.html' ||
    /^\/(?:js|assets)\//.test(parsed.pathname) || /^\/(?:style|online)\.css$/.test(parsed.pathname)
  );
}
function trackErrors(page, base, device) {
  page.on('pageerror', error => report.pageErrors.push({ device, message: error.message }));
  page.on('response', response => {
    if (response.status() >= 400 && staticResource(response.url(), base)) {
      report.resourceErrors.push({ device, status: response.status(), path: new URL(response.url()).pathname });
    }
  });
  page.on('requestfailed', request => {
    if (staticResource(request.url(), base)) {
      report.resourceErrors.push({ device, path: new URL(request.url()).pathname, error: request.failure()?.errorText || 'request failed' });
    }
  });
}
async function press(page, selector, device) {
  const control = page.locator(selector);
  if (device.touch) await control.tap();
  else await control.click();
}
async function frames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function clearToasts(page) {
  await page.waitForFunction(() => document.querySelectorAll('#toasts .toast').length === 0, null, { timeout: 8000 });
}
async function screenshot(page, device, state) {
  const filename = `visual-${device.name}-${state}.png`;
  await page.screenshot({ path: path.join(output, filename) });
  return path.posix.join('work', filename);
}
async function mapArea(page) {
  return page.evaluate(() => {
    let map = 0, total = 0;
    const step = 8;
    for (let y = step / 2; y < innerHeight; y += step) {
      for (let x = step / 2; x < innerWidth; x += step) {
        total++;
        if (document.elementFromPoint(x, y)?.id === 'cv') map++;
      }
    }
    const canvas = document.querySelector('#cv').getBoundingClientRect();
    return {
      directlyInteractiveFraction: map / total,
      sampledPoints: total,
      samplingStepCssPixels: step,
      canvas: { width: canvas.width, height: canvas.height },
      viewport: { width: innerWidth, height: innerHeight },
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth,
    };
  });
}
async function captureArea(page, device, record, state, minimum) {
  const area = await mapArea(page);
  record.states[state] = { ...area, screenshot: await screenshot(page, device, state) };
  assert.equal(area.horizontalOverflow, false, `${device.name}/${state}: horizontal overflow`);
  assert.equal(area.canvas.width, device.width, `${device.name}/${state}: canvas does not fill viewport width`);
  assert.equal(area.canvas.height, device.height, `${device.name}/${state}: canvas does not fill viewport height`);
  if (minimum !== undefined) {
    assert.ok(area.directlyInteractiveFraction >= minimum,
      `${device.name}/${state}: directly touchable map area ${(area.directlyInteractiveFraction * 100).toFixed(1)}% is below ${minimum * 100}%`);
  }
}
async function structure(page) {
  return page.evaluate(() => ({
    signature: JSON.stringify(buildings().map(o => [o.b.id, o.b.type, o.x, o.y, o.b.lvl || 0]).sort((a, b) => a[0] - b[0])),
    totalBuilt: S.stats.totalBuilt,
    camera: { x: view.ox, y: view.oy, zoom: view.zoom },
    goods: { ...S.goods },
  }));
}
async function centerTarget(page, target) {
  await page.evaluate(({ x, y }) => centerOnTile(x, y, 1.05), target);
  await frames(page);
  const point = await page.evaluate(({ x, y }) => {
    const rectangle = cv.getBoundingClientRect(), projected = tileToScreen(x, y);
    const point = { x: rectangle.left + view.ox + projected.sx * view.zoom, y: rectangle.top + view.oy + projected.sy * view.zoom };
    return { ...point, targetElement: document.elementFromPoint(point.x, point.y)?.id };
  }, target);
  assert.equal(point.targetElement, 'cv', 'The intended tile must be unobstructed before a real pointer click');
  return point;
}
async function dragMap(page, device, client) {
  const x = device.width * 0.48, y = device.height * 0.43;
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, { x, y }), 'cv');
  if (device.touch) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y }] });
    for (let i = 1; i <= 8; i++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: x + i * 7, y: y + i * 3 }] });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 56, y + 24, { steps: 8 });
    await page.mouse.up();
  }
  await frames(page);
}
async function pinchMap(page, device, client) {
  const x = device.width / 2, y = device.height * 0.42;
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ id: 1, x: x - 32, y }, { id: 2, x: x + 32, y }],
  });
  for (let i = 1; i <= 10; i++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ id: 1, x: x - 32 - i * 4, y }, { id: 2, x: x + 32 + i * 4, y }],
    });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await frames(page);
}
async function canvasHash(page) {
  return page.evaluate(() => {
    const pixels = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let hash = 2166136261;
    for (let i = 0; i < pixels.length; i += 1012) hash = Math.imul(hash ^ pixels[i], 16777619);
    return hash >>> 0;
  });
}

async function verifyDevice(base, device) {
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: device.dpr,
    hasTouch: device.touch,
    isMobile: device.touch,
  });
  const page = await context.newPage();
  activePage = page; activeDevice = device;
  page.setDefaultTimeout(15000);
  trackErrors(page, base, device.name);
  const record = { name: device.name, viewport: device, success: false, checks: [], states: {} };
  report.devices.push(record);
  try {
    const response = await page.goto(base, { waitUntil: 'load' });
    assert.equal(response.status(), 200);
    await press(page, '[data-civ="china"]', device);
    await page.locator('#newCityName').fill(`触控验收-${device.name}`);
    await page.locator('#newCitySeed').fill(`hud-regression-${device.name}`);
    await press(page, '#foundCity', device);
    await page.waitForFunction(() => S && S.tick >= 2);
    await press(page, '#quickPauseBtn', device);
    assert.equal(await page.evaluate(() => speed), 0, 'Real pause button must stop simulation');
    record.checks.push('Civilization and city creation through visible controls; natural simulation advances, then visible pause stops it.');

    await page.waitForFunction(() => !!window.GameArt && !!window.ModularBuildings && !!window.Citizens);
    await page.evaluate(async () => {
      await GameArt.ready;
      await GameArt.partsReady;
      await ModularBuildings.ready;
    });
    record.modules = await page.evaluate(() => ({
      partsReady: !!GameArt.partsReady && typeof GameArt.partsReady.then === 'function',
      partsLoaded: GameArt.partsLoaded,
      partsExpected: GameArt.partNames.length,
      modularDraw: typeof ModularBuildings.draw,
      modularThumbnail: typeof ModularBuildings.thumbnail,
      citizenModule: !!window.Citizens,
      assetFailures: GameArt.errors,
      house: ModularBuildings.inspect({ type: 'house', civ: 'china', level: 1 }).supported,
    }));
    assert.equal(record.modules.partsReady, true);
    assert.ok(record.modules.partsExpected > 0);
    assert.equal(record.modules.partsLoaded, record.modules.partsExpected, 'Every declared modular part must load');
    assert.equal(record.modules.modularDraw, 'function');
    assert.equal(record.modules.modularThumbnail, 'function');
    assert.equal(record.modules.house, true);
    assert.deepEqual(record.modules.assetFailures, []);
    record.checks.push('Real building modules, citizen module and declared image parts loaded; no mocked canvas or assets.');

    await clearToasts(page);
    assert.equal(await page.locator('#buildPanel').isVisible(), false, 'Build catalog starts closed');
    assert.equal(await page.locator('#side').isVisible(), false, 'Building details start closed');
    assert.equal(await page.locator('#minimapBox').isVisible(), false, 'Minimap starts closed');
    await captureArea(page, device, record, 'idle', 0.80);
    if (device.touch) {
      const targets = await page.evaluate(() => ['#buildOpenBtn', '#roadToolBtn', '#onlineBtn', '#viewBtn', '#menuBtn', '#quickPauseBtn', '#inventoryBtn', '#taskToggle'].map(selector => {
        const r = document.querySelector(selector).getBoundingClientRect(); return { selector, width: r.width, height: r.height };
      }));
      for (const target of targets) assert.ok(target.width >= 44 && target.height >= 44, `${target.selector} must have a 44 CSS pixel touch target`);
      record.touchTargets = targets;
    }

    await press(page, '#buildOpenBtn', device);
    assert.equal(await page.locator('#buildPanel').isVisible(), true);
    const catalog = await page.locator('#buildPanel').boundingBox();
    if (device.touch) assert.ok(catalog.height <= device.height * .36 + 1, `${device.name}: catalog exceeds 36vh`);
    record.catalogHeight = catalog.height;
    await captureArea(page, device, record, 'catalog');
    await press(page, '[data-c="municipal"]', device);
    await press(page, '[data-t="well"]', device);
    assert.equal(await page.locator('#buildPanel').isVisible(), false, 'Selecting a blueprint closes catalog');
    assert.equal(await page.locator('#hint').isVisible(), true, 'Selecting a blueprint shows the compact placement bar');
    assert.equal(await page.locator('#side').isVisible(), false, 'Placement does not open a competing details sheet');
    assert.equal(await page.evaluate(() => selTool), 'well');
    await captureArea(page, device, record, 'placing', 0.80);
    record.checks.push('Visible build entry, bounded catalog, actual category/card selection, and automatic collapse to a compact placement bar.');

    const target = await page.evaluate(() => {
      const origin = S.start || { x: MAP_W / 2, y: MAP_H / 2 }, candidates = [];
      for (let y = 1; y < MAP_H - 1; y++) for (let x = 1; x < MAP_W - 1; x++) {
        if (canBuildAt('well', x, y).ok && connectedToMain(x, y, BUILD.well.size)) candidates.push({ x, y });
      }
      candidates.sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y));
      return candidates[0];
    });
    assert.ok(target, 'The actual settlement needs a legal connected well location');
    await centerTarget(page, target);
    const client = device.touch ? await context.newCDPSession(page) : null;
    const beforeDrag = await structure(page);
    await dragMap(page, device, client);
    const afterDrag = await structure(page);
    assert.equal(afterDrag.signature, beforeDrag.signature, 'Dragging while placing must not build anything');
    assert.equal(afterDrag.totalBuilt, beforeDrag.totalBuilt);
    assert.deepEqual(afterDrag.goods, beforeDrag.goods, 'Dragging must not spend goods');
    assert.ok(Math.hypot(afterDrag.camera.x - beforeDrag.camera.x, afterDrag.camera.y - beforeDrag.camera.y) > 20, 'The drag must actually move the map');
    record.checks.push(`${device.touch ? 'Real one-finger touch' : 'Mouse'} drag pans without accidentally building or spending resources.`);

    if (device.touch) {
      const beforePinch = await structure(page);
      await pinchMap(page, device, client);
      const afterPinch = await structure(page);
      assert.ok(afterPinch.camera.zoom > beforePinch.camera.zoom * 1.2, 'Real two-finger gesture must increase zoom');
      assert.equal(afterPinch.signature, beforePinch.signature, 'Pinching must not place a building');
      assert.equal(afterPinch.totalBuilt, beforePinch.totalBuilt);
      assert.deepEqual(afterPinch.goods, beforePinch.goods);
      record.pinchZoom = { before: beforePinch.camera.zoom, after: afterPinch.camera.zoom };
      record.checks.push('Real two-finger CDP touch sequence changes zoom without building or spending.');
    }

    const point = await centerTarget(page, target);
    const beforeBuild = await structure(page);
    const cost = await page.evaluate(() => ({ ...BUILD.well.cost }));
    if (device.touch) await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
    await page.waitForFunction(({ x, y }) => tileAt(x, y)?.b?.type === 'well', target);
    const afterBuild = await structure(page);
    assert.equal(afterBuild.totalBuilt, beforeBuild.totalBuilt + 1, 'One pointer tap must create exactly one building');
    for (const [resource, amount] of Object.entries(cost)) {
      assert.equal(afterBuild.goods[resource], beforeBuild.goods[resource] - amount, `${resource}: charge actual configured well cost relative to pre-click stock`);
    }
    record.placedAt = target;
    record.states.built = { screenshot: await screenshot(page, device, 'built') };
    await press(page, '#cancelPlacementBtn', device);
    assert.equal(await page.locator('#hint').isVisible(), false);
    assert.equal(await page.locator('#toolDock').isVisible(), true);
    const selectionPoint = await centerTarget(page, target);
    if (device.touch) await page.touchscreen.tap(selectionPoint.x, selectionPoint.y);
    else await page.mouse.click(selectionPoint.x, selectionPoint.y);
    await page.locator('#side').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => selectedBuilding()?.b?.type), 'well');
    await captureArea(page, device, record, 'details');
    await press(page, '#closeInfo', device);
    assert.equal(await page.locator('#side').isVisible(), false, 'Building detail close control must restore map');
    assert.equal(await page.evaluate(() => window.selectedTile), null);
    await clearToasts(page);
    await captureArea(page, device, record, 'after-close', 0.80);
    record.checks.push('One real tap builds exactly one well, deducts relative configured cost, and opens/closes its actual building details.');

    const dayHash = await canvasHash(page);
    await press(page, '#viewBtn', device);
    await press(page, '#dayBtn', device); // automatic -> day
    assert.equal(await page.evaluate(() => rendererSettings.night), 'day');
    await press(page, '#dayBtn', device); // day -> night
    assert.equal(await page.evaluate(() => rendererSettings.night), 'night');
    await press(page, '#closeView', device);
    await frames(page);
    assert.ok(await page.evaluate(() => getNightAmount() > .5), 'Night setting must reach the renderer');
    assert.notEqual(await canvasHash(page), dayHash, 'Actual rendered pixels must change for night mode');
    record.states.night = { screenshot: await screenshot(page, device, 'night') };
    record.checks.push('Visible view tools switch day/night; renderer night amount and actual canvas pixels change.');

    assert.deepEqual(report.pageErrors.filter(error => error.device === device.name), [], `${device.name}: JavaScript errors`);
    assert.deepEqual(report.resourceErrors.filter(error => error.device === device.name), [], `${device.name}: failed HTML/CSS/JS or asset requests`);
    record.success = true;
    console.log(`PASS ${device.name}: idle ${(record.states.idle.directlyInteractiveFraction * 100).toFixed(1)}%, placing ${(record.states.placing.directlyInteractiveFraction * 100).toFixed(1)}% directly interactive map; catalog ${catalog.height.toFixed(1)}px.`);
  } catch (error) {
    record.error = error.message;
    if (!page.isClosed()) record.failureScreenshot = await screenshot(page, device, 'failure').catch(() => null);
    throw error;
  } finally {
    await context.close();
    activePage = null;
  }
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'citys-visual-browser-'));
  try {
    // Passing this isolated env prevents inherited production DB configuration
    // and TEST_BASE_URL/SMOKE_BASE_URL from choosing an external server.
    server = createServer({ env: { NODE_ENV: 'test', DATA_FILE: path.join(temporaryDirectory, 'online.json') } });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    report.server = 'Ephemeral loopback HTTP server with a disposable local store.';
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
      headless: true,
      args: ['--no-sandbox'],
    });
    for (const device of devices) await verifyDevice(base, device);
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.resourceErrors, []);
    report.success = true;
  } catch (error) {
    report.error = error.stack || error.message;
    if (activePage && !activePage.isClosed()) await screenshot(activePage, activeDevice, 'failure').catch(() => {});
    process.exitCode = 1;
    console.error(error);
  } finally {
    const cleanupErrors = [];
    if (browser) {
      try { await browser.close(); report.cleanup.browserClosed = true; }
      catch (error) { cleanupErrors.push('Browser: ' + error.message); }
    }
    if (server) {
      try {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        report.cleanup.serverClosed = true;
      } catch (error) { cleanupErrors.push('Server: ' + error.message); }
      try { await server.app.store.close(); report.cleanup.storeClosed = true; }
      catch (error) { cleanupErrors.push('Store: ' + error.message); }
    }
    if (temporaryDirectory) {
      try {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
        report.cleanup.temporaryDataRemoved = !fs.existsSync(temporaryDirectory);
      } catch (error) { cleanupErrors.push('Temporary data: ' + error.message); }
    }
    if (cleanupErrors.length) {
      report.cleanup.errors = cleanupErrors; report.success = false; process.exitCode = 1;
      console.error('Cleanup failed:', cleanupErrors);
    }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`Report: ${reportPath}`);
    console.log('Screenshots are for human review; this test does not certify artistic quality.');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
