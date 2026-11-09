/**
 * 공개 데모(EXPO_PUBLIC_STATIC_DEMO=1) 전용: 공유 서버 대신 브라우저 안에서 같은 API 를 흉내 낸다.
 * - 저장은 이 브라우저(localStorage)에만 한다. 다른 사람에게 보이지 않는다. 화면 배너가 이를 알린다(몰래 대체 아님).
 * - AI 기능은 키가 없으므로 언제나 'ai_not_configured'(503). 외부로 아무것도 보내지 않는다.
 * - 처음 열면 가상 게시글·댓글을 넣는다(데모 표시). 실제 학생 글이 아니다.
 * 응답 모양은 server/index.ts 의 같은 경로와 맞춘다.
 */
import { computeDigest, helpfulWeight, SUMMARY_VERSION, type DigestPost, type DigestReview } from '../../../server/summaries';

type Post = { id: number; category: string; title: string; body: string; lecture_id: string | null; author_session: string | null; author_name: string; anonymous: number; created_at: string; updated_at: string | null; is_demo: number; client_id: string | null };
type Comment = { id: number; post_id: number; body: string; author_session: string | null; author_name: string; anonymous: number; created_at: string; updated_at: string | null; is_demo: number; client_id: string | null };
type Review = { id: number; lecture_id: string; taken_year: number; grade: number; attendance: string; evaluation: string; workload: number; difficulty: number; body: string; author_session: string; created_at: string; updated_at: string; is_demo: number; client_id: string | null };
type Db = { v: 1; seq: number; sessions: Record<string, string>; posts: Post[]; comments: Comment[]; reviews: Review[]; helpful: { review_id: number; session: string }[] };

const KEY = 'ksu:v1:staticDemoDb';
const CATEGORIES = ['class_question', 'registration', 'textbook', 'campus_life'];

export class DemoHttpError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

const iso = (daysAgo: number, h = 12) => new Date(Date.now() - daysAgo * 86_400_000 + (h - 12) * 3_600_000).toISOString();

function seed(): Db {
  const db: Db = { v: 1, seq: 0, sessions: {}, posts: [], comments: [], reviews: [], helpful: [] };
  const post = (category: string, title: string, body: string, name: string, daysAgo: number, comments: [string, string, number][]) => {
    const id = ++db.seq;
    db.posts.push({ id, category, title, body, lecture_id: null, author_session: null, author_name: name, anonymous: 1, created_at: iso(daysAgo), updated_at: null, is_demo: 1, client_id: null });
    for (const [b, n, d] of comments) db.comments.push({ id: ++db.seq, post_id: id, body: b, author_session: null, author_name: n, anonymous: 1, created_at: iso(d, 15), updated_at: null, is_demo: 1, client_id: null });
  };
  post('class_question', 'データ構造とアルゴリズムの課題、どこまで終わりました?', '今週の課題の3問目で詰まっています。再帰の考え方のコツがあれば教えてください。(デモ投稿)', 'demo1', 1, [['紙に呼び出しの順番を書くと分かりやすかったです。', 'demo2', 1], ['ヒントは前回のスライドの最後にありました!', 'demo3', 0]]);
  post('registration', '4Qの履修、何コマくらい取りますか?', '3年の4Qで演習と選択を合わせて何コマ取るか迷っています。(デモ投稿)', 'demo4', 2, [['演習があるなら選択は2つくらいが楽でした。', 'demo5', 2]]);
  post('textbook', '確率・統計の教科書、譲ります', '去年使った教科書があります。書き込みは少しだけです。(デモ投稿)', 'demo6', 3, []);
  post('campus_life', '図書館の自習室、試験期間は何時まで?', '試験期間は開館時間が延びると聞きましたが本当ですか?(デモ投稿)', 'demo7', 4, [['掲示板に告知が出ると思います。公式のお知らせで確認してください。', 'demo8', 4]]);
  post('class_question', '데이터 시각화 과제 그래프 고르는 법', '막대그래프랑 선그래프 중 어떤 걸 써야 할지 헷갈려요. (데모 글)', 'demo9', 5, [['시간 흐름이면 선, 항목 비교면 막대가 무난했어요.', 'demo10', 5]]);
  return db;
}

function load(): Db {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) return JSON.parse(raw) as Db;
  } catch {
    /* 저장소를 못 쓰면 새로 시작 */
  }
  const db = seed();
  save(db);
  return db;
}
function save(db: Db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* 사생활 보호 창 등에서는 이번 화면 동안만 유지 */
  }
}

const str = (v: unknown, max: number, field: string, required = true) => {
  if (v == null || v === '') {
    if (required) throw new DemoHttpError(422, `${field}_required`);
    return null;
  }
  if (typeof v !== 'string') throw new DemoHttpError(422, `${field}_invalid`);
  const s = v.trim();
  if (required && !s) throw new DemoHttpError(422, `${field}_required`);
  if ([...s].length > max) throw new DemoHttpError(422, `${field}_too_long`);
  return s;
};

const publicPost = (db: Db, p: Post) => ({
  id: p.id, category: p.category, title: p.title, body: p.body, lectureId: p.lecture_id, author: p.anonymous ? null : p.author_name, anonymous: p.anonymous === 1,
  isSample: false, createdAt: p.created_at, updatedAt: p.updated_at, isDemo: p.is_demo === 1, commentCount: db.comments.filter((c) => c.post_id === p.id).length,
});
const helpfulOf = (db: Db, id: number) => db.helpful.filter((h) => h.review_id === id).length;
const publicReview = (db: Db, r: Review, viewer: string | null) => {
  const n = helpfulOf(db, r.id);
  return {
    id: r.id, lectureId: r.lecture_id, takenYear: r.taken_year, grade: r.grade, attendance: r.attendance, evaluation: r.evaluation, workload: r.workload, difficulty: r.difficulty, body: r.body,
    createdAt: r.created_at, updatedAt: r.updated_at, mine: viewer != null && r.author_session === viewer, isDemo: r.is_demo === 1,
    helpfulCount: n, helpedByMe: viewer != null && db.helpful.some((h) => h.review_id === r.id && h.session === viewer), helpfulWeight: Math.round(helpfulWeight(n) * 100) / 100,
  };
};
function reviewInput(b: Record<string, unknown>) {
  const int = (v: unknown, lo: number, hi: number, f: string) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new DemoHttpError(422, `${f}_invalid`);
    return v;
  };
  return {
    taken_year: int(b.takenYear, 2000, 2100, 'takenYear'), grade: int(b.grade, 1, 6, 'grade'), workload: int(b.workload, 1, 5, 'workload'), difficulty: int(b.difficulty, 1, 5, 'difficulty'),
    attendance: str(b.attendance, 20, 'attendance')!, evaluation: str(b.evaluation, 20, 'evaluation')!, body: str(b.body, 1000, 'body')!,
  };
}
function digestRows(db: Db, lectureId: string, demo: boolean) {
  const reviews: DigestReview[] = db.reviews.filter((r) => r.lecture_id === lectureId && (demo || !r.is_demo)).map((r) => ({ id: r.id, workload: r.workload, difficulty: r.difficulty, evaluation: r.evaluation, body: r.body, taken_year: r.taken_year, updated_at: r.updated_at, is_demo: r.is_demo, helpful: helpfulOf(db, r.id) }));
  const posts: DigestPost[] = db.posts.filter((p) => p.lecture_id === lectureId && (demo || !p.is_demo)).map((p) => ({ id: p.id, category: p.category, title: p.title, body: p.body, created_at: p.created_at, updated_at: p.updated_at, is_demo: p.is_demo }));
  return { reviews, posts };
}

/** request() 대신 호출된다. 실패는 DemoHttpError(상태·코드) */
export async function handleDemoRequest(path: string, init: { method?: string; body?: unknown; token?: string }): Promise<unknown> {
  const method = init.method ?? 'GET';
  const url = new URL(path, 'http://demo.local');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const body = (init.body ?? {}) as Record<string, unknown>;
  const demo = url.searchParams.get('demo') === '1';
  const db = load();
  const viewer = init.token && db.sessions[init.token] != null ? init.token : null;
  const need = () => {
    if (!viewer) throw new DemoHttpError(401, 'session_required');
    return { token: viewer, nickname: db.sessions[viewer] };
  };
  const done = <T,>(v: T) => {
    save(db);
    return v;
  };

  // AI: 공개 데모에는 키도 서버도 없다
  if (p === '/api/ai/translate-content') return { translations: {}, unavailable: 'ai_not_configured' };
  if (p.startsWith('/api/ai/')) throw new DemoHttpError(503, 'ai_not_configured');
  if (p === '/api/demo/history' || p === '/api/mail/digest') throw new DemoHttpError(404, 'not_found');

  if (method === 'GET' && p === '/api/health') return { ok: true, posts: db.posts.length, reviews: db.reviews.length, ai: false, demo: true, time: new Date().toISOString() };
  if (method === 'POST' && p === '/api/session') {
    const nickname = str(body.nickname, 20, 'nickname')!;
    const token = `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    db.sessions[token] = nickname;
    return done({ token, nickname });
  }
  if (method === 'PUT' && p === '/api/session') {
    const s = need();
    db.sessions[s.token] = str(body.nickname, 20, 'nickname')!;
    return done({ nickname: db.sessions[s.token] });
  }

  if (method === 'GET' && p === '/api/posts') {
    const category = url.searchParams.get('category');
    const lectureId = url.searchParams.get('lectureId');
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 100);
    const q = (url.searchParams.get('q') ?? '').normalize('NFKC').toLowerCase().trim();
    const has = (s: string) => s.normalize('NFKC').toLowerCase().includes(q);
    const rows = db.posts
      .filter((x) => (demo || !x.is_demo) && (!category || x.category === category) && (!lectureId || x.lecture_id === lectureId) && (!q || has(x.title) || has(x.body)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
      .slice(0, limit);
    return { posts: rows.map((x) => publicPost(db, x)) };
  }
  if (method === 'POST' && p === '/api/posts') {
    const s = need();
    const category = str(body.category, 32, 'category')!;
    if (!CATEGORIES.includes(category)) throw new DemoHttpError(422, 'category_invalid');
    const clientId = str(body.clientId, 64, 'clientId', false);
    const dup = clientId ? db.posts.find((x) => x.author_session === s.token && x.client_id === clientId) : undefined;
    if (dup) return { post: publicPost(db, dup) };
    const row: Post = { id: ++db.seq, category, title: str(body.title, 100, 'title')!, body: str(body.body, 3000, 'body')!, lecture_id: str(body.lectureId, 64, 'lectureId', false), author_session: s.token, author_name: s.nickname, anonymous: body.anonymous === false ? 0 : 1, created_at: new Date().toISOString(), updated_at: null, is_demo: 0, client_id: clientId };
    db.posts.push(row);
    return done({ post: publicPost(db, row) });
  }
  const postOne = /^\/api\/posts\/(\d+)$/.exec(p);
  if (postOne) {
    const id = Number(postOne[1]);
    const row = db.posts.find((x) => x.id === id);
    if (!row) throw new DemoHttpError(404, 'not_found');
    if (method === 'GET') {
      const comments = db.comments
        .filter((c) => c.post_id === id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)
        .map((c) => ({ id: c.id, body: c.body, author: c.anonymous ? null : c.author_name, anonymous: c.anonymous === 1, isPostAuthor: row.author_session != null && c.author_session === row.author_session, createdAt: c.created_at, updatedAt: c.updated_at, isDemo: c.is_demo === 1, mine: viewer != null && c.author_session === viewer }));
      return { post: { ...publicPost(db, row), mine: viewer != null && row.author_session === viewer }, comments };
    }
    const s = need();
    if (row.author_session !== s.token) throw new DemoHttpError(403, 'forbidden');
    if (method === 'DELETE') {
      db.posts = db.posts.filter((x) => x.id !== id);
      db.comments = db.comments.filter((c) => c.post_id !== id);
      return done({ ok: true });
    }
    if (method === 'PUT') {
      const category = str(body.category, 32, 'category')!;
      if (!CATEGORIES.includes(category)) throw new DemoHttpError(422, 'category_invalid');
      Object.assign(row, { category, title: str(body.title, 100, 'title')!, body: str(body.body, 3000, 'body')!, lecture_id: str(body.lectureId, 64, 'lectureId', false), updated_at: new Date().toISOString() });
      return done({ post: publicPost(db, row) });
    }
  }
  const commentAdd = /^\/api\/posts\/(\d+)\/comments$/.exec(p);
  if (method === 'POST' && commentAdd) {
    const s = need();
    const postId = Number(commentAdd[1]);
    if (!db.posts.some((x) => x.id === postId)) throw new DemoHttpError(404, 'not_found');
    const clientId = str(body.clientId, 64, 'clientId', false);
    if (clientId && db.comments.some((c) => c.author_session === s.token && c.client_id === clientId)) return { ok: true, duplicate: true };
    db.comments.push({ id: ++db.seq, post_id: postId, body: str(body.body, 1000, 'body')!, author_session: s.token, author_name: s.nickname, anonymous: body.anonymous === false ? 0 : 1, created_at: new Date().toISOString(), updated_at: null, is_demo: 0, client_id: clientId });
    return done({ ok: true });
  }
  const commentOne = /^\/api\/comments\/(\d+)$/.exec(p);
  if (commentOne && (method === 'PUT' || method === 'DELETE')) {
    const s = need();
    const c = db.comments.find((x) => x.id === Number(commentOne[1]));
    if (!c) throw new DemoHttpError(404, 'not_found');
    if (c.author_session !== s.token) throw new DemoHttpError(403, 'forbidden');
    if (method === 'DELETE') db.comments = db.comments.filter((x) => x.id !== c.id);
    else Object.assign(c, { body: str(body.body, 1000, 'body')!, updated_at: new Date().toISOString() });
    return done({ ok: true });
  }

  if (method === 'GET' && p === '/api/lectures/digest') {
    const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean).slice(0, 400);
    const digests: Record<string, unknown> = {};
    for (const id of ids) {
      const { reviews, posts } = digestRows(db, id, demo);
      if (reviews.length || posts.length) digests[id] = computeDigest(id, reviews, posts, demo);
    }
    return { digests };
  }
  const summary = /^\/api\/lectures\/([^/]+)\/summary$/.exec(p);
  if (summary) {
    const id = decodeURIComponent(summary[1]);
    const { reviews, posts } = digestRows(db, id, demo);
    const digest = computeDigest(id, reviews, posts, demo);
    if (method === 'POST' && digest.count > 0) throw new DemoHttpError(503, 'ai_not_configured');
    return { digest, status: digest.count === 0 ? 'no_reviews' : 'none', summary: null, generatedBy: null, updatedAt: null, version: SUMMARY_VERSION, ...(method === 'POST' ? { reused: false } : {}) };
  }
  const lectureReviews = /^\/api\/lectures\/([^/]+)\/reviews$/.exec(p);
  if (lectureReviews) {
    const lectureId = decodeURIComponent(lectureReviews[1]);
    if (method === 'GET') {
      const rows = db.reviews.filter((r) => r.lecture_id === lectureId && (demo || !r.is_demo)).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
      return { reviews: rows.map((r) => publicReview(db, r, viewer)) };
    }
    if (method === 'POST') {
      const s = need();
      const clientId = str(body.clientId, 64, 'clientId', false);
      const mine = db.reviews.find((r) => r.author_session === s.token && r.lecture_id === lectureId);
      if (mine) {
        if (clientId && mine.client_id === clientId) return { review: publicReview(db, mine, s.token) };
        throw new DemoHttpError(409, 'already_reviewed');
      }
      const now = new Date().toISOString();
      const row: Review = { id: ++db.seq, lecture_id: lectureId, ...reviewInput(body), author_session: s.token, created_at: now, updated_at: now, is_demo: 0, client_id: clientId };
      db.reviews.push(row);
      return done({ review: publicReview(db, row, s.token) });
    }
  }
  const helpful = /^\/api\/reviews\/(\d+)\/helpful$/.exec(p);
  if (helpful && (method === 'PUT' || method === 'DELETE')) {
    const s = need();
    const id = Number(helpful[1]);
    const r = db.reviews.find((x) => x.id === id);
    if (!r) throw new DemoHttpError(404, 'not_found');
    if (r.author_session === s.token) throw new DemoHttpError(403, 'own_review');
    db.helpful = db.helpful.filter((h) => !(h.review_id === id && h.session === s.token));
    if (method === 'PUT') db.helpful.push({ review_id: id, session: s.token });
    const n = helpfulOf(db, id);
    return done({ helpfulCount: n, helpedByMe: method === 'PUT', helpfulWeight: Math.round(helpfulWeight(n) * 100) / 100 });
  }
  const reviewOne = /^\/api\/reviews\/(\d+)$/.exec(p);
  if (reviewOne && (method === 'PUT' || method === 'DELETE')) {
    const s = need();
    const r = db.reviews.find((x) => x.id === Number(reviewOne[1]));
    if (!r) throw new DemoHttpError(404, 'not_found');
    if (r.author_session !== s.token) throw new DemoHttpError(403, 'forbidden');
    if (method === 'DELETE') {
      db.reviews = db.reviews.filter((x) => x.id !== r.id);
      db.helpful = db.helpful.filter((h) => h.review_id !== r.id);
      return done({ ok: true });
    }
    Object.assign(r, reviewInput(body), { updated_at: new Date().toISOString() });
    return done({ review: publicReview(db, r, s.token) });
  }

  if (method === 'GET' && p === '/api/me/activity') {
    const s = need();
    const maxComment = Math.max(0, ...db.comments.map((c) => c.id));
    const maxReview = Math.max(0, ...db.reviews.map((r) => r.id));
    const ac = url.searchParams.get('afterComment');
    const ar = url.searchParams.get('afterReview');
    const lectureIds = (url.searchParams.get('lectureIds') ?? '').split(',').filter(Boolean);
    const comments = ac == null ? [] : db.comments.filter((c) => !c.is_demo && c.id > Number(ac) && c.author_session !== s.token && db.posts.some((x) => x.id === c.post_id && x.author_session === s.token)).map((c) => ({ id: c.id, postId: c.post_id, postTitle: db.posts.find((x) => x.id === c.post_id)!.title, createdAt: c.created_at }));
    const reviews = ar == null || !lectureIds.length ? [] : db.reviews.filter((r) => !r.is_demo && r.id > Number(ar) && r.author_session !== s.token && lectureIds.includes(r.lecture_id)).map((r) => ({ id: r.id, lectureId: r.lecture_id, createdAt: r.created_at }));
    return { cursor: { comment: Math.max(Number(ac ?? 0), maxComment), review: Math.max(Number(ar ?? 0), maxReview) }, comments, reviews };
  }

  throw new DemoHttpError(404, 'not_found');
}
