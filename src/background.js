/*
 * Session Keeper - 백그라운드 서비스 워커.
 *
 * 크롬은 manifest의 content_scripts를 설치 "이후에 연" 페이지에만 넣는다. 그래서 확장 프로그램을
 * 설치·업데이트하면, 이미 열려 있던 탭에도 같은 스크립트를 넣어 새로고침 없이 바로 동작하게 한다.
 */
'use strict';

chrome.runtime.onInstalled.addListener(injectIntoOpenTabs);

async function injectIntoOpenTabs() {
  const scripts = chrome.runtime.getManifest().content_scripts || [];
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      // 잠들어 있는(discarded) 탭은 다시 열릴 때 새로 로드되므로 건너뛴다.
      if (tab.discarded || !/^(https?|file):/.test(tab.url || '')) return;
      if (await isRunning(tab.id)) return;
      // MAIN(page-hook) → ISOLATED(content) 순서로 넣는다.
      for (const script of scripts) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: script.js,
            world: script.world || 'ISOLATED',
          });
        } catch (e) {
          // 웹 스토어처럼 확장 프로그램이 접근할 수 없는 페이지
        }
      }
    }),
  );
}

async function isRunning(tabId) {
  try {
    return !!(await chrome.tabs.sendMessage(tabId, { type: 'session-keeper:ping' }, { frameId: 0 }));
  } catch (e) {
    return false;
  }
}
