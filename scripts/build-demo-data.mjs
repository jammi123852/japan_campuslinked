#!/usr/bin/env node
/**
 * 공개 데모용 가상 학교 자료를 만든다. 실제 학교 자료(과목·교원·시간표·규정)를 하나도 쓰지 않는다.
 * - 과목명은 일반적인 이름, 교원은 'デモ教員A' 식 가상 표시, 시간·학점·졸업 요건 숫자도 가상.
 * - 학부·학과 이름과 공식 링크는 이미 공개된 공개 최소본(public-min.json)만 쓴다.
 * 사용: node scripts/build-demo-data.mjs <출력 폴더>   → <출력>/official/{ksu-2026,courses-2026,showcase,public-min}.json
 */
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('출력 폴더를 지정하세요');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = path.join(out, 'official');
fs.mkdirSync(dir, { recursive: true });

const SRC = { id: 'DEMO' };
const DEPT = 'RS';

// ---------------------------------------------------------------- 가상 과목
// [이름, 배당 학년, 구분(必/選択), 학점, 쿼터, [요일, 교시], 분반 수]
const MAJOR = [
  ['情報リテラシー', 1, '必', 2, ['1Q', '2Q'], [0, 2], 1],
  ['プログラミング入門', 1, '必', 2, ['1Q'], [1, 1], 2],
  ['離散数学Ⅰ', 1, '必', 2, ['2Q'], [2, 2], 1],
  ['線形代数Ⅰ', 1, '必', 2, ['1Q'], [3, 1], 1],
  ['微分積分Ⅰ', 1, '必', 2, ['2Q'], [4, 2], 1],
  ['コンピュータ概論', 1, '必', 2, ['3Q'], [0, 3], 1],
  ['Webデザイン基礎', 1, '選択', 2, ['4Q'], [2, 4], 1],
  ['情報数学演習', 1, '選択', 1, ['3Q'], [4, 3], 1],
  ['データ構造とアルゴリズムⅠ', 2, '必', 2, ['1Q'], [0, 1], 2],
  ['オブジェクト指向プログラミング', 2, '必', 2, ['2Q'], [1, 3], 1],
  ['確率・統計', 2, '必', 2, ['1Q'], [2, 1], 1],
  ['計算機アーキテクチャ', 2, '必', 2, ['2Q'], [3, 2], 1],
  ['データベース基礎', 2, '選択', 2, ['3Q'], [1, 2], 1],
  ['ネットワーク基礎', 2, '選択', 2, ['4Q'], [2, 2], 1],
  ['オペレーティングシステム', 2, '選択', 2, ['3Q'], [3, 3], 1],
  ['ソフトウェア工学', 2, '選択', 2, ['4Q'], [4, 1], 1],
  ['数値計算', 2, '選択', 2, ['1Q'], [4, 4], 1],
  ['人工知能入門', 2, '選択', 2, ['2Q'], [0, 4], 1],
  ['機械学習基礎', 3, '選択', 2, ['1Q'], [1, 4], 1],
  ['情報セキュリティ', 3, '選択', 2, ['2Q'], [2, 3], 1],
  ['Webアプリケーション開発', 3, '選択', 2, ['3Q'], [0, 2], 2],
  ['ヒューマンインタフェース', 3, '選択', 2, ['3Q'], [2, 1], 1],
  ['画像処理', 3, '選択', 2, ['4Q'], [1, 1], 1],
  ['組込みシステム', 3, '選択', 2, ['4Q'], [3, 4], 1],
  ['データ可視化', 3, '選択', 2, ['3Q'], [3, 2], 1],
  ['自然言語処理入門', 3, '選択', 2, ['4Q'], [0, 3], 1],
  ['分散システム', 3, '選択', 2, ['1Q'], [3, 3], 1],
  ['モバイルアプリ開発', 3, '選択', 2, ['2Q'], [4, 3], 1],
  ['情報科学演習Ⅰ', 3, '必', 2, ['3Q', '4Q'], [4, 2], 1],
  ['プロジェクト実習', 3, '選択', 2, ['1Q', '2Q'], [2, 4], 1],
  ['情報科学演習Ⅱ', 4, '必', 2, ['1Q', '2Q'], [1, 2], 1],
  ['卒業研究', 4, '必', 6, ['1Q', '2Q', '3Q', '4Q'], [3, 5], 1],
];
const KISO = [
  ['日本語表現', ['1Q'], [1, 2]], ['キャリアデザインⅠ', ['2Q'], [3, 4]], ['心理学入門', ['3Q'], [1, 3]], ['経済学入門', ['4Q'], [2, 3]],
  ['健康とスポーツ', ['1Q'], [4, 5]], ['地域と社会', ['2Q'], [0, 5]], ['哲学入門', ['3Q'], [4, 4]], ['統計リテラシー', ['4Q'], [0, 1]],
  ['日本の文化', ['1Q'], [2, 5]], ['環境と科学', ['3Q'], [1, 5]], ['キャリアデザインⅡ', ['4Q'], [3, 1]], ['導入ゼミ', ['1Q', '2Q'], [4, 1]],
];
const FOREIGN = [
  ['English Reading Ⅰ', ['1Q'], [0, 3]], ['English Reading Ⅱ', ['2Q'], [1, 1]], ['English Communication Ⅰ', ['3Q'], [2, 2]],
  ['English Communication Ⅱ', ['4Q'], [4, 2]], ['中国語Ⅰ', ['1Q'], [3, 5]], ['韓国語Ⅰ', ['3Q'], [3, 1]],
];

const teacher = (i) => `デモ教員${String.fromCharCode(65 + (i % 26))}`;
const termOf = (qs) => (qs.some((q) => q === '1Q' || q === '2Q') ? '前期' : '後期');
const WD = ['月', '火', '水', '木', '金', '土', '日'];
let n = 0;
const courses = [];
function add({ name, year, creditType, credits, quarters, slot, track, kind, categoryRaw, depts, section }) {
  const i = n++;
  const meetings = [{ weekday: slot[0], period: slot[1] }];
  courses.push({
    id: `demo${String(i).padStart(3, '0')}`, ay: 2026, term: termOf(quarters), quarters, track, categoryRaw, program: 'undergrad',
    code: `DEMO${String(i).padStart(4, '0')}`, name, subjectName: name, section, instructor: teacher(i), rooms: [`デモ${100 + (i % 12)}教室`],
    meetings, offTimetable: false, wp: `${WD[slot[0]]}${slot[1]}`, grade: year ? `${year}年` : null, year, numbering: [`${DEPT}DEMO${i}`], depts,
    applies: depts.length ? [{ dept: DEPT, gfbp: false, heads: ['23RS以降'], mark: creditType === '必' ? 'required' : null, cohorts: [[2023, null]], source: SRC }] : [],
    cohortText: '23RS以降', cohortRanges: [[2023, null]], prereq: null, credits, creditType, kind, subjectType: '講義', hasSyllabus: false, practitioner: false,
    source: [SRC], review: [],
  });
}
for (const [name, year, ct, credits, quarters, slot, sections] of MAJOR) {
  for (let s = 0; s < sections; s++) {
    const shifted = s === 0 ? slot : [(slot[0] + 2) % 5, slot[1] === 5 ? 4 : slot[1] + 1];
    add({ name, year, creditType: ct, credits, quarters, slot: shifted, track: 'major', kind: ct === '必' ? '必修' : '選択', categoryRaw: '専門科目 (デモ)', depts: [DEPT], section: String(s + 1).padStart(3, '0') });
  }
}
for (const [name, quarters, slot] of KISO) add({ name, year: 1, creditType: '選択', credits: 2, quarters, slot, track: 'kiso', kind: '基礎教育', categoryRaw: '基礎教育科目 (デモ)', depts: [], section: '001' });
for (const [name, quarters, slot] of FOREIGN) add({ name, year: 1, creditType: '選択', credits: 1, quarters, slot, track: 'foreign', kind: '外国語', categoryRaw: '外国語科目 (デモ)', depts: [], section: '001' });

// ---------------------------------------------------------------- 가상 학교 정보
const pm = JSON.parse(fs.readFileSync(path.join(root, 'public/official/public-min.json'), 'utf8'));
const rule = {
  source: SRC, appliesNote: '공개 데모용 가상 졸업 요건 (실제 학교 규정 아님)',
  categories: { senmon_required: { min: 36, exact: true }, senmon_elective: { min: 44 }, intro: { min: 2, exact: true }, kiso_other: { min: 16 }, english: { min: 6 } },
  flex: { min: 20, from: ['senmon_elective', 'kiso_other', 'english', 'foreign_other'] }, total: 124,
};
const byYear = (y) => [...new Set(courses.filter((c) => c.track === 'major' && c.year === y).map((c) => c.name))];
const meta = {
  version: 1, generatedFrom: 'scripts/build-demo-data.mjs', collectedAt: '2026-11-09', school: 'demo', usage: 'public',
  sources: {
    DEMO: { title: '공개 데모용 가상 자료 (실제 학교 자료 아님)', url: 'https://github.com/jammi123852/japan_campuslinked', note: 'demo' },
    SYLALL: { title: '공개 데모용 가상 강의 목록 (실제 시라버스 아님)', url: 'https://github.com/jammi123852/japan_campuslinked', note: 'demo' },
  },
  calendar: { year: 2026, source: SRC, quarters: [
    { q: '1Q', term: '前期', start: '2026-04-08', end: '2026-05-30', examStart: '2026-06-01', examNote: '데모' },
    { q: '2Q', term: '前期', start: '2026-06-04', end: '2026-07-24', examStart: '2026-07-27', examNote: '데모' },
    { q: '3Q', term: '後期', start: '2026-09-15', end: '2026-11-13', examStart: '2026-11-16', examNote: '데모' },
    { q: '4Q', term: '後期', start: '2026-11-24', end: '2027-01-29', examStart: '2027-02-01', examNote: '데모' },
  ] },
  periods: { items: [1, 2, 3, 4, 5, 6].map((p) => ({ period: p, start: ['09:00', '10:50', '13:00', '14:50', '16:40', '18:30'][p - 1], end: ['10:30', '12:20', '14:30', '16:20', '18:10', '20:00'][p - 1] })), source: SRC },
  examPeriods: { items: [1, 2, 3, 4].map((p) => ({ period: p, start: ['09:30', '11:10', '13:30', '15:10'][p - 1], end: ['10:30', '12:10', '14:30', '16:10'][p - 1] })), source: SRC },
  scope: { courses: '공개 데모용 가상 과목', exams: '공개 데모용 가상 시험', rules: '공개 데모용 가상 졸업 요건' },
  courses: [],
  exams: courses.filter((c) => c.track === 'major' && c.quarters.includes('3Q') && c.quarters.length === 1).slice(0, 4).map((c, i) => ({
    id: `demo-x${i}`, offeringId: c.id, date: `2026-11-${16 + i}`, period: 1 + (i % 3), depts: [DEPT], name: c.name, instructor: c.instructor,
    slots: [c.wp], room: c.rooms[0], items: '持込不可 (デモ)', quarter: '3Q', source: SRC,
  })),
  examNotes: ['공개 데모: 시험 일정은 가상입니다.'],
  departments: {
    'rikou/joho-kagaku': {
      faculty: '理工学部', department: '情報科学科', code: DEPT,
      courses: [{ id: 'tech', ja: '情報技術コース' }, { id: 'math', ja: '情報数理コース' }],
      marks: { required: '＊ 必修 (デモ)', none: '無印 選択 (デモ)' }, marksSource: SRC,
      curriculum: [{ area: '専門科目 (デモ)', years: { 1: byYear(1), 2: byYear(2), 3: byYear(3), 4: byYear(4) } }], curriculumSource: SRC,
      rules: { '23R': rule, '24R': rule, '25R': rule, '26R': rule },
      cap: { yearly: 46, half: 26, yearlyHighGpa: 50, highGpa: 3.0, note: '데모 값', source: SRC }, pageUrl: null, closedNote: null,
    },
  },
  notices: [], scholarships: [], activities: [],
  departmentIndex: pm.departmentIndex.map((d) => ({ ...d, courses: null })),
  tiers: { courses: 'demo', links: 'public_min' },
};

// ---------------------------------------------------------------- 가상 학생 (2024 입학 3학년, 정보기술 코스)
const find = (name) => courses.find((c) => c.name === name);
const cls = (name, year, recordStatus, category) => {
  const c = find(name);
  const p = meta.periods.items.find((x) => x.period === c.meetings[0].period);
  return { year, quarters: c.quarters, weekday: c.meetings[0].weekday, periods: [c.meetings[0].period], start: p.start, end: p.end, name: c.name, section: c.section, instructor: c.instructor, room: c.rooms[0], category, credits: c.credits, ...(recordStatus ? { recordStatus } : {}) };
};
const cat = (name) => { const c = find(name); return c.track === 'kiso' ? (name === '導入ゼミ' ? 'intro' : 'kiso_other') : c.track === 'foreign' ? 'english' : c.creditType === '必' ? 'senmon_required' : 'senmon_elective'; };
const plan = [
  [2024, ['情報リテラシー', 'プログラミング入門', '離散数学Ⅰ', '線形代数Ⅰ', '微分積分Ⅰ', 'コンピュータ概論', 'Webデザイン基礎', '導入ゼミ', '日本語表現', '心理学入門', 'English Reading Ⅰ', 'English Reading Ⅱ']],
  [2025, ['データ構造とアルゴリズムⅠ', 'オブジェクト指向プログラミング', '確率・統計', '計算機アーキテクチャ', 'データベース基礎', 'ネットワーク基礎', 'オペレーティングシステム', 'ソフトウェア工学', '人工知能入門', 'キャリアデザインⅠ', '経済学入門', 'English Communication Ⅰ', 'English Communication Ⅱ']],
  [2026, ['機械学習基礎', '情報セキュリティ', '分散システム', 'モバイルアプリ開発', 'プロジェクト実習', '地域と社会']],
];
const classes = plan.flatMap(([y, names]) => names.map((nm) => cls(nm, y, null, cat(nm))));
for (const nm of ['Webアプリケーション開発', 'ヒューマンインタフェース', 'データ可視化', '情報科学演習Ⅰ', '画像処理', '哲学入門']) classes.push(cls(nm, 2026, 'enrolled', cat(nm)));

const R = (year, grade, evaluation, workload, difficulty, ja, ko) => ({ year, grade, evaluation, workload, difficulty, ja, ko });
const reviews = {
  'データ構造とアルゴリズムⅠ': [R(2025, 2, 'exam', 3, 4, '毎週の小テストで復習のペースがつかめました。', '매주 쪽지시험 덕분에 복습 속도를 잡을 수 있었어요.'), R(2025, 3, 'exam', 2, 4, '擬似コードを自分で書いてみると期末が楽になります。', '의사코드를 직접 써 보면 기말이 편해져요.')],
  'Webアプリケーション開発': [R(2025, 3, 'report', 4, 3, '毎回小さな課題があり、最後に自分のアプリを発表します。', '매번 작은 과제가 있고 마지막에 자기 앱을 발표해요.'), R(2025, 4, 'report', 4, 2, '作業量は多いですが、作ったものがそのまま作品になります。', '작업량은 많지만 만든 게 그대로 포트폴리오가 돼요.'), R(2024, 3, 'mixed', 3, 3, 'チームで進める回が多いので早めに役割を決めると安心です。', '팀으로 하는 회차가 많아서 역할을 일찍 정하면 안심이에요.')],
  '機械学習基礎': [R(2025, 3, 'mixed', 3, 4, '確率・統計を先に取っておくと理解がずっと楽です。', '확률·통계를 먼저 들어 두면 이해가 훨씬 쉬워요.'), R(2025, 3, 'exam', 2, 3, 'ノートの数式を自分で追うのが大事でした。', '노트의 수식을 직접 따라가 보는 게 중요했어요.')],
  'データ可視化': [R(2025, 3, 'report', 3, 2, 'グラフの選び方を毎回フィードバックしてもらえます。', '그래프 고르는 법을 매번 피드백 받을 수 있어요.')],
  '確率・統計': [R(2025, 2, 'exam', 2, 4, '演習問題を解く量で点数が決まる感じでした。', '연습문제를 푼 양만큼 점수가 나오는 느낌이었어요.'), R(2024, 2, 'exam', 3, 5, '前半の確率の範囲でつまずくと後半が大変です。', '전반부 확률 범위에서 막히면 후반이 힘들어요.')],
  '日本語表現': [R(2024, 1, 'report', 2, 1, 'レポートの書き方を一から教えてもらえて他の授業にも役立ちました。', '레포트 쓰는 법을 처음부터 알려 줘서 다른 수업에도 도움이 됐어요.')],
};
const showcase = {
  notice: '공개 데모용 가상 후기입니다. 실제 학생 후기가 아닙니다.',
  courses: Object.fromEntries(Object.entries(reviews).map(([nm, rv]) => [find(nm).id, {
    reviews: rv,
    questions: [{ ja: '初めてでもついていけますか?', ko: '처음이어도 따라갈 수 있나요?', answers: [{ ja: '最初の数回で基礎を復習してくれるので大丈夫でした。(デモ)', ko: '처음 몇 번은 기초를 복습해 줘서 괜찮았어요. (데모)' }] }],
  }])),
  history: { profile: { facultyId: 'rikou', departmentId: 'joho-kagaku', admissionYear: 2024, currentGrade: 3, courseName: '情報技術コース' }, classes },
};

fs.writeFileSync(path.join(dir, 'ksu-2026.json'), JSON.stringify(meta));
fs.writeFileSync(path.join(dir, 'courses-2026.json'), JSON.stringify({ version: 1, collectedAt: '2026-11-09', count: courses.length, courses }));
fs.writeFileSync(path.join(dir, 'showcase.json'), JSON.stringify(showcase));
fs.writeFileSync(path.join(dir, 'public-min.json'), JSON.stringify(pm));
// 미리 번역 표: 가상 과목은 번역 표 없이 원문으로 보여 준다 (빈 표 — 404 콘솔 오류 방지)
fs.writeFileSync(path.join(dir, 'ko-2026.json'), JSON.stringify({ map: {} }));
console.log(`가상 자료: 과목 ${courses.length}개, 시연 학생 수업 ${classes.length}개, 후기 과목 ${Object.keys(reviews).length}개 → ${dir}`);
