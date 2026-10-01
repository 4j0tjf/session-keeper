/*
 * Session Keeper - 기본 설정값과 문구 판별 로직.
 *
 * 브라우저 API를 쓰지 않는 순수 함수만 둔다. 콘텐츠 스크립트,
 * 팝업·옵션 페이지에서는 classic script로, 테스트에서는 require()로 불러온다.
 */
(function (root) {
  'use strict';

  const DEFAULTS = Object.freeze({
    enabled: true,
    // 자동 처리를 끌 사이트(호스트명). 하위 도메인까지 포함한다.
    disabledSites: [],
    // window.alert / window.confirm 으로 뜨는 브라우저 기본 대화상자도 처리할지
    handleNativeDialogs: true,
    // 팝업 내용이 로그인 세션에 관한 것인지 판단하는 단어
    sessionKeywords: [
      '로그인',
      '로그아웃',
      '세션',
      '접속',
      'session',
      'login',
      'log in',
      'logged in',
      'sign in',
      'signed in',
      'timeout',
      'time out',
    ],
    // 연장 의도를 나타내는 단어
    extendKeywords: [
      '연장',
      '유지',
      '계속',
      'extend',
      'stay',
      'keep',
      'continue',
      'still there',
      'still here',
    ],
    // 만료/종료 안내를 나타내는 단어
    expiryKeywords: ['만료', '종료', '남은 시간', '남은시간', 'expire', 'timed out', 'inactiv'],
    // 세션 관련 팝업 안에서 이 문구가 들어간 버튼은 누른다.
    extendLabels: [
      '연장',
      '로그인 유지',
      '세션 유지',
      '계속 사용',
      '계속 이용',
      '계속 접속',
      'extend',
      'stay signed in',
      'stay logged in',
      'keep me signed in',
      'keep me logged in',
      'keep session',
      'continue session',
      "i'm still here",
      'still here',
    ],
    // 세션 만료/연장 안내 팝업 안에서만, 문구가 정확히 이것인 버튼을 누른다.
    confirmLabels: ['확인', '예', '네', '계속', 'ok', 'okay', 'yes', 'continue'],
    // 이 문구가 들어간 버튼은 절대 누르지 않는다.
    excludeLabels: [
      '로그아웃',
      '취소',
      '닫기',
      '아니',
      '안함',
      '안 함',
      '하지 않',
      '않음',
      'logout',
      'log out',
      'sign out',
      'signout',
      'cancel',
      'close',
      "don't",
      'do not',
      'not now',
      'no thanks',
    ],
    // 사이트별 직접 지정 규칙. 한 줄에 "호스트 CSS선택자", #으로 시작하면 주석.
    customRules: '',
  });

  const HANGUL = /[ㄱ-ㆎ가-힣]/;

  function normalize(text) {
    return String(text == null ? '' : text)
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function compact(text) {
    return String(text == null ? '' : text)
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /*
   * 한글 단어는 띄어쓰기 차이("로그인 연장"/"로그인연장")를 무시하고 비교한다.
   * 영어 단어는 단어 앞 경계를 요구해서 "sign in"이 "designing"에 걸리지 않게 한다.
   */
  function containsKeyword(text, keyword) {
    const kw = normalize(keyword);
    if (!kw) return false;
    if (HANGUL.test(kw)) return compact(text).includes(compact(kw));
    return new RegExp('(^|[^a-z0-9])' + escapeRegExp(kw)).test(normalize(text));
  }

  function containsAny(text, keywords) {
    return (keywords || []).some((kw) => containsKeyword(text, kw));
  }

  /*
   * 버튼 문구 분류.
   *  'extend'  - 연장 버튼 (세션 문맥이면 누름)
   *  'confirm' - 확인/예 같은 일반 버튼 (세션 만료·연장 안내 팝업 안일 때만 누름)
   *  null      - 누르지 않음
   */
  function classifyLabel(label, cfg) {
    const text = normalize(label);
    if (!text || containsAny(text, cfg.excludeLabels)) return null;
    if (containsAny(text, cfg.extendLabels)) return 'extend';
    const c = compact(text);
    if ((cfg.confirmLabels || []).some((kw) => compact(kw) === c)) return 'confirm';
    return null;
  }

  /* 버튼 주변 글이 해당 종류의 버튼을 누를 만한 세션 팝업 내용인지 */
  function isSessionContext(text, kind, cfg) {
    if (!containsAny(text, cfg.sessionKeywords)) return false;
    if (kind === 'confirm') {
      return containsAny(text, cfg.expiryKeywords) || containsAny(text, cfg.extendKeywords);
    }
    return true;
  }

  /*
   * 브라우저 기본 대화상자를 자동으로 처리할지.
   *  confirm: 세션 + 연장 의도가 모두 있을 때만 '확인'(true)으로 답한다.
   *  alert:   세션 + (만료 또는 연장) 안내일 때 바로 닫는다.
   */
  function shouldAutoAnswerDialog(kind, message, cfg) {
    if (!cfg || !containsAny(message, cfg.sessionKeywords)) return false;
    if (kind === 'confirm') return containsAny(message, cfg.extendKeywords);
    if (kind === 'alert') {
      return containsAny(message, cfg.expiryKeywords) || containsAny(message, cfg.extendKeywords);
    }
    return false;
  }

  function hostMatches(host, pattern) {
    const h = normalize(host).replace(/\.$/, '');
    const p = normalize(pattern).replace(/^\*\./, '').replace(/^\./, '').replace(/\.$/, '');
    if (!h || !p) return false;
    return h === p || h.endsWith('.' + p);
  }

  function parseCustomRules(text) {
    const rules = [];
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^(\S+)\s+(.+)$/);
      if (m) rules.push({ host: m[1], selector: m[2].trim() });
    }
    return rules;
  }

  /* 저장된 값 중 타입이 맞는 것만 기본값 위에 덮어쓴다. */
  function withDefaults(stored) {
    const cfg = {};
    for (const [key, def] of Object.entries(DEFAULTS)) {
      const value = stored ? stored[key] : undefined;
      if (Array.isArray(def)) {
        cfg[key] = Array.isArray(value) ? value.map(String).filter((s) => s.trim()) : def.slice();
      } else {
        cfg[key] = typeof value === typeof def ? value : def;
      }
    }
    return cfg;
  }

  function isActiveOn(host, cfg) {
    return !!cfg.enabled && !(cfg.disabledSites || []).some((site) => hostMatches(host, site));
  }

  const api = {
    DEFAULTS,
    normalize,
    compact,
    containsKeyword,
    containsAny,
    classifyLabel,
    isSessionContext,
    shouldAutoAnswerDialog,
    hostMatches,
    parseCustomRules,
    withDefaults,
    isActiveOn,
  };

  root.SessionKeeperRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
