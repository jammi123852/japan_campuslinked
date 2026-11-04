// 공유 API 서버 테스트 (임시 DB 사용, 실제 데이터에 영향 없음). 실행: node scripts/test-server.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'ksu-api-test-'));
const DB_PATH = join(dir, 'test.sqlite');
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = 'https://jammi123852.github.io';

function start() {
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH },
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
const api = async (path, { method = 'GET', body, token, origin = ORIGIN } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
};

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`); };

let server = await start();
try {
  let tokenA, tokenB, postId;
  await test('상태 확인 + 예시 글 3개', async () => {
    const r = await api('/api/health');
    assert.equal(r.status, 200); assert.equal(r.json.posts, 3);
  });
  await test('CORS: 허용 주소만 Allow-Origin', async () => {
    assert.equal((await api('/api/health')).headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal((await api('/api/health', { origin: 'https://evil.example' })).headers.get('access-control-allow-origin'), null);
  });
  await test('세션 발급 (닉네임 검증)', async () => {
    assert.equal((await api('/api/session', { method: 'POST', body: { nickname: '' } })).status, 422);
    assert.equal((await api('/api/session', { method: 'POST', body: { nickname: 'x'.repeat(21) } })).status, 422);
    tokenA = (await api('/api/session', { method: 'POST', body: { nickname: '기기A' } })).json.token;
    tokenB = (await api('/api/session', { method: 'POST', body: { nickname: '기기B' } })).json.token;
    assert.ok(tokenA && tokenB && tokenA !== tokenB);
  });
  await test('세션 없이 글쓰기 거부', async () => {
    assert.equal((await api('/api/posts', { method: 'POST', body: { category: 'class_question', title: 't', body: 'b' } })).status, 401);
    assert.equal((await api('/api/posts', { method: 'POST', token: 'x'.repeat(30), body: { category: 'class_question', title: 't', body: 'b' } })).status, 401);
  });
  await test('입력 검증: 빈 제목·본문, 길이 초과, 잘못된 분류', async () => {
    const bad = [
      { category: 'class_question', title: '  ', body: 'b' },
      { category: 'class_question', title: 't', body: '' },
      { category: 'class_question', title: 'x'.repeat(81), body: 'b' },
      { category: 'nope', title: 't', body: 'b' },
    ];
    for (const b of bad) assert.equal((await api('/api/posts', { method: 'POST', token: tokenA, body: b })).status, 422);
  });
  await test('글쓰기 + 같은 clientId 재전송은 한 번만 저장', async () => {
    const body = { category: 'class_question', title: '통계 질문', body: '시험 범위?', lectureId: 'lec-statistics', clientId: 'c-1' };
    const r1 = await api('/api/posts', { method: 'POST', token: tokenA, body });
    const r2 = await api('/api/posts', { method: 'POST', token: tokenA, body });
    assert.equal(r1.status, 201); assert.equal(r2.status, 200); assert.equal(r1.json.post.id, r2.json.post.id);
    postId = r1.json.post.id;
    assert.equal((await api('/api/health')).json.posts, 4);
  });
  await test('목록: 분류·강의 필터, 작성자 정보 비노출(익명)', async () => {
    const byLecture = (await api('/api/posts?lectureId=lec-statistics')).json.posts;
    assert.ok(byLecture.some((p) => p.id === postId));
    const cat = (await api('/api/posts?category=textbook')).json.posts;
    assert.ok(cat.every((p) => p.category === 'textbook'));
    const p = byLecture.find((x) => x.id === postId);
    assert.equal(p.author, null); assert.equal(p.anonymous, true);
    const raw = JSON.stringify(await api('/api/posts')) + JSON.stringify(await api(`/api/posts/${postId}`));
    assert.ok(!raw.includes('author_session') && !raw.includes(tokenA) && !raw.includes('기기A'));
  });
  await test('다른 세션(기기B)에서 같은 글 조회 + 댓글, 글쓴이 표시', async () => {
    assert.equal((await api(`/api/posts/${postId}/comments`, { method: 'POST', token: tokenB, body: { body: '' } })).status, 422);
    assert.equal((await api(`/api/posts/${postId}/comments`, { method: 'POST', token: tokenB, body: { body: '작년엔 5장까지였어요', clientId: 'k1' } })).status, 201);
    assert.equal((await api(`/api/posts/${postId}/comments`, { method: 'POST', token: tokenB, body: { body: '작년엔 5장까지였어요', clientId: 'k1' } })).status, 200);
    assert.equal((await api(`/api/posts/${postId}/comments`, { method: 'POST', token: tokenA, body: { body: '감사합니다', anonymous: false } })).status, 201);
    const d = (await api(`/api/posts/${postId}`)).json;
    assert.equal(d.comments.length, 2);
    assert.deepEqual(d.comments.map((c) => [c.author, c.isPostAuthor]), [[null, false], ['기기A', true]]);
    assert.equal(d.post.commentCount, 2);
  });
  await test('없는 글 404, 잘못된 JSON 400', async () => {
    assert.equal((await api('/api/posts/99999')).status, 404);
    const r = await fetch(BASE + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
    assert.equal(r.status, 400);
  });

  await stop(server);
  server = await start();
  await test('재시작 후 글·댓글 유지, 예시 글 중복 삽입 없음, 기존 세션 유효', async () => {
    assert.equal((await api('/api/health')).json.posts, 4);
    assert.equal((await api(`/api/posts/${postId}`)).json.comments.length, 2);
    assert.equal((await api(`/api/posts/${postId}/comments`, { method: 'POST', token: tokenB, body: { body: '재시작 후 댓글' } })).status, 201);
  });
} finally {
  await stop(server);
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${passed} passed`);
