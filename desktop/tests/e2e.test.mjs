/**
 * End-to-end smoke tests for the Paperwing interface.
 *
 * Runs against a served copy of the web app (Vite dev server or
 * `vite preview` of the desktop build) in a real Chromium:
 *
 *   PAPERWING_URL=http://localhost:5173 npm run test:e2e
 *
 * Chrome/Chromium is located automatically, or set CHROME_PATH.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = (process.env.PAPERWING_URL || 'http://localhost:5173').replace(
  /\/$/,
  ''
);
const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = resolve(
  here,
  '..',
  '..',
  'src',
  'tests',
  'fixtures',
  'sample.pdf'
);

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Chrome not found: set CHROME_PATH');
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll a page function until it returns a truthy value */
async function waitFor(page, fn, arg, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${fn}`);
    await sleep(150);
  }
}

let browser;
let page;
const pdfBase64 = readFileSync(SAMPLE).toString('base64');

async function openApp(scheme = 'light') {
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: scheme },
  ]);
  await page.goto(`${BASE}/app.html`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => !document.getElementById('splash'));
}

/** Drop a PDF onto the window like a user would */
async function dropPdf(name = 'sample.pdf') {
  await page.evaluate(
    async ({ b64, name }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type: 'application/pdf' }));
      window.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
        })
      );
    },
    { b64: pdfBase64, name }
  );
  await waitFor(
    page,
    () =>
      !document.querySelector('#doc-stage.is-loading') &&
      document.querySelector('#view-doc.is-active')
  );
  await sleep(800);
}

const tabNames = () =>
  page.$$eval('#tabs .tab-label', (els) => els.map((e) => e.textContent));

describe('Paperwing UI', () => {
  before(async () => {
    browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless: true,
      args: ['--no-sandbox'],
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 860 });
    page.on('dialog', (d) => d.dismiss());
    await page.goto(`${BASE}/app.html`);
    await page.evaluate(() => {
      localStorage.clear();
      indexedDB.deleteDatabase('paperwing-desktop');
    });
  });

  after(async () => {
    await browser?.close();
  });

  test('loads the home view and dismisses the launch screen', async () => {
    await openApp();
    assert.equal(await page.title(), 'Paperwing');
    assert.ok(await page.$('#view-home.is-active'));
    const cards = await page.$$('#rec-tools .rec-card');
    assert.ok(cards.length >= 3, 'recommended tools shown');
  });

  test('follows the system light/dark setting', async () => {
    await openApp('dark');
    const dark = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor
    );
    await openApp('light');
    const light = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor
    );
    assert.notEqual(dark, light);
    assert.equal(light, 'rgb(255, 255, 255)');
    // Dark theme is neutral grey, not blue-tinted
    const [r, g, b] = dark.match(/\d+/g).map(Number);
    assert.ok(
      Math.abs(r - b) <= 4 && Math.abs(r - g) <= 4,
      `neutral dark: ${dark}`
    );
  });

  test('opens a dropped PDF in a document tab', async () => {
    await openApp();
    await dropPdf('Report.pdf');
    assert.deepEqual(await tabNames(), ['Report.pdf']);
    const total = await page.$eval(
      '#right-rail .rr-total',
      (e) => e.textContent
    );
    assert.equal(total, '1');
    assert.ok(await page.$('#quickbar .qb-btn'), 'quick toolbar shown');
    assert.ok(await page.$('#left-panel .lp-tool'), 'tools panel shown');
  });

  test('mirrors Acrobat shortcuts', async () => {
    const tool = () =>
      page.evaluate(() => {
        const v = window.__acro?.viewer;
        const tab = [...v.docIds.keys()][0];
        return (
          v.cap('annotation').forDocument(v.docIds.get(tab)).getActiveTool()
            ?.id ?? null
        );
      });
    await page.keyboard.press('u');
    assert.equal(await tool(), 'highlight', 'U = highlight');
    await page.keyboard.press('Escape');
    assert.equal(await tool(), null, 'Esc = back to select');
    await page.keyboard.press('d');
    assert.equal(await tool(), 'ink', 'D = draw');
    await page.keyboard.press('v');
    assert.equal(await tool(), null, 'V = select');

    await page.keyboard.down('Control');
    await page.keyboard.press('KeyD');
    await page.keyboard.up('Control');
    assert.equal(
      await page.$eval('.dlg h2', (e) => e.textContent),
      'Document properties'
    );
    await page.keyboard.press('Escape');
    await page.evaluate(() =>
      document.querySelector('.dlg-backdrop')?.remove()
    );

    await page.keyboard.down('Control');
    await page.keyboard.press('KeyK');
    await page.keyboard.up('Control');
    assert.equal(
      await page.$eval('.dlg h2', (e) => e.textContent),
      'Preferences'
    );
    await page.evaluate(() =>
      document.querySelector('.dlg-backdrop')?.remove()
    );

    await page.keyboard.down('Control');
    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyP');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Control');
    assert.ok(await page.$('.find-pop .find-input'), 'command palette opens');
    await page.keyboard.press('Escape');
  });

  test('tracks unsaved changes and confirms before closing', async () => {
    await page.keyboard.press('d');
    const box = await page.$eval('#viewer-host', (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 3 };
    });
    await page.mouse.move(box.x - 60, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x, box.y + 30, { steps: 8 });
    await page.mouse.move(box.x + 60, box.y, { steps: 8 });
    await page.mouse.up();
    await waitFor(page, () => document.querySelector('#tabs .tab.is-dirty'));
    await page.keyboard.press('Escape');

    await page.keyboard.down('Control');
    await page.keyboard.press('KeyW');
    await page.keyboard.up('Control');
    await waitFor(page, () =>
      document.querySelector('.dlg[role="alertdialog"]')
    );
    const buttons = await page.$$eval('.dlg-actions button', (b) =>
      b.map((x) => x.textContent)
    );
    assert.deepEqual(buttons, ["Don't save", 'Cancel', 'Save']);
    await page.click('.dlg-actions .quiet-btn');
    await waitFor(page, () => !document.querySelector('#tabs .tab'));

    // Ctrl+Shift+T brings it back
    await page.keyboard.down('Control');
    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyT');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Control');
    await waitFor(page, () => document.querySelector('#tabs .tab'));
    assert.deepEqual(await tabNames(), ['Report.pdf']);
  });

  test('runs a tool on the open document and opens the result as a new tab', async () => {
    await waitFor(page, () => !document.querySelector('#doc-stage.is-loading'));
    await page.evaluate(() =>
      [...document.querySelectorAll('.lp-tool')]
        .find((b) => b.textContent.includes('Compress'))
        .click()
    );
    const frame = await page.waitForSelector('#left-panel iframe');
    const content = await frame.contentFrame();
    await content.waitForFunction(
      () =>
        document
          .querySelector('#file-display-area')
          ?.textContent.includes('Report.pdf'),
      { timeout: 20000 }
    );
    await content.waitForSelector('#process-btn');
    await content.click('#process-btn');
    await waitFor(
      page,
      () => document.querySelectorAll('#tabs .tab').length === 2,
      undefined,
      60000
    );
    const names = await tabNames();
    assert.equal(names[1], 'Report (1).pdf');
  });

  test('All tools view searches every tool', async () => {
    await page.evaluate(() => document.querySelector('.lp-more')?.click());
    await waitFor(page, () =>
      document.querySelector('#view-alltools.is-active')
    );
    await page.type('#alltools-search', 'watermark');
    const names = await page.$$eval('#alltools-groups .at-name', (e) =>
      e.map((x) => x.textContent)
    );
    assert.ok(
      names.some((n) => /watermark/i.test(n)),
      names.join(', ')
    );
  });

  test('home lists recent files', async () => {
    await page.click('#home-btn');
    await waitFor(
      page,
      () =>
        document.querySelectorAll(
          '#recent-list .recent-row:not(.recent-header)'
        ).length > 0
    );
    const text = await page.$eval('#recent-list', (e) => e.textContent);
    assert.match(text, /Report\.pdf/);
  });

  test('tool pages adopt the theme and hide their own chrome when embedded', async () => {
    await page.emulateMediaFeatures([
      { name: 'prefers-color-scheme', value: 'dark' },
    ]);
    await page.goto(`${BASE}/404.html`);
    await page.evaluate(() => {
      document.body.innerHTML =
        '<iframe id="f" src="/merge-pdf.html" style="width:800px;height:600px"></iframe>';
    });
    const handle = await page.waitForSelector('#f');
    const frame = await handle.contentFrame();
    await frame.waitForFunction(() =>
      document.documentElement.classList.contains('rs-embedded')
    );
    const state = await frame.evaluate(() => ({
      navHidden: [...document.querySelectorAll('body > nav')].every(
        (n) => getComputedStyle(n).display === 'none'
      ),
      bg: getComputedStyle(document.body).backgroundColor,
    }));
    assert.ok(state.navHidden, 'navbar hidden');
    const [r, g, b] = state.bg.match(/\d+/g).map(Number);
    assert.ok(
      r < 60 && Math.abs(r - b) <= 4,
      `dark neutral background: ${state.bg}`
    );
  });
});
