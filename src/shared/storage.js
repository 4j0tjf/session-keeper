/*
 * Session Keeper - 설정(chrome.storage.sync)과 동작 기록(chrome.storage.local) 읽기/쓰기.
 * rules.js 다음에 불러와야 한다.
 */
(function (root) {
  'use strict';

  const R = root.SessionKeeperRules;
  // 기록은 항목마다 별도 키로 저장한다. 여러 탭/프레임이 동시에 써도 서로 덮어쓰지 않게.
  const LOG_PREFIX = 'log:';
  const LOG_MAX = 50;

  async function loadConfig() {
    return R.withDefaults(await chrome.storage.sync.get(null));
  }

  function saveConfig(patch) {
    return chrome.storage.sync.set(patch);
  }

  function resetConfig() {
    return chrome.storage.sync.clear();
  }

  async function logEntries() {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all)
      .filter(([key]) => key.startsWith(LOG_PREFIX))
      .sort(([, a], [, b]) => b.time - a.time);
  }

  async function readLog() {
    return (await logEntries()).map(([, entry]) => entry);
  }

  async function appendLog(entry) {
    const time = Date.now();
    const key = LOG_PREFIX + time + ':' + Math.random().toString(36).slice(2, 8);
    await chrome.storage.local.set({ [key]: { ...entry, time } });
    const stale = (await logEntries()).slice(LOG_MAX).map(([k]) => k);
    if (stale.length) await chrome.storage.local.remove(stale);
  }

  async function clearLog() {
    await chrome.storage.local.remove((await logEntries()).map(([key]) => key));
  }

  root.SessionKeeperStorage = { loadConfig, saveConfig, resetConfig, readLog, appendLog, clearLog };
})(globalThis);
