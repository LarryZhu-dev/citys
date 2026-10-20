'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const {
  waitForStableGodotControl,
  clickGodotControl,
} = require('./browser-controls.cjs');

function control(overrides = {}) {
  return {
    name: 'ConfirmButton',
    text: '确认建造',
    rect: [100, 80, 140, 44],
    disabled: false,
    visible: true,
    clipped: false,
    ...overrides,
  };
}

function report(controls = [control()]) {
  // Each call intentionally produces a new object, as JSON.parse does in the
  // Godot bridge. Reusing a report below keeps precisely the same identity.
  return { hud: { controls, css_size: [800, 600] } };
}

class FakePage {
  constructor(baseline, reports, { touch = false } = {}) {
    this.reports = reports;
    this.reportCursor = 0;
    this.polls = 0;
    this.calls = [];
    this.evaluations = 0;
    this.window = {
      godotMetrics: baseline,
      innerWidth: 800,
      innerHeight: 600,
      devicePixelRatio: 1,
    };
    this.context = vm.createContext({
      window: this.window,
      navigator: { maxTouchPoints: touch ? 1 : 0 },
      innerWidth: 800,
      innerHeight: 600,
      document: {
        documentElement: { clientWidth: 800, clientHeight: 600 },
        getElementById: () => ({
          getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, width: 800, height: 600 }),
        }),
      },
    });
    this.mouse = { click: async (x, y) => this.calls.push({ kind: 'mouse', x, y }) };
    this.touchscreen = { tap: async (x, y) => this.calls.push({ kind: 'touch', x, y }) };
  }

  async evaluate(fn, argument) {
    this.evaluations += 1;
    this.context.argument = argument;
    const value = typeof fn === 'string'
      ? vm.runInContext(fn, this.context)
      : vm.runInContext(`(${fn.toString()})(argument)`, this.context);
    return await value;
  }

  async waitForFunction(fn, argument) {
    while (this.reportCursor < this.reports.length) {
      const metrics = this.reports[this.reportCursor++];
      this.polls += 1;
      this.window.godotMetrics = metrics;
      const value = await this.evaluate(fn, argument);
      if (value) {
        return { jsonValue: async () => structuredClone(value), dispose: async () => {} };
      }
    }
    const error = new Error('Timeout waiting for fresh stable Godot control metrics');
    error.name = 'TimeoutError';
    throw error;
  }

  viewportSize() {
    return { width: 800, height: 600 };
  }
}

test('a repeated metrics object never counts as another layout observation', async () => {
  const baseline = report();
  const fresh = report();
  const page = new FakePage(baseline, [baseline, baseline, fresh, fresh, fresh]);
  await assert.rejects(
    waitForStableGodotControl(page, { name: 'ConfirmButton' }, { timeout: 1 }),
    /Timeout|timed out/i,
  );
  assert.equal(page.polls, 5);
  assert.deepEqual(page.calls, []);
});

test('two fresh matching reports are required after the call baseline', async () => {
  const baseline = report();
  const first = report();
  const second = report();
  const page = new FakePage(baseline, [baseline, first, first, second]);
  const found = await waitForStableGodotControl(page, { name: 'ConfirmButton' }, { timeout: 1 });
  assert.equal(page.polls, 4);
  assert.deepEqual(Array.from(found.rect), [100, 80, 140, 44]);
});

test('a changed layout resets stability instead of clicking the earlier rectangle', async () => {
  const baseline = report();
  const first = report();
  const changed = report([control({ rect: [340, 210, 160, 48] })]);
  const settled = report([control({ rect: [340.3, 210.2, 160.1, 48.2] })]);
  const page = new FakePage(baseline, [first, changed, changed, settled]);
  const found = await waitForStableGodotControl(page, { name: 'ConfirmButton' }, { timeout: 1 });
  assert.equal(page.polls, 4);
  assert.deepEqual(Array.from(found.rect), [340.3, 210.2, 160.1, 48.2]);
});

test('changes in either size dimension also reset stability', async () => {
  const baseline = report();
  const first = report();
  const resized = report([control({ rect: [100, 80, 142, 48] })]);
  const page = new FakePage(baseline, [first, resized, resized]);
  await assert.rejects(
    waitForStableGodotControl(page, { name: 'ConfirmButton' }, { timeout: 1 }),
    /Timeout|timed out/i,
  );
});

test('disabled, clipped, invisible and out-of-viewport controls are excluded', async () => {
  const invalid = [
    control({ disabled: true }),
    control({ clipped: true }),
    control({ visible: false }),
    control({ rect: [-1, 80, 140, 44] }),
    control({ rect: [760, 80, 140, 44] }),
    control({ rect: [100, 580, 140, 44] }),
    control({ rect: [100, 80, 0, 44] }),
  ];
  for (const item of invalid) {
    const page = new FakePage(report(), [report([item]), report([{ ...item }])]);
    await assert.rejects(
      waitForStableGodotControl(page, { name: 'ConfirmButton' }, { timeout: 1 }),
      /Timeout|timed out/i,
      JSON.stringify(item),
    );
  }
});

test('an invalid candidate does not hide a later usable control with the same name', async () => {
  const make = () => report([control({ disabled: true }), control({ rect: [250, 90, 100, 40] })]);
  const page = new FakePage(report(), [make(), make()]);
  const found = await waitForStableGodotControl(page, { name: 'ConfirmButton' }, { timeout: 1 });
  assert.deepEqual(Array.from(found.rect), [250, 90, 100, 40]);
});

test('exact text matching chooses the intended control', async () => {
  const make = () => report([
    control({ name: 'CancelButton', text: '取消确认建造' }),
    control({ name: 'TargetButton', text: '确认建造', rect: [300, 120, 120, 40] }),
  ]);
  const page = new FakePage(report(), [make(), make()]);
  const found = await waitForStableGodotControl(page, { text: '确认建造', exactText: true }, { timeout: 1 });
  assert.equal(found.name, 'TargetButton');
});

test('mouse input uses the centre of the final stable rectangle', async () => {
  const first = report([control({ rect: [280, 160, 120, 48] })]);
  const second = report([control({ rect: [280, 160, 120, 48] })]);
  const afterPointerUp = report([control({ rect: [280, 160, 120, 48] })]);
  const page = new FakePage(report(), [first, second, second, afterPointerUp]);
  await clickGodotControl(page, { name: 'ConfirmButton' }, { timeout: 1 });
  assert.deepEqual(page.calls, [{ kind: 'mouse', x: 340, y: 184 }]);
  assert.equal(page.polls, 4);
});

test('touch input uses the actual touchscreen tap API', async () => {
  const first = report();
  const second = report();
  const page = new FakePage(report(), [first, second, report()], { touch: true });
  await clickGodotControl(page, { name: 'ConfirmButton' }, { timeout: 1, touch: true });
  assert.deepEqual(page.calls, [{ kind: 'touch', x: 170, y: 102 }]);
});

test('a wait that never receives two fresh stable reports never sends input', async () => {
  const baseline = report();
  const page = new FakePage(baseline, [baseline, baseline, baseline]);
  await assert.rejects(
    clickGodotControl(page, { name: 'ConfirmButton' }, { timeout: 1 }),
    /Timeout|timed out/i,
  );
  assert.deepEqual(page.calls, []);
});
