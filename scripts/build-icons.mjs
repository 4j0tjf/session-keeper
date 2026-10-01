// icons/icon.svg 를 확장 프로그램용 PNG(16/32/48/128)로 렌더링한다.
// 사용법: node scripts/build-icons.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const iconsDir = fileURLToPath(new URL('../icons/', import.meta.url));
const svg = await readFile(iconsDir + 'icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: `${iconsDir}icon${size}.png`, omitBackground: true });
}
await browser.close();
