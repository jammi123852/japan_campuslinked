// 후기 도움돼요 서버 동작 테스트 (임시 DB·가짜 Anthropic). 실행: node --disable-warning=ExperimentalWarning scripts/test-server-helpful.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = mkdtempSync(join(tmpdir(), 'ksu-helpful-test-'));
const DB_PATH = join(dir, 't.sqlite');
const PORT = 21000 + Math.floor(Math.random() * 1000);
const FAKE = PORT + 1000;
const BASE = `http://127.0.0.1:${PORT}`;
let aiCalls = 0;
const fake = createServer((req, res) => {
  let b = '';
  req.on('data', (d) => (b += d));
  req.on('end', () => {
    aiCalls += 1;
    const lang = { overview: '요약', workload: '', difficulty: '', evaluation: '', good: [], caution: [], split: [], repeated: [], helpfulNotes: [], missingInfo: [] };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'fake', content: [{ type: 'text', text: JSON.stringify({ ko: lang, ja: lang, evidenceReviewIds: [999], evidencePostIds: [] }) }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
await new Promise((r) => fake.listen(FAKE, '127.0.0.1', r));
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT), DB_PATH, ANTHROPIC_API_KEY: 'x', ANTHROPIC_BASE_URL: `http://127.0.0.1:${FAKE}`, MAIL_IMAP_USER: '', MAIL_IMAP_PASSWORD: '' }, stdio: ['ignore', 'pipe', 'ignore'] });
await new Promise((r) => server.stdout.on('data', (d) => d.toString().includes('listening') && r()));
const api = async (path, { method = 'GET', body, token } = {}) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Origin: 'https://jammi123852.github.io', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const session = async (nickname) => (await api('/api/session', { method: 'POST', body: { nickname } })).json.token;
let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; console.log(`ok - ${name}`); };
const L = 'o4e0e4b8e4a9c4';
const review = { takenYear: 2025, grade: 2, attendance: 'in_person', evaluation: 'exam', workload: 3, difficulty: 3, body: '시험 비중이 크고 과제는 적당했어요. 복습이 필요합니다.' };
try {
  const A = await session('작성자');
  const B = await session('읽는이');
  const C = await session('다른이');
  const id = (await api(`/api/lectures/${L}/reviews`, { method: 'POST', token: A, body: { ...review, clientId: 'c1' } })).json.review.id;
  const count = async (tok, q = '') => (await api(`/api/lectures/${L}/reviews${q}`, { token: tok })).json.reviews.find((r) => r.id === id);

  await test('추천·취소, 연속 요청에도 1개, 수는 서버 집계', async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, () => api(`/api/reviews/${id}/helpful`, { method: 'PUT', token: B })));
    assert.ok(rs.every((r) => r.status === 200));
    assert.equal((await count(B)).helpfulCount, 1);
    assert.equal((await count(B)).helpedByMe, true);
    assert.equal((await count(C)).helpedByMe, false);
    const off = await api(`/api/reviews/${id}/helpful`, { method: 'DELETE', token: B });
    assert.deepEqual([off.json.helpfulCount, off.json.helpedByMe], [0, false]);
    const off2 = await api(`/api/reviews/${id}/helpful`, { method: 'DELETE', token: B });
    assert.equal(off2.json.helpfulCount, 0, '취소를 또 해도 음수가 되지 않는다');
  });
  await test('클라이언트가 보낸 수는 무시', async () => {
    const r = await api(`/api/reviews/${id}/helpful`, { method: 'PUT', token: B, body: { helpfulCount: 9999 } });
    assert.equal(r.json.helpfulCount, 1);
  });
  await test('본인 후기 제한·세션 없음·없는 후기', async () => {
    assert.deepEqual([(await api(`/api/reviews/${id}/helpful`, { method: 'PUT', token: A })).status, (await api(`/api/reviews/${id}/helpful`, { method: 'PUT', token: A })).json.error], [403, 'own_review']);
    assert.equal((await api(`/api/reviews/${id}/helpful`, { method: 'PUT' })).status, 401);
    assert.equal((await api('/api/reviews/999999/helpful', { method: 'PUT', token: B })).status, 404);
  });
  await test('닉네임을 바꿔도 추천·작성자 연결 유지', async () => {
    await api('/api/session', { method: 'PUT', token: B, body: { nickname: '새이름' } });
    await api('/api/session', { method: 'PUT', token: A, body: { nickname: '새작성자' } });
    assert.equal((await count(B)).helpedByMe, true);
    assert.equal((await count(A)).mine, true);
    assert.equal((await api(`/api/reviews/${id}/helpful`, { method: 'PUT', token: A })).status, 403);
  });
  await test('응답에 세션이 나가지 않는다', async () => {
    const raw = JSON.stringify((await api(`/api/lectures/${L}/reviews`, { token: C })).json);
    assert.ok(!raw.includes('session') && !raw.includes(B));
  });
  await test('요약: 반응 변경은 AI 호출 없이 표시만, 재사용·내용 변경은 숨김, 근거 id 검증', async () => {
    const before = aiCalls;
    const s1 = await api(`/api/lectures/${L}/summary`, { method: 'POST', token: C, body: {} });
    assert.equal(s1.json.status, 'fresh');
    assert.equal(aiCalls, before + 1);
    assert.deepEqual(s1.json.summary.evidenceReviewIds, [], '없는 근거 id 제거');
    assert.equal((await api(`/api/lectures/${L}/summary`)).json.status, 'fresh');
    await api(`/api/reviews/${id}/helpful`, { method: 'PUT', token: C });
    const s2 = (await api(`/api/lectures/${L}/summary`)).json;
    assert.equal(s2.status, 'reactions_changed');
    assert.ok(s2.summary, '내용은 같아서 글은 보여 준다');
    assert.equal(s2.digest.weighted.helpfulTotal, 2, '숫자는 바로 최신');
    assert.equal(aiCalls, before + 1, '추천만으로 AI 호출 안 함');
    await api(`/api/reviews/${id}/helpful`, { method: 'DELETE', token: C });
    assert.equal((await api(`/api/lectures/${L}/summary`)).json.status, 'fresh', '취소로 원래 상태면 저장본 재사용');
    await api(`/api/reviews/${id}`, { method: 'PUT', token: A, body: { ...review, body: '내용을 고쳤어요. 시험보다 과제가 더 많았습니다.' } });
    const s3 = (await api(`/api/lectures/${L}/summary`)).json;
    assert.deepEqual([s3.status, s3.summary], ['stale', null]);
    const s4 = await api(`/api/lectures/${L}/summary`, { method: 'POST', token: C, body: {} });
    assert.equal(s4.json.status, 'fresh');
    assert.equal(aiCalls, before + 2, '다시 만들 때만 호출');
    assert.equal((await api(`/api/lectures/${L}/summary`, { method: 'POST', token: C, body: {} })).json.reused, true, '변화 없으면 재사용');
  });
  await test('데모 분리: 실제 모드에서 데모 후기·반응이 안 보이고, 시드 반복에 중복 없음, 데모만 초기화', async () => {
    const seed = (...a) => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/seed-demo.ts', '--db', DB_PATH, ...a], { encoding: 'utf8' });
    seed();
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    const n = (q) => db.prepare(q).get().n;
    const demoReviews = n('SELECT COUNT(*) n FROM reviews WHERE is_demo=1');
    const demoHelp = n('SELECT COUNT(*) n FROM review_helpful WHERE is_demo=1');
    assert.ok(demoReviews > 100 && demoHelp > 100, `${demoReviews}/${demoHelp}`);
    seed();
    assert.equal(n('SELECT COUNT(*) n FROM reviews WHERE is_demo=1'), demoReviews, '다시 실행해도 중복 없음');
    assert.equal(n('SELECT COUNT(*) n FROM review_helpful WHERE is_demo=1'), demoHelp);
    const D = 'o224c727ef27d6';
    const real = (await api(`/api/lectures/${D}/reviews`)).json.reviews;
    const withDemo = (await api(`/api/lectures/${D}/reviews?demo=1`)).json.reviews;
    assert.equal(real.length, 0);
    assert.ok(withDemo.length >= 3 && withDemo.some((r) => r.helpfulCount >= 12));
    const top = withDemo.find((r) => r.helpfulCount >= 12);
    assert.equal(top.helpfulCount, db.prepare('SELECT COUNT(*) n FROM review_helpful WHERE review_id = ?').get(top.id).n, '노출 수 = 저장된 반응');
    assert.equal((await api(`/api/reviews/${top.id}/helpful`, { method: 'PUT', token: B })).status, 404, '실제 모드에서 데모 후기에 반응 불가');
    assert.equal((await api(`/api/reviews/${top.id}/helpful?demo=1`, { method: 'PUT', token: B })).json.helpfulCount, top.helpfulCount + 1);
    // 실제 후기 수는 데모 반응을 세지 않는다
    assert.equal((await api(`/api/reviews/${id}/helpful?demo=1`, { method: 'PUT', token: C })).status, 200);
    assert.equal((await count(B)).helpfulCount, 1, '데모 모드 반응이 실제 수에 섞이지 않음');
    db.close();
    seed('--reset');
    const db2 = new DatabaseSync(DB_PATH, { readOnly: true });
    assert.equal(db2.prepare('SELECT COUNT(*) n FROM reviews WHERE is_demo=1').get().n, 0);
    assert.equal(db2.prepare('SELECT COUNT(*) n FROM reviews WHERE is_demo=0').get().n, 1, '실제 후기 보존');
    assert.equal(db2.prepare('SELECT COUNT(*) n FROM review_helpful WHERE is_demo=0').get().n, 1, '실제 반응 보존');
    db2.close();
  });
  await test('후기 삭제: 반응·근거에서 사라짐', async () => {
    await api(`/api/reviews/${id}`, { method: 'DELETE', token: A });
    const d = (await api(`/api/lectures/${L}/summary`)).json;
    assert.deepEqual([d.status, d.summary, d.digest.count], ['no_reviews', null, 0]);
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM review_helpful WHERE review_id = ?').get(id).n, 0);
    db.close();
  });
  console.log(`\n${passed} passed`);
} finally {
  server.kill('SIGTERM');
  fake.close();
  rmSync(dir, { recursive: true, force: true });
}
