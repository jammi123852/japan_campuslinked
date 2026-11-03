// 시간표 OCR 변환기 테스트 (가상 OCR 좌표 데이터).
// 실행: node scripts/test-parse-timetable.mjs   (Node 23.6+ 는 .ts 를 바로 import 한다)
import assert from 'node:assert/strict';
import { parseTimetable } from '../src/features/timetableImport/parseTimetable.ts';

const line = (text, left, top, width = 60, height = 16) => ({ text, frame: { left, top, width, height } });

/** 월~금 5열, 1~5교시. 열 중심 x = 130,230,…  행 중심 y = 130,230,… */
function grid({ headers = ['月', '火', '水', '木', '金'], periodLabel = (p) => `${p}`, withTimes = false } = {}) {
  const lines = headers.map((h, i) => line(h, 120 + i * 100, 40, 20));
  for (let p = 1; p <= 5; p++) {
    lines.push(line(periodLabel(p), 20, 122 + (p - 1) * 100, 30));
    if (withTimes) {
      lines.push(line(['09:00', '10:40', '13:00', '14:40', '16:20'][p - 1], 10, 142 + (p - 1) * 100, 40));
    }
  }
  return lines;
}

const cell = (col, period, texts) =>
  texts.map((t, k) => line(t, 105 + col * 100, 100 + (period - 1) * 100 + k * 20, 70));

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

test('기본 일본어 표: 요일·교시·과목·강의실·메모', () => {
  const lines = [
    ...grid(),
    ...cell(0, 1, ['情報リテラシー', '1号館 201', '山田']),
    ...cell(2, 3, ['統計学入門', 'A301']),
    ...cell(4, 5, ['英語コミュニケーション']),
  ];
  const r = parseTimetable(lines);
  assert.equal(r.failure, undefined);
  assert.equal(r.periodRows, 5);
  assert.deepEqual(
    r.entries.map((e) => [e.weekday, e.period, e.courseName, e.room ?? null, e.memo ?? null]),
    [
      [0, 1, '情報リテラシー', '1号館 201', '山田'],
      [2, 3, '統計学入門', 'A301', null],
      [4, 5, '英語コミュニケーション', null, null],
    ],
  );
});

test('한국어 표: 월~금, "1교시" 라벨', () => {
  const lines = [
    ...grid({ headers: ['월', '화', '수', '목', '금'], periodLabel: (p) => `${p}교시` }),
    ...cell(1, 2, ['통계학 입문', '3호관 101']),
  ];
  const r = parseTimetable(lines);
  assert.deepEqual(r.entries.map((e) => [e.weekday, e.period, e.courseName, e.room]), [[1, 2, '통계학 입문', '3호관 101']]);
});

test('요일 머리글이 한 줄로 붙어 인식돼도 열을 나눈다', () => {
  const lines = [line('月 火 水 木 金', 110, 40, 440), ...grid().slice(5), ...cell(3, 4, ['ゼミ'])];
  const r = parseTimetable(lines);
  assert.deepEqual(r.entries.map((e) => [e.weekday, e.period, e.courseName]), [[3, 4, 'ゼミ']]);
});

test('왼쪽 시각 라벨을 교시 시작 시각으로 붙인다', () => {
  const lines = [...grid({ periodLabel: (p) => `${p}限`, withTimes: true }), ...cell(0, 2, ['経済学'])];
  const r = parseTimetable(lines);
  assert.equal(r.entries[0].period, 2);
  assert.equal(r.entries[0].startTime, '10:40');
});

test('"1限 9:00~10:30" 한 줄 라벨에서 시작·종료 시각', () => {
  const lines = [
    ...['Mon', 'Tue', 'Wed'].map((h, i) => line(h, 120 + i * 100, 40, 30)),
    line('1限 9:00~10:30', 5, 122, 70),
    line('2限 10:40~12:10', 5, 222, 70),
    ...cell(1, 1, ['Calculus']),
  ];
  const r = parseTimetable(lines);
  assert.deepEqual(r.entries.map((e) => [e.weekday, e.period, e.startTime, e.endTime]), [[1, 1, '09:00', '10:30']]);
});

test('요일로 시작하는 과목명(日本文化論, 月曜演習)을 머리글로 오인하지 않는다', () => {
  const lines = [...grid(), ...cell(0, 2, ['日本文化論']), ...cell(1, 3, ['月曜演習'])];
  const r = parseTimetable(lines);
  assert.deepEqual(r.entries.map((e) => [e.weekday, e.period, e.courseName]), [
    [0, 2, '日本文化論'],
    [1, 3, '月曜演習'],
  ]);
});

test('교시 라벨이 없으면 period=null 로 넘겨 사용자가 고르게 한다', () => {
  const lines = [...['月', '火', '水'].map((h, i) => line(h, 120 + i * 100, 40, 20)), ...cell(2, 2, ['物理'])];
  const r = parseTimetable(lines);
  assert.equal(r.periodRows, 0);
  assert.deepEqual(r.entries.map((e) => [e.weekday, e.period, e.courseName]), [[2, null, '物理']]);
});

test('요일 머리글이 3개 미만이면 실패 사유를 돌려준다', () => {
  const r = parseTimetable([line('時間割', 100, 10), line('情報', 200, 200)]);
  assert.equal(r.failure, 'noWeekdayHeader');
  assert.equal(r.entries.length, 0);
});

test('빈 입력', () => {
  assert.equal(parseTimetable([]).failure, 'noText');
});

test('표 위 제목·바깥 글자는 칸에 넣지 않는다', () => {
  const lines = [line('2026年度 前期 時間割', 150, 5, 200), ...grid(), ...cell(0, 1, ['数学'])];
  const r = parseTimetable(lines);
  assert.equal(r.entries.length, 1);
  assert.ok(r.unassigned.includes('2026年度 前期 時間割'));
});

console.log(`\n${passed} passed`);
