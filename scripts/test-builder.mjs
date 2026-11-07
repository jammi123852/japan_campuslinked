// 직접 시간표 짜기·후기 가중치·설명 일치 순수 로직 테스트. 실행: node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-builder.mjs
import assert from 'node:assert/strict';
import { findPlaces, parseRoom } from '../src/features/campus/campusLogic.ts';
import { altHighlights, altReviewNotes, buildAlternatives, draftBlockers, draftImpact, EMPTY_BUILDER, evaluateDraft, prepareBuilder, replacementsFor } from '../src/features/planner/builderLogic.ts';
import { planMetrics } from '../src/features/planner/plannerLogic.ts';
import { planAnswerMismatch, planFingerprint, planFromConditions, prefScore } from '../src/features/assistant/assistantLogic.ts';
import { computeDigest, helpfulWeight, HELPFUL_WEIGHT, isInformative } from '../server/summaries.ts';

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`ok - ${name}`); };

const periods = [1, 2, 3, 4, 5].map((p) => ({ period: p, start: `${8 + p * 2 - 1}:00`.padStart(5, '0'), end: `${8 + p * 2}:40`.padStart(5, '0') }));
periods[2] = { period: 3, start: '12:10', end: '13:50' };
const course = (id, name, meetings, o = {}) => ({ id, name, section: '101', meetings: meetings.map(([weekday, period]) => ({ weekday, period })), quarters: ['4Q'], term: '後期', cohort: '全', credits: 2, year: 2, track: 'kiso', mark: 'elective', depts: ['RS'], ...o });
const courses = [
  course('req', '必修演習', [[0, 2]], { track: 'major', mark: 'required' }),
  course('req2', '必修演習', [[1, 2]], { track: 'major', mark: 'required', section: '102' }),
  course('fill', '英語', [[0, 3]], { track: 'kiso' }),
  course('mon1', '月1', [[0, 1]], { prereq: 'なし' }),
  course('tue4', '火4', [[1, 4]]),
  course('wed5', '水5', [[2, 5]]),
  course('thu2', '木2', [[3, 2]]),
  course('fri1', '金1', [[4, 1]]),
  course('fri5', '金5', [[4, 5]], { prereq: '必修演習を修得していること' }),
];
const base = (o = {}) => ({
  od: { courses, calendar: { year: 2026 }, periods: { items: periods } },
  target: { year: 2026, quarter: '4Q' },
  records: [],
  timetable: [],
  admissionYear: 2024,
  grade: 3,
  dept: null,
  rule: null,
  picked: null,
  digests: {},
  shortCategories: [],
  ...o,
});
// coursesForDept(dept=null) 는 전체를 돌려준다

test('필수 유지: 대안에 필수가 들어가고 같은 과목 다른 분반은 겹쳐 넣지 않는다', () => {
  const r = buildAlternatives(base(), { ...EMPTY_BUILDER, keepRequired: true });
  for (const a of r.alternatives) {
    assert.equal(a.ids.filter((id) => id === 'req' || id === 'req2').length, 1);
    assert.deepEqual(a.metrics.clashes, []);
  }
});
test('이미 적용한 과목이 자기 자신과 충돌하지 않는다 (다른 분반 포함)', () => {
  const timetable = [{ id: 'e', courseName: '必修演習', weekday: 0, period: 2, lectureId: 'req', term: { year: 2026, quarters: ['4Q'] } }];
  const input = base({ timetable });
  const o = planFromConditions(input, { ...EMPTY_BUILDER, keepRequired: true });
  assert.deepEqual(o.conflicts, [], '자기 자신과 충돌로 나오면 안 된다');
  const r = buildAlternatives(input, { ...EMPTY_BUILDER, keepRequired: true });
  for (const a of r.alternatives) assert.ok(!a.ids.includes('req') && !a.ids.includes('req2'), '같은 과목 재등록 금지');
});
test('요일 비우기는 어느 대안도 어기지 않고, 조건을 바꾸면 실제로 다시 계산된다', () => {
  const a = buildAlternatives(base(), { ...EMPTY_BUILDER });
  const b = buildAlternatives(base(), { ...EMPTY_BUILDER, excludeWeekdays: [0, 4] });
  assert.notEqual(a.version, b.version);
  for (const alt of b.alternatives) for (const id of alt.ids) assert.ok(courses.find((c) => c.id === id).meetings.every((m) => m.weekday !== 0 && m.weekday !== 4));
});
test('후기 점수가 커도 필수 조건을 넘지 못한다 (막은 시간 과목은 안 들어감)', () => {
  const digests = { fri1: { lectureId: 'fri1', count: 9, realCount: 9, demoCount: 0, demoIncluded: false, workload: { avg: 1, low: 1, high: 1, mixed: false }, difficulty: { avg: 1, low: 1, high: 1, mixed: false }, aspects: {}, smallSample: false, weighted: { workload: 1, difficulty: 1, helpfulTotal: 50, top: [] } } };
  const r = buildAlternatives(base({ digests }), { ...EMPTY_BUILDER, excludeWeekdays: [4], prefs: ['lowWorkload'] });
  for (const a of r.alternatives) assert.ok(!a.ids.includes('fri1'));
});
test('대안이 같으면 합치고 억지로 3개를 만들지 않는다', () => {
  const input = base({ od: { courses: courses.slice(2, 3), calendar: { year: 2026 }, periods: { items: periods } } });
  const r = buildAlternatives(input, { ...EMPTY_BUILDER });
  assert.equal(r.alternatives.length, 1);
  assert.deepEqual(r.alternatives[0].merged, ['requirement', 'gaps', 'balance']);
});
test('대안이 없으면 비어 있고 완화안을 준다', () => {
  const r = buildAlternatives(base(), { ...EMPTY_BUILDER, excludeWeekdays: [0, 1, 2, 3, 4] });
  assert.equal(r.alternatives.length, 0);
  assert.ok(r.outcome.relax.length >= 5);
});
test('카드 지표 = 직접 계산값 (학점·등교일·공강·점심)', () => {
  const input = base();
  const cond = { ...EMPTY_BUILDER };
  const b = prepareBuilder(input, cond);
  const m = evaluateDraft(input, cond, b, ['mon1', 'fill', 'fri5']);
  assert.deepEqual([m.addedCredits, m.days, m.lunchOkDays, m.lunchBadDays], [6, 2, 1, 1]);
  assert.equal(m.gapMinutes, new Date(0).getTime() + (Number(periods[2].start.slice(0, 2)) * 60 + 10) - (Number(periods[0].end.slice(0, 2)) * 60 + 40));
  const r = buildAlternatives(input, cond);
  for (const a of r.alternatives) assert.deepEqual(a.metrics, evaluateDraft(input, cond, r.build, a.ids), '카드·상세가 같은 함수');
});
test('못 지킨 선호와 추가 확인이 표시된다', () => {
  const input = base();
  const cond = { ...EMPTY_BUILDER, softFirst: true, creditGoal: 20, prefs: ['project'] };
  const b = prepareBuilder(input, cond);
  const m = evaluateDraft(input, cond, b, ['mon1', 'fri5']);
  assert.deepEqual(m.unmet.map((u) => u.key), ['softFirst', 'creditGoal', 'prefNoEvidence']);
  assert.ok(m.checks.some((c) => c.id === 'fri5' && c.kind === 'prereq'), '선수 조건을 가능하다고 단정하지 않는다');
  assert.ok(!evaluateDraft(input, cond, b, ['mon1']).checks.some((c) => c.kind === 'prereq'));
});
test('삭제·변경 영향: 학점·필수·선수 관계·대체 후보가 맞다', () => {
  const input = base();
  const cond = { ...EMPTY_BUILDER };
  const b = prepareBuilder(input, cond);
  const imp = draftImpact(input, cond, b, ['req', 'fri5', 'tue4'], ['fri5', 'tue4']);
  assert.equal(imp.creditsDelta, -2);
  assert.deepEqual(imp.requiredLost, ['必修演習']);
  assert.deepEqual(imp.prereqAffected, ['金5']);
  assert.equal(imp.before.days - imp.after.days, 1);
  const rep = replacementsFor(input, b, ['req', 'fri5', 'tue4'], 'req');
  assert.ok(rep.some((c) => c.course.id === 'req2'), '같은 과목 다른 분반을 대체 후보로');
  assert.ok(!rep.some((c) => c.course.id === 'fri5' || c.course.id === 'tue4'));
  // 남은 계획과 겹치는 후보는 나오지 않는다
  assert.ok(!replacementsFor(input, b, ['req', 'tue4'], 'req').some((c) => c.course.meetings.some((m) => m.weekday === 1 && m.period === 4)));
});
test('계획에서 빼도 입력 기록을 바꾸지 않는다', () => {
  const records = [{ id: 'r', year: 2025, quarters: ['1Q'], name: 'x', code: null, section: null, credits: 2, category: 'unknown', status: 'passed', confirmedAt: null, officialId: 'x', note: '', createdAt: '', updatedAt: '' }];
  const before = JSON.stringify(records);
  const input = base({ records });
  draftImpact(input, EMPTY_BUILDER, prepareBuilder(input, EMPTY_BUILDER), ['req'], []);
  assert.equal(JSON.stringify(records), before);
});
test('적용 직전 재검사: 그 사이 들어온 수업과 겹치면 막는다', () => {
  const input = base({ timetable: [{ id: 'e', courseName: '다른', weekday: 0, period: 1, term: { year: 2026, quarters: ['4Q'] } }] });
  const b = prepareBuilder(input, EMPTY_BUILDER);
  assert.deepEqual(draftBlockers(b, ['mon1']), ['月1']);
  assert.deepEqual(draftBlockers(b, ['tue4']), []);
});
test('AI 문장 숫자가 계산과 다르면 잡는다', () => {
  const o = { plans: [{ courseIds: ['a'], creditsKnown: 5, metrics: { days: 2, gapMinutes: 0 } }], conflicts: [{ name: 'x', reason: 'timetable' }] };
  assert.equal(planAnswerMismatch('필수과목 충돌은 없고, 총 6학점·수업일 1일 구성이에요.', o), true);
  assert.equal(planAnswerMismatch('총 5학점, 등교 2일이에요.', { ...o, conflicts: [] }), false);
  assert.equal(planAnswerMismatch('총 7학점이에요.', { ...o, conflicts: [] }), true, '학점만 달라도 잡는다');
  assert.equal(planAnswerMismatch('등교 3일이에요.', { ...o, conflicts: [] }), true, '등교일만 달라도 잡는다');
  assert.equal(planAnswerMismatch('金曜を空けて必修を残しました。', o), false);
  assert.notEqual(planFingerprint(o), planFingerprint({ ...o, conflicts: [] }));
});

// ---- 도움돼요 가중치
const rv = (id, body, helpful = 0, w = 3, d = 3) => ({ id, workload: w, difficulty: d, evaluation: 'exam', body, taken_year: 2025, updated_at: 'u', helpful });
const LONG = '과제가 매주 있어서 부담이 큰 편이지만 시험은 쉬웠어요.';
test('가중치: 0개도 기본값, 늘수록 증가폭이 줄고 상한이 있다', () => {
  assert.equal(helpfulWeight(0), HELPFUL_WEIGHT.base);
  const ws = [0, 1, 3, 7, 50, 100000].map(helpfulWeight);
  for (let i = 1; i < ws.length; i++) assert.ok(ws[i] >= ws[i - 1]);
  assert.ok(ws[1] - ws[0] > ws[2] - ws[1] - 0.001);
  assert.equal(ws[5], HELPFUL_WEIGHT.max);
  assert.equal(helpfulWeight(-5), HELPFUL_WEIGHT.base);
});
test('한 후기가 결론을 지배하지 못하고 소수 의견이 남는다', () => {
  const d = computeDigest('L', [rv(1, LONG, 100000, 5, 5), rv(2, '과제는 거의 없고 시험만 있어서 부담이 적었어요.', 0, 1, 1), rv(3, '과제가 적고 난이도도 낮아서 편하게 들었어요.', 0, 1, 1)], [], false);
  assert.equal(d.workload.avg, 2.3, '산술 평균은 그대로');
  assert.ok(d.weighted.workload > d.workload.avg && d.weighted.workload < 3.5, `상한 때문에 지배 못함: ${d.weighted.workload}`);
  assert.deepEqual(d.evidenceReviewIds, [1, 2, 3], '0개 후기도 근거에 남는다');
});
test('관련 없는 글은 도움돼요가 많아도 제외되고 가중치도 커지지 않는다', () => {
  const off = '수업 끝나고 먹은 학식 카레가 맛있었어요. 다들 꼭 드셔 보세요. 오늘 날씨도 좋네요.';
  assert.equal(isInformative(off), false);
  const d = computeDigest('L', [rv(1, off, 500, 1, 1), rv(2, LONG, 0, 5, 5)], [], false);
  assert.deepEqual(d.evidenceReviewIds, [2]);
  assert.equal(d.excludedReviewCount, 1);
  assert.equal(d.weighted.workload, 3, '기본 가중치 1:1');
  assert.ok(d.weighted.top.every((x) => x.id !== 1));
});
test('짧은 글에서 과제·시험 정보를 추정하지 않는다', () => {
  const d = computeDigest('L', [rv(1, '과제 많음')], [], false);
  assert.equal(d.aspects.assignment.mentioned, 0);
  assert.equal(d.informativeCount, 0);
});
test("'여러 후기 반복'과 '한 후기지만 도움돼요 많음'을 구분한다", () => {
  const d = computeDigest('L', [rv(1, '프로젝트 경험이 좋았고 팀으로 나눠서 진행했어요.', 8), rv(2, '과제가 많아서 힘들었지만 설명은 좋았어요.', 0), rv(3, '과제 양이 꽤 많고 시험도 어려운 편이었어요.', 0)], [], false);
  assert.equal(d.aspects.assignment.repeated, true);
  assert.equal(d.aspects.project.repeated, false);
  assert.equal(d.aspects.project.singleHelpful, 1);
  assert.equal(d.aspects.assignment.singleHelpful, null);
});
test('후기 선호: 근거가 있을 때만, 전체 도움돼요 수로 과목을 높이지 않는다', () => {
  const noProject = computeDigest('L', [rv(1, LONG, 5000)], [], false);
  assert.equal(prefScore({ course: { id: 'L' } }, ['project'], { L: noProject }), 0, '프로젝트 근거 없으면 0');
  const a = computeDigest('L', [rv(1, '프로젝트 경험이 좋았고 팀으로 나눠서 했어요.', 0), rv(2, '프로젝트 경험이 좋았어요. 설명도 괜찮았습니다.', 0), rv(3, '프로젝트는 없고 시험 위주로 진행됐어요. 과제 적음.', 0)], [], false);
  const b = computeDigest('L', [rv(1, '프로젝트 경험이 좋았고 팀으로 나눠서 했어요.', 5000), rv(2, '프로젝트 경험이 좋았어요. 설명도 괜찮았습니다.', 0), rv(3, '프로젝트는 없고 시험 위주로 진행됐어요. 과제 적음.', 0)], [], false);
  const sa = prefScore({ course: { id: 'L' } }, ['project'], { L: a });
  const sb = prefScore({ course: { id: 'L' } }, ['project'], { L: b });
  assert.ok(sb > sa && sb <= 4, `비중만 바뀌고 상한 안: ${sa} → ${sb}`);
});
test('반응이 바뀌어도 내용 해시는 그대로, 내용이 바뀌면 달라진다', () => {
  const a = computeDigest('L', [rv(1, LONG, 0)], [], false);
  const b = computeDigest('L', [rv(1, LONG, 3)], [], false);
  const c = computeDigest('L', [rv(1, `${LONG} 추가`, 3)], [], false);
  assert.equal(a.sourceHash, b.sourceHash);
  assert.notEqual(a.reactionHash, b.reactionHash);
  assert.notEqual(b.sourceHash, c.sourceHash);
});

test('공강 교시 수·수업 없는 평일을 센다', () => {
  const b = prepareBuilder(base(), EMPTY_BUILDER);
  const m = evaluateDraft(base(), EMPTY_BUILDER, b, ['mon1', 'fill', 'tue4']);
  assert.deepEqual([m.gapPeriods, m.freeWeekdays, m.days], [1, 3, 2], '월1·월3 사이 1교시 공강');
  assert.equal(planMetrics([{ weekday: 0, period: 1 }, { weekday: 0, period: 4 }, { weekday: 1, period: 2 }, { weekday: 1, period: 5 }], periods, null).gapPeriods, 4, '날마다 비는 교시를 더한다');
});
const hm = (o) => ({ days: 2, gapPeriods: 1, freeWeekdays: 3, lunchOkDays: 1, lunchBadDays: 1, maxConsecutive: 3, gradFilled: 2, ...o });
test('장단점: 다른 대안보다 나을 때만 가장이라고 한다', () => {
  const h = altHighlights([{ id: 'a', m: hm({ days: 1, gradFilled: 4, maxConsecutive: 4, lunchOkDays: 0 }) }, { id: 'b', m: hm({ days: 4, gapPeriods: 0, freeWeekdays: 1, lunchOkDays: 4, lunchBadDays: 0, maxConsecutive: 1 }) }]);
  const pa = h.a.pros.map((x) => x.key);
  const pb = h.b.pros.map((x) => x.key);
  assert.ok(pa.includes('mostGrad') && pa.includes('fewestDays') && !pa.includes('noGaps'));
  assert.ok(pb.includes('noGaps') && pb.includes('lunchAll') && pb.includes('shortRun') && pb.includes('gradFill') && !pb.includes('mostGrad'));
  assert.ok(h.a.cons.some((x) => x.key === 'longRun') && h.a.cons.some((x) => x.key === 'noLunch'));
  assert.deepEqual(h.b.cons.map((x) => [x.key, x.n]).sort(), [['lessGrad', 2], ['moreDays', 4]].sort());
});
test('장단점: 값이 같으면 가장이라고 하지 않고, 규칙이 없으면 졸업 항목을 말하지 않는다', () => {
  const h = altHighlights([{ id: 'a', m: hm({ gradFilled: null }) }, { id: 'b', m: hm({ gradFilled: null }) }]);
  assert.ok(!h.a.pros.some((x) => ['mostGrad', 'gradFill', 'fewestDays', 'fewestGaps'].includes(x.key)));
  assert.ok(!h.a.cons.some((x) => x.key === 'noGrad'));
  assert.ok(altHighlights([{ id: 'a', m: hm({ gradFilled: 0 }) }]).a.cons.some((x) => x.key === 'noGrad'));
});

// ---- 캠퍼스 지도
const campus = { buildings: [
  { id: 'b1', ko: '1호관', ja: '1号館', aliases: ['보건실', '교무'], facilities: [{ ko: '학생부·보건실 (3층)', ja: '学生部・保健室 (3階)' }] },
  { id: 'b2', ko: '2호관', ja: '2号館', aliases: [], facilities: [] },
  { id: 'chuo', ko: '중앙회관', ja: '中央会館', aliases: ['학식', '学食'], facilities: [{ ko: '학생식당', ja: '学生食堂' }] },
  { id: 'b8', ko: '8호관', ja: '8号館', aliases: [], facilities: [] },
] };
test('강의실 번호 규칙: 공식·추정을 구분하고 모르면 추측하지 않는다', () => {
  assert.deepEqual([parseRoom('S207').buildingId, parseRoom('S207').wing, parseRoom('S207').floor, parseRoom('S207').number, parseRoom('S207').basis], ['b1', 'S', 2, '07', 'official']);
  assert.deepEqual([parseRoom('N404A').floor, parseRoom('N404A').basis], [4, 'official']);
  assert.deepEqual([parseRoom('2W407').buildingId, parseRoom('2W407').wing, parseRoom('2W407').floor], ['b2', 'W', 4]);
  assert.deepEqual([parseRoom('OA1').buildingId, parseRoom('OA1').floor], ['b1', 6]);
  assert.deepEqual([parseRoom('パソコン教室2').buildingId, parseRoom('パソコン教室2').floor], ['chuo', 4]);
  assert.deepEqual([parseRoom('8315').buildingId, parseRoom('8315').floor, parseRoom('8315').basis], ['b8', 3, 'inferred']);
  assert.deepEqual([parseRoom('12409').buildingId, parseRoom('12409').floor], ['b12', 4]);
  assert.equal(parseRoom('デザ実1/15201').buildingId, 'b15');
  assert.equal(parseRoom('42(中央会館4階)').buildingId, 'chuo');
  for (const x of ['研究室', 'デジタルラボ502', '5201', '陶芸室', '']) assert.equal(parseRoom(x), null, x);
});
test('장소 찾기: 번호·시설·이름, 없으면 빈 결과', () => {
  assert.equal(findPlaces(campus, 'S201 어디야?')[0].room.floor, 2);
  assert.equal(findPlaces(campus, '보건실 어디야')[0].building.id, 'b1');
  assert.equal(findPlaces(campus, '保健室')[0].building.id, 'b1');
  assert.equal(findPlaces(campus, '학식')[0].building.id, 'chuo');
  assert.equal(findPlaces(campus, '수영장 찾아줘').length, 0);
  assert.equal(findPlaces(campus, '어디야').length, 0);
});
const cand = (id, track = 'kiso') => ({ course: { id, name: id, track } });
const dg = (w, o = {}) => ({ count: 3, demoCount: 3, demoIncluded: true, weighted: { workload: w, difficulty: 2 }, workload: { avg: w, mixed: false }, difficulty: { avg: 2, mixed: false }, aspects: {}, smallSample: false, evidencePostIds: [1], ...o });
test('후기 종합: 교양 비교는 차이가 뚜렷할 때만, 후기 없는 과목은 빼고, 저장 요약을 붙인다', () => {
  const digests = { x: dg(1.5, { storedOverview: { ko: '요약', ja: '要約' } }), y: dg(3.5), z: dg(1.7) };
  const n = altReviewNotes([{ id: 'a', courses: [cand('x'), cand('none')] }, { id: 'b', courses: [cand('y')] }, { id: 'c', courses: [cand('z')] }], digests);
  assert.deepEqual(n.a.map((r) => r.id), ['x']);
  assert.deepEqual([n.a[0].betterThan.id, n.a[0].betterThan.workload], ['y', 3.5]);
  assert.ok(n.a[0].tags.includes('lightWork'));
  assert.equal(n.a[0].overview.ko, '요약');
  assert.equal(n.b[0].betterThan, null);
  assert.equal(n.c[0].betterThan.id, 'y');
  assert.equal(altReviewNotes([{ id: 'a', courses: [cand('x', 'major')] }, { id: 'b', courses: [cand('y', 'kiso')] }], digests).a[0].betterThan, null, '다른 묶음끼리 비교하지 않는다');
  assert.equal(altReviewNotes([{ id: 'a', courses: [cand('x')] }, { id: 'b', courses: [cand('z')] }], digests).a[0].betterThan, null, '0.5 미만 차이는 낫다고 하지 않는다');
});
test('후기 동률 처리: 다른 조건이 같으면 후기 부담이 적은 과목을 먼저 고른다', () => {
  const od = { courses: [course('good', '후기좋음', [[2, 5]]), course('fills', '영역채움', [[3, 2]], { depts: ['RS'] })], calendar: { year: 2026 }, periods: { items: periods } };
  const digests = { good: dg(1), fills: dg(5) };
  const input = base({ od, digests, count: 1 });
  const light = buildAlternatives(input, EMPTY_BUILDER).alternatives.find((a) => a.key === 'requirement');
  assert.deepEqual(light.ids, ['good'], '조건이 같으면 후기가 나은 과목');
});

console.log(`\n${passed} passed`);
