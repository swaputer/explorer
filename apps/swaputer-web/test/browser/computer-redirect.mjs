import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
const base = process.env.WEB_URL || 'http://127.0.0.1:4176';
const computer = process.env.COMPUTER_URL || 'http://127.0.0.1:4175';
try {
  const page = await browser.newPage();
  for (const path of ['/minter?contract=0x1234', '/market', '/market/0x1234?create=1', '/bridge']) {
    await page.goto(`${base}${path}`);
    await page.waitForURL(`${computer}/#${path}`);
    await page.getByRole('button', { name: 'Power on and connect wallet' }).waitFor();
    assert.equal(new URL(page.url()).hash, `#${path}`);
  }
  console.log('PASS: all legacy app links preserve their destination and require wallet power on.');
} finally { await browser.close(); }
