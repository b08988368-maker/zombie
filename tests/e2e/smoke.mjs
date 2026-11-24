import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ARTIFACT_DIR = path.resolve('tests/artifacts');
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const BASE_URL = process.env.HOLLOWFIELD_URL || 'http://127.0.0.1:4176';

function resolveChromiumExecutable() {
  const msDir = '/ms-playwright';
  if (fs.existsSync(msDir)) {
    const dirs = fs.readdirSync(msDir).filter((d) => d.startsWith('chromium_headless_shell-'));
    for (const d of dirs) {
      const candidate = path.join(msDir, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

async function run() {
  const executablePath = resolveChromiumExecutable();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const consoleErrors = [];
  const pageErrors = [];

  console.log(`[E2E] Verifying hardware postprocessing EffectComposer at ${BASE_URL}/?forcePostProcess=1`);
  const ppPage = await context.newPage();
  ppPage.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  ppPage.on('pageerror', (err) => {
    pageErrors.push(String(err));
  });
  await ppPage.goto(`${BASE_URL}/?forcePostProcess=1`, { waitUntil: 'domcontentloaded' });
  await ppPage.waitForSelector('[data-testid="play-button"]', { timeout: 25000 });
  await ppPage.waitForTimeout(500);
  const measureClipLuma = async () => {
    const buf = await ppPage.screenshot({ clip: { x: 700, y: 160, width: 320, height: 320 } });
    const b64 = buf.toString('base64');
    return ppPage.evaluate(async (src) => {
      const img = new Image();
      img.src = `data:image/png;base64,${src}`;
      await new Promise((res) => { img.onload = res; });
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 32;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 32, 32);
      const data = ctx.getImageData(0, 0, 32, 32).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += data[i] + data[i + 1] + data[i + 2];
      }
      return sum / (data.length / 4);
    }, b64);
  };
  const ppMenuLuma = await measureClipLuma();
  if (ppMenuLuma < 20) {
    throw new Error(`PostProcess menu rendered black (avg RGB sum=${ppMenuLuma.toFixed(1)})`);
  }
  await ppPage.click('[data-testid="play-button"]');
  await ppPage.waitForTimeout(500);
  const ppPlayLuma = await measureClipLuma();
  if (ppPlayLuma < 40) {
    throw new Error(`PostProcess gameplay rendered black (avg RGB sum=${ppPlayLuma.toFixed(1)})`);
  }
  if (consoleErrors.length > 0 || pageErrors.length > 0) {
    throw new Error(`PostProcess EffectComposer errors: ${JSON.stringify({ consoleErrors, pageErrors })}`);
  }
  await ppPage.close();
  console.log(`[E2E] Hardware EffectComposer pass verified (0 errors, luma=${ppMenuLuma.toFixed(1)}/${ppPlayLuma.toFixed(1)}).`);

  const page = await context.newPage();
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

  // 1. Wait for Play button on 3D menu, test Difficulty selector & capture main menu
  await page.waitForSelector('[data-testid="play-button"]', { timeout: 25000 });
  await page.click('[data-testid="difficulty-nightmare"]');
  await page.waitForFunction(
    () => {
      const raw = localStorage.getItem('hollowfield_settings_v1');
      return raw ? JSON.parse(raw).difficulty === 'nightmare' : false;
    },
    null,
    { timeout: 5000 },
  );
  await page.click('[data-testid="difficulty-survivor"]');
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, '01_main_menu.png'), animations: 'disabled', timeout: 45000 });
  console.log('[E2E] Main menu & difficulty selector rendered.');

  // 2. Verify Settings menu & localStorage persistence
  await page.click('button:has-text("Settings")');
  await page.waitForSelector('h2:has-text("Settings")', { timeout: 10000 });
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

  // 3. Start survival run & verify HUD layout (zero overlap between top-left and top-center)
  await page.click('[data-testid="play-button"]');
  await page.waitForTimeout(600);
  await page.keyboard.press('F3');
  await page.waitForTimeout(350);

  const hudOverlap = await page.evaluate(() => {
    const leftBox = document.querySelector('.fixed.top-5.left-6')?.getBoundingClientRect();
    const centerBox = document.querySelector('.fixed.top-5.left-1\\/2')?.getBoundingClientRect();
    if (!leftBox || !centerBox) return false;
    return !(leftBox.right <= centerBox.left || leftBox.left >= centerBox.right || leftBox.bottom <= centerBox.top || leftBox.top >= centerBox.bottom);
  });
  if (hudOverlap) {
    throw new Error('Top-left objective panel overlaps top-center round/radio banner!');
  }
  console.log('[E2E] HUD zero-overlap verified at 1280x720.');

  await page.screenshot({ path: path.join(ARTIFACT_DIR, '02_farmhouse_spawn.png'), animations: 'disabled', timeout: 45000 });

  // 3a. Verify crosshair ("cross aim") is visible in BOTH hipfire & ADS, and KeyT toggles flashlight
  const hipCrosshair = await page.locator('[data-testid="crosshair"]').boundingBox();
  if (!hipCrosshair || hipCrosshair.width < 10 || hipCrosshair.height < 10) {
    throw new Error(`Expected visible hipfire crosshair, got ${JSON.stringify(hipCrosshair)}`);
  }
  await page.mouse.move(640, 360);
  await page.mouse.down({ button: 'right' });
  await page.waitForFunction(
    () => window.__HOLLOWFIELD_DEBUG__.getState().isAds === true,
    null,
    { timeout: 15000 },
  );
  const adsCrosshair = await page.locator('[data-testid="crosshair"]').boundingBox();
  if (!adsCrosshair || adsCrosshair.width < 10 || adsCrosshair.height < 10) {
    throw new Error(`Expected visible ADS crosshair, got ${JSON.stringify(adsCrosshair)}`);
  }
  await page.mouse.up({ button: 'right' });

  const flashBefore = await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.getState().flashlightOn);
  await page.keyboard.press('KeyT');
  await page.waitForFunction(
    (prev) => window.__HOLLOWFIELD_DEBUG__.getState().flashlightOn !== prev,
    flashBefore,
    { timeout: 15000 },
  );
  await page.keyboard.press('KeyT');
  await page.waitForFunction(
    (prev) => window.__HOLLOWFIELD_DEBUG__.getState().flashlightOn === prev,
    flashBefore,
    { timeout: 15000 },
  );
  console.log('[E2E] Hipfire + ADS crosshair & KeyT tactical flashlight verified.');

  // 3b. Verify real simulation progression, Arrow-key aim, Pointer-Lock aim, auto-pause & fallback mouse aim
  const poseBefore = await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.getPlayerPose());
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(350);
  await page.keyboard.up('ArrowRight');
  const poseAfterArrow = await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.getPlayerPose());
  if (Math.abs(poseAfterArrow.yaw - poseBefore.yaw) < 0.08) {
    throw new Error(`ArrowRight aim failed: yaw stayed ${poseBefore.yaw} -> ${poseAfterArrow.yaw}`);
  }
  console.log(`[E2E] Arrow-key aim verified (yaw ${poseBefore.yaw.toFixed(2)} -> ${poseAfterArrow.yaw.toFixed(2)}).`);

  // Verify pointer-lock raw mousemove delta aim (bypasses chromium-headless-shell absolute warp-back quirk)
  await page.evaluate(() => {
    window.dispatchEvent(new MouseEvent('mousemove', { movementX: 90, movementY: -18 }));
  });
  await page.waitForTimeout(100);
  const poseAfterLockMove = await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.getPlayerPose());
  if (Math.abs(poseAfterLockMove.yaw - poseAfterArrow.yaw) < 0.1) {
    throw new Error(`Pointer-lock mousemove aim failed: yaw stayed ${poseAfterArrow.yaw} -> ${poseAfterLockMove.yaw}`);
  }
  console.log(`[E2E] Pointer-lock mouse look verified (yaw ${poseAfterArrow.yaw.toFixed(2)} -> ${poseAfterLockMove.yaw.toFixed(2)}).`);

  // Verify Esc / pointer unlock auto-pauses & Resume returns to playing
  await page.evaluate(() => document.exitPointerLock?.());
  await page.waitForFunction(
    () => window.__HOLLOWFIELD_DEBUG__.getState().screen === 'paused',
    null,
    { timeout: 15000 },
  );
  await page.keyboard.press('KeyP');
  await page.waitForFunction(
    () => window.__HOLLOWFIELD_DEBUG__.getState().screen === 'playing',
    null,
    { timeout: 15000 },
  );
  console.log('[E2E] Auto-pause on pointer unlock & Resume verified.');

  // Verify unlocked fallback mouse aim when requestPointerLock rejects (iframe SecurityError)
  await page.evaluate(() => {
    document.exitPointerLock?.();
  });
  await page.waitForFunction(
    () => window.__HOLLOWFIELD_DEBUG__.getState().screen === 'paused',
    null,
    { timeout: 15000 },
  );
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.requestPointerLock = () =>
      Promise.reject(new DOMException('Blocked in iframe', 'SecurityError'));
  });
  await page.keyboard.press('KeyP');
  await page.waitForFunction(
    () => {
      const st = window.__HOLLOWFIELD_DEBUG__.getState();
      return st.screen === 'playing' && st.pointerLockBlocked === true;
    },
    null,
    { timeout: 15000 },
  );
  await page.mouse.move(640, 360);
  await page.mouse.move(740, 350, { steps: 4 });
  await page.waitForTimeout(100);
  const poseAfterFallback = await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.getPlayerPose());
  if (Math.abs(poseAfterFallback.yaw - poseAfterLockMove.yaw) < 0.1) {
    throw new Error(`Unlocked iframe fallback mouse aim failed: yaw stayed ${poseAfterLockMove.yaw} -> ${poseAfterFallback.yaw}`);
  }
  console.log(`[E2E] Unlocked iframe fallback mouse aim verified (yaw ${poseAfterLockMove.yaw.toFixed(2)} -> ${poseAfterFallback.yaw.toFixed(2)}).`);

  // Wait for Round 1 to go active & a real zombie to spawn and reach a Farmhouse window
  await page.waitForFunction(
    () => {
      const st = window.__HOLLOWFIELD_DEBUG__.getState();
      const zs = window.__HOLLOWFIELD_DEBUG__.getZombies();
      return st.roundPhase === 'active' && zs.length >= 1;
    },
    null,
    { timeout: 20000 },
  );

  // Wait until at least one real zombie reaches tear_board / climb_in / chase and check distance to window
  await page.waitForFunction(
    () => window.__HOLLOWFIELD_DEBUG__.getZombies().some((z) => z.state !== 'approach_window'),
    null,
    { timeout: 20000 },
  );
  const realZombie = await page.evaluate(() =>
    window.__HOLLOWFIELD_DEBUG__.getZombies().find((z) => z.state !== 'approach_window'),
  );
  if (realZombie && realZombie.state === 'tear_board') {
    const distWest = Math.hypot(realZombie.x - -14, realZombie.z - 14);
    const distEast = Math.hypot(realZombie.x - 0, realZombie.z - 21);
    const minDist = Math.min(distWest, distEast);
    if (minDist > 2.2) {
      throw new Error(`Zombie tearing board too far from window wall: ${minDist.toFixed(2)}m at (${realZombie.x}, ${realZombie.z})`);
    }
    console.log(`[E2E] Real zombie reached window barricade at ${minDist.toFixed(2)}m.`);
  }

  // Face a spawned zombie's head while ADS and fire ONE real mouse click to verify 1-shot headshot kill
  await page.mouse.move(640, 360);
  await page.mouse.down({ button: 'right' });
  await page.waitForFunction(
    () => window.__HOLLOWFIELD_DEBUG__.getState().isAds === true,
    null,
    { timeout: 5000 },
  );
  await page.evaluate(() => {
    const z = window.__HOLLOWFIELD_DEBUG__.getZombies()[0];
    if (z) {
      // Position player with clean line of sight straight at the zombie's head (eye y=1.65 -> head y=1.48)
      const px = z.x < -7 ? z.x + 2.8 : z.x;
      const pz = z.x < -7 ? z.z : z.z - 2.8;
      const dx = z.x - px;
      const dz = z.z - pz;
      const dist = Math.hypot(dx, dz);
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(1.48 - 1.65, dist);
      window.__HOLLOWFIELD_DEBUG__.setPlayerPose(px, 0.9, pz, yaw, pitch);
    }
  });
  await page.waitForTimeout(180);
  const beforeRealClick = await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.getState());
  await page.mouse.click(640, 360);
  await page.waitForFunction(
    (prevShots) => window.__HOLLOWFIELD_DEBUG__.getState().stats.shotsFired > prevShots,
    beforeRealClick.stats.shotsFired,
    { timeout: 10000 },
  );
  await page.mouse.up({ button: 'right' });
  const afterRealClick = await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.getState());
  if (afterRealClick.stats.shotsHit <= beforeRealClick.stats.shotsHit) {
    throw new Error(`Expected real mouse click shot to hit aimed zombie (shotsHit=${afterRealClick.stats.shotsHit})`);
  }
  if (
    afterRealClick.stats.headshots <= beforeRealClick.stats.headshots ||
    afterRealClick.stats.kills <= beforeRealClick.stats.kills
  ) {
    throw new Error(
      `Expected 1-shot Round 1 ADS headshot kill, got headshots=${afterRealClick.stats.headshots} kills=${afterRealClick.stats.kills}`,
    );
  }
  console.log(
    `[E2E] 1-shot Round 1 ADS headshot kill verified (points ${beforeRealClick.points} -> ${afterRealClick.points}, headshots=${afterRealClick.stats.headshots}, kills=${afterRealClick.stats.kills}).`,
  );

  // 4. Drive movement, shoot, reload, melee lunge, grenade throw
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

  // Verify grenade throw consumes 1 frag grenade
  const beforeGrenades = (await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.getState())).grenades;
  await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.triggerAction('grenade'));
  await page.waitForFunction(
    (prev) => window.__HOLLOWFIELD_DEBUG__.getState().grenades === prev - 1,
    beforeGrenades,
    { timeout: 10000 },
  );
  console.log('[E2E] Composite frag grenade throw verified.');

  // Verify knife melee lunge + cooldown
  await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.triggerAction('melee'));
  await page.waitForTimeout(250);
  console.log('[E2E] Knife melee lunge executed.');

  // 5. Add points, unlock Farmhouse -> Silo Yard gate, Yard -> Lab, Lab -> Bunker, wall-buy Hedgerow + swap
  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.addPoints(35000);
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

  // 6. Test Supply Crate roll in Silo Yard
  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.setPlayerPose(-10.5, 0.9, -2.5, Math.PI * 0.5, -0.15);
  });
  await page.keyboard.down('KeyF');
  await page.waitForTimeout(550);
  await page.keyboard.up('KeyF');
  await page.waitForTimeout(1000);
  console.log('[E2E] Supply Crate roll animation triggered.');

  // 7. Unlock Lab Airlock, flip Station Power Switch, buy Ironhide perk
  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.setPlayerPose(0, 0.9, -12.6, 0, 0);
  });
  await page.keyboard.down('KeyF');
  await page.waitForFunction(
    () => window.__HOLLOWFIELD_DEBUG__.getState().stats.doorsOpened >= 2,
    null,
    { timeout: 20000 },
  );
  await page.keyboard.up('KeyF');

  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.setPlayerPose(12.3, 0.9, -26.5, -Math.PI * 0.5, 0);
  });
  await page.keyboard.down('KeyF');
  await page.waitForFunction(
    () => window.__HOLLOWFIELD_DEBUG__.getState().powerOn === true,
    null,
    { timeout: 20000 },
  );
  await page.keyboard.up('KeyF');
  console.log('[E2E] Station Power Switch restored.');

  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.setPlayerPose(-11.0, 0.9, -26.0, Math.PI * 0.25, 0);
  });
  await page.keyboard.down('KeyF');
  await page.waitForFunction(
    () => window.__HOLLOWFIELD_DEBUG__.getState().perks.includes('ironhide'),
    null,
    { timeout: 20000 },
  );
  await page.keyboard.up('KeyF');
  await page.waitForTimeout(1600);
  console.log('[E2E] Ironhide Tonic perk purchase verified.');

  // Unlock Bunker Bulkhead & Barn Doors so all map zones are connected for zombie pathfinding
  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.setPlayerPose(-6.0, 0.9, -28.6, 0, 0);
  });
  await page.keyboard.down('KeyF');
  await page.waitForFunction(
    () => window.__HOLLOWFIELD_DEBUG__.getState().stats.doorsOpened >= 3,
    null,
    { timeout: 20000 },
  );
  await page.keyboard.up('KeyF');

  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.setPlayerPose(10.6, 0.9, 2.0, -Math.PI * 0.5, 0);
  });
  await page.keyboard.down('KeyF');
  await page.waitForFunction(
    () => window.__HOLLOWFIELD_DEBUG__.getState().stats.doorsOpened >= 4,
    null,
    { timeout: 20000 },
  );
  await page.keyboard.up('KeyF');
  console.log('[E2E] Bunker Bulkhead and Barn Doors unlocked.');

  // 7b. Verify Barn hayloft ramp is physically climbable up onto the loft (fuse_barn reachable)
  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.setPlayerPose(25.5, 0.9, 13.8, 0, 0);
  });
  await page.keyboard.down('KeyW');
  await page.waitForFunction(
    () => {
      const p = window.__HOLLOWFIELD_DEBUG__.getPlayerPose();
      return p.y > 3.2 && p.z < 6.5;
    },
    null,
    { timeout: 15000 },
  );
  await page.keyboard.up('KeyW');
  const loftPose = await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.getPlayerPose());
  console.log(`[E2E] Barn hayloft ramp climbed cleanly to (x=${loftPose.x}, y=${loftPose.y}, z=${loftPose.z}).`);

  // 8. Spawn 24 zombies & verify flow-field chase + frame timings + stuck teleports = 0 + [X] inspect
  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.spawnAllZombiesTest(24);
  });

  const frameTimes = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(450);
    const st = await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.getState());
    frameTimes.push(st.perf.frameTimeMs);
  }
  await page.evaluate(() => {
    const zs = window.__HOLLOWFIELD_DEBUG__.getZombies();
    const target = zs[0];
    if (target) {
      const px = Math.max(-10, Math.min(8, target.x + 3.2));
      const pz = Math.max(-10, Math.min(8, target.z + 3.4));
      const yaw = Math.atan2(-(target.x - px), -(target.z - pz));
      window.__HOLLOWFIELD_DEBUG__.setPlayerPose(px, 0.9, pz, yaw, -0.05);
    } else {
      window.__HOLLOWFIELD_DEBUG__.setPlayerPose(-4, 0.9, 6.5, 0.9, -0.05);
    }
    window.__HOLLOWFIELD_DEBUG__.triggerAction('inspect');
  });
  await page.waitForTimeout(380);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, '03_combat_24_zombies.png'), animations: 'disabled', timeout: 45000 });

  // 9. Capture Silo Yard, Bio-Lab, Barn, and Underground Bunker screenshots
  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.setPlayerPose(6, 0.9, 4.5, 0.85, -0.04);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, '04_silo_yard.png'), animations: 'disabled', timeout: 45000 });

  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.setPlayerPose(0, 0.9, -18, 0, -0.04);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, '05_lab_wing.png'), animations: 'disabled', timeout: 45000 });

  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.setPlayerPose(16, 0.9, 5, -Math.PI * 0.48, -0.04);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, '06_barn.png'), animations: 'disabled', timeout: 45000 });

  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.setPlayerPose(-9, 0.9, -36, Math.PI * 0.5, -0.04);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, '07_bunker.png'), animations: 'disabled', timeout: 45000 });

  // 9b. Verify Round 4 off-screen flanking threat indicators, visible above-floor rigs, & solid cover/wall occlusion
  await page.evaluate(() => {
    const dbg = window.__HOLLOWFIELD_DEBUG__;
    dbg.jumpToRound(4);
    dbg.spawnAllZombiesTest(6);
  });
  await page.waitForFunction(
    () => {
      const zs = window.__HOLLOWFIELD_DEBUG__.getZombies();
      return zs.length > 0 && zs.some((z) => z.state === 'chase') && zs.every((z) => !z.isRising);
    },
    null,
    { timeout: 20000 },
  );
  await page.waitForTimeout(200);
  const visibilityAudit = await page.evaluate(() => {
    const zs = window.__HOLLOWFIELD_DEBUG__.getZombies();
    const invisible = zs.filter((z) => !z.visible);
    const underground = zs.filter((z) => !z.isRising && z.state === 'chase' && z.bodyY < -0.08);
    const insideRamp = zs.filter(
      (z) => z.x > 24.2 && z.x < 26.8 && z.z > 6.9 && z.z < 12.1 && z.y < 0.5,
    );
    return { total: zs.length, invisible, underground, insideRamp };
  });
  if (visibilityAudit.invisible.length > 0 || visibilityAudit.underground.length > 0) {
    throw new Error(`Invisible/underground zombie detected: ${JSON.stringify(visibilityAudit)}`);
  }
  if (visibilityAudit.insideRamp.length > 0) {
    throw new Error(`Zombie clipped inside Barn hayloft ramp: ${JSON.stringify(visibilityAudit.insideRamp)}`);
  }

  await page.evaluate(() => {
    const zs = window.__HOLLOWFIELD_DEBUG__.getZombies();
    const chaser = zs.find((z) => z.state === 'chase') || zs[0];
    if (chaser) {
      window.__HOLLOWFIELD_DEBUG__.setPlayerPose(chaser.x, 0.9, chaser.z - 4.2, 0, -0.02);
    }
  });
  await page.waitForFunction(
    () => window.__HOLLOWFIELD_DEBUG__.getState().offscreenThreats.length >= 1,
    null,
    { timeout: 10000 },
  );
  // Stand behind Farmhouse Kitchen Island cover (-7, 19.65) and verify no phantom punch lands across solid cover
  const hpBeforeCover = await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.setPlayerPose(-7, 0.9, 19.8, 0, -0.05);
    return window.__HOLLOWFIELD_DEBUG__.getState().health;
  });
  await page.waitForTimeout(1200);
  const hpAfterCover = await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.getState().health);
  if (hpAfterCover < hpBeforeCover) {
    throw new Error(`Phantom melee hit detected behind Kitchen Island cover (${hpBeforeCover} -> ${hpAfterCover})`);
  }

  // Stand inside Farmhouse against North wall (facing away so exterior Silo Yard zombies are behind) and verify 0 phantom arrows for wall-occluded zombies
  const occludedAudit = await page.evaluate(() => {
    const dbg = window.__HOLLOWFIELD_DEBUG__;
    dbg.jumpToRound(4);
    dbg.spawnAllZombiesTest(4);
    // Farmhouse interior at (-11.7, 11.4) directly behind solid North wall at z=10, facing South (+Z)
    dbg.setPlayerPose(-11.7, 0.9, 11.4, Math.PI, 0);
    return dbg.getState();
  });
  await page.waitForTimeout(700);
  const occludedAfter = await page.evaluate(() => {
    const st = window.__HOLLOWFIELD_DEBUG__.getState();
    const zs = window.__HOLLOWFIELD_DEBUG__.getZombies();
    const losCount = zs.filter((z) => z.hasLos).length;
    return {
      threats: st.offscreenThreats?.length ?? 0,
      losCount,
      health: st.health,
    };
  });
  if (occludedAfter.losCount === 0 && occludedAfter.threats > 0) {
    throw new Error(`Wall-occluded phantom arrows leaked when no zombie had LOS: ${JSON.stringify(occludedAfter)}`);
  }
  if (occludedAfter.health < occludedAudit.health && occludedAfter.losCount === 0) {
    throw new Error(`Wall-occluded phantom damage leaked when no zombie had LOS: ${JSON.stringify(occludedAfter)}`);
  }
  console.log('[E2E] Round 4 off-screen flanking chevrons, above-floor visibility & wall-occlusion verified.');

  // 9c. Verify Bloater blast behind solid Farmhouse wall deals 0 damage
  const hpBeforeWallBlast = await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.setPlayerPose(-7, 0.9, 16.5, 0, 0);
    return window.__HOLLOWFIELD_DEBUG__.getState().health;
  });
  await page.evaluate(() => {
    // Farmhouse north wall sits at z=10; trigger explosion just outside at z=8.2
    window.__HOLLOWFIELD_DEBUG__.triggerBloaterExplosionTest(-7, 1.0, 8.2);
  });
  await page.waitForTimeout(250);
  const hpAfterWallBlast = await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.getState().health);
  if (hpAfterWallBlast < hpBeforeWallBlast) {
    throw new Error(`Wall-occluded bloater blast leaked damage (${hpBeforeWallBlast} -> ${hpAfterWallBlast})`);
  }
  console.log('[E2E] Wall-occluded bloater explosion = 0 damage verified.');

  // 10. Test Round 12 Brute spawn & Alpha Bloom Brute Boss HUD bar
  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.jumpToRound(12);
    window.__HOLLOWFIELD_DEBUG__.spawnBossTest('alpha_boss');
  });
  await page.waitForSelector('[data-testid="boss-bar"]', { timeout: 8000 });
  const round12State = await page.evaluate(() => window.__HOLLOWFIELD_DEBUG__.getState());
  if (round12State.round !== 12 || !round12State.boss) {
    throw new Error(`Expected round 12 & active boss bar, got round=${round12State.round} boss=${JSON.stringify(round12State.boss)}`);
  }
  console.log('[E2E] High-round transition (Round 12) & Alpha Boss HUD verified.');

  // 11. Verify Victory screen & Continue Endless Survival (+5,000 PTS)
  const ptsBeforeVictory = round12State.points;
  await page.evaluate(() => {
    window.__HOLLOWFIELD_DEBUG__.triggerVictoryTest();
  });
  await page.waitForSelector('[data-testid="victory-screen"]', { timeout: 8000 });
  await page.screenshot({ path: path.join(ARTIFACT_DIR, '08_victory_screen.png'), animations: 'disabled' });
  await page.click('[data-testid="continue-endless-button"]');
  await page.waitForFunction(
    (prevPts) => {
      const st = window.__HOLLOWFIELD_DEBUG__.getState();
      return st.screen === 'playing' && st.campaign?.endlessMode === true && st.points > prevPts;
    },
    ptsBeforeVictory,
    { timeout: 8000 },
  );
  console.log('[E2E] Victory screen & Continue Endless Survival verified.');

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
