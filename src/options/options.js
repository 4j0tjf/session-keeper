(function () {
  'use strict';

  const R = globalThis.SessionKeeperRules;
  const S = globalThis.SessionKeeperStorage;
  const $ = (id) => document.getElementById(id);
  const LIST_FIELDS = [
    'disabledSites',
    'sessionKeywords',
    'extendKeywords',
    'expiryKeywords',
    'extendLabels',
    'confirmLabels',
    'excludeLabels',
  ];

  $('save').addEventListener('click', save);
  $('reset').addEventListener('click', async () => {
    if (!confirm('모든 설정을 기본값으로 되돌릴까요?')) return;
    await S.resetConfig();
    await fill();
    showStatus('기본값으로 되돌렸습니다.');
  });
  fill();

  async function fill() {
    const cfg = await S.loadConfig();
    $('handleNativeDialogs').checked = cfg.handleNativeDialogs;
    $('customRules').value = cfg.customRules;
    for (const key of LIST_FIELDS) $(key).value = cfg[key].join('\n');
  }

  async function save() {
    const customRules = $('customRules').value.trim();
    const invalid = R.parseCustomRules(customRules).filter((rule) => !isValidSelector(rule.selector));
    if (invalid.length) {
      showStatus('잘못된 CSS 선택자: ' + invalid.map((rule) => rule.selector).join(', '), true);
      return;
    }

    const patch = { handleNativeDialogs: $('handleNativeDialogs').checked, customRules };
    for (const key of LIST_FIELDS) {
      patch[key] = $(key)
        .value.split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    }

    try {
      await S.saveConfig(patch);
      showStatus('저장했습니다. 열려 있는 탭에 바로 적용됩니다.');
    } catch (e) {
      showStatus('저장하지 못했습니다: ' + e.message, true);
    }
  }

  function isValidSelector(selector) {
    try {
      document.createDocumentFragment().querySelector(selector);
      return true;
    } catch (e) {
      return false;
    }
  }

  let statusTimer = 0;
  function showStatus(message, isError) {
    const el = $('status');
    el.textContent = message;
    el.style.color = isError ? 'var(--warn)' : '';
    clearTimeout(statusTimer);
    if (!isError) statusTimer = setTimeout(() => (el.textContent = ''), 4000);
  }
})();
