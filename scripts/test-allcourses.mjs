// 전 학부 공식 데이터 로직 테스트 (데이터 파일이 있으면 실제 값도 검사)
import { officialText } from '../src/lib/officialText.ts';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { courseCohort, coursesForDept, deptCodeOf, markOf, normalizeCourse, quartersForEntry, ruleLabel, ruleVariantKeys, suggestCategory } from '../src/features/official/courseLogic.ts';
import { computeProgress, pickRule } from '../src/features/records/gradLogic.ts';
import { recommendForShort } from '../src/features/planner/recommend.ts';
import { matchExams } from '../src/features/academic/examLogic.ts';

let n = 0;
const ok = (name, fn) => {
  fn();
  n += 1;
  console.log(`ok - ${name}`);
};
const rec = (over) => ({ id: over.name, year: 2026, quarters: ['1Q'], name: over.name, code: over.code ?? null, section: null, credits: over.credits ?? 2, category: over.category ?? 'unknown', status: over.status ?? 'passed', confirmedAt: 'x', officialId: null, note: '', createdAt: '', updatedAt: '' });

ok('입학연도: 구간 안/밖/표기 없음(null)', () => {
  const c = { cohortRanges: [[2022, 2024]], applies: [] };
  assert.equal(courseCohort(c, 2023), true);
  assert.equal(courseCohort(c, 2025), false);
  assert.equal(courseCohort({ cohortRanges: [], applies: [] }, 2025), null);
  assert.equal(courseCohort({ cohortRanges: [[2025, null]], applies: [] }, 2030), true);
});
ok('입학연도: 같은 과목도 학과 표기를 먼저 본다', () => {
  const c = { cohortRanges: [[2018, 2030]], applies: [{ dept: 'KK', cohorts: [[2025, null]], mark: null, heads: [], source: { id: 'x' } }, { dept: 'KN', cohorts: [[2019, 2024]], mark: null, heads: [], source: { id: 'y' } }] };
  assert.equal(courseCohort(c, 2023, 'KK'), false);
  assert.equal(courseCohort(c, 2023, 'KN'), true);
});
ok('시라버스 구분 → 표시, 시간표 기호는 학과별 범례', () => {
  assert.equal(markOf({ creditType: '選択必修' }), 'selective');
  assert.equal(markOf({ creditType: '必修' }), 'required');
  assert.equal(markOf({ creditType: '必' }), 'required');
  assert.equal(markOf({ applies: [{ dept: 'RS', mark: '△' }] }), 'required_math');
  assert.equal(markOf({ applies: [{ dept: 'UA', mark: '△' }] }), 'selective');
});
ok('쿼터 미확인은 학기 전체로 넣고 assumed 표시', () => {
  assert.deepEqual(quartersForEntry({ quarters: [], term: '後期' }), { quarters: ['3Q', '4Q'], assumed: true });
  assert.deepEqual(quartersForEntry({ quarters: ['1Q'], term: '前期' }), { quarters: ['1Q'], assumed: false });
});
ok('인정 영역 제안: 확실한 것만, 학과별 세부 묶음은 null', () => {
  const simple = { categories: { senmon_required: {}, senmon_elective: {}, kiso_total: {}, english: {} } };
  assert.equal(suggestCategory({ track: 'major', name: 'x', creditType: '必修' }, simple), 'senmon_required');
  assert.equal(suggestCategory({ track: 'major', name: 'x', creditType: '必' }, simple), 'senmon_required');
  assert.equal(suggestCategory({ track: 'foreign', name: 'Reading & WritingⅠ' }, simple), 'english');
  assert.equal(suggestCategory({ track: 'foreign', name: '韓国語Ⅰ' }, simple), 'foreign_other');
  const unit = { categories: { u_req: {}, core: {}, kiso_total: {}, foreign_total: {} } };
  assert.equal(suggestCategory({ track: 'major', name: 'x', creditType: '選択' }, unit), null);
  assert.equal(suggestCategory({ track: 'foreign', name: 'English' }, unit), 'foreign_total');
  assert.equal(suggestCategory({ track: 'teaching', name: 'x' }, simple), null);
});
ok('묶음(pools): 남는 학점만 다음 묶음으로, 같은 학점 이중 합산 없음', () => {
  const rule = { source: { id: 'x' }, appliesNote: '', total: 30, categories: { a: { min: 4 }, kiso_total: { min: 2 } }, pools: [{ id: 'inner', label: 'i', min: 2, from: ['a'] }, { id: 'outer', label: 'o', min: 2, from: ['inner', 'kiso_total'] }] };
  const g = computeProgress([rec({ name: 'A', credits: 8, category: 'a' }), rec({ name: 'K', credits: 3, category: 'kiso_total' })], { key: '26R', rule }, 'actual');
  assert.equal(g.pools[0].earned, 4); // a 초과 4
  assert.equal(g.pools[1].earned, 3); // inner 남은 2 + kiso 초과 1
  assert.equal(g.pools[1].short, 0);
  assert.equal(g.countedTotal, 11);
  // 두 묶음이 같은 영역을 가리켜도 한 번만 센다
  const rule2 = { source: { id: 'x' }, appliesNote: '', total: 10, categories: { a: { min: 2 } }, pools: [{ id: 'p1', label: 'p', min: 1, from: ['a'] }, { id: 'p2', label: 'q', min: 1, from: ['a'] }] };
  const g2 = computeProgress([rec({ name: 'A', credits: 6, category: 'a' })], { key: '26R', rule: rule2 }, 'actual');
  assert.equal(g2.pools[0].earned, 4);
  assert.equal(g2.pools[1].earned, 0);
});
ok('미분류·계획은 취득에 넣지 않고, 총학점만으로 충족 판정 안 함', () => {
  const rule = { source: { id: 'x' }, appliesNote: '', total: 2, categories: { kiso_total: { min: 2 } } };
  const g1 = computeProgress([rec({ name: 'A', status: 'planned', category: 'kiso_total' })], { key: '26R', rule }, 'actual');
  assert.equal(g1.countedTotal, 0);
  assert.equal(g1.verdict, 'short');
  const g2 = computeProgress([rec({ name: 'B', category: 'unknown' })], { key: '26R', rule }, 'actual');
  assert.equal(g2.verdict, 'undetermined');
});
ok('규칙 구분: 코스 이름으로 고르고, 정할 수 없으면 null', () => {
  const rules = { '25R:建築基本コース': { t: 1 }, '25R:建築総合コース': { t: 2 } };
  assert.equal(pickRule(rules, 2025, '建築総合コース').key, '25R:建築総合コース');
  assert.equal(pickRule(rules, 2025, null), null);
  assert.deepEqual(ruleVariantKeys(rules, 2025), ['建築基本コース', '建築総合コース']);
  const gf = { '26R': { t: 0 }, '26R:GFBP': { t: 3 } };
  assert.equal(pickRule(gf, 2026, 'GFBP').key, '26R:GFBP');
  assert.equal(pickRule(gf, 2026, null).key, '26R');
  assert.equal(pickRule(gf, 2022, null), null);
});
ok('학과 필터: 소속 전공 + 전학 공통, 다른 학과 전공 제외', () => {
  const list = [{ id: '1', depts: ['EE'], track: 'major' }, { id: '2', depts: ['RS'], track: 'major' }, { id: '3', depts: [], track: 'kiso' }];
  assert.deepEqual(coursesForDept(list, 'EE').map((x) => x.id), ['1', '3']);
  assert.equal(deptCodeOf('keizai', 'keizai'), 'EE');
});
ok('추천: 입학연도 불일치·쿼터 미확인·인정 미확인 제외, 충돌은 뒤로', () => {
  const base = { track: 'kiso', term: '後期', quarters: ['3Q'], meetings: [{ weekday: 0, period: 1 }], offTimetable: false, cohortRanges: [], applies: [], name: 'A' };
  const rule = { categories: { kiso_total: { min: 2 } } };
  const out = recommendForShort({ courses: [{ ...base, id: 'c' }, { ...base, id: 'd', name: 'B', meetings: [{ weekday: 1, period: 1 }] }, { ...base, id: 'old', cohortRanges: [[2018, 2020]] }, { ...base, id: 'nq', quarters: [] }, { ...base, id: 'tea', track: 'teaching' }], rule, shortCategories: ['kiso_total'], records: [], timetable: [{ weekday: 0, period: 1, courseName: 'X', term: { year: 2026, quarters: ['3Q'] } }], target: { year: 2026, quarter: '3Q' }, admissionYear: 2025, dept: 'EE', interests: [] });
  assert.deepEqual(out.kiso_total.map((r) => r.course.id), ['d', 'c']);
  assert.deepEqual(out.kiso_total[1].conflicts, ['X']);
});
ok('규칙 이름은 한 언어만: 한국어 모드는 한국어, 일본어 모드는 원문 (병기 없음)', () => {
  assert.equal(ruleLabel('専門 必修科目', 'ja'), '専門 必修科目');
  assert.equal(ruleLabel('専門 必修科目', 'ko'), '전공 필수');
});
ok('공식 문구 한국어 변환: 아는 문장은 한국어만, 모르면 대체 문구', () => {
  assert.equal(officialText('3年生ガイダンス: 【24R】以外の3年生は要件が異なる場合あり', 'ko'), '3학년 가이던스 기준: 24R 외의 3학년은 요건이 다를 수 있어요');
  assert.equal(officialText('2026年度 理工学部 3年生ガイダンス (24R 기준)', 'ko'), '2026학년도 이공학부 3학년 가이던스 (24R 기준)');
  assert.equal(officialText('知らない文書', 'ko', '공식 자료 X'), '공식 자료 X');
  assert.equal(officialText('知らない文書', 'ja', '공식 자료 X'), '知らない文書');
});
ok('normalize: 없는 값을 지어내지 않는다', () => {
  const c = normalizeCourse({ id: 'o1', name: '□X', source: [], cohortText: null, code: null, credits: null, quarters: [], meetings: [], rooms: [], review: [], term: null, section: null, instructor: null });
  assert.equal(c.name, 'X');
  assert.equal(c.syllabus, undefined);
  assert.equal(c.cohort, '');
});

const dataFile = new URL('../public/official/courses-2026.json', import.meta.url);
if (existsSync(dataFile)) {
  const { courses } = JSON.parse(readFileSync(dataFile, 'utf8'));
  ok(`실데이터: id 유일, 샘플 혼입 없음 (${courses.length}분반)`, () => {
    assert.equal(new Set(courses.map((c) => c.id)).size, courses.length);
    assert.ok(courses.every((c) => /^o[0-9a-f]{13}$/.test(c.id)));
    assert.ok(courses.every((c) => !c.id.startsWith('lec-')));
  });
  ok('실데이터: 전 학과 코드 존재 + 트랙 분류 보존', () => {
    const depts = new Set(courses.flatMap((c) => c.depts));
    for (const d of ['KK', 'KN', 'HP', 'HC', 'HS', 'EE', 'CB', 'DT', 'DR', 'RS', 'RM', 'RE', 'LL', 'UA', 'UH', 'UC', 'AA', 'AP', 'AD', 'AE', 'AS']) assert.ok(depts.has(d), d);
    const tracks = new Set(courses.map((c) => c.track));
    for (const t of ['major', 'kiso', 'foreign', 'teaching', 'intl', 'gfbp', 'junior']) assert.ok(tracks.has(t), t);
  });
  ok('실데이터: 복수 요일·통년·집중 보존, 교시 범위 정상', () => {
    assert.ok(courses.some((c) => c.meetings.length >= 2));
    assert.ok(courses.some((c) => c.quarters.length === 4));
    assert.ok(courses.some((c) => c.offTimetable));
    assert.ok(courses.every((c) => c.meetings.every((m) => m.weekday >= 0 && m.weekday <= 5 && m.period >= 1 && m.period <= 7)));
  });
  ok('실데이터: 시라버스 없는 분반에 학점·구분을 채우지 않는다', () => {
    assert.ok(courses.filter((c) => !c.hasSyllabus).every((c) => c.credits == null && c.creditType == null && c.kind == null));
  });
  const ops = JSON.parse(readFileSync(new URL('../public/official/ops-2026.json', import.meta.url), 'utf8')).posts;
  ok(`실데이터: 운영팀 글은 분반당 1개, 시라버스 있는 분반만 (${ops.length}개)`, () => {
    assert.equal(new Set(ops.map((p) => p.offeringId)).size, ops.length);
    const has = new Set(courses.filter((c) => c.hasSyllabus).map((c) => c.id));
    assert.ok(ops.every((p) => has.has(p.offeringId)));
  });
  const meta = JSON.parse(readFileSync(new URL('../public/official/ksu-2026.json', import.meta.url), 'utf8'));
  ok('실데이터: 학칙 판 분리 — 2024 정보과학 40학점, 2025·2026 36학점', () => {
    const r = meta.departments['rikou/joho-kagaku'].rules;
    assert.equal(r['24R'].categories.senmon_required.min, 40);
    assert.equal(r['25R'].categories.senmon_required.min, 36);
    assert.equal(r['26R'].categories.senmon_required.min, 36);
    assert.equal(r['22R'], undefined);
  });
  ok('실데이터: 학과별 규칙 영역 합 = 124 (별표 제10)', () => {
    for (const [key, d] of Object.entries(meta.departments)) {
      if (key === 'rikou/joho-kagaku') continue;
      for (const [rk, rule] of Object.entries(d.rules)) {
        const sum = Object.values(rule.categories).reduce((a, c) => a + c.min, 0) + (rule.pools ?? []).reduce((a, p) => a + p.min, 0);
        assert.equal(sum, rule.total, `${key} ${rk}`);
      }
    }
  });
  ok('실데이터: 시험 — 표기 기호가 달라도 분반으로 정확히 찾고, 같은 이름 다른 분반과 섞지 않는다 (원본 F009 11/9 3교시 N202)', () => {
    const list = courses.map(normalizeCourse);
    const c = list.find((x) => x.name === '日本の歴史A' && x.section === '008');
    assert.equal(c.wp.replace('２', '2'), '月2');
    const m = matchExams([{ lectureId: c.id, courseName: c.name, weekday: 0, period: 2 }], list, meta.exams, '3Q')[0];
    assert.equal(m.status, 'matched');
    assert.equal(m.exams[0].date, '2026-11-09');
    assert.equal(m.exams[0].period, 3);
    assert.equal(m.exams[0].room, 'N202');
  });
  const pub = JSON.parse(readFileSync(new URL('../public/official/public-min.json', import.meta.url), 'utf8'));
  ok('공개 최소본: 과목·교원·시라버스·공지 없음', () => {
    assert.equal(pub.usage, 'public_min');
    for (const k of ['courses', 'exams', 'notices', 'departments', 'scholarships']) assert.equal(pub[k], undefined);
    assert.ok(!JSON.stringify(pub).includes('担当'));
  });
}
console.log(`\n${n} passed`);
