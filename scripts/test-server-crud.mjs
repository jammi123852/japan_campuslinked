// 글·댓글 수정 삭제 권한, 데모 분리, 요약 무효화, 지원 안 되는 기능 이름 제거 테스트 (임시 DB·가짜 Anthropic)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = mkdtempSync(join(tmpdir(), 'ksu-crud-'));
const DB_PATH = join(dir, 't.sqlite');
const PORT = 20000 + Math.floor(Math.random() * 1000);
const FAKE = PORT + 1000;
const BASE = `http://127.0.0.1:${PORT}`;
let aiBody = () => ({ kind: 'answer', calls: [{ tool: 'rm_rf' }, { tool: 'get_profile' }], answer: 'a', whyMe: '', unverified: [], courseIds: [], unsupportedTopic: '' });
let aiCalls = 0;
const fake = createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    aiCalls += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    const out = aiBody(b);
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'fake', content: out.__content ?? [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
  });
}).listen(FAKE, '127.0.0.1');
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT), DB_PATH, ANTHROPIC_API_KEY: 'x', ANTHROPIC_BASE_URL: `http://127.0.0.1:${FAKE}`, MAIL_IMAP_USER: '', MAIL_IMAP_PASSWORD: '' }, stdio: 'ignore' });
const api = async (path, { method = 'GET', body, token } = {}) => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; console.log(`ok - ${name}`); };
try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  const me = (await api('/api/session', { method: 'POST', body: { nickname: 'me' } })).json.token;
  const other = (await api('/api/session', { method: 'POST', body: { nickname: 'other' } })).json.token;
  const L = 'o4e0e4b8e4a9c4';
  let postId;
  await test('글 수정: 작성자만, 닉네임을 바꿔도 내 글', async () => {
    const p = await api('/api/posts', { method: 'POST', token: me, body: { category: 'class_question', title: 't', body: 'b', lectureId: null, anonymous: true, clientId: 'c1' } });
    postId = p.json.post.id;
    assert.equal((await api(`/api/posts/${postId}`, { token: me })).json.post.mine, true);
    assert.equal((await api(`/api/posts/${postId}`, { token: other })).json.post.mine, false);
    assert.equal((await api(`/api/posts/${postId}`)).json.post.mine, false);
    const u = { category: 'textbook', title: 't2', body: 'b2', lectureId: null };
    assert.equal((await api(`/api/posts/${postId}`, { method: 'PUT', token: other, body: u })).status, 403);
    assert.equal((await api(`/api/posts/${postId}`, { method: 'PUT', body: u })).status, 401);
    await api('/api/session', { method: 'PUT', token: me, body: { nickname: 'renamed' } });
    assert.equal((await api(`/api/posts/${postId}`, { method: 'PUT', token: me, body: u })).status, 200);
    const got = (await api(`/api/posts/${postId}`, { token: me })).json.post;
    assert.deepEqual([got.title, got.category, got.mine, !!got.updatedAt], ['t2', 'textbook', true, true]);
  });
  await test('댓글 수정·삭제 권한, 글 삭제 시 댓글도 삭제', async () => {
    await api(`/api/posts/${postId}/comments`, { method: 'POST', token: other, body: { body: 'c', anonymous: true, clientId: 'x' } });
    const c = (await api(`/api/posts/${postId}`, { token: other })).json.comments[0];
    assert.equal(c.mine, true);
    assert.equal((await api(`/api/comments/${c.id}`, { method: 'PUT', token: me, body: { body: 'hack' } })).status, 403);
    assert.equal((await api(`/api/comments/${c.id}`, { method: 'DELETE', token: me })).status, 403);
    assert.equal((await api(`/api/comments/${c.id}`, { method: 'PUT', token: other, body: { body: 'c2' } })).status, 200);
    assert.equal((await api(`/api/posts/${postId}`)).json.comments[0].body, 'c2');
    assert.equal((await api(`/api/posts/${postId}`, { method: 'DELETE', token: other })).status, 403);
    assert.equal((await api(`/api/posts/${postId}`, { method: 'DELETE', token: me })).status, 200);
    assert.equal((await api(`/api/posts/${postId}`)).status, 404);
    assert.equal((await api(`/api/comments/${c.id}`, { method: 'DELETE', token: other })).status, 404);
  });
  await test('데모 콘텐츠는 demo=1 일 때만, 알림·실제 집계에 섞이지 않는다', async () => {
    const db = new DatabaseSync(DB_PATH);
    db.prepare("INSERT INTO reviews (lecture_id, taken_year, grade, attendance, evaluation, workload, difficulty, body, author_session, created_at, updated_at, is_demo) VALUES (?, 2025, 2, 'in_person', 'exam', 5, 5, '데모 후기 시험 내용입니다 과제 많음', 'demo-seed:1', 't', 't', 1)").run(L);
    db.prepare("INSERT INTO posts (category, title, body, lecture_id, author_session, author_name, anonymous, is_sample, created_at, is_demo) VALUES ('class_question', '데모 글', '시험', ?, 'demo-seed:p', 'demo', 1, 0, '2026-01-01', 1)").run(L);
    db.close();
    assert.equal((await api(`/api/lectures/${L}/reviews`)).json.reviews.length, 0);
    const d = (await api(`/api/lectures/${L}/reviews?demo=1`)).json.reviews;
    assert.deepEqual([d.length, d[0].isDemo], [1, true]);
    assert.equal((await api('/api/posts')).json.posts.filter((p) => p.isDemo).length, 0);
    assert.equal((await api('/api/posts?demo=1')).json.posts.filter((p) => p.isDemo).length, 1);
    const real = (await api(`/api/lectures/digest?ids=${L}`)).json.digests[L];
    assert.deepEqual([real.count, real.demoCount, real.evidencePostIds.length], [0, 1, 0]);
    assert.equal((await api(`/api/lectures/digest?ids=${L}&demo=1`)).json.digests[L].count, 1);
  });
  await test('요약: 생성·재사용·수정 뒤 오래됨·근거 id 검증·실제 모드 분리', async () => {
    aiBody = (b) => (b.includes('학생 후기') ? { ko: { overview: '요약', workload: '', difficulty: '', evaluation: '', good: [], caution: [], split: [] }, ja: { overview: 'ま', workload: '', difficulty: '', evaluation: '', good: [], caution: [], split: [] }, evidenceReviewIds: [1, 999], evidencePostIds: [999] } : {});
    const rv = await api(`/api/lectures/${L}/reviews`, { method: 'POST', token: me, body: { takenYear: 2025, grade: 2, attendance: 'in_person', evaluation: 'exam', workload: 2, difficulty: 2, body: '수업과 시험이 괜찮았어요 과제도 적어요', clientId: 'r1' } });
    const id = rv.json.review.id;
    assert.equal((await api(`/api/lectures/${L}/summary`)).json.status, 'none');
    const before = aiCalls;
    const s = await api(`/api/lectures/${L}/summary`, { method: 'POST', token: me, body: {} });
    assert.equal(s.json.status, 'fresh');
    assert.ok(!s.json.summary.evidenceReviewIds.includes(999), '없는 근거 id 는 버린다');
    assert.ok(!s.json.summary.evidencePostIds.includes(999));
    assert.equal(aiCalls, before + 1);
    const again = await api(`/api/lectures/${L}/summary`, { method: 'POST', token: me, body: {} });
    assert.deepEqual([again.json.reused, aiCalls], [true, before + 1]);
    assert.equal((await api(`/api/lectures/${L}/summary?demo=1`)).json.status, 'none', '데모 포함 요약과 실제 요약은 따로');
    await api(`/api/reviews/${id}`, { method: 'PUT', token: me, body: { takenYear: 2025, grade: 2, attendance: 'in_person', evaluation: 'exam', workload: 5, difficulty: 2, body: '수업과 시험이 힘들었어요 과제가 많아요', clientId: 'r1' } });
    const stale = (await api(`/api/lectures/${L}/summary`)).json;
    assert.deepEqual([stale.status, stale.summary], ['stale', null], '수정 뒤 옛 요약 글을 내보내지 않는다');
    assert.equal(stale.digest.workload.avg, 5);
    await api(`/api/reviews/${id}`, { method: 'DELETE', token: me });
    const gone = (await api(`/api/lectures/${L}/summary`)).json;
    assert.deepEqual([gone.status, gone.digest.count, gone.summary], ['no_reviews', 0, null]);
  });
  await test('도우미: 허용 목록 밖 기능 이름은 버리고, 세션 없으면 거부', async () => {
    aiBody = () => ({ kind: 'call', calls: [{ tool: 'run_sql' }, { tool: 'get_profile' }], answer: '', whyMe: '', unverified: [], courseIds: [], unsupportedTopic: '' });
    assert.equal((await api('/api/ai/assistant', { method: 'POST', body: { question: 'q' } })).status, 401);
    const r = await api('/api/ai/assistant', { method: 'POST', token: me, body: { question: 'q', lang: 'ko' } });
    assert.deepEqual(r.json.calls.map((c) => c.tool), ['get_profile']);
  });
  await test('번역: 같은 문장은 호출 없이 재사용, 내용이 바뀌면 다시 번역', async () => {
    aiBody = () => ({ items: [{ i: 0, out: '翻訳' }] });
    const before = aiCalls;
    const a = await api('/api/ai/translate-content', { method: 'POST', token: me, body: { texts: ['안녕'], target: 'ja' } });
    assert.equal(a.json.translations[0], '翻訳');
    await api('/api/ai/translate-content', { method: 'POST', token: me, body: { texts: ['안녕'], target: 'ja' } });
    assert.equal(aiCalls, before + 1);
    await api('/api/ai/translate-content', { method: 'POST', token: me, body: { texts: ['안녕하세요'], target: 'ja' } });
    assert.equal(aiCalls, before + 2);
  });
  await test('공지: 옛 저장 결과도 읽을 때 날짜를 고치고 원본 행은 보존', async () => {
    const { createHash } = await import('node:crypto');
    const text = '옛 공지 본문';
    const legacy = createHash('sha256').update(`notice|${text}||p|2026-11-02`).digest('hex');
    const raw = JSON.stringify({ audienceStatus: 'target', tasks: [], dates: [{ kind: 'deadline', label: '受付', date: '2026-12-24', time: '13:00', rawText: '13:00～17:00', evidence: '' }] });
    const db = new DatabaseSync(DB_PATH);
    db.prepare('INSERT INTO ai_cache (image_hash, result_json, created_at) VALUES (?, ?, ?)').run(legacy, raw, 't');
    const before = aiCalls;
    const r = await api('/api/ai/notice', { method: 'POST', token: me, body: { text, profile: 'p', today: '2026-11-02' } });
    assert.deepEqual([r.json.cached, r.json.dates[0].kind, r.json.dates[0].endTime, aiCalls], [true, 'reception', '17:00', before]);
    assert.equal(db.prepare('SELECT result_json FROM ai_cache WHERE image_hash = ?').get(legacy).result_json, raw);
    db.close();
  });
  await test('글 검색: 제목·본문·저장된 번역, 데모 분리, 빈 결과', async () => {
    const p = (await api('/api/posts', { method: 'POST', token: me, body: { category: 'textbook', title: '教科書はどこで買えますか', body: '購買部にありますか', lectureId: null, anonymous: true, clientId: 'q1' } })).json.post;
    const db = new DatabaseSync(DB_PATH);
    const { createHash } = await import('node:crypto');
    db.prepare('INSERT OR REPLACE INTO translations (hash, target, text, created_at) VALUES (?, ?, ?, ?)').run(createHash('sha256').update(`ko|${p.title}`).digest('hex'), 'ko', '교재는 어디서 사나요', 't');
    db.close();
    const ids = async (q, demo = '') => (await api(`/api/posts?q=${encodeURIComponent(q)}${demo}`)).json.posts.map((x) => x.id);
    assert.ok((await ids('教科書')).includes(p.id));
    assert.ok((await ids('購買部')).includes(p.id));
    assert.ok((await ids('교재는')).includes(p.id), '번역으로도 찾는다');
    assert.deepEqual(await ids('없는단어없는단어'), []);
    assert.deepEqual(await ids('데모 글'), [], '실제 모드에 데모 글 없음');
    assert.equal((await ids('데모 글', '&demo=1')).length, 1);
  });
  await test('자격증 찾기: 검색 결과 주소만 남기고, 같은 직업은 재사용', async () => {
    let step = 0;
    aiBody = () => {
      step += 1;
      return step === 1
        ? { __content: [{ type: 'web_search_tool_result', tool_use_id: 'x', content: [{ type: 'web_search_result', url: 'https://www.ipa.go.jp/x', title: 't' }] }, { type: 'text', text: '조사 내용' }] }
        : { certs: [{ name: '基本情報技術者', nameKo: '기본정보기술자', organizer: 'IPA', officialUrl: 'https://www.ipa.go.jp/x', whyKo: 'k', whyJa: 'j', difficulty: 3, hoursMin: 100, hoursMax: 200, hoursBasis: 'estimate', yearRound: true, scheduleText: '', eligibilityKo: '', eligibilityJa: '', examDates: [{ label: 'a', examDate: '2027-01-01', applyEnd: '', sourceUrl: 'https://made.up/' }], sourceUrls: ['https://www.ipa.go.jp/x'] }, { name: '가짜', nameKo: '가짜', officialUrl: 'https://made.up/', sourceUrls: [], examDates: [] }] };
    };
    const before = aiCalls;
    const r = await api('/api/ai/career-certs', { method: 'POST', token: me, body: { job: '웹 개발자' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.certs.map((c) => c.name), ['基本情報技術者']);
    assert.equal(r.json.certs[0].examDates.length, 0, '검색 결과에 없는 출처의 시험일은 버린다');
    assert.equal(aiCalls, before + 2);
    const again = await api('/api/ai/career-certs', { method: 'POST', token: other, body: { job: ' 웹개발자 ' } });
    assert.deepEqual([again.json.cached, aiCalls], [true, before + 2]);
    assert.equal((await api('/api/ai/career-certs', { method: 'POST', body: { job: 'x' } })).status, 401);
  });
  await test('검색 요약: 목록에 없는 강의 id 를 버린다', async () => {
    const part = { overview: 'o', points: [{ text: 't', courseIds: ['o4e0e4b8e4a9c4', 'o0000000000000'] }] };
    aiBody = () => ({ ko: part, ja: part });
    const r = await api('/api/ai/search-summary', { method: 'POST', token: me, body: { query: 'q', total: 1, items: [{ id: 'o4e0e4b8e4a9c4', name: 'n' }] } });
    assert.deepEqual(r.json.ko.points[0].courseIds, ['o4e0e4b8e4a9c4']);
    const before = aiCalls;
    assert.equal((await api('/api/ai/search-summary', { method: 'POST', token: me, body: { query: 'q', total: 1, items: [{ id: 'o4e0e4b8e4a9c4', name: 'n' }] } })).json.cached, true);
    assert.equal(aiCalls, before);
  });
  await test('도우미 호출이 공지·시간표 상한을 쓰지 않는다', async () => {
    aiBody = () => ({ kind: 'answer', calls: [], answer: 'a', whyMe: '', unverified: [], courseIds: [], unsupportedTopic: '' });
    for (let i = 0; i < 12; i++) await api('/api/ai/assistant', { method: 'POST', token: other, body: { question: `q${i}`, lang: 'ko' } });
    aiBody = () => ({ summaryKo: 's', summaryJa: 's', audience: '', audienceStatus: 'target', audienceReason: '', tasks: [], materials: [], howTo: '', dates: [], uncertain: [], ko: {}, ja: {} });
    assert.equal((await api('/api/ai/notice', { method: 'POST', token: other, body: { text: '상한 확인', profile: 'p' } })).status, 200);
  });
  console.log(`\n${passed} tests passed`);
} finally {
  server.kill();
  fake.close();
  await new Promise((r) => setTimeout(r, 200));
  rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
