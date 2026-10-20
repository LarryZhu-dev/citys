'use strict';

// Godot controls live inside a canvas, so DOM actionability cannot observe their
// container layout. A report replaces window.godotMetrics with a new object.
// Distinct object identity, rather than polling frequency or wall-clock sleeps,
// lets slow software-rendered frames settle before a real pointer click.
let nextWaitId = 0;
const stateKey = '__godotBrowserControlWaits';

async function waitForStableGodotControl(page, query, options = {}) {
  if (typeof query === 'string') query = {name: query};
  const {timeout = 90000, tolerance = .5, stableSnapshots = 2} = options;
  if (!query || (!query.name && !query.text)) throw new Error('A Godot control name or text is required');
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error('Control tolerance must be nonnegative');
  if (!Number.isInteger(stableSnapshots) || stableSnapshots < 2) throw new Error('At least two fresh control snapshots are required');
  const id = `control-${++nextWaitId}`;
  await page.evaluate(({stateKey, id}) => {
    window[stateKey] ||= {};
    // The snapshot already present may precede the action that opened a panel.
    // It is only a baseline, never one of the required stable observations.
    window[stateKey][id] = {snapshot: window.godotMetrics, rect: null, count: 0};
  }, {stateKey, id});
  let handle;
  try {
    handle = await page.waitForFunction(({stateKey, id, query, tolerance, stableSnapshots}) => {
      const state = window[stateKey]?.[id], snapshot = window.godotMetrics;
      if (!state || !snapshot || snapshot === state.snapshot) return false;
      state.snapshot = snapshot;
      const control = snapshot.hud?.controls?.find(control => {
        if (query.name && control.name !== query.name) return false;
        if (query.text && (query.exactText ? control.text !== query.text : !String(control.text || '').includes(query.text))) return false;
        const rect = control.rect;
        return control.visible !== false && !control.disabled && !control.clipped && Array.isArray(rect) &&
          rect.length === 4 && rect.every(Number.isFinite) && rect[2] > 0 && rect[3] > 0 &&
          rect[0] >= -tolerance && rect[1] >= -tolerance &&
          rect[0] + rect[2] <= innerWidth + tolerance &&
          rect[1] + rect[3] <= innerHeight + tolerance;
      });
      if (!control) {
        state.rect = null;
        state.name = null;
        state.count = 0;
        return false;
      }
      const stable = state.name === control.name && state.rect &&
        control.rect.every((value, index) => Math.abs(value - state.rect[index]) <= tolerance);
      state.count = stable ? state.count + 1 : 1;
      // Keep the run's first geometry as its anchor so repeated tiny movements
      // cannot accumulate into a large layout change while passing tolerance.
      if (!stable) state.rect = [...control.rect];
      state.name = control.name;
      if (state.count < stableSnapshots) return false;
      return {...control, touch: navigator.maxTouchPoints > 0};
    }, {stateKey, id, query, tolerance, stableSnapshots}, {timeout, polling: 100});
    return await handle.jsonValue();
  } finally {
    if (handle) await handle.dispose();
    await page.evaluate(({stateKey, id}) => {
      if (window[stateKey]) delete window[stateKey][id];
    }, {stateKey, id}).catch(() => {});
  }
}

async function waitForFreshGodotSnapshot(page, timeout = 90000) {
  const id = `after-click-${++nextWaitId}`;
  await page.evaluate(({stateKey, id}) => {
    window[stateKey] ||= {};
    window[stateKey][id] = {snapshot: window.godotMetrics};
  }, {stateKey, id});
  let handle;
  try {
    handle = await page.waitForFunction(({stateKey, id}) =>
      !!window.godotMetrics && window.godotMetrics !== window[stateKey]?.[id]?.snapshot,
    {stateKey, id}, {timeout, polling: 100});
  } finally {
    if (handle) await handle.dispose();
    await page.evaluate(({stateKey, id}) => {
      if (window[stateKey]) delete window[stateKey][id];
    }, {stateKey, id}).catch(() => {});
  }
}

async function clickGodotControl(page, query, options = {}) {
  const control = await waitForStableGodotControl(page, query, options);
  const [left, top, width, height] = control.rect;
  const x = left + width / 2, y = top + height / 2;
  if (control.touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  // Await actual engine progress after pointer-up; callers can then inspect the
  // resulting city state without assuming that a 650 ms sleep spans a frame.
  await waitForFreshGodotSnapshot(page, options.timeout);
  return control;
}

function chromiumGraphicsOptions(backend = process.env.CHROMIUM_ANGLE_BACKEND || 'swiftshader') {
  return {
    headless: backend !== 'gl',
    args: [
      '--no-sandbox', '--use-gl=angle', `--use-angle=${backend}`,
      '--enable-unsafe-swiftshader', '--disable-dev-shm-usage',
      ...(backend === 'gl' ? ['--ignore-gpu-blocklist'] : []),
    ],
  };
}

async function chromiumRunMetadata(browser, backend = process.env.CHROMIUM_ANGLE_BACKEND || 'swiftshader') {
  const result = {requestedBackend: backend, browserVersion: browser.version()};
  let session;
  try {
    session = await browser.newBrowserCDPSession();
    const info = await session.send('SystemInfo.getInfo');
    result.gpuSystemInfo = info.gpu;
  } catch (error) {
    result.gpuSystemInfoUnavailable = error.message;
  } finally {
    if (session) await session.detach().catch(() => {});
  }
  return result;
}

module.exports = {waitForStableGodotControl, clickGodotControl, chromiumGraphicsOptions, chromiumRunMetadata};
