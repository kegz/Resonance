import { expect, test } from '@playwright/test';

function wave(seconds = 8, frequency = 220) {
  const rate = 8000;
  const samples = seconds * rate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const envelope = (i % (rate / 2)) < rate / 10 ? 0.6 : 0.1;
    buffer.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * frequency / rate) * 16000 * envelope), 44 + i * 2);
  }
  return buffer;
}

test('import, play, pause, rewind, and persist accessible settings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Resonance' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeDisabled();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import music' }).click();
  await (await chooser).setFiles({ name: 'local-song.wav', mimeType: 'audio/wav', buffer: wave(15) });
  await expect(page.locator('#track')).toHaveText('local-song.wav');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
  await expect(page.locator('#time')).not.toHaveText('0:00 / 0:15', { timeout: 8000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await page.locator('#time').textContent();
  await page.waitForTimeout(300);
  await expect(page.locator('#time')).toHaveText(paused!);
  await page.locator('h1').click();
  await page.keyboard.press('r');
  await expect(page.locator('#time')).toHaveText('0:00 / 0:15');
  await page.getByLabel('Visual intensity').fill('0');
  await expect(page.locator('#settings-state')).toHaveText('Settings saved.');
  await page.reload();
  await expect(page.getByLabel('Visual intensity')).toHaveValue('0');
  expect(errors).toEqual([]);
});

test('focus interruption pauses without automatic resume', async ({ page }) => {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import music' }).click();
  await (await chooser).setFiles({ name: 'interruption.wav', mimeType: 'audio/wav', buffer: wave(15) });
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
  const before = await page.locator('#time').textContent();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(300);
  await expect(page.locator('#time')).toHaveText(before!);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
});

test('invalid files recover without breaking import', async ({ page }) => {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import music' }).click();
  await (await chooser).setFiles({ name: 'invalid.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('not audio') });
  await expect(page.getByRole('status')).toContainText(/decode|invalid|supported|audio/i);
  await expect(page.getByRole('button', { name: 'Import music' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeDisabled();
});

test('playlist automatically moves to the next distinct world', async ({ page }) => {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import music' }).click();
  await (await chooser).setFiles([
    { name: 'first.wav', mimeType: 'audio/wav', buffer: wave(2) },
    { name: 'second.wav', mimeType: 'audio/wav', buffer: wave(8, 440) },
  ]);
  await expect(page.locator('#track')).toHaveText('second.wav', { timeout: 15000 });
  await expect(page.locator('#playlist [aria-current]')).toHaveText('▶ second.wav');
  await expect(page.locator('#objectives')).toContainText('NOTES 0/');
});

test('mobile layout keeps controls visible and supports concurrent pointers', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  const left = page.getByRole('button', { name: 'Move left', exact: true });
  const jump = page.getByRole('button', { name: 'Jump', exact: true });
  await expect(left).toBeVisible();
  await expect(jump).toBeVisible();
  const a = (await left.boundingBox())!;
  const b = (await jump.boundingBox())!;
  const session = await page.context().newCDPSession(page);
  const first = { x: a.x + a.width / 2, y: a.y + a.height / 2, id: 1 };
  const second = { x: b.x + b.width / 2, y: b.y + b.height / 2, id: 2 };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first, second] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [second] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('installed shell reloads and imports audio fully offline', async ({ page, context }) => {
  test.skip(!process.env.PREVIEW, 'Service workers are production-only.');
  await page.goto('/');
  await expect(page.locator('#offline')).toHaveText('Available offline', { timeout: 15000 });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
    }
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Resonance' })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import music' }).click();
  await (await chooser).setFiles({ name: 'offline.wav', mimeType: 'audio/wav', buffer: wave() });
  await expect(page.locator('#track')).toHaveText('offline.wav');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
});
