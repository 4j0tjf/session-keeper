(async function () {
  'use strict';

  const R = globalThis.SessionKeeperRules;
  const S = globalThis.SessionKeeperStorage;
  const $ = (id) => document.getElementById(id);
  const KIND_LABEL = { click: '버튼 클릭', confirm: '확인창 승인', alert: '알림창 닫기' };

  const host = await currentHost();

  $('enabled').addEventListener('change', (event) => {
    S.saveConfig({ enabled: event.target.checked });
  });

  $('site-enabled').addEventListener('change', async (event) => {
    const cfg = await S.loadConfig();
    const others = cfg.disabledSites.filter((site) => !R.hostMatches(host, site));
    S.saveConfig({ disabledSites: event.target.checked ? others : others.concat(host) });
  });

  $('clear-log').addEventListener('click', () => S.clearLog());
  $('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
  chrome.storage.onChanged.addListener(render);
  render();

  async function currentHost() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = new URL(tab.url);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname : '';
    } catch (e) {
      return '';
    }
  }

  async function render() {
    const cfg = await S.loadConfig();
    const on = host ? R.isActiveOn(host, cfg) : cfg.enabled;

    $('state').textContent = on ? '작동 중' : '꺼짐';
    $('state').className = on ? 'on' : 'off';
    $('enabled').checked = cfg.enabled;
    $('site').textContent = host ? '(' + host + ')' : '';
    $('site-enabled').checked = !!host && !cfg.disabledSites.some((site) => R.hostMatches(host, site));
    $('site-enabled').disabled = !host || !cfg.enabled;
    $('site-row').hidden = !host;

    renderLog(await S.readLog());
  }

  function renderLog(log) {
    const list = $('log');
    list.replaceChildren(
      ...log.map((entry) => {
        const item = document.createElement('li');
        const meta = document.createElement('div');
        meta.className = 'meta';
        const when = document.createElement('span');
        when.textContent =
          new Date(entry.time).toLocaleString('ko-KR', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }) +
          ' · ' +
          (KIND_LABEL[entry.kind] || entry.kind);
        const where = document.createElement('span');
        where.textContent = entry.host || '';
        meta.append(when, where);

        const text = document.createElement('div');
        text.className = 'text';
        text.textContent = entry.kind === 'click' ? '"' + entry.text + '"' : entry.text;
        if (entry.context) text.title = entry.context;

        item.append(meta, text);
        return item;
      }),
    );
    $('log-empty').hidden = log.length > 0;
  }
})();
