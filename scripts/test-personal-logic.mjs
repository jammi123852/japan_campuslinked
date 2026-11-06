// 날짜·마감·출석·알림함 계산 테스트. 실행: node --import ./scripts/ts-resolve.mjs scripts/test-personal-logic.mjs
import assert from 'node:assert/strict';
import { academicNow, addDays, diffDays, isValidDateKey, monthGrid, shiftMonth, weekdayOf } from '../src/lib/dates.ts';
import { deadlineAlerts, dueState, overdueDeadlines, upcomingDeadlines, validateEvent } from '../src/features/schedule/scheduleLogic.ts';
import { summarizeAttendance, unrecordedDates } from '../src/lib/attendance.ts';
import { summarizeReviews } from '../src/features/lectures/reviewSummary.ts';
import { applyActivity, cursorFor, emptyInbox, markRead, normalizeInbox } from '../src/features/inbox/inboxLogic.ts';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`ok - ${name}`); };

// ---------------- 날짜
test('학사 기준 시간대(Asia/Tokyo): UTC 15:00 이후는 다음 날', () => {
  assert.deepEqual(academicNow(new Date('2026-10-30T14:59:00Z')), { date: '2026-10-30', minutes: 23 * 60 + 59 });
  assert.deepEqual(academicNow(new Date('2026-10-30T15:00:00Z')), { date: '2026-10-31', minutes: 0 });
  // 기기 시간대와 무관 (다른 시간대를 넘겨도 같은 순간이면 그 시간대 날짜)
  assert.equal(academicNow(new Date('2026-10-30T15:00:00Z'), 'America/Los_Angeles').date, '2026-10-30');
});
test('날짜 검증·더하기·차이·요일 (윤년, 월·연 경계)', () => {
  assert.ok(isValidDateKey('2028-02-29')); assert.ok(!isValidDateKey('2026-02-29')); assert.ok(!isValidDateKey('2026-13-01')); assert.ok(!isValidDateKey('2026-1-01'));
  assert.equal(addDays('2026-12-31', 1), '2027-01-01'); assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(diffDays('2026-12-30', '2027-01-02'), 3); assert.equal(diffDays('2026-11-01', '2026-10-30'), -2);
  assert.equal(weekdayOf('2026-10-30'), 4); // 금요일
  assert.equal(weekdayOf('2026-11-02'), 0); // 월요일
});
test('월 이동: 12월↔1월 연도 변경', () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2027, 1, -1), { year: 2026, month: 12 });
  assert.deepEqual(shiftMonth(2026, 10, -22), { year: 2024, month: 12 });
});
test('월간 달력 칸: 월요일 시작, 해당 월 날짜 모두 포함, 7칸 주', () => {
  for (const [y, m, days] of [[2026, 10, 31], [2026, 2, 28], [2028, 2, 29], [2026, 12, 31], [2027, 1, 31]]) {
    const weeks = monthGrid(y, m);
    assert.ok(weeks.every((w) => w.length === 7));
    const inMonth = weeks.flat().filter((c) => c.inMonth);
    assert.equal(inMonth.length, days);
    assert.equal(weekdayOf(weeks[0][0].key), 0);
    assert.equal(inMonth[0].day, 1);
  }
  assert.equal(monthGrid(2026, 10)[0][0].key, '2026-09-28'); // 10/1 은 목요일
  assert.equal(monthGrid(2026, 12).flat().at(-1).key, '2027-01-03'); // 연도 넘어가는 꼬리 칸
});

// ---------------- 마감
const ev = (o) => ({ id: 'e', title: 't', kind: 'assignment', date: '2026-10-30', time: null, course: null, memo: '', notify: true, done: false, createdAt: '2026-10-01', updatedAt: '2026-10-01', ...o });
const TODAY = '2026-10-30';
test('마감 상태: 날짜만 = 그날 끝까지 오늘, 시각 있으면 지나면 지남', () => {
  assert.deepEqual(dueState(ev({}), TODAY, 23 * 60 + 59), { state: 'today', days: 0 });
  assert.deepEqual(dueState(ev({ time: '13:00' }), TODAY, 12 * 60 + 59), { state: 'today', days: 0 });
  assert.equal(dueState(ev({ time: '13:00' }), TODAY, 13 * 60).state, 'overdue');
  assert.deepEqual(dueState(ev({ date: '2026-10-29' }), TODAY, 0), { state: 'overdue', days: -1 });
  assert.deepEqual(dueState(ev({ date: '2026-11-02' }), TODAY, 0), { state: 'upcoming', days: 3 });
  assert.equal(dueState(ev({ done: true }), TODAY, 0).state, 'done');
});
test('다가오는 마감: 완료·지난 것·개인 일정 제외, 날짜·시각 순', () => {
  const list = [
    ev({ id: 'later', date: '2026-11-05' }),
    ev({ id: 'done', date: '2026-10-31', done: true }),
    ev({ id: 'past', date: '2026-10-29' }),
    ev({ id: 'personal', kind: 'personal', date: '2026-10-31' }),
    ev({ id: 'exam', kind: 'exam', date: '2026-10-31', time: '09:00' }),
    ev({ id: 'today', date: TODAY }),
  ];
  assert.deepEqual(upcomingDeadlines(list, TODAY, 600).map((x) => x.event.id), ['today', 'exam', 'later']);
  assert.deepEqual(overdueDeadlines(list, TODAY, 600).map((e) => e.id), ['past']);
});
test('마감 알림: 알림 켠 과제·시험, 오늘·내일만, 완료·삭제·날짜 변경 반영', () => {
  const list = [
    ev({ id: 'a', date: '2026-10-31' }),
    ev({ id: 'b', date: TODAY }),
    ev({ id: 'c', date: '2026-11-01' }),
    ev({ id: 'off', date: TODAY, notify: false }),
    ev({ id: 'done', date: TODAY, done: true }),
    ev({ id: 'personal', kind: 'personal', date: TODAY }),
  ];
  assert.deepEqual(deadlineAlerts(list, TODAY, 600).map((x) => x.id).sort(), ['deadline:a:2026-10-31:D1', 'deadline:b:2026-10-30:D0']);
  // 날짜를 바꾸면 새 id (이전 읽음 상태가 새 마감에 넘어가지 않음)
  // 공지에서 넣은 일정: 날짜가 멀어도 바로 알림·마감에 뜬다. 일반 일정은 그대로
  const far = ev({ id: 'n', date: '2026-11-20', kind: 'personal', notify: false, sourceKey: 'notice:k:event:x' });
  assert.deepEqual(deadlineAlerts([far], TODAY, 600).map((x) => x.id), ['deadline:n:2026-11-20:SOON']);
  assert.deepEqual(upcomingDeadlines([far], TODAY, 600).map((x) => x.event.id), ['n']);
  const plainPersonal = ev({ id: 'p', date: '2026-11-20', kind: 'personal', notify: false });
  assert.deepEqual(deadlineAlerts([plainPersonal], TODAY, 600), []);
  assert.deepEqual(upcomingDeadlines([plainPersonal], TODAY, 600), []);
  assert.deepEqual(deadlineAlerts([ev({ id: 'f', date: '2026-11-20' })], TODAY, 600), []);
  assert.deepEqual(deadlineAlerts([{ ...far, kind: 'assignment' }], TODAY, 600), []);
  assert.deepEqual(deadlineAlerts([{ ...far, done: true }], TODAY, 600), []);
  assert.deepEqual(deadlineAlerts([ev({ id: 'a', date: TODAY })], TODAY, 600).map((x) => x.id), ['deadline:a:2026-10-30:D0']);
});
test('일정 입력 검증', () => {
  assert.deepEqual(validateEvent({ title: ' ', date: '', time: '', memo: '' }), { title: 'required', date: 'required' });
  assert.deepEqual(validateEvent({ title: 'x'.repeat(61), date: '2026-02-30', time: '25:00', memo: 'm'.repeat(501) }), { title: 'tooLong', date: 'invalid', time: 'invalid', memo: 'tooLong' });
  assert.deepEqual(validateEvent({ title: '리포트', date: '2026-11-01', time: '', memo: '' }), {});
});

// ---------------- 출석
const rec = (date, mark, courseKey = 'lec:lec-statistics', courseName = '통계학 입문') => ({ id: `${courseKey}:${date}`, courseKey, courseName, date, mark, source: { kind: 'user_input' } });
test('출석: 미기록은 결석이 아님 — 기록한 수업만 분모', () => {
  const [s] = summarizeAttendance([rec('2026-10-06', 'present'), rec('2026-10-13', 'absent')], []);
  assert.equal(s.recorded, 2); assert.equal(s.absent, 1); assert.equal(s.rate, 0.5);
});
test('출석: 기준이 없으면 위험 판정 안 함 (unknown)', () => {
  const [s] = summarizeAttendance([rec('2026-10-06', 'absent'), rec('2026-10-13', 'absent'), rec('2026-10-20', 'absent')], []);
  assert.equal(s.risk, 'unknown'); assert.equal(s.remainingAbsences, null);
  // 비율만 있고 총 횟수가 없어도 판정하지 않는다
  const [s2] = summarizeAttendance([rec('2026-10-06', 'absent')], [{ courseKey: 'lec:lec-statistics', courseName: 'x', minRate: 0.8, lateCountsAsAbsence: null, totalSessions: null }]);
  assert.equal(s2.risk, 'unknown');
});
test('출석: 과목별 기준이 있을 때만 참고 판정, 지각 환산은 설정한 경우만', () => {
  const recs = [rec('2026-10-06', 'late'), rec('2026-10-13', 'late'), rec('2026-10-20', 'absent')];
  const rule = { courseKey: 'lec:lec-statistics', courseName: 'x', minRate: 0.8, totalSessions: 15, lateCountsAsAbsence: null };
  const [noConv] = summarizeAttendance(recs, [rule]);
  assert.equal(noConv.absent, 1); assert.equal(noConv.remainingAbsences, 2); assert.equal(noConv.risk, 'ok');
  const [conv] = summarizeAttendance(recs, [{ ...rule, lateCountsAsAbsence: 2 }]);
  assert.equal(conv.absent, 2); assert.equal(conv.remainingAbsences, 1); assert.equal(conv.risk, 'caution');
  // 다른 과목의 기준은 적용되지 않는다
  const [other] = summarizeAttendance(recs, [{ ...rule, courseKey: 'tt:other' }]);
  assert.equal(other.risk, 'unknown');
});
test('출석: 과목명이 같아도 키가 다르면 다른 과목, 이름이 바뀌어도 같은 키면 한 과목', () => {
  const list = [rec('2026-10-06', 'present', 'tt:a', '세미나'), rec('2026-10-06', 'absent', 'tt:b', '세미나'), rec('2026-10-13', 'present', 'tt:a', '세미나 II')];
  const out = summarizeAttendance(list, []);
  assert.equal(out.length, 2);
  const a = out.find((x) => x.key === 'tt:a');
  assert.equal(a.recorded, 2); assert.equal(a.courseName, '세미나 II');
});
test('미기록 날짜: 수업 요일 중 기록 없는 지난 날만', () => {
  // 화요일(1) 수업, 10/6·10/13·10/20·10/27 중 10/13 기록
  assert.deepEqual(unrecordedDates([1], ['2026-10-13'], '2026-10-06', '2026-10-30'), ['2026-10-06', '2026-10-20', '2026-10-27']);
  assert.deepEqual(unrecordedDates([1], [], '2026-10-30', '2026-10-06'), []);
});

// ---------------- 알림함
const act = (comments, reviews, cursor = { comment: 10, review: 5 }) => ({ cursor, comments, reviews });
const BASE = 'https://a.example';
test('알림함: 같은 이벤트 중복 없음, 최신순', () => {
  let s = emptyInbox();
  const r = act([{ id: 7, postId: 1, postTitle: 'Q', createdAt: '2026-10-30T01:00:00Z' }], [{ id: 3, lectureId: 'lec-x', createdAt: '2026-10-30T02:00:00Z' }]);
  s = applyActivity(s, r, BASE, 'now');
  s = applyActivity(s, r, BASE, 'now');
  assert.deepEqual(s.items.map((i) => i.id), ['review:3', 'answer:7']);
  assert.deepEqual(s.cursor, { comment: 10, review: 5 });
});
test('알림함: 꺼 둔 종류는 쌓지 않음, 읽음 유지, 서버가 바뀌면 기준점 다시', () => {
  let s = emptyInbox();
  s = { ...s, settings: { ...s.settings, review: false } };
  s = applyActivity(s, act([], [{ id: 3, lectureId: 'lec-x', createdAt: 't' }]), BASE, 'now');
  assert.equal(s.items.length, 0);
  s = markRead(s, ['answer:7', 'answer:7']);
  assert.deepEqual(s.readIds, ['answer:7']);
  assert.notEqual(cursorFor(s, BASE), null);
  assert.equal(cursorFor(s, 'https://b.example'), null);
});
test('알림함: 저장값이 비어 있거나 이전 형식이어도 기본값으로 복구', () => {
  assert.deepEqual(normalizeInbox(null).settings, { answer: true, review: true, deadline: true });
  const n = normalizeInbox({ items: 'bad', settings: { review: false } });
  assert.deepEqual(n.items, []); assert.equal(n.settings.review, false); assert.equal(n.settings.answer, true);
});

// ---------------- 후기 요약
test('후기 요약: 작성된 후기만, 없으면 null, 평균·최빈값', () => {
  assert.equal(summarizeReviews([]), null);
  const rv = (o) => ({ id: 1, lectureId: 'l', takenYear: 2025, grade: 1, attendance: 'online', evaluation: 'exam', workload: 2, difficulty: 3, body: 'x', createdAt: '', updatedAt: '', mine: false, ...o });
  const s = summarizeReviews([rv({ workload: 2, difficulty: 4 }), rv({ workload: 5, difficulty: 4, attendance: 'in_person' }), rv({ workload: 4, difficulty: 1, attendance: 'in_person', evaluation: 'report' })]);
  assert.deepEqual(s, { count: 3, workload: 3.7, difficulty: 3, attendance: 'in_person', evaluation: 'exam' });
});

console.log(`\n${passed} passed`);
