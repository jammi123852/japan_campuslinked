// 학년도·쿼터, 공식 강의 연결, 이수 기록·졸업요건 계산 테스트.
// 실행: node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-academic.mjs
import assert from 'node:assert/strict';
import {
  checkAddOfficial,
  cohortApplies,
  copyToPeriod,
  removeFromPeriod,
  currentPeriod,
  entriesForPeriod,
  officialToEntries,
  searchOfficial,
  EMPTY_OFFICIAL_FILTERS,
} from '../src/features/academic/academicLogic.ts';
import { applyGrade, computeGpa, computeProgress, countedRecords, pickRule } from '../src/features/records/gradLogic.ts';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`ok - ${name}`); };

const CAL = { year: 2026, quarters: [
  { q: '1Q', start: '2026-04-07', end: '2026-05-28' }, { q: '2Q', start: '2026-06-04', end: '2026-07-22' },
  { q: '3Q', start: '2026-09-14', end: '2026-11-06' }, { q: '4Q', start: '2026-11-13', end: '2027-01-18' } ] };
const PERIODS = [{ period: 1, start: '09:00', end: '10:40' }, { period: 2, start: '11:00', end: '12:40' }, { period: 3, start: '13:40', end: '15:20' }];
let n = 0; const newId = () => `t${++n}`;
const course = (o) => ({ id: 'rs26-a', term: '後期', name: 'アルゴリズム論', section: '102', instructor: '朝廣', year: 3, mark: null, classTag: null, cohort: '17-24RS', rooms: ['12107'], meetings: [{ weekday: 1, period: 2 }], quarters: ['3Q', '4Q'], note: null, source: { id: 'F044', page: 4 }, review: [], ...o });

test('현재 쿼터: 학년력 기간 안·사이·밖', () => {
  assert.deepEqual(currentPeriod(CAL, '2026-11-01'), { period: { year: 2026, quarter: '3Q' }, inSession: true });
  assert.deepEqual(currentPeriod(CAL, '2026-11-10'), { period: { year: 2026, quarter: '4Q' }, inSession: false }); // 시험 기간
  assert.deepEqual(currentPeriod(CAL, '2026-08-10'), { period: { year: 2026, quarter: '3Q' }, inSession: false });
  assert.equal(currentPeriod(CAL, '2027-03-01'), null); // 학년력 밖은 추측하지 않음
  assert.equal(currentPeriod(undefined, '2026-11-01'), null);
});
test('쿼터 전환: 해당 쿼터 수업만 + 기간 미지정은 보존 표시, 여러 쿼터 수업은 한 항목', () => {
  const list = [
    { id: 'a', courseName: 'A', weekday: 0, period: 1, term: { year: 2026, quarters: ['3Q', '4Q'] } },
    { id: 'b', courseName: 'B', weekday: 0, period: 2, term: { year: 2026, quarters: ['3Q'] } },
    { id: 'c', courseName: 'C', weekday: 0, period: 3, term: { year: 2026, quarters: ['1Q'] } },
    { id: 'd', courseName: 'D', weekday: 1, period: 1 },
    { id: 'e', courseName: 'E', weekday: 1, period: 2, term: { year: 2025, quarters: ['3Q'] } },
  ];
  assert.deepEqual(entriesForPeriod(list, { year: 2026, quarter: '4Q' }).map((e) => e.id), ['a', 'd']);
  assert.deepEqual(entriesForPeriod(list, { year: 2026, quarter: '3Q' }).map((e) => e.id), ['a', 'b', 'd']);
  assert.deepEqual(entriesForPeriod(list, { year: 2025, quarter: '3Q' }).map((e) => e.id), ['d', 'e']); // 과거 시간표 유지
});
test('선택 기간 초기화: 그 기간만 지우고 여러 쿼터 수업은 다른 쿼터에 남김, 다른 학년도·쿼터는 유지', () => {
  const e = (id, term) => ({ id, courseName: id, weekday: 0, period: 1, source: { kind: 'user_input' }, ...(term ? { term } : {}) });
  const list = [e('only3', { year: 2026, quarters: ['3Q'] }), e('both', { year: 2026, quarters: ['3Q', '4Q'] }), e('other', { year: 2026, quarters: ['4Q'] }), e('lastYear', { year: 2025, quarters: ['3Q'] }), e('none')];
  const out = removeFromPeriod(list, { year: 2026, quarter: '3Q' });
  assert.deepEqual(out.map((x) => x.id), ['both', 'other', 'lastYear']);
  assert.deepEqual(out[0].term.quarters, ['4Q']);
  assert.deepEqual(list[1].term.quarters, ['3Q', '4Q']);
  assert.deepEqual(removeFromPeriod([], { year: 2026, quarter: '3Q' }), []);
});

test('입학연도 대상 표기 해석', () => {
  assert.equal(cohortApplies('17-24RS', 2024), true);
  assert.equal(cohortApplies('17-24RS', 2025), false);
  assert.equal(cohortApplies('25RS以降/17-24RS', 2026), true);
  assert.equal(cohortApplies('26RSのみ', 2025), false);
  assert.equal(cohortApplies('17RS以降', null), null);
  assert.equal(cohortApplies('全学年', 2024), null); // 모르는 표기는 판단 안 함
});
test('공식 강의 → 시간표: 공식 교시 시각·쿼터 기간, 다른 쿼터와는 충돌 아님', () => {
  const es = officialToEntries(course({ meetings: [{ weekday: 0, period: 1 }, { weekday: 2, period: 1 }] }), 2026, PERIODS, newId);
  assert.equal(es.length, 2);
  assert.deepEqual([es[0].startTime, es[0].endTime, es[0].term], ['09:00', '10:40', { year: 2026, quarters: ['3Q', '4Q'] }]);
  const existing = [
    { id: 'x', courseName: '1Q 수업', weekday: 1, period: 2, term: { year: 2026, quarters: ['1Q'] } },
    { id: 'y', courseName: '4Q 수업', weekday: 1, period: 2, term: { year: 2026, quarters: ['4Q'] } },
  ];
  const r = checkAddOfficial(course({}), 2026, existing);
  assert.equal(r.kind, 'conflict'); assert.deepEqual(r.conflicts.map((c) => c.courseName), ['4Q 수업']);
  assert.equal(checkAddOfficial(course({}), 2026, [{ id: 'z', lectureId: 'rs26-a', courseName: 'x', weekday: 4, period: 5 }]).kind, 'duplicate');
  assert.equal(checkAddOfficial(course({}), 2026, [existing[0]]).kind, 'ok');
  // 기간 미지정 수업은 같은 칸이면 충돌로 알린다(확인 필요)
  const u = checkAddOfficial(course({}), 2026, [{ id: 'u', courseName: '미지정', weekday: 1, period: 2 }]);
  assert.equal(u.kind, 'conflict'); assert.equal(u.conflicts[0].unclassified, true);
});
test('과거 기간 복사: 원본 유지, 재확인 표시', () => {
  const list = [{ id: 'a', courseName: 'A', weekday: 0, period: 1, term: { year: 2026, quarters: ['3Q', '4Q'] } }];
  const copied = copyToPeriod(list, { year: 2026, quarter: '3Q' }, { year: 2027, quarter: '1Q' }, newId);
  assert.deepEqual(copied[0].term, { year: 2027, quarters: ['1Q'] }); assert.equal(copied[0].needsRecheck, true);
  assert.deepEqual(list[0].term, { year: 2026, quarters: ['3Q', '4Q'] });
});
test('공식 강의 검색: 이름·교원·과목코드·필터', () => {
  const list = [course({}), course({ id: 'b', name: '離散数学Ⅰ', mark: 'required_math', term: '後期', year: 1, instructor: '朝廣', syllabus: undefined }), course({ id: 'c', name: '線形代数Ⅰ', term: '前期', instructor: '石田健', syllabus: { code: '0FD10101' } })];
  const f = (o) => searchOfficial(list, { ...EMPTY_OFFICIAL_FILTERS, ...o }).map((c) => c.id);
  assert.deepEqual(f({ query: '朝廣' }), ['rs26-a', 'b']);
  assert.deepEqual(f({ query: '0fd10101' }), ['c']);
  assert.deepEqual(f({ term: '後期', mark: 'required_any' }), ['b']);
  assert.deepEqual(f({ year: 3, term: '前期' }), ['c']);
});

// ---------------- 이수 기록·졸업요건
const RULE24 = { source: {}, appliesNote: '', total: 124,
  categories: { senmon_required: { min: 40, exact: true }, senmon_elective: { min: 48 }, intro: { min: 2, exact: true }, kiso_other: { min: 14 }, english: { min: 6 } },
  flex: { min: 14, from: ['senmon_elective', 'kiso_other', 'english', 'foreign_other'] },
  thesisStart: { credits: 100, courses: ['情報科学演習Ⅰ', '情報科学演習Ⅱ'] } };
const RULE25 = { ...RULE24, categories: { ...RULE24.categories, senmon_required: { min: 36, exact: true }, senmon_elective: { min: 52 }, kiso_other: { min: 12 } }, flex: { ...RULE24.flex, min: 16 } };
const RULES = { '24R': RULE24, '25R': RULE25, '26R': { source: {}, appliesNote: '', partial: true, categories: { senmon_total: { min: 88 } }, total: 124 } };
const rec = (o) => ({ id: Math.random().toString(36), year: 2026, quarters: [], name: 'X', code: null, section: null, credits: 2, category: 'senmon_elective', status: 'passed', confirmedAt: 't', officialId: null, note: '', createdAt: '', updatedAt: '', ...o });

test('규칙 선택: 입학연도와 같은 판본만, 없으면 대신 쓰지 않음', () => {
  assert.equal(pickRule(RULES, 2024).key, '24R');
  assert.equal(pickRule(RULES, 2025).rule.categories.senmon_required.min, 36);
  assert.equal(pickRule(RULES, 2023), null);
  assert.equal(pickRule(RULES, null), null);
});
test('수강 중·계획 학점은 실제 취득에 합산하지 않음 (시나리오 분리)', () => {
  const rs = [rec({ credits: 2 }), rec({ name: 'Y', credits: 2, status: 'enrolled' }), rec({ name: 'Z', credits: 4, status: 'planned' }), rec({ name: 'W', status: 'failed' }), rec({ name: 'V', status: 'review' })];
  const p = pickRule(RULES, 2024);
  assert.equal(computeProgress(rs, p, 'actual').countedTotal, 2);
  assert.equal(computeProgress(rs, p, 'current').countedTotal, 4);
  assert.equal(computeProgress(rs, p, 'plan').countedTotal, 8);
});
test('재수강·같은 과목 중복 합산 방지 (코드 우선, 없으면 과목명)', () => {
  const rs = [rec({ name: '統計学', code: '0FD1', credits: 2 }), rec({ name: '統計学 ', code: '0FD1', credits: 2 }), rec({ name: 'ベクトル解析', credits: 2 }), rec({ name: 'ベクトル 解析', credits: 2 })];
  const c = countedRecords(rs, 'actual');
  assert.equal(c.list.length, 2); assert.equal(c.duplicates.length, 2);
});
test('총학점 충족 ≠ 졸업요건 충족: 영역 부족이면 short', () => {
  const rs = [rec({ category: 'senmon_elective', credits: 110 }), rec({ name: 'R', category: 'senmon_required', credits: 40 })];
  const g = computeProgress(rs, pickRule(RULES, 2024), 'actual');
  assert.equal(g.totalShort, 0);
  assert.equal(g.verdict, 'short');
  assert.equal(g.categories.find((c) => c.id === 'english').short, 6);
  assert.equal(g.categories.find((c) => c.id === 'intro').short, 2);
});
test('추가 취득 영역: 최소를 넘는 학점만 한 번 셈 (필수 초과분은 이동 안 함)', () => {
  const rs = [rec({ category: 'senmon_elective', credits: 50 }), rec({ name: 'K', category: 'kiso_other', credits: 20 }), rec({ name: 'R', category: 'senmon_required', credits: 44 })];
  const g = computeProgress(rs, pickRule(RULES, 2024), 'actual');
  assert.equal(g.flex.earned, 2 + 6); // 선택 50-48, 기초 20-14 / 필수 44-40 은 넣지 않음
  assert.equal(g.categories.find((c) => c.id === 'senmon_required').surplus, 0);
});
test('같은 학점, 24R 과 25R 결과가 다름 (판본 혼합 없음)', () => {
  const rs = [rec({ category: 'senmon_required', credits: 38 })];
  assert.equal(computeProgress(rs, pickRule(RULES, 2024), 'actual').categories[0].short, 2);
  assert.equal(computeProgress(rs, pickRule(RULES, 2025), 'actual').categories[0].short, 0);
});
test('미분류·학점 미입력·부분 규칙·규칙 없음은 판정 불가 (0 부족·충족으로 바꾸지 않음)', () => {
  const full = [rec({ category: 'senmon_required', credits: 40 }), rec({ name: 'E', category: 'senmon_elective', credits: 62 }), rec({ name: 'I', category: 'intro', credits: 2 }), rec({ name: 'K', category: 'kiso_other', credits: 14 }), rec({ name: 'En', category: 'english', credits: 6 }), rec({ name: '情報科学演習Ⅰ', category: 'senmon_required', credits: 0 }), rec({ name: '情報科学演習Ⅱ', category: 'senmon_required', credits: 0 })];
  assert.equal(computeProgress(full, pickRule(RULES, 2024), 'actual').verdict, 'met_checked');
  assert.equal(computeProgress([...full, rec({ name: 'U', category: 'unknown', credits: 2 })], pickRule(RULES, 2024), 'actual').verdict, 'undetermined');
  assert.equal(computeProgress([...full, rec({ name: 'N', credits: null })], pickRule(RULES, 2024), 'actual').verdict, 'undetermined');
  assert.equal(computeProgress(full, pickRule(RULES, 2026), 'actual').verdict, 'undetermined');
  const none = computeProgress(full, pickRule(RULES, 2023), 'actual');
  assert.equal(none.noRule, true); assert.equal(none.verdict, 'undetermined');
});
test('졸업연구 착수: 학점 + 지정 과목 이수 둘 다', () => {
  const rs = [rec({ category: 'senmon_elective', credits: 100 }), rec({ name: '情報科学演習Ⅰ', category: 'senmon_required', credits: 2 })];
  const t = computeProgress(rs, pickRule(RULES, 2024), 'actual').thesis;
  assert.equal(t.met, false); assert.deepEqual(t.missingCourses, ['情報科学演習Ⅱ']);
});
test('요건 외(자격과정) 학점은 합계에 넣지 않음', () => {
  const g = computeProgress([rec({ category: 'outside', credits: 10 })], pickRule(RULES, 2024), 'actual');
  assert.equal(g.countedTotal, 0); assert.equal(g.outsideCredits, 10);
});

console.log(`\n${passed} passed`);

// ---------------- 시험 대조
const { matchExams, slotOf } = await import('../src/features/academic/examLogic.ts');
const EX = [
  { id: 'x1', date: '2026-11-09', period: 7, name: 'プログラミング基礎Ⅰ', instructor: '合志 和晃', slots: ['月4/水4'], room: '12109', quarter: '3Q' },
  { id: 'x2', date: '2026-11-09', period: 7, name: 'プログラミング基礎Ⅰ', instructor: '隅田 康明', slots: ['月4/水4'], room: '12106', quarter: '3Q' },
  { id: 'x3', date: '2026-11-09', period: 5, name: 'プログラミング基礎Ⅰ', instructor: '隅田 康明', slots: ['火4/金4'], room: '12218', quarter: '3Q' },
  { id: 'x4', date: '2026-11-10', period: 3, name: '離散数学Ⅰ', instructor: '朝廣 雄一', slots: ['月1/水1', '月2/水2'], room: '12106', quarter: '3Q' },
];
const pc = (id, instructor, meetings, extra = {}) => course({ id, name: 'プログラミング基礎Ⅰ', instructor, meetings, quarters: ['3Q'], ...extra });
test('시험 대조: 과목명+교원+수업 칸이 모두 맞아야 일치, 이름만 같으면 확인 필요', () => {
  assert.equal(slotOf([{ weekday: 2, period: 4 }, { weekday: 0, period: 4 }]), '月4/水4');
  const courses = [pc('b', '隅田', [{ weekday: 0, period: 4 }, { weekday: 2, period: 4 }]), pc('k', '隅田', [{ weekday: 1, period: 5 }]), course({ id: 'r', name: '離散数学Ⅰ', instructor: '朝廣', meetings: [{ weekday: 0, period: 2 }, { weekday: 2, period: 2 }], quarters: ['3Q'] }), course({ id: 'q4', name: '離散数学Ⅱ', quarters: ['4Q'] })];
  const entries = [{ id: '1', lectureId: 'b', courseName: 'x' }, { id: '2', lectureId: 'b', courseName: 'x' }, { id: '3', lectureId: 'k', courseName: 'x' }, { id: '4', lectureId: 'r', courseName: 'x' }, { id: '5', courseName: 'プログラミング基礎Ⅰ' }, { id: '6', courseName: '없는과목' }, { id: '7', lectureId: 'q4', courseName: 'x' }];
  const m = Object.fromEntries(matchExams(entries, courses, EX, '3Q').map((x) => [x.officialId ?? x.courseName, x]));
  assert.equal(m.b.status, 'matched'); assert.equal(m.b.exams[0].id, 'x2'); // 같은 이름 3건 중 교원·칸으로 1건
  assert.equal(m.k.status, 'needs_check'); // 교원은 같지만 수업 칸(火5)이 시험표와 다름 → 확정 안 함
  assert.equal(m.r.status, 'matched'); assert.equal(m.r.exams[0].id, 'x4'); // 복수 칸 표기
  assert.equal(m['プログラミング基礎Ⅰ'].status, 'needs_check'); // 직접 입력 수업은 이름만으로 확정 안 함
  assert.equal(m['없는과목'].status, 'not_found');
  assert.equal(m.q4.status, 'out_of_scope');
  assert.equal(Object.keys(m).length, 6); // 여러 요일 수업은 한 번만
});
console.log(`\n${passed} passed (with exams)`);

// ---------------- 수강 계획
const { buildCandidates, planMetrics, generatePlans, applyPicks } = await import('../src/features/planner/plannerLogic.ts');
const T6 = [{ period: 1, start: '09:00', end: '10:40' }, { period: 2, start: '11:00', end: '12:40' }, { period: 3, start: '13:40', end: '15:20' }, { period: 4, start: '15:40', end: '17:20' }, { period: 5, start: '17:30', end: '19:10' }];
test('지표: 이어지는 교시는 한 덩어리, 공강·점심·등교일 계산이 실제 배치와 일치', () => {
  // 월 1·2교시(연속) + 월 4교시 → 공강 2교시 끝 12:40 ~ 4교시 15:40 = 180분, 수 3교시 하나
  const m = planMetrics([{ weekday: 0, period: 1 }, { weekday: 0, period: 2 }, { weekday: 0, period: 4 }, { weekday: 2, period: 3 }], T6, { start: '12:00', end: '13:00' });
  assert.deepEqual([m.days, m.gapMinutes, m.maxConsecutive], [2, 180, 2]);
  assert.deepEqual([m.lunchBadDays, m.lunchOkDays], [1, 1]); // 월 2교시(11:00~12:40)가 12:00~13:00 과 겹침
  assert.equal(planMetrics([], T6, null).days, 0);
});
const cand = (o) => course({ id: o.id, name: o.name ?? o.id, meetings: o.meetings, quarters: o.quarters ?? ['4Q'], mark: o.mark ?? null, cohort: o.cohort ?? '17RS以降', year: o.year ?? 2, ...(o.credits != null ? { credits: o.credits } : {}), ...(o.track ? { track: o.track } : {}) });
const RECS = [rec({ name: '済み科目', status: 'passed' })];
const base = (courses, extra = {}) => buildCandidates({ courses, dataYear: 2026, target: { year: 2026, quarter: '4Q' }, records: RECS, timetable: [{ id: 'fx', courseName: '既存', weekday: 0, period: 1, term: { year: 2026, quarters: ['4Q'] } }], admissionYear: 2024, grade: 3, blocked: new Set(), lunch: null, periodTimes: T6, interests: [], ...extra });
test('후보 근거: 이수 완료·대상 아님·충돌·막은 시간·학년·다른 쿼터를 따로 표시', () => {
  const cs = base([
    cand({ id: 'done', name: '済み科目', meetings: [{ weekday: 1, period: 1 }] }),
    cand({ id: 'co', cohort: '25RS以降', meetings: [{ weekday: 1, period: 2 }] }),
    cand({ id: 'cf', meetings: [{ weekday: 0, period: 1 }] }),
    cand({ id: 'bl', meetings: [{ weekday: 4, period: 5 }] }),
    cand({ id: 'hi', year: 4, meetings: [{ weekday: 2, period: 2 }] }),
    cand({ id: 'q3', quarters: ['3Q'], meetings: [{ weekday: 3, period: 3 }] }),
  ], { blocked: new Set(['4-5']) });
  const by = Object.fromEntries(cs.map((c) => [c.course.id, c]));
  assert.equal(by.done.excluded, 'taken');
  assert.equal(by.co.excluded, 'cohort');
  assert.deepEqual(by.cf.conflicts, ['既存']);
  assert.equal(by.bl.blocked, true);
  assert.equal(by.hi.gradeFit, 'higher_year');
  assert.equal(by.q3, undefined); // 다른 쿼터 수업은 후보 아님
  assert.equal(by.hi.offered, 'confirmed');
  // 다른 학년도로 계획하면 개설 확정이 아님
  assert.equal(base([cand({ id: 'x', meetings: [{ weekday: 1, period: 3 }] })], { target: { year: 2027, quarter: '4Q' } })[0].offered, 'not_confirmed');
});
test('대안: 제외·충돌·막은 시간 후보는 넣지 않음, 같은 결과 대안은 합침, 전략별 차이', () => {
  const cs = base([
    cand({ id: 'r1', mark: 'required', meetings: [{ weekday: 3, period: 2 }] }),
    cand({ id: 'm1', meetings: [{ weekday: 0, period: 2 }] }), // 이미 등교하는 월요일, 1교시 다음 → 연속
    cand({ id: 'cf', meetings: [{ weekday: 0, period: 1 }] }),
    cand({ id: 'co', cohort: '25RS以降', meetings: [{ weekday: 1, period: 2 }] }),
  ]);
  const { plans, usable } = generatePlans(cs, [{ weekday: 0, period: 1 }], 1, ['requirement', 'fewerDays'], T6, null);
  assert.equal(usable, 2);
  assert.deepEqual(plans.map((p) => [p.strategy, p.courseIds.join()]), [['requirement', 'r1'], ['fewerDays', 'm1']]);
  assert.equal(plans[1].metrics.days, 1); // 월요일만
  assert.equal(plans[0].metrics.days, 2);
  const one = generatePlans(cs, [{ weekday: 0, period: 1 }], 3, ['requirement', 'fewerDays'], T6, null);
  assert.equal(one.plans.length, 1); // 둘 다 같은 두 과목 → 하나로
  assert.equal(generatePlans([], [], 3, ['requirement'], T6, null).plans.length, 0);
});
test('대안에 꼭 넣기: 고른 과목은 모든 대안에 들어가고, 나머지 수만큼만 채움', () => {
  const cs = base([
    cand({ id: 'r1', mark: 'required', meetings: [{ weekday: 3, period: 2 }] }),
    cand({ id: 'm1', meetings: [{ weekday: 0, period: 2 }] }),
    cand({ id: 'w1', meetings: [{ weekday: 2, period: 3 }] }),
  ]);
  const w1 = cs.find((c) => c.course.id === 'w1');
  const r = generatePlans(cs, [], 2, ['requirement', 'fewerDays'], T6, null, [w1]);
  assert.ok(r.plans.length >= 1);
  for (const p of r.plans) {
    assert.ok(p.courseIds.includes('w1'));
    assert.equal(p.courseIds.length, 2);
  }
  // 고른 수가 추가할 과목 수 이상이면 고른 것만
  const only = generatePlans(cs, [], 1, ['requirement'], T6, null, [w1]);
  assert.deepEqual(only.plans.map((p) => p.courseIds.join()), ['w1']);
});
test('듣고 싶은 학점: 과목 수 대신 학점이 찰 때까지 채움', () => {
  const cs = base([cand({ id: 'a', credits: 2, meetings: [{ weekday: 0, period: 2 }] }), cand({ id: 'b', credits: 2, meetings: [{ weekday: 1, period: 2 }] }), cand({ id: 'c', credits: 2, meetings: [{ weekday: 2, period: 2 }] })]);
  const per = cs[0].credits ?? 0;
  assert.ok(per > 0);
  const r = generatePlans(cs, [], 1, ['requirement'], T6, null, [], per * 2);
  assert.equal(r.plans[0].courseIds.length, 2);
});
test('AI 추천 확인: 겹침·같은 과목·점심·교양 개수·목표 학점을 앱이 다시 검사', () => {
  const cs = base([
    cand({ id: 'k1', credits: 2, track: 'kiso', meetings: [{ weekday: 0, period: 3 }] }),
    cand({ id: 'k2', track: 'kiso', meetings: [{ weekday: 1, period: 3 }] }),
    cand({ id: 'k3', track: 'kiso', meetings: [{ weekday: 2, period: 3 }] }),
    cand({ id: 'dup', name: 'X', meetings: [{ weekday: 0, period: 3 }] }),
    cand({ id: 'noon', meetings: [{ weekday: 3, period: 2 }] }),
    cand({ id: 'm1', meetings: [{ weekday: 4, period: 4 }] }),
  ]);
  const by = Object.fromEntries(cs.map((c) => [c.course.id, c]));
  const order = ['k1', 'dup', 'k2', 'k3', 'noon', 'm1'].map((id) => by[id]);
  const r = applyPicks(order, [], T6, { lunch: { start: '12:00', end: '13:00' }, creditGoal: null, kisoMax: 2, needOnly: null });
  assert.deepEqual(r.accepted.map((c) => c.course.id), ['k1', 'k2', 'm1']);
  assert.deepEqual(Object.fromEntries(r.dropped.map((d) => [d.c.course.id, d.why])), { dup: 'clash', k3: 'kiso', noon: 'lunch' });
  const g = applyPicks(order, [], T6, { lunch: null, creditGoal: 1, kisoMax: null, needOnly: null });
  assert.equal(g.accepted.length, 1);
});
test('성적: S~C 이수 완료·D/E 불합격, 다시 누르면 지움, 졸업 학점은 합격만', () => {
  const base0 = rec({ id: 'x', name: 'X', status: 'enrolled', credits: 2, category: 'senmon_elective' });
  const a = applyGrade(base0, 'A', 'T');
  assert.deepEqual([a.status, a.grade, a.confirmedAt], ['passed', 'A', 'T']);
  const d = applyGrade(a, 'D', 'T2');
  assert.deepEqual([d.status, d.grade, d.confirmedAt], ['failed', 'D', null]);
  assert.equal(countedRecords([d], 'actual').list.length, 0);
  assert.equal(countedRecords([a], 'actual').list.length, 1);
  const off = applyGrade(a, 'A', 'T3');
  assert.deepEqual([off.status, off.grade], ['enrolled', null]);
  // GPA: (2×4 + 2×0) / 4 = 2, 성적 없는 과목·요건 외 제외
  const g = computeGpa([applyGrade(base0, 'S', 'T'), applyGrade({ ...base0, id: 'y', name: 'Y' }, 'E', 'T'), { ...base0, id: 'z', name: 'Z' }, applyGrade({ ...base0, id: 'o', name: 'O', category: 'outside' }, 'S', 'T')]);
  assert.deepEqual(g, { gpa: 2, courses: 2, credits: 4 });
  assert.equal(computeGpa([base0]).gpa, null);
});
test('점심 우선이면 점심 시간과 겹치는 후보를 넣지 않음', () => {
  const cs = base([cand({ id: 'noon', meetings: [{ weekday: 2, period: 2 }] }), cand({ id: 'pm', meetings: [{ weekday: 2, period: 4 }] })], { lunch: { start: '12:00', end: '13:00' } });
  const { plans } = generatePlans(cs, [], 2, ['lunch'], T6, { start: '12:00', end: '13:00' });
  assert.deepEqual(plans[0].courseIds, ['pm']);
});
// ---- 체크리스트·장학금·진로
const CL = await import('../src/features/checklist/checklistLogic.ts');
const SCH = await import('../src/features/scholarship/scholarshipLogic.ts');
const CAR = await import('../src/features/career/careerLogic.ts');
const item = (o) => ({ id: 'i', periodKey: '2026-3Q', kind: 'manual', ref: null, title: 'A', status: 'todo', carriedFrom: null, carriedTo: null, createdAt: '', updatedAt: '', ...o });
test('기간 범위: 다음 쿼터 전날까지(시험 포함), 마지막은 3/31, 학년력 밖은 null', () => {
  assert.deepEqual(CL.periodRange(CAL, { year: 2026, quarter: '3Q' }), { start: '2026-09-14', end: '2026-11-12' });
  assert.deepEqual(CL.periodRange(CAL, { year: 2026, quarter: '4Q' }), { start: '2026-11-13', end: '2027-03-31' });
  assert.equal(CL.periodRange(CAL, { year: 2027, quarter: '1Q' }), null);
  const ev = [{ id: 'a', date: '2026-11-12' }, { id: 'b', date: '2026-11-13' }];
  assert.deepEqual(CL.eventsInRange(ev, CL.periodRange(CAL, { year: 2026, quarter: '3Q' })).map((e) => e.id), ['a']);
  assert.deepEqual(CL.eventsInRange(ev, null), []);
});
test('대상 입학 연도: 연도 하나 표기와 나눈 표기, 표기 없으면 판단 안 함', () => {
  assert.equal(cohortApplies('25RS', 2025), true);
  assert.equal(cohortApplies('25RS', 2024), false);
  assert.equal(cohortApplies('25RS/17-24RS', 2025), true);
  assert.equal(cohortApplies('25RS/17-24RS', 2024), true);
  assert.equal(cohortApplies('25RS/17-24RS', 2026), false);
  assert.equal(cohortApplies('17-24RS', 2025), false);
  assert.equal(cohortApplies('', 2025), null);
});
test('넘기기: 예정·진행 중만, 원래 항목은 남고 표시, 두 번 눌러도 중복 없음', () => {
  const from = { year: 2026, quarter: '3Q' }, to = { year: 2026, quarter: '4Q' };
  let k = 0; const nid = () => `n${++k}`;
  const src = [item({ id: '1', title: 'A', status: 'todo' }), item({ id: '2', title: 'B', status: 'doing' }), item({ id: '3', title: 'C', status: 'done' }), item({ id: '4', title: 'D', status: 'na' }), item({ id: '5', title: 'E', periodKey: '2026-1Q' })];
  const r = CL.carryOver(src, from, to, nid, 'now');
  assert.equal(r.moved, 2);
  assert.equal(r.items.length, 7);
  assert.deepEqual(CL.itemsForPeriod(r.items, '2026-4Q').map((i) => [i.title, i.status, i.carriedFrom]), [['A', 'todo', '2026-3Q'], ['B', 'doing', '2026-3Q']]);
  assert.equal(r.items.find((i) => i.id === '1').carriedTo, '2026-4Q');
  assert.equal(r.items.find((i) => i.id === '3').carriedTo, null);
  assert.equal(CL.carryOver(r.items, from, to, nid, 'now').moved, 0);
});
test('넘기기: 다음 기간에 같은 연결 항목이 있으면 새로 만들지 않음', () => {
  const src = [item({ id: '1', kind: 'event', ref: 'e1' }), item({ id: '2', kind: 'event', ref: 'e1', periodKey: '2026-4Q' })];
  const r = CL.carryOver(src, { year: 2026, quarter: '3Q' }, { year: 2026, quarter: '4Q' }, () => 'x', 'now');
  assert.equal(r.moved, 0);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].carriedTo, '2026-4Q');
});
test('넘기기: 이미 넘긴 항목은 다음 기간에서 지웠어도 되살리지 않음', () => {
  const src = [item({ id: '1', title: 'A', carriedTo: '2026-4Q' })];
  const r = CL.carryOver(src, { year: 2026, quarter: '3Q' }, { year: 2026, quarter: '4Q' }, () => 'x', 'now');
  assert.equal(r.moved, 0);
  assert.equal(r.items.length, 1);
});
test('연결 항목은 원본의 현재 값을 읽고, 원본이 없으면 missing, 규칙 없으면 판단 안 함', () => {
  const ctx = { events: [{ id: 'e1', title: '새 제목' }], records: [{ id: 'r1', name: 'X', status: 'passed' }], scholarships: [{ id: 's1' }], gradShort: { english: 2 } };
  assert.equal(CL.liveLink(item({ kind: 'event', ref: 'e1', title: '옛 제목' }), ctx).event.title, '새 제목');
  assert.equal(CL.liveLink(item({ kind: 'event', ref: 'gone' }), ctx).kind, 'missing');
  assert.equal(CL.liveLink(item({ kind: 'record', ref: 'r1' }), ctx).record.status, 'passed');
  assert.equal(CL.liveLink(item({ kind: 'scholarship', ref: 'nope' }), ctx).kind, 'missing');
  assert.equal(CL.liveLink(item({ kind: 'grad', ref: 'english' }), ctx).short, 2);
  assert.equal(CL.liveLink(item({ kind: 'grad', ref: 'english' }), { ...ctx, gradShort: null }).short, null);
  assert.equal(CL.liveLink(item({}), ctx).kind, 'none');
});
test('중복 판정·기간 기록·요약', () => {
  const list = [item({ kind: 'event', ref: 'e1' }), item({ title: ' 직접 ' })];
  assert.equal(CL.isDuplicate(list, { periodKey: '2026-3Q', kind: 'event', ref: 'e1', title: 'x' }), true);
  assert.equal(CL.isDuplicate(list, { periodKey: '2026-4Q', kind: 'event', ref: 'e1', title: 'x' }), false);
  assert.equal(CL.isDuplicate(list, { periodKey: '2026-3Q', kind: 'manual', ref: null, title: '직접' }), true);
  assert.equal(CL.isDuplicate(list, { periodKey: '2026-3Q', kind: 'manual', ref: null, title: '다른 것' }), false);
  assert.deepEqual(CL.recordsInPeriod([{ id: 'a', year: 2026, quarters: ['3Q', '4Q'] }, { id: 'b', year: 2025, quarters: ['3Q'] }, { id: 'c', year: 2026, quarters: ['1Q'] }, { id: 'd', year: null, quarters: [] }], { year: 2026, quarter: '4Q' }).map((r) => r.id), ['a']);
  assert.deepEqual(CL.summarize([item({ status: 'todo' }), item({ status: 'done' }), item({ status: 'done' })]), { todo: 1, doing: 0, done: 2, na: 0 });
});
const SCHOL = { checks: [{ key: 'undergrad', expect: true, cond: 0 }, { key: 'international', expect: false, cond: 0 }], judgedBySchool: [] };
test('장학금 마감: 당일 시각 경계까지', () => {
  const s = { deadline: '2026-06-30T19:00' };
  assert.equal(SCH.isClosed(s, '2026-06-29', 1439), false);
  assert.equal(SCH.isClosed(s, '2026-06-30', 19 * 60), false);
  assert.equal(SCH.isClosed(s, '2026-06-30', 19 * 60 + 1), true);
  assert.equal(SCH.isClosed(s, '2026-11-01', 0), true);
});
test('장학금 판정: 모르면 추가 확인 필요, 하나라도 어긋나면 대상 아님, 기대값 false 도 정확히', () => {
  assert.equal(SCH.eligibility(SCHOL, {}).verdict, 'check');
  assert.deepEqual(SCH.eligibility(SCHOL, { undergrad: true }).unknown, ['international']);
  assert.equal(SCH.eligibility(SCHOL, { undergrad: true, international: null }).verdict, 'check');
  assert.equal(SCH.eligibility(SCHOL, { undergrad: true, international: false }).verdict, 'candidate');
  assert.equal(SCH.eligibility(SCHOL, { undergrad: true, international: true }).verdict, 'not');
  assert.deepEqual(SCH.eligibility(SCHOL, { international: true }).unmet, ['international']); // 다른 답이 없어도 대상 아님 우선
  assert.equal(SCH.eligibility(SCHOL, { international: true }).verdict, 'not');
});
test('진로: 키워드 분리·중복 제거, 강의 일치, 프로그램은 빼지 않고 일치 순', () => {
  assert.deepEqual(CAR.parseKeywords('AI, ai、 データ ,, '), ['AI', 'データ']);
  const cs = [{ id: 'a', name: 'アルゴリズム論' }, { id: 'b', name: 'アルゴリズム論' }, { id: 'c', name: 'データベース' }];
  assert.deepEqual(CAR.coursesForKeyword(cs, 'アルゴリズム').map((c) => c.id), ['a']);
  assert.deepEqual(CAR.coursesForKeyword(cs, ''), []);
  const acts = [{ id: 'p', name: 'PBL', text: 'チーム', keywords: ['開発'] }, { id: 'k', name: '見える化', text: '競技', keywords: ['プログラミング'] }];
  const ranked = CAR.rankActivities(acts, ['プログラミング']);
  assert.deepEqual(ranked.map((r) => r.activity.id), ['k', 'p']);
  assert.deepEqual(ranked[1].hits, []);
});
console.log(`\n${passed} passed (with planner, checklist, scholarship, career)`);
