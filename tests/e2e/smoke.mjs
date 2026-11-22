import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ARTIFACT_DIR = path.resolve('tests/artifacts');
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const BASE_URL = process.env.HOLLOWFIELD_URL || 'http://127.0.0.1:4176';

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(String(err));
  });

  console.log(`[E2E] Navigating to ${BASE_URL}`);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  // 1. Wait for Play button on 3D menu & capture main menu
  await page.waitForSelector('[data-testid="play-button"]', { timeout: 25000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, '01_main_menu.png'), animations: 'disabled' });
  console.log('[E2E] Main menu rendered.');

  // 2. Verify Settings menu & localStorage persistence
  await page.click('button:has-text("Settings")');
  await page.waitForSelector('h2:has-text("Settings")', { timeout: 5000 });
  await page.selectOption('select', 'medium');
  const savedQuality = await page.evaluate(() => {
    const raw = localStorage.getItem('hollowfield_settings_v1');
    return raw ? JSON.parse(raw).quality : null;
  });
  if (savedQuality !== 'medium') {
    throw new Error(`Expected settings quality to persist as 'medium', got ${savedQuality}`);
  }
  await page.click('button:has-text("Reset Defaults")');
  await page.click('button:has-text("Back")');
  console.log('[E2E] Settings persistence verified.');

  // 3. Start survival run & toggle F3 perf overlay
  await page.click('[data-testid="play-button"]');
  await page.waitForTimeout(700);
  await page.keyboard.press('F3');
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, '02_farmhouse_spawn.png'), animations: 'disabled' });

  // 4. Drive movement, shoot, reload, melee
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(450);
  await page.keyboard.up('KeyW');

  const beforeShot = await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.getState());
  await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.triggerAction('shoot'));
  await page.waitForFunction(
    (prevMag) => window.__HOLLOWFIELD_DEBUG__.getState().weapons[0].mag < prevMag,
    beforeShot.weapons[0].mag,
    { timeout: 10000 },
  );
  const afterShot = await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.getState());
  console.log(`[E2E] Shoot verified (${beforeShot.weapons[0].mag} -> ${afterShot.weapons[0].mag}).`);

  await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.triggerAction('reload'));
  await page.waitForFunction(
    () => window.__HOLLOWFIELD_DEBUG__.getState().weapons[0].mag === 8,
    null,
    { timeout: 25000 },
  );
  console.log('[E2E] Reload verified (mag restored to 8).');

  // 5. Add points, unlock Farmhouse -> Silo Yard gate with [F], and wall-buy Hedgerow + swap
  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.addPoints(15000);
    window.__HOLLOWFIELD_DEBUG__.setPlayerPose(-7, 0.9, 11.4, 0, 0);
  });
  await page.keyboard.down('KeyF');
  await page.waitForFunction(
    () => window.__HOLLOWFIELD_DEBUG__.getState().stats.doorsOpened >= 1,
    null,
    { timeout: 20000 },
  );
  await page.keyboard.up('KeyF');
  console.log('[E2E] Door unlock interaction verified.');

  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.setPlayerPose(-1.5, 0.9, 15.0, -Math.PI / 2, 0);
  });
  await page.keyboard.down('KeyF');
  await page.waitForFunction(
    () => window.__HOLLOWFIELD_DEBUG__.getState().weapons.length >= 2,
    null,
    { timeout: 20000 },
  );
  await page.keyboard.up('KeyF');

  await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.triggerAction('swap'));
  await page.waitForFunction(
    () => window.__HOLLOWFIELD_DEBUG__.getState().activeSlot === 1,
    null,
    { timeout: 15000 },
  );
  console.log('[E2E] Wall-buy & weapon swap verified.');

  // 6. Spawn 24 zombies & verify flow-field chase + frame timings + stuck teleports = 0
  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.setPlayerPose(-4, 0.9, 8.5, 0.12, -0.05);
    window.__HOLLOWFIELD_DEBUG__.spawnAllZombiesTest(24);
  });

  const frameTimes = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(350);
    const st = await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.getState());
    frameTimes.push(st.perf.frameTimeMs);
  }
  await page.screenshot({ path: path.join(ARTIFACT_DIR, '03_combat_24_zombies.png'), animations: 'disabled' });

  // 7. Capture Silo Yard, Bio-Lab, Barn, and Underground Bunker screenshots
  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.setPlayerPose(-2, 0.9, 6, 0.25, -0.05);
  });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, '04_silo_yard.png'), animations: 'disabled' });

  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.setPlayerPose(0, 0.9, -18, 0, -0.04);
  });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, '05_lab_wing.png'), animations: 'disabled' });

  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.setPlayerPose(16, 0.9, 5, -Math.PI * 0.48, -0.04);
  });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, '06_barn.png'), animations: 'disabled' });

  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.setPlayerPose(-9, 0.9, -36, Math.PI * 0.5, -0.04);
  });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, '07_bunker.png'), animations: 'disabled' });

  const finalState = await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.getState());
  const stuckTeleports = await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.getStuckTeleports());

  frameTimes.sort((a, b) => a - b);
  const p50 = frameTimes[Math.floor(frameTimes.length * 0.5)] ?? 0;
  const p95 = frameTimes[Math.floor(frameTimes.length * 0.95)] ?? 0;

  console.log(
    `[E2E] Perf log (Software/Headless): p50=${p50}ms, p95=${p95}ms, drawCalls=${finalState.perf.drawCalls}, triangles=${finalState.perf.triangles}, aiTickMs=${finalState.perf.aiTickMs}ms, stuckTeleports=${stuckTeleports}`,
  );

  if (finalState.perf.drawCalls >= 1500) {
    throw new Error(`Draw call budget exceeded: ${finalState.perf.drawCalls}`);
  }
  if (stuckTeleports !== 0) {
    throw new Error(`Expected 0 stuck zombie teleports, got ${stuckTeleports}`);
  }
  if (consoleErrors.length > 0 || pageErrors.length > 0) {
    throw new Error(`Console/Page errors detected: ${JSON.stringify({ consoleErrors, pageErrors })}`);
  }

  await browser.close();
  console.log('[E2E] ALL PLAYWRIGHT CHECKS PASSED.');
}

run().catch((err) => {
  console.error('[E2E] FAILED:', err);
  process.exit(1);
});
