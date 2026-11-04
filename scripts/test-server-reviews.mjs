// 강의 후기·알림 확인 API 테스트 (임시 DB 사용, 실제 데이터에 영향 없음). 실행: node scripts/test-server-reviews.mjs
// 이전 스키마(게시글·댓글만 있던 DB)에서 시작해 마이그레이션 후에도 기존 글이 남는지도 확인한다.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = mkdtempSync(join(tmpdir(), 'ksu-review-test-'));
const DB_PATH = join(dir, 'old.sqlite');
const PORT = 19000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;

// 2026-10-30 이전 서버가 만든 형태의 DB (reviews 테이블 없음) + 기존 글 1개
{
  const old = new DatabaseSync(DB_PATH);
  old.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, nickname TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      lecture_id TEXT, author_session TEXT, author_name TEXT NOT NULL, anonymous INTEGER NOT NULL DEFAULT 1,
      is_sample INTEGER NOT NULL DEFAULT 0, client_id TEXT, created_at TEXT NOT NULL, UNIQUE (author_session, client_id));
    CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      body TEXT NOT NULL, author_session TEXT, author_name TEXT NOT NULL, anonymous INTEGER NOT NULL DEFAULT 1, client_id TEXT,
      created_at TEXT NOT NULL, UNIQUE (author_session, client_id));
  `);
  old.prepare('INSERT INTO meta VALUES (?, ?)').run('seed_v1', '2026-10-30T00:00:00Z');
  old.prepare(`INSERT INTO posts (category, title, body, author_name, created_at) VALUES ('campus_life', '이전 DB의 글', '보존 확인', '옛 사용자', '2026-10-30T00:00:00Z')`).run();
  old.close();
}

function start() {
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH, ANTHROPIC_API_KEY: '' }, // AI 는 키 없이: 실제 API 를 부르지 않는다
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((res, rej) => {
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.stdout.on('data', (d) => d.toString().includes('listening') && res(p));
    p.on('exit', (code) => rej(new Error(`server exited ${code}: ${err}`)));
  });
}
const stop = (p) => new Promise((r) => { p.on('exit', r); p.kill('SIGTERM'); });
const api = async (path, { method = 'GET', body, token } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'https://jammi123852.github.io', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const session = async (nickname) => (await api('/api/session', { method: 'POST', body: { nickname } })).json.token;

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`); };
const LEC = '/api/lectures/lec-statistics/reviews';
const review = (o = {}) => ({ takenYear: 2025, grade: 2, attendance: 'in_person', evaluation: 'exam', workload: 3, difficulty: 4, body: '시험 비중이 커서 복습이 필요해요.', ...o });

let server = await start();
try {
  let A, B, C, reviewId;
  await test('이전 스키마 DB 마이그레이션: 기존 글 유지, 예시 글 재삽입 없음, 후기 테이블 생성', async () => {
    const h = (await api('/api/health')).json;
    assert.equal(h.posts, 1); assert.equal(h.reviews, 0);
    assert.equal((await api('/api/posts')).json.posts[0].title, '이전 DB의 글');
  });
  A = await session('작성자A'); B = await session('다른B'); C = await session('구경C');

  await test('후기 입력 검증 (필수·범위·길이·선택값)', async () => {
    const bad = [
      review({ body: '짧음' }), review({ body: 'x'.repeat(1001) }), review({ grade: 7 }), review({ grade: 1.5 }),
      review({ takenYear: 1999 }), review({ workload: 0 }), review({ difficulty: 6 }), review({ attendance: 'x' }),
      review({ evaluation: '' }), review({ takenYear: '2025' }),
    ];
    for (const b of bad) assert.equal((await api(LEC, { method: 'POST', token: A, body: b })).status, 422, JSON.stringify(b));
    assert.equal((await api(LEC, { method: 'POST', body: review() })).status, 401);
    assert.equal((await api('/api/lectures/..%2Fx/reviews')).status, 422);
  });

  await test('후기 작성 + 같은 clientId 재전송은 1개만, 같은 강의 두 번째 작성은 409', async () => {
    const r1 = await api(LEC, { method: 'POST', token: A, body: review({ clientId: 'r1' }) });
    const r2 = await api(LEC, { method: 'POST', token: A, body: review({ clientId: 'r1' }) });
    assert.equal(r1.status, 201); assert.equal(r2.status, 200); assert.equal(r1.json.review.id, r2.json.review.id);
    reviewId = r1.json.review.id;
    const r3 = await api(LEC, { method: 'POST', token: A, body: review({ clientId: 'r2' }) });
    assert.equal(r3.status, 409); assert.equal(r3.json.reviewId, reviewId);
    assert.equal((await api('/api/health')).json.reviews, 1);
  });

  await test('조회: 다른 세션도 보임, mine 은 본인만 true, 세션·닉네임 비노출', async () => {
    const asA = (await api(LEC, { token: A })).json.reviews;
    const asB = (await api(LEC, { token: B })).json.reviews;
    const anon = (await api(LEC)).json.reviews;
    assert.equal(asA[0].mine, true); assert.equal(asB[0].mine, false); assert.equal(anon[0].mine, false);
    const raw = JSON.stringify(asB);
    assert.ok(!raw.includes('author') && !raw.includes('작성자A') && !raw.includes(A));
  });

  await test('수정·삭제 권한: 남의 후기 403, 본인만 가능', async () => {
    assert.equal((await api(`/api/reviews/${reviewId}`, { method: 'PUT', token: B, body: review({ body: '남이 고친 내용입니다.' }) })).status, 403);
    assert.equal((await api(`/api/reviews/${reviewId}`, { method: 'DELETE', token: B })).status, 403);
    const u = await api(`/api/reviews/${reviewId}`, { method: 'PUT', token: A, body: review({ workload: 5, body: '고친 후기 내용입니다.' }) });
    assert.equal(u.status, 200); assert.equal(u.json.review.workload, 5);
    assert.equal((await api(LEC)).json.reviews[0].body, '고친 후기 내용입니다.');
  });

  await test('알림 확인: 첫 호출은 기준점만(과거 댓글·후기 안 쏟아냄)', async () => {
    // A 의 질문 + B 의 기존 댓글 (A 가 알림 기준점을 정하기 전)
    const post = (await api('/api/posts', { method: 'POST', token: A, body: { category: 'class_question', title: 'A의 질문', body: '?' } })).json.post;
    await api(`/api/posts/${post.id}/comments`, { method: 'POST', token: B, body: { body: '옛 댓글' } });
    const first = (await api('/api/me/activity?lectureIds=lec-statistics', { token: A })).json;
    assert.deepEqual(first.comments, []); assert.deepEqual(first.reviews, []);
    globalThis.cursor = first.cursor; globalThis.postId = post.id;
  });

  await test('알림 확인: 다른 사람 댓글·즐겨찾기 강의 새 후기만, 본인 댓글·본인 후기 제외, 같은 커서로 다시 불러도 커서 이후만', async () => {
    const { cursor, postId } = globalThis;
    await api(`/api/posts/${postId}/comments`, { method: 'POST', token: A, body: { body: '내가 단 댓글' } });
    await api(`/api/posts/${postId}/comments`, { method: 'POST', token: B, body: { body: '새 답변' } });
    await api('/api/lectures/lec-statistics/reviews', { method: 'POST', token: C, body: review({ body: '다른 사람이 쓴 새 후기' }) });
    await api('/api/lectures/lec-marketing/reviews', { method: 'POST', token: C, body: review({ body: '즐겨찾기 아닌 강의 후기' }) });
    const q = `/api/me/activity?afterComment=${cursor.comment}&afterReview=${cursor.review}&lectureIds=lec-statistics`;
    const r = (await api(q, { token: A })).json;
    assert.equal(r.comments.length, 1); assert.equal(r.comments[0].postTitle, 'A의 질문');
    assert.equal(r.reviews.length, 1); assert.equal(r.reviews[0].lectureId, 'lec-statistics');
    assert.ok(!JSON.stringify(r).includes('다른B') && !JSON.stringify(r).includes('새 답변'));
    // 다음 커서로 부르면 같은 이벤트가 다시 오지 않는다
    const again = (await api(`/api/me/activity?afterComment=${r.cursor.comment}&afterReview=${r.cursor.review}&lectureIds=lec-statistics`, { token: A })).json;
    assert.deepEqual(again.comments, []); assert.deepEqual(again.reviews, []);
    // 다른 사용자(B)는 A 글의 댓글 알림을 받지 않는다
    const asB = (await api(q, { token: B })).json;
    assert.deepEqual(asB.comments, []);
    assert.equal((await api('/api/me/activity')).status, 401);
  });

  await test('AI 시간표 인식: 키가 없으면 503, 세션 없으면 401 (실제 API 호출 없음)', async () => {
    assert.equal((await api('/api/health')).json.ai, false);
    assert.equal((await api('/api/ai/timetable', { method: 'POST', body: { image: 'aGk=', mediaType: 'image/png' } })).status, 401);
    const r = await api('/api/ai/timetable', { method: 'POST', token: A, body: { image: 'aGk=', mediaType: 'image/png' } });
    assert.equal(r.status, 503); assert.equal(r.json.error, 'ai_not_configured');
  });

  await stop(server);
  server = await start();
  await test('재시작 후 후기·글 유지, 기존 세션으로 본인 후기 삭제', async () => {
    const h = (await api('/api/health')).json;
    assert.equal(h.reviews, 3); assert.equal(h.posts, 2);
    assert.equal((await api(`/api/reviews/${reviewId}`, { method: 'DELETE', token: A })).status, 200);
    assert.equal((await api(`/api/reviews/${reviewId}`, { method: 'DELETE', token: A })).status, 404);
    assert.equal((await api(LEC)).json.reviews.length, 1);
  });

  await test('공식 분반 id 후기: 분반별로 분리, 닉네임을 바꿔도 내 후기 유지', async () => {
    const tok = await session('닉변전');
    const good = { takenYear: 2026, grade: 3, attendance: 'in_person', evaluation: 'exam', workload: 3, difficulty: 3, body: '실제 수강 경험 검증 문장입니다.', clientId: 'off-1', offering: '[101] 朝廣 2026' };
    const a = await api('/api/lectures/o4e0e4b8e4a9c4/reviews', { method: 'POST', body: good, token: tok });
    assert.equal(a.status, 201);
    assert.equal((await api('/api/lectures/oZZ/reviews', { method: 'GET' })).status, 422, '형식이 틀린 id 거절');
    assert.equal((await api('/api/lectures/o00000000000ab/reviews', { method: 'GET' })).json.reviews.length, 0, '다른 분반에 섞이지 않음');
    const put = await api('/api/session', { method: 'PUT', body: { nickname: '닉변후' }, token: tok });
    assert.equal(put.status, 200);
    const list = await api('/api/lectures/o4e0e4b8e4a9c4/reviews', { method: 'GET', token: tok });
    assert.equal(list.json.reviews[0].mine, true);
    assert.equal((await api('/api/session', { method: 'PUT', body: { nickname: 'x' } })).status, 401, '세션 없으면 변경 불가');
  });
} finally {
  await stop(server);
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${passed} passed`);
