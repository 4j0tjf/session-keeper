/*
 * Session Keeper - 콘텐츠 스크립트(ISOLATED world).
 *
 * 화면에 "로그인 연장" 같은 세션 연장 팝업이 나타나면 찾아서 누른다.
 *  - 문구가 연장 버튼("연장", "로그인 유지", "Stay signed in" ...)이고 주변 글이 세션 관련이면 누른다.
 *  - "확인"/"예" 같은 일반 버튼은 세션 만료·연장 안내 팝업(모달/레이어/팝업창) 안일 때만 누른다.
 *  - 옵션에서 사이트별로 지정한 CSS 선택자에 맞는 요소는 그대로 누른다.
 *  - alert/confirm 은 page-hook.js(MAIN world)가 물어 오면 세션 연장·만료 대화상자인지 판단해 준다.
 * 실제 클릭과 alert/confirm 가로채기는 page-hook.js가 한다.
 */
(function () {
  'use strict';

  const R = globalThis.SessionKeeperRules;
  const S = globalThis.SessionKeeperStorage;

  const DIALOG_EVENT = 'session-keeper:dialog';
  const CLICK_EVENT = 'session-keeper:click';
  const CLICK_ATTR = 'data-session-keeper-click';
  const CANDIDATES = [
    'button',
    'a',
    'input[type="button"]',
    'input[type="submit"]',
    'input[type="image"]',
    '[role="button"]',
    '[onclick]',
  ].join(',');
  const POPUP_NAME = /modal|popup|dialog|layer|lightbox|overlay|^pop|[_-]pop|pop[_-]/i;

  const SCAN_DEBOUNCE_MS = 500;
  const SCAN_INTERVAL_MS = 2000;
  // 페이지가 뜬 직후부터 보이던 버튼(상단바의 상시 "연장" 버튼 등)은 팝업이 아니므로 누르지 않는다.
  const BASELINE_MS = 3000;
  const CLICK_GAP_MS = 1000;
  // 같은 팝업(같은 버튼 문구 + 같은 안내문)은 이 시간 안에 다시 누르지 않는다.
  const REPEAT_COOLDOWN_MS = 30000;
  const MAX_LABEL_LENGTH = 40;
  const MAX_CONTEXT_LENGTH = 1500;
  const MAX_CONTEXT_DEPTH = 12;
  const INLINE_CONTEXT_DEPTH = 4;

  const topHost = getTopHost();
  // window.open 으로 띄운 팝업창이나 iframe
  const isAuxWindow = window !== window.top || !!window.opener;

  // 저장된 설정을 읽기 전(페이지 로딩 중)에 뜨는 alert/confirm도 처리할 수 있게 기본값으로 시작한다.
  // 버튼 찾기는 저장된 설정을 읽은 뒤에 시작한다.
  let cfg = R.withDefaults({});
  let active = R.isActiveOn(topHost, cfg);
  let customRules = [];
  let watching = false;
  let observer = null;
  let intervalId = 0;
  let baselineUntil = 0;
  let lastClickAt = 0;
  let scanTimer = 0;
  const handled = new Set();
  const recentClicks = new Map();

  document.addEventListener(DIALOG_EVENT, onPageDialog);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') loadConfig();
  });
  // 툴바 팝업이 "이 탭에서 동작 중인지" 확인할 때 답한다.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'session-keeper:ping') sendResponse({ active });
  });
  loadConfig();

  async function loadConfig() {
    try {
      cfg = await S.loadConfig();
    } catch (e) {
      return; // 확장 프로그램이 업데이트/재시작되어 연결이 끊긴 경우
    }
    active = R.isActiveOn(topHost, cfg);
    customRules = R.parseCustomRules(cfg.customRules).filter(
      (rule) => R.hostMatches(location.hostname, rule.host) || R.hostMatches(topHost, rule.host),
    );
    if (active) startWatching();
  }

  /*
   * page-hook.js가 alert/confirm 직전에 보내는 이벤트. 동기로 전달되므로 여기서
   * preventDefault()하면 그 대화상자는 띄우지 않고 자동으로 답한다.
   * 꺼져 있으면 그대로 둔다(원래 대화상자가 뜸).
   */
  function onPageDialog(event) {
    if (!active || !cfg.handleNativeDialogs) return;
    let request;
    try {
      request = JSON.parse(event.detail);
    } catch (e) {
      return;
    }
    if (!request || (request.kind !== 'alert' && request.kind !== 'confirm')) return;
    if (!R.shouldAutoAnswerDialog(request.kind, request.message, cfg)) return;
    event.preventDefault();
    record(request.kind, String(request.message).slice(0, 200));
  }

  function startWatching() {
    if (watching) return;
    watching = true;
    const begin = () => {
      if (!isAuxWindow) baselineUntil = Date.now() + BASELINE_MS;
      observer = new MutationObserver(scheduleScan);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden', 'open', 'aria-hidden'],
      });
      // 애니메이션처럼 DOM 변경 없이 보이게 되는 경우를 위한 주기 검사
      intervalId = setInterval(scan, SCAN_INTERVAL_MS);
      scan();
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', begin, { once: true });
    } else {
      begin();
    }
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = 0;
      scan();
    }, SCAN_DEBOUNCE_MS);
  }

  /*
   * 확장 프로그램이 업데이트되면 이 스크립트는 연결이 끊긴 채 남고, 새 스크립트가 들어온다
   * (background.js). 같은 버튼을 두 번 누르지 않도록 옛 스크립트는 버튼 찾기를 멈춘다.
   */
  function stopWatching() {
    if (observer) observer.disconnect();
    clearInterval(intervalId);
    clearTimeout(scanTimer);
  }

  function scan() {
    if (!chrome.runtime || !chrome.runtime.id) {
      stopWatching();
      return;
    }
    if (!active || !document.body) return;

    // 사라진 버튼은 잊어서, 같은 팝업이 다시 뜨면 또 누를 수 있게 한다.
    for (const el of handled) {
      if (!isVisible(el)) handled.delete(el);
    }

    const now = Date.now();
    for (const target of findTargets()) {
      if (handled.has(target.el)) continue;
      if (now < baselineUntil) {
        handled.add(target.el);
        continue;
      }
      if (now - lastClickAt < CLICK_GAP_MS) {
        scheduleScan();
        return;
      }
      handled.add(target.el);

      const key = signature(target);
      if (now - (recentClicks.get(key) || 0) < REPEAT_COOLDOWN_MS) continue;
      for (const [k, at] of recentClicks) {
        if (now - at >= REPEAT_COOLDOWN_MS) recentClicks.delete(k);
      }
      recentClicks.set(key, now);
      lastClickAt = now;

      clickInPage(target.el);
      record('click', target.label, target.context);
      return; // 한 번에 하나만 누르고 페이지가 반응할 시간을 준다.
    }
  }

  function findTargets() {
    const targets = [];

    for (const rule of customRules) {
      let found;
      try {
        found = document.querySelectorAll(rule.selector);
      } catch (e) {
        continue; // 잘못된 선택자
      }
      for (const el of found) {
        if (isVisible(el)) {
          targets.push({ el, kind: 'rule', label: labelOf(el) || rule.selector, context: rule.selector });
        }
      }
    }

    for (const el of document.querySelectorAll(CANDIDATES)) {
      const label = labelOf(el);
      if (!label || label.length > MAX_LABEL_LENGTH) continue;
      const kind = R.classifyLabel(label, cfg);
      if (!kind || !isVisible(el)) continue;
      const context = findSessionContext(el, kind);
      if (context != null) targets.push({ el, kind, label, context });
    }

    return targets;
  }

  function labelOf(el) {
    let text = el instanceof HTMLInputElement ? el.value || el.alt : el.textContent;
    if (!text || !text.trim()) {
      text =
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        Array.from(el.querySelectorAll('img[alt]'), (img) => img.alt).join(' ');
    }
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /*
   * 버튼이 세션 안내문과 함께 있는지 보고, 그 안내문을 돌려준다(아니면 null).
   * 팝업(모달/레이어) 안의 버튼이면 그 팝업 안의 글만 본다. 페이지 다른 곳의 "로그아웃"
   * 링크 때문에 엉뚱한 버튼을 누르지 않도록, 팝업이 아닌 곳에서는 가까운 조상 몇 단계만 본다.
   * "확인" 같은 일반 버튼은 팝업 안이거나 작은 팝업창일 때만 대상이 된다.
   */
  function findSessionContext(el, kind) {
    const chain = [];
    let popupIndex = -1;
    for (
      let node = el;
      node && node !== document.body && node !== document.documentElement;
      node = node.parentElement
    ) {
      if (chain.length >= MAX_CONTEXT_DEPTH) break;
      chain.push(node);
      if (isPopupNode(node)) popupIndex = chain.length - 1;
    }

    let scope;
    if (popupIndex >= 0) scope = chain.slice(0, popupIndex + 1);
    else if (isSmallAuxWindow()) scope = chain.concat(document.body);
    else if (kind === 'confirm') return null;
    else scope = chain.slice(0, INLINE_CONTEXT_DEPTH);

    for (const node of scope) {
      const text = node.innerText || '';
      if (text.length > MAX_CONTEXT_LENGTH) break;
      if (R.isSessionContext(text, kind, cfg)) {
        // 로그인 입력 화면(비밀번호 칸)의 버튼은 누르지 않는다.
        if (hasVisiblePassword(node) || hasVisiblePassword(el.closest('form'))) return null;
        return text.replace(/\s+/g, ' ').trim();
      }
    }
    return null;
  }

  function hasVisiblePassword(root) {
    if (!root) return false;
    return Array.from(root.querySelectorAll('input[type="password"]')).some(isVisible);
  }

  /* 모달/레이어 팝업처럼 보이는 요소인지 */
  function isPopupNode(node) {
    if (node.localName === 'dialog' && node.open) return true;
    const role = node.getAttribute('role');
    if (role === 'dialog' || role === 'alertdialog' || node.getAttribute('aria-modal') === 'true')
      return true;
    if (POPUP_NAME.test(node.getAttribute('id') || '')) return true;
    if (Array.from(node.classList).some((name) => POPUP_NAME.test(name))) return true;
    const style = getComputedStyle(node);
    if (style.position === 'fixed') return true;
    return style.position === 'absolute' && Number(style.zIndex) >= 10;
  }

  /* window.open 으로 띄운 작은 팝업창이나 iframe 안 */
  function isSmallAuxWindow() {
    return isAuxWindow && (document.body.innerText || '').length <= MAX_CONTEXT_LENGTH;
  }

  function isVisible(el) {
    if (!el.isConnected) return false;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    // left:-9999px 처럼 화면 밖으로 치워 둔 요소 제외
    return rect.right + window.scrollX > 0 && rect.bottom + window.scrollY > 0;
  }

  function signature(target) {
    const context = R.compact(target.context).replace(/\d+/g, '').slice(0, 200);
    return target.kind + '|' + R.compact(target.label) + '|' + context;
  }

  /* 클릭은 페이지 문맥(page-hook.js)에서 한다. javascript: 링크가 CSP에 막히지 않게. */
  function clickInPage(el) {
    const token = Math.random().toString(36).slice(2);
    el.setAttribute(CLICK_ATTR, token);
    document.dispatchEvent(new CustomEvent(CLICK_EVENT, { detail: token }));
    if (el.getAttribute(CLICK_ATTR) === token) {
      // page-hook이 없는 프레임이면 여기서 직접 누른다.
      el.removeAttribute(CLICK_ATTR);
      el.click();
    }
  }

  function record(kind, text, context) {
    console.info('[Session Keeper]', kind, text);
    try {
      S.appendLog({
        host: topHost,
        kind,
        text,
        context: context ? context.slice(0, 120) : undefined,
      }).catch(() => {});
    } catch (e) {
      /* 확장 프로그램 연결이 끊긴 경우 */
    }
  }

  function getTopHost() {
    try {
      return window.top.location.hostname;
    } catch (e) {
      /* 다른 출처의 iframe */
    }
    const origins = location.ancestorOrigins;
    if (origins && origins.length) {
      try {
        return new URL(origins[origins.length - 1]).hostname;
      } catch (e) {
        /* ignore */
      }
    }
    return location.hostname;
  }
})();
