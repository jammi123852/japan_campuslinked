// 도우미·공지 날짜·후기 집계 순수 로직 테스트. 실행: node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-assistant.mjs
import assert from 'node:assert/strict';
import { normalizeNoticeDates } from '../server/noticeDates.ts';
import { computeDigest, isCourseRelevantPost } from '../server/summaries.ts';
import { parseConditions, localRoute, conditionsFromCall, planFromConditions, prefScore, scholarshipView } from '../src/features/assistant/assistantLogic.ts';
import { canSaveDate, noticeEvent, noticeText, savePolicy } from '../src/features/notice/noticeLogic.ts';
import { filterCertSources } from '../server/careerCerts.ts';
import { gradeAt, normalizeCert, planCerts } from '../src/features/career/certLogic.ts';
import { detectContentLang } from '../src/lib/contentLang.ts';
import { matchOfficialCourse, splitSectionFromName } from '../src/features/timetableImport/officialMatch.ts';
import { upcomingDeadlines, deadlineAlerts } from '../src/features/schedule/scheduleLogic.ts';

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`ok - ${name}`); };

const legacy = [
  { kind: 'deadline', label: '提出日', date: '2026-12-24', time: '13:00', rawText: '令和8年（2026年）12月24日（木）', evidence: 'x' },
  { kind: 'other', label: '受付時間', date: '2026-12-24', time: '13:00', rawText: '13:00～17:00', evidence: '【受付時間】13:00～17:00' },
  { kind: 'other', label: 'N702教室への入室締切', date: '2026-12-24', time: '16:00', rawText: '16:00で締め切る', evidence: '入室は16:00で締め切る' },
];
test('옛 결과: 접수 13~17시를 마감 13시로 두지 않는다', () => {
  const [d, r, e] = normalizeNoticeDates(legacy);
  assert.equal(r.kind, 'reception');
  assert.deepEqual([r.startTime, r.endTime], ['13:00', '17:00']);
  assert.equal(e.kind, 'entry_close');
  assert.equal(e.time, '16:00');
  assert.equal(d.kind, 'deadline');
  assert.equal(d.time, '17:00');
});
test('범위 시각을 가진 마감은 접수로 나눈다 (라벨에 접수 글자가 없어도)', () => {
  const [d] = normalizeNoticeDates([{ kind: 'deadline', label: '提出', date: '2026-12-24', time: '13:00', rawText: '13:00～17:00', evidence: '' }]);
  assert.deepEqual([d.kind, d.startTime, d.endTime], ['reception', '13:00', '17:00']);
});
test('날짜 정리는 다시 적용해도 같다', () => {
  const once = normalizeNoticeDates(legacy);
  assert.deepEqual(normalizeNoticeDates(once), once);
});
test('원문에 적힌 마감 시각은 바꾸지 않는다', () => {
  const [d] = normalizeNoticeDates([{ kind: 'deadline', label: '締切', date: '2026-11-27', time: '17:00', rawText: '11月27日 17:00', evidence: '' }, { kind: 'reception', label: '受付', date: '2026-11-27', time: '09:00', startTime: '09:00', endTime: '12:00', rawText: '09:00～12:00', evidence: '' }]);
  assert.equal(d.time, '17:00');
});
test('대상 정책: 제외는 참고용 선택 때만, 미확인은 알림 없이', () => {
  assert.deepEqual(savePolicy('target', false), { allowed: true, reference: false, notify: true });
  assert.equal(savePolicy('excluded', false).allowed, false);
  assert.deepEqual(savePolicy('excluded', true), { allowed: true, reference: true, notify: false });
  assert.deepEqual(savePolicy('needs_check', false), { allowed: true, reference: true, notify: false });
});
test('참고용 일정은 마감·알림에 들어가지 않는다', () => {
  const d = normalizeNoticeDates(legacy)[0];
  const ref = noticeEvent(d, 'k', '제출일', savePolicy('excluded', true), 'a', '2026-11-02T00:00:00Z');
  const tgt = noticeEvent(d, 'k', '제출일', savePolicy('target', false), 'b', '2026-11-02T00:00:00Z');
  assert.equal(ref.kind, 'personal');
  assert.equal(upcomingDeadlines([ref], '2026-11-02', 0).length, 0);
  assert.equal(deadlineAlerts([ref], '2026-11-02', 0).length, 0);
  assert.equal(upcomingDeadlines([tgt], '2026-11-02', 0).length, 1);
});
test('언어: 언어별 내용 우선, 옛 결과는 저장값', () => {
  const r = { summaryKo: 'k', summaryJa: 'j', audience: 'old', audienceReason: 'old', tasks: ['old'], materials: [], howTo: '', uncertain: [], ko: { audience: '한', audienceReason: '이유', tasks: ['할일'], materials: [], howTo: '', uncertain: [] }, ja: { audience: '日', audienceReason: '理由', tasks: ['やること'], materials: [], howTo: '', uncertain: [] } };
  assert.equal(noticeText(r, 'ja').tasks[0], 'やること');
  assert.equal(noticeText(r, 'ko').audience, '한');
  assert.equal(noticeText({ ...r, ko: undefined }, 'ko').tasks[0], 'old');
  assert.equal(canSaveDate({ kind: 'posted', date: '2026-01-01' }), false);
});
test('조건 해석: 금요일 제외·필수 유지·1교시·학점', () => {
  const c = parseConditions('금요일은 비우고 필수과목은 유지해 줘. 1교시는 피하고 공강 최소, 12학점');
  assert.deepEqual(c.excludeWeekdays, [4]);
  assert.equal(c.keepRequired, true);
  assert.deepEqual(c.avoidPeriods, [1]);
  assert.equal(c.creditGoal, 12);
  assert.equal(c.minimizeGaps, true);
  const j = parseConditions('金曜日は空けて必修は残してください');
  assert.deepEqual(j.excludeWeekdays, [4]);
  assert.equal(j.keepRequired, true);
});
test('조건 인자 검증: 범위 밖 값과 모르는 선호는 버린다', () => {
  const c = conditionsFromCall({ excludeWeekdays: [4, 9, -1], avoidPeriods: [0, 2, 99], creditGoal: 500, prefs: ['lowWorkload', 'rm -rf'] });
  assert.deepEqual(c.excludeWeekdays, [4]);
  assert.deepEqual(c.avoidPeriods, [2]);
  assert.equal(c.creditGoal, null);
  assert.deepEqual(c.prefs, ['lowWorkload']);
});
test('AI 없을 때: 지원 범위 밖은 unsupported, 지어내지 않는다', () => {
  assert.equal(localRoute('오늘 날씨 어때').kind, 'unsupported');
  assert.equal(localRoute('파이썬 코드 짜줘').kind, 'unsupported');
  assert.equal(localRoute('장학금 있어?').calls[0].tool, 'get_scholarships');
  assert.equal(localRoute('졸업하려면 어떤 학점이 부족해?').calls[0].tool, 'get_graduation');
  assert.equal(localRoute('금요일은 비우고 필수과목은 유지해 줘').calls[0].tool, 'plan_courses');
  assert.equal(localRoute('卒業まで何の単位が足りませんか').calls[0].tool, 'get_graduation');
});
const rv = (id, w, d, body, demo = 0) => ({ id, workload: w, difficulty: d, evaluation: 'mixed', body, taken_year: 2025, updated_at: `t${id}`, is_demo: demo });
test('집계: 실제 모드에 데모를 섞지 않고, 데모 모드는 구분해 센다', () => {
  const rows = [rv(1, 2, 2, '과제가 적어요 수업 좋아요 정말로 추천합니다 좋아요', 0), rv(2, 5, 5, '과제가 많았습니다. 데모입니다 데모입니다 데모 시험', 1)];
  const real = computeDigest('x', rows, [], false);
  assert.deepEqual([real.count, real.realCount, real.demoCount], [1, 1, 1]);
  const demo = computeDigest('x', rows, [], true);
  assert.equal(demo.count, 2);
  assert.equal(demo.workload.mixed, true);
  assert.notEqual(real.sourceHash, demo.sourceHash);
  assert.equal(real.smallSample, true);
});
test('요약 무효화: 수정·삭제하면 해시가 바뀐다', () => {
  const a = computeDigest('x', [rv(1, 2, 2, '수업 내용입니다 수업 내용입니다 수업')], [], false);
  const edited = computeDigest('x', [{ ...rv(1, 2, 2, '바뀐 수업 내용입니다 바뀐 수업 내용입니다'), updated_at: 't9' }], [], false);
  const removed = computeDigest('x', [], [], false);
  assert.notEqual(a.sourceHash, edited.sourceHash);
  assert.notEqual(a.sourceHash, removed.sourceHash);
});
test('관련성: 일상 글은 근거에서 빠지고 수강 글은 남는다', () => {
  assert.equal(isCourseRelevantPost({ category: 'campus_life', title: '오늘 너무 피곤하다', body: '수업 많아서' }), false);
  assert.equal(isCourseRelevantPost({ category: 'class_question', title: '배고파요', body: '점심 뭐 먹지' }), false);
  assert.equal(isCourseRelevantPost({ category: 'class_question', title: '소테스트', body: '결석하면 볼 수 있나요' }), true);
  const d = computeDigest('x', [], [{ id: 1, category: 'campus_life', title: '피곤', body: '피곤', created_at: 't' }, { id: 2, category: 'textbook', title: '교재', body: '교재 필요?', created_at: 't' }], false);
  assert.deepEqual(d.evidencePostIds, [2]);
  assert.equal(d.excludedPostCount, 1);
});
test('짧은 글에서 측면을 추정하지 않고, 없다는 언급을 구분한다', () => {
  const d = computeDigest('x', [rv(1, 3, 3, '무난했어요'), rv(2, 3, 3, '발표는 없었고 과제는 거의 없어요 수업만 들으면 됩니다')], [], false);
  assert.equal(d.informativeCount, 1);
  assert.equal(d.aspects.presentation.denied, 1);
  assert.equal(d.aspects.presentation.mentioned, 0);
  assert.ok(d.missing.includes('project'));
});
const course = (id, name, track, mark, meetings, credits = 2) => ({ id, name, track, mark, meetings, credits, section: '101', term: '後期', quarters: ['4Q'], cohort: '', cohortRanges: null, rooms: [], classTag: null, note: null, source: { id: 'F' }, review: [], instructor: null, year: 1, depts: ['RS'], applies: [] });
const input = (over = {}) => ({
  od: { courses: [course('o1', '필수A', 'major', 'required', [{ weekday: 4, period: 1 }]), course('o2', '선택B', 'major', 'elective', [{ weekday: 0, period: 2 }]), course('o3', '선택C', 'major', 'elective', [{ weekday: 1, period: 2 }]), course('o4', '교직D', 'teaching', 'required', [{ weekday: 2, period: 2 }])], calendar: { year: 2026 }, periods: { items: [1, 2, 3, 4, 5].map((p) => ({ period: p, start: `${8 + p}:00`.padStart(5, '0'), end: `${8 + p}:50`.padStart(5, '0') })) } },
  target: { year: 2026, quarter: '4Q' }, records: [], timetable: [], admissionYear: 2024, grade: 3, dept: null, rule: null, digests: {}, shortCategories: [], ...over,
});
test('계획: 조건을 바꾸면 결과가 달라지고, 필수 충돌과 완화안을 낸다', () => {
  const base = { excludeWeekdays: [], avoidPeriods: [], keepRequired: true, needOnly: false, creditGoal: null, minimizeGaps: false, fewerDays: false, lunch: false, prefs: [] };
  const ok = planFromConditions(input(), base);
  assert.ok(ok.plans[0].courseIds.includes('o1'));
  assert.equal(ok.conflicts.length, 0);
  assert.ok(!ok.plans.flatMap((p) => p.courseIds).includes('o4'), '교직 과목은 넣지 않는다');
  const fri = planFromConditions(input(), { ...base, excludeWeekdays: [4] });
  assert.deepEqual(fri.conflicts.map((c) => [c.name, c.reason]), [['필수A', 'blocked']]);
  assert.ok(!fri.plans.flatMap((p) => p.courseIds).includes('o1'));
  assert.ok(fri.relax.some((r) => r.key === 'day' && r.day === 4 && r.resolves === 1));
  const mon = planFromConditions(input(), { ...base, excludeWeekdays: [0] });
  assert.ok(!mon.plans.flatMap((p) => p.courseIds).includes('o2'));
});
test('전공이 아닌 필수 표시는 필수 유지로 넣지 않는다', () => {
  const i = input();
  i.od.courses.push(course('o5', '교양필수표시', 'kiso', 'required', [{ weekday: 3, period: 3 }]));
  const o = planFromConditions(i, { excludeWeekdays: [3], avoidPeriods: [], keepRequired: true, needOnly: false, creditGoal: null, minimizeGaps: false, fewerDays: false, lunch: false, prefs: [] });
  assert.ok(!o.conflicts.some((c) => c.courseId === 'o5'));
  assert.ok(!o.forcedIds.includes('o5'));
});
test('후기 선호는 필수 조건을 넘지 못한다', () => {
  const digests = { o1: { count: 2, workload: { avg: 5, mixed: false }, aspects: {} }, o2: { count: 2, workload: { avg: 1, mixed: false }, aspects: {} } };
  const c = { excludeWeekdays: [0], avoidPeriods: [], keepRequired: false, needOnly: false, creditGoal: 2, minimizeGaps: false, fewerDays: false, lunch: false, prefs: ['lowWorkload'] };
  const o = planFromConditions(input({ digests }), c);
  assert.ok(!o.plans.flatMap((p) => p.courseIds).includes('o2'), '월요일을 비우면 후기가 좋아도 넣지 않는다');
  assert.ok(prefScore({ course: { id: 'o2' } }, ['lowWorkload'], digests) > prefScore({ course: { id: 'o1' } }, ['lowWorkload'], digests));
  assert.equal(prefScore({ course: { id: 'zz' } }, ['lowWorkload'], digests), 0);
});
test('장학금: 마감·모집 중·미확인을 나눈다', () => {
  const s = (id, deadline) => ({ id, deadline, checks: [{ key: 'undergrad', expect: true, cond: 0 }], judgedBySchool: [0] });
  const v = scholarshipView([s('a', '2026-01-14T16:00'), s('b', '2026-12-01T16:00'), s('c', '')], {}, '2026-11-02', 0);
  assert.deepEqual(v.map((x) => x.recruit), ['closed', 'open', 'unknown']);
  assert.equal(v[1].verdict, 'check');
  assert.equal(scholarshipView([s('b', '2026-12-01T16:00')], { undergrad: false }, '2026-11-02', 0)[0].verdict, 'not');
});
test('언어 판별', () => {
  assert.equal(detectContentLang('오늘 수업'), 'ko');
  assert.equal(detectContentLang('今日の授業'), 'ja');
  assert.equal(detectContentLang('情報科学'), 'ja');
  assert.equal(detectContentLang('ABC 123'), null);
});
test('시간표 대조: 분반 표기 분리, 애매하면 연결 안 함', () => {
  assert.deepEqual(splitSectionFromName('情報科学実習Ⅱ([102])'), { name: '情報科学実習Ⅱ', section: '102' });
  const cs = [{ id: 'a', name: '情報', section: '101', meetings: [{ weekday: 2, period: 1 }] }, { id: 'b', name: '情報', section: '102', meetings: [{ weekday: 2, period: 1 }] }];
  assert.equal(matchOfficialCourse(cs, { name: '情報([102])', section: '102', weekday: 2, period: 1 }), 'b');
  assert.equal(matchOfficialCourse(cs, { name: '情報', weekday: 2, period: 1 }), null);
  assert.equal(matchOfficialCourse(cs, { name: '없는 과목', weekday: 2, period: 1 }), null);
});
const cert = (o) => normalizeCert({ name: 'C', nameKo: 'C', whyKo: '', whyJa: '', difficulty: 2, hoursMin: 40, hoursMax: 60, hoursBasis: 'estimate', yearRound: false, examDates: [], ...o });
test('자격증 시기: 준비 기간 뒤 가장 빠른 시험일, 공부 시간을 바꾸면 달라진다', () => {
  const dates = [{ label: 'A', examDate: '2026-11-10', applyEnd: '', sourceUrl: 'https://x' }, { label: 'B', examDate: '2027-02-10', applyEnd: '', sourceUrl: 'https://x' }, { label: 'C', examDate: '2027-07-10', applyEnd: '', sourceUrl: 'https://x' }];
  const c = cert({ examDates: dates });
  const slow = planCerts([c], { today: '2026-11-02', grade: 3, weeklyHours: 3 })[0];
  const fast = planCerts([c], { today: '2026-11-02', grade: 3, weeklyHours: 15 })[0];
  assert.deepEqual([fast.hours, fast.weeks, fast.target, fast.timing, fast.grade], [50, 4, '2027-02-10', 'dated', 3]);
  assert.deepEqual([slow.weeks, slow.target, slow.grade], [17, '2027-07-10', 4]);
});
test('자격증 시기: 쉬운 것부터 순서대로, 앞 시험 뒤에 다음 준비', () => {
  const easy = cert({ name: 'E', difficulty: 1, hoursMin: 10, hoursMax: 10, yearRound: true });
  const hard = cert({ name: 'H', difficulty: 5, hoursMin: 100, hoursMax: 100, examDates: [{ label: '', examDate: '2027-04-18', applyEnd: '', sourceUrl: 'https://x' }] });
  const r = planCerts([hard, easy], { today: '2026-11-02', grade: 2, weeklyHours: 5 });
  assert.deepEqual(r.map((x) => [x.cert.name, x.order, x.timing]), [['E', 1, 'year_round'], ['H', 2, 'dated']]);
  assert.equal(r[0].target, '2026-11-16');
  assert.equal(r[1].startBy, '2026-11-16');
  assert.equal(r[1].grade, 3);
  assert.equal(r[1].beforeJobHunt, true);
});
test('자격증 시기: 확인된 시험일이 없으면 예상만, 신청 마감이 지난 회차는 뺀다, 졸업 뒤는 표시', () => {
  const none = planCerts([cert({})], { today: '2026-11-02', grade: 3, weeklyHours: 5 })[0];
  assert.deepEqual([none.timing, none.target, none.sourceUrl], ['estimated', '2027-04-01', '']);
  const closed = planCerts([cert({ hoursMin: 5, hoursMax: 5, examDates: [{ label: '', examDate: '2026-12-01', applyEnd: '2026-10-01', sourceUrl: 'https://x' }] })], { today: '2026-11-02', grade: 3, weeklyHours: 5 })[0];
  assert.equal(closed.timing, 'estimated');
  const late = planCerts([cert({ hoursMin: 400, hoursMax: 400 })], { today: '2026-11-02', grade: 4, weeklyHours: 3 })[0];
  assert.equal(late.timing, 'after_graduation');
  assert.equal(gradeAt('2027-03-31', '2026-11-02', 2), 2);
  assert.equal(gradeAt('2027-04-01', '2026-11-02', 2), 3);
});
test('자격증 시기: 일정 미공지면 시험 있는 달로 제안, 공부는 이어서 시작', () => {
  const r = planCerts([cert({ typicalMonths: [3, 6, 11] })], { today: '2026-11-02', grade: 3, weeklyHours: 5 })[0];
  assert.deepEqual([r.timing, r.target], ['estimated', '2027-03-01']);
  const two = planCerts([cert({ name: 'A', difficulty: 1, hoursMin: 10, hoursMax: 10, examDates: [{ label: '', examDate: '2027-06-01', applyEnd: '', sourceUrl: 'https://x' }] }), cert({ name: 'B', difficulty: 2, hoursMin: 10, hoursMax: 10, yearRound: true })], { today: '2026-11-02', grade: 3, weeklyHours: 5 });
  assert.equal(two[1].startBy, '2026-11-16', '앞 시험일까지 기다리지 않는다');
  assert.deepEqual(normalizeCert({ name: 'X', hoursMax: 1, typicalMonths: [0, 3, 13, 2.5] }).typicalMonths, [3]);
});
test('자격증 출처: 검색 결과에 없는 주소·시험일·자격증을 버린다', () => {
  const out = filterCertSources([
    { name: 'A', officialUrl: 'https://real.jp/', sourceUrls: ['https://fake.jp'], examDates: [{ examDate: '2027-01-01', sourceUrl: 'https://real.jp/a' }, { examDate: '2027-02-02', sourceUrl: 'https://fake.jp' }] },
    { name: 'B', officialUrl: 'https://fake.jp', sourceUrls: ['https://fake2.jp'], examDates: [] },
    { name: 'C', officialUrl: 'http://real.jp/', sourceUrls: ['https://real.jp/a#x'], examDates: [] },
  ], ['https://real.jp', 'https://real.jp/a']);
  assert.deepEqual(out.map((c) => c.name), ['A', 'C']);
  assert.deepEqual(out[0].examDates.map((d) => d.examDate), ['2027-01-01']);
  assert.deepEqual(out[0].sourceUrls, []);
  assert.equal(out[1].officialUrl, '');
});
test('입력 검증: 출처 없는 시험일·시간 없는 자격증은 뺀다', () => {
  assert.equal(normalizeCert({ name: '', hoursMax: 10 }), null);
  assert.equal(normalizeCert({ name: 'X', hoursMin: 0, hoursMax: 0 }), null);
  assert.equal(normalizeCert({ name: 'X', hoursMax: 10, examDates: [{ examDate: '2027-01-01', sourceUrl: '' }, { examDate: '내년', sourceUrl: 'https://x' }] }).examDates.length, 0);
});
console.log(`\n${passed} tests passed`);
