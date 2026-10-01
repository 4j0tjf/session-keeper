// 확장 프로그램을 실제 Chromium에 올려 테스트 페이지에서 동작을 확인한다.
// 실행: npm test  (Playwright의 Chromium 필요: npx playwright install chromium)
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const fixtures = path.join(root, 'test', 'fixtures');

let server;
let base;
let context;
let extensionId;
const dialogsByPage = new WeakMap();

before(async () => {
  server = http.createServer(async (req, res) => {
    try {
      const name = path.basename(new URL(req.url, 'http://localhost').pathname);
      const body = await readFile(path.join(fixtures, name));
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  // 압축 해제된 확장 프로그램의 ID는 폴더 경로의 SHA-256으로 정해진다.
  extensionId = [...createHash('sha256').update(root).digest('hex').slice(0, 32)]
    .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
    .join('');
  // 모든 탭에서 뜬 브라우저 대화상자를 기록하고 닫는다.
  context.on('page', trackDialogs);
});

after(async () => {
  await context?.close();
  server?.close();
});

function trackDialogs(page) {
  const dialogs = [];
  dialogsByPage.set(page, dialogs);
  page.on('dialog', (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    dialog.dismiss().catch(() => {});
  });
}

async function open(name, host = '127.0.0.1') {
  const page = await context.newPage();
  await page.goto(`${base.replace('127.0.0.1', host)}/${name}`);
  return page;
}

const dialogsOf = (page) => dialogsByPage.get(page);
const eventsOf = (target) => target.evaluate(() => window.events);
const waitForEvent = (target, name, timeout = 10000) =>
  target.waitForFunction((n) => window.events && window.events.includes(n), name, { timeout });

async function extensionPage(fn, arg) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  try {
    return await page.evaluate(fn, arg);
  } finally {
    await page.close();
  }
}

const setConfig = (patch) =>
  extensionPage(async (p) => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set(p);
  }, patch);

describe('기본 설정', { concurrency: true }, () => {
  test('레이어 팝업의 "연장"을 누르고, 이어지는 연장 완료 alert도 닫는다', async () => {
    const page = await open('layer.html');
    await waitForEvent(page, 'after-alert');
    await page.waitForTimeout(1500);
    // 처음부터 보이던 상단바 "로그인 연장"과 "로그아웃"은 누르지 않는다.
    assert.deepEqual(await eventsOf(page), ['shown', 'extend', 'after-alert']);
    assert.deepEqual(dialogsOf(page), []);
    await page.close();
  });

  test('href="javascript:..." 링크도 누른다 (영문 모달)', async () => {
    const page = await open('javascript-link.html');
    await waitForEvent(page, 'stay');
    await page.waitForTimeout(1000);
    assert.deepEqual(await eventsOf(page), ['shown', 'stay']);
    await page.close();
  });

  test('세션 만료 레이어의 이미지 "확인" 버튼을 누른다', async () => {
    const page = await open('expired.html');
    await waitForEvent(page, 'ok');
    assert.deepEqual(await eventsOf(page), ['shown', 'ok']);
    await page.close();
  });

  test('세션과 무관한 모달·본문 안내·로그인 입력창은 건드리지 않는다', async () => {
    const page = await open('unrelated.html');
    await waitForEvent(page, 'shown');
    await page.waitForTimeout(3000);
    assert.deepEqual(await eventsOf(page), ['shown']);
    await page.close();
  });

  test('iframe 안의 연장 버튼을 누른다', async () => {
    const page = await open('frame.html');
    const frame = page.frames().find((f) => f.url().endsWith('/frame-inner.html'));
    await waitForEvent(frame, 'extend');
    assert.deepEqual(await eventsOf(frame), ['shown', 'extend']);
    await page.close();
  });

  test('window.open 으로 뜬 연장 안내 팝업창의 "확인"을 누른다', async () => {
    const page = await open('opener.html');
    await page.click('#open');
    await waitForEvent(page, 'popup-ok');
    assert.deepEqual(await eventsOf(page), ['popup-ok']);
    await page.close();
  });

  test('같은 팝업이 다음 만료 때 다시 뜨면 또 누른다', async () => {
    const page = await open('repeat.html');
    await page.waitForFunction(() => window.events.filter((e) => e === 'extend').length === 2, null, {
      timeout: 45000,
    });
    assert.deepEqual(await eventsOf(page), ['shown', 'extend', 'shown', 'extend']);
    await page.close();
  });

  test('세션 연장 confirm()은 자동 승인하고, 다른 confirm()은 그대로 띄운다', async () => {
    const page = await open('blank.html');
    await page.waitForTimeout(500);
    assert.equal(
      await page.evaluate(() => confirm('로그인 유지 시간이 5분 남았습니다. 연장하시겠습니까?')),
      true,
    );
    assert.deepEqual(dialogsOf(page), []);
    assert.equal(await page.evaluate(() => confirm('정말 삭제하시겠습니까?')), false);
    assert.deepEqual(dialogsOf(page), ['confirm: 정말 삭제하시겠습니까?']);
    await page.close();
  });
});

test('자동 처리 기록이 툴바 팝업에 보인다', async () => {
  const kinds = await extensionPage(async () => (await SessionKeeperStorage.readLog()).map((e) => e.kind));
  assert.ok(kinds.includes('click'));
  assert.ok(kinds.includes('alert'));
  assert.ok(kinds.includes('confirm'));

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await page.waitForSelector('#log li');
  assert.ok((await page.locator('#log li').count()) >= kinds.length);
  await page.close();
});

test('사이트별 CSS 선택자 규칙에 맞는 요소를 누른다', async () => {
  await setConfig({ customRules: `127.0.0.1 #customExtend` });
  const page = await open('custom.html');
  await waitForEvent(page, 'custom');
  assert.deepEqual(await eventsOf(page), ['shown', 'custom']);
  await page.close();
});

test('사용하지 않을 사이트에서는 아무것도 하지 않는다', async () => {
  await setConfig({ disabledSites: ['127.0.0.1'] });
  const page = await open('layer.html');
  await waitForEvent(page, 'shown');
  await page.waitForTimeout(2500);
  assert.deepEqual(await eventsOf(page), ['shown']);
  assert.equal(await page.evaluate(() => confirm('로그인 시간을 연장하시겠습니까?')), false);
  assert.deepEqual(dialogsOf(page), ['confirm: 로그인 시간을 연장하시겠습니까?']);
  await page.close();

  // 다른 호스트(localhost)에서는 그대로 동작한다.
  const other = await open('expired.html', 'localhost');
  await waitForEvent(other, 'ok');
  await other.close();
});

test('전체 끄기를 하면 열려 있는 탭에도 바로 적용된다', async () => {
  await setConfig({});
  const page = await open('layer.html');
  await setConfig({ enabled: false });
  await waitForEvent(page, 'shown');
  await page.waitForTimeout(2500);
  assert.deepEqual(await eventsOf(page), ['shown']);
  await page.close();
});

test('설정 페이지에서 저장하면 storage에 반영된다', async () => {
  await setConfig({});
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await page.fill('#customRules', 'example.com #btnExtend');
  await page.fill('#disabledSites', 'a.com\n\n b.com ');
  await page.click('#save');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('저장'));
  const stored = await page.evaluate(() => chrome.storage.sync.get(['customRules', 'disabledSites']));
  assert.deepEqual(stored, { customRules: 'example.com #btnExtend', disabledSites: ['a.com', 'b.com'] });

  await page.fill('#customRules', 'example.com ##bad');
  await page.click('#save');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('잘못된'));
  await page.close();
});
