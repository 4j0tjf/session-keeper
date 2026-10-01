/*
 * Session Keeper - 페이지 문맥(MAIN world)에서 실행되는 부분.
 *
 *  1. window.alert / window.confirm 을 감싸서, 세션 연장·만료 대화상자면 띄우지 않고 바로 답한다.
 *     판단은 content.js가 한다. 취소 가능한 이벤트를 보내면 DOM 이벤트는 동기로 전달되므로,
 *     content.js가 preventDefault()로 "자동 처리"를 표시한 경우에만 자동으로 답한다.
 *  2. content.js가 고른 버튼을 페이지 문맥에서 클릭한다.
 *     (확장 프로그램 쪽에서 누르면 href="javascript:..." 링크가 CSP에 막힌다.)
 */
(function () {
  'use strict';

  const DIALOG_EVENT = 'session-keeper:dialog';
  const CLICK_EVENT = 'session-keeper:click';
  const CLICK_ATTR = 'data-session-keeper-click';

  const nativeAlert = window.alert;
  const nativeConfirm = window.confirm;

  function shouldAutoAnswer(kind, message) {
    const event = new CustomEvent(DIALOG_EVENT, {
      cancelable: true,
      detail: JSON.stringify({ kind, message: message === undefined ? '' : String(message) }),
    });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  }

  window.alert = function alert(message) {
    if (shouldAutoAnswer('alert', message)) return undefined;
    return nativeAlert.apply(this, arguments);
  };

  window.confirm = function confirm(message) {
    if (shouldAutoAnswer('confirm', message)) return true;
    return nativeConfirm.apply(this, arguments);
  };

  document.addEventListener(CLICK_EVENT, (event) => {
    const token = String(event.detail || '');
    for (const el of document.querySelectorAll('[' + CLICK_ATTR + ']')) {
      if (el.getAttribute(CLICK_ATTR) !== token) continue;
      el.removeAttribute(CLICK_ATTR);
      el.click();
    }
  });
})();
