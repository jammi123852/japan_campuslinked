// 강의 검색·시간표 추가 판정 테스트. 실행: node scripts/test-lecture-logic.mjs
import assert from 'node:assert/strict';
import { LECTURES } from '../src/data/lectures.ts';
import { EMPTY_FILTERS, checkAddLecture, lectureToEntries, searchLectures } from '../src/features/lectures/lectureLogic.ts';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`ok - ${name}`); };
const ids = (list) => list.map((l) => l.id);
const f = (o) => ({ ...EMPTY_FILTERS, ...o });

test('필터 없으면 전체', () => assert.equal(searchLectures(LECTURES, EMPTY_FILTERS).length, LECTURES.length));
test('과목명 한국어 검색', () => assert.deepEqual(ids(searchLectures(LECTURES, f({ query: '통계' }))), ['lec-statistics']));
test('과목명 일본어 검색 + 전각/공백 무시', () => assert.deepEqual(ids(searchLectures(LECTURES, f({ query: ' 統計 ' }))), ['lec-statistics']));
test('교수 표시명 검색', () => assert.deepEqual(ids(searchLectures(LECTURES, f({ query: '교원 C' }))), ['lec-english-comm']));
test('키워드 검색 (대소문자 무시)', () => assert.deepEqual(ids(searchLectures(LECTURES, f({ query: 'python' }))), ['lec-programming-1']));
test('학부 필터', () => assert.deepEqual(ids(searchLectures(LECTURES, f({ facultyId: 'keizai' }))), ['lec-statistics', 'lec-microecon']));
test('검색 + 학년 + 요일 + 출석 방식 동시 적용', () => {
  assert.deepEqual(ids(searchLectures(LECTURES, f({ facultyId: 'rikou', grade: 1, weekday: 2, attendance: 'hybrid' }))), ['lec-programming-1']);
  assert.deepEqual(ids(searchLectures(LECTURES, f({ query: '통계', attendance: 'online' }))), []);
});
test('요일 필터는 여러 수업 시간 중 하나만 맞아도 포함', () => assert.ok(ids(searchLectures(LECTURES, f({ weekday: 3 }))).includes('lec-english-comm')));
test('결과 없음', () => assert.equal(searchLectures(LECTURES, f({ query: '존재하지않는과목' })).length, 0));

const eng = LECTURES.find((l) => l.id === 'lec-english-comm');
let n = 0; const mk = () => `id-${n++}`;
test('빈 시간표에는 추가 가능, 수업 시간마다 한 칸', () => {
  assert.deepEqual(checkAddLecture(eng, []), { kind: 'ok' });
  const es = lectureToEntries(eng, '영어 커뮤니케이션', mk);
  assert.deepEqual(es.map((e) => [e.weekday, e.period, e.lectureId]), [[0, 4, 'lec-english-comm'], [3, 4, 'lec-english-comm']]);
});
test('같은 강의 중복 추가 막음', () => {
  const tt = lectureToEntries(eng, 'x', mk);
  assert.equal(checkAddLecture(eng, tt).kind, 'duplicate');
});
test('같은 시간 다른 수업이면 충돌 목록', () => {
  const tt = [{ id: 'a', courseName: '내 수업', weekday: 3, period: 4, source: { kind: 'user_input' } }];
  assert.deepEqual(checkAddLecture(eng, tt), { kind: 'conflict', conflicts: [{ weekday: 3, period: 4, courseName: '내 수업' }] });
});
test('모든 강의는 샘플 출처이고 공식 링크가 없다', () => {
  for (const l of LECTURES) { assert.equal(l.source.kind, 'demo'); assert.equal(l.syllabusUrl, null); }
});
console.log(`\n${passed} passed`);
