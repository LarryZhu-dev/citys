'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { createServer } = require('../server/index.cjs');
const out = 'work/godot-validation';
const timeout = 90000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function click(page, name) {
  await page.waitForFunction(n => window.godotMetrics?.hud?.controls?.some(c => c.name === n && !c.disabled), name, { timeout });
  const control = await page.evaluate(n => window.godotMetrics.hud.controls.find(c => c.name === n && !c.disabled), name);
  await page.touchscreen.tap(control.rect[0] + control.rect[2] / 2, control.rect[1] + control.rect[3] / 2);
  await sleep(700);
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dataDir = fs.mkdtempSync(out + '/mobile-input-data-');
  const server = createServer({ env: { DATA_FILE: dataDir + '/data.json' } });
  let browser;
  const report = { profiles: [], errors: [] };
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
    for (const profile of [{ name: 'portrait', width: 390, height: 844 }, { name: 'landscape', width: 844, height: 390 }]) {
      const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
      const page = await context.newPage();
      page.on('pageerror', error => report.errors.push({ profile: profile.name, message: error.message }));
      page.on('console', message => { if (/SCRIPT ERROR:|Parse Error:|USER ERROR:/.test(message.text())) report.errors.push({ profile: profile.name, message: message.text() }); });
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.waitForFunction(() => window.godotReady === true && !!window.godotMetrics, null, { timeout });
      await click(page, 'CityNameInput');
      await page.waitForFunction(() => document.activeElement?.tagName === 'INPUT' && !document.activeElement.disabled, null, { timeout: 10000 });
      const focused = await page.evaluate(() => ({ tag: document.activeElement.tagName, type: document.activeElement.type, value: document.activeElement.value, visibleStyle: document.activeElement.style.display, rect: Array.from(['x','y','width','height'], key => document.activeElement.getBoundingClientRect()[key]) }));
      const cityName = profile.name === 'portrait' ? '临江新城' : '横屏华夏';
      await page.locator('input:focus').fill(cityName);
      await page.waitForFunction(name => window.godotMetrics.hud.controls.find(c => c.name === 'CityNameInput')?.text === name, cityName, { timeout: 10000 });
      await click(page, 'NewCityButton');
      await page.waitForFunction(name => JSON.parse(CityBridge.snapshot(false)).hasSave && JSON.parse(CityBridge.snapshot(false)).cityName === name, cityName, { timeout: 10000 });
      await page.waitForFunction(() => window.godotMetrics.hud.active_panel === '', null, { timeout: 10000 });
      const result = await page.evaluate(() => {
        const canvas = document.getElementById('game');
        const rect = canvas.getBoundingClientRect();
        return { cityName: JSON.parse(CityBridge.snapshot(false)).cityName, canvas: { width: canvas.width, height: canvas.height, css: [rect.width, rect.height], dpr: devicePixelRatio, target: [rect.width * devicePixelRatio, rect.height * devicePixelRatio] }, hud: { css_size: window.godotMetrics.hud.css_size, active_panel: window.godotMetrics.hud.active_panel }, world: window.godotMetrics.world };
      });
      result.profile = profile;
      result.virtualKeyboard = focused;
      assert.equal(result.cityName, cityName);
      report.profiles.push(result);
      await page.screenshot({ path: out + '/mobile-input-' + profile.name + '.png' });
      await context.close();
    }
    assert.deepEqual(report.errors, []);
    fs.writeFileSync(out + '/mobile-input-report.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.failure = error.message;
    fs.writeFileSync(out + '/mobile-input-report.json', JSON.stringify(report, null, 2));
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    await server.app.store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
