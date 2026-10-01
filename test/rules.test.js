'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/shared/rules.js');

const cfg = R.withDefaults({});

test('연장 버튼 문구를 알아본다', () => {
  for (const label of [
    '연장',
    '로그인 연장',
    '로그인연장',
    '시간 연장하기',
    '세션 유지',
    'Stay signed in',
    'Extend session',
  ]) {
    assert.equal(R.classifyLabel(label, cfg), 'extend', label);
  }
});

test('일반 확인 버튼은 정확히 일치할 때만', () => {
  for (const label of ['확인', '확 인', 'OK', 'Yes', '예']) {
    assert.equal(R.classifyLabel(label, cfg), 'confirm', label);
  }
  for (const label of ['확인서 발급', 'Okta 로그인', '예약']) {
    assert.equal(R.classifyLabel(label, cfg), null, label);
  }
});

test('로그아웃·취소·"연장 안함" 같은 버튼은 누르지 않는다', () => {
  for (const label of [
    '로그아웃',
    '연장 안함',
    '연장하지 않음',
    '취소',
    '닫기',
    'Sign out',
    'Log out',
    "Don't extend",
    'Cancel',
  ]) {
    assert.equal(R.classifyLabel(label, cfg), null, label);
  }
});

test('영어 단어는 단어 경계를 본다', () => {
  assert.equal(R.containsKeyword('Designing a sign in page', 'sign in'), true);
  assert.equal(R.containsKeyword('designing', 'sign in'), false);
  assert.equal(R.containsKeyword('Your session expired', 'expire'), true);
  assert.equal(R.containsKeyword('bookkeeping', 'keep'), false);
});

test('세션 문맥 판단', () => {
  assert.equal(R.isSessionContext('자동 로그아웃까지 남은 시간 04:59 연장 로그아웃', 'extend', cfg), true);
  assert.equal(R.isSessionContext('계약 기간을 1년 연장하시겠습니까? 연장', 'extend', cfg), false);
  assert.equal(R.isSessionContext('세션이 만료되었습니다. 다시 로그인해 주세요. 확인', 'confirm', cfg), true);
  // 세션 단어만 있고 만료/연장 안내가 아니면 "확인"은 누르지 않는다.
  assert.equal(R.isSessionContext('로그아웃 하시겠습니까? 확인 취소', 'confirm', cfg), false);
  assert.equal(R.isSessionContext('저장되었습니다. 확인', 'confirm', cfg), false);
});

test('confirm(): 세션 + 연장 의도가 모두 있어야 자동 승인', () => {
  const yes = [
    '로그인 유지 시간이 5분 남았습니다. 연장하시겠습니까?',
    '세션이 곧 만료됩니다. 계속 이용하시겠습니까?',
    'Your session is about to expire. Do you want to stay signed in?',
  ];
  const no = ['정말 삭제하시겠습니까?', '로그아웃 하시겠습니까?', '계약을 연장하시겠습니까?', ''];
  for (const message of yes) assert.equal(R.shouldAutoAnswerDialog('confirm', message, cfg), true, message);
  for (const message of no) assert.equal(R.shouldAutoAnswerDialog('confirm', message, cfg), false, message);
});

test('alert(): 세션 만료/연장 안내만 자동으로 닫는다', () => {
  const yes = [
    '로그인 시간이 연장되었습니다.',
    '세션이 만료되었습니다. 다시 로그인하세요.',
    'Your session has timed out.',
  ];
  const no = [
    '아이디 또는 비밀번호가 틀렸습니다.',
    '로그인 후 이용해 주세요.',
    'Request timed out.',
    '저장되었습니다.',
  ];
  for (const message of yes) assert.equal(R.shouldAutoAnswerDialog('alert', message, cfg), true, message);
  for (const message of no) assert.equal(R.shouldAutoAnswerDialog('alert', message, cfg), false, message);
});

test('설정을 받기 전(null)에는 대화상자를 건드리지 않는다', () => {
  assert.equal(R.shouldAutoAnswerDialog('confirm', '로그인 시간을 연장하시겠습니까?', null), false);
});

test('호스트 매칭은 하위 도메인을 포함한다', () => {
  assert.equal(R.hostMatches('www.example.com', 'example.com'), true);
  assert.equal(R.hostMatches('example.com', '*.example.com'), true);
  assert.equal(R.hostMatches('badexample.com', 'example.com'), false);
  assert.equal(R.hostMatches('', 'example.com'), false);
});

test('사이트별 규칙 파싱', () => {
  const rules = R.parseCustomRules(
    '# 주석\n\nintra.example.com  #btnExtend\nerp.example.co.kr .layer_session a.btn\nbroken-line',
  );
  assert.deepEqual(rules, [
    { host: 'intra.example.com', selector: '#btnExtend' },
    { host: 'erp.example.co.kr', selector: '.layer_session a.btn' },
  ]);
});

test('저장값은 타입이 맞을 때만 기본값을 덮어쓴다', () => {
  const merged = R.withDefaults({ enabled: false, extendLabels: ['연장', ' '], confirmLabels: 'oops' });
  assert.equal(merged.enabled, false);
  assert.deepEqual(merged.extendLabels, ['연장']);
  assert.deepEqual(merged.confirmLabels, R.DEFAULTS.confirmLabels);
  assert.equal(R.isActiveOn('a.com', R.withDefaults({ disabledSites: ['a.com'] })), false);
  assert.equal(R.isActiveOn('b.com', R.withDefaults({ disabledSites: ['a.com'] })), true);
});
