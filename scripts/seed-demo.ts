/**
 * 로컬 데모 DB에 데모 후기·글·댓글을 넣는다. 공개 DB·공유 서버 DB에는 넣지 않는다.
 * 실행: node --disable-warning=ExperimentalWarning scripts/seed-demo.ts --db <경로> [--reset]
 * - 반복 실행해도 중복되지 않는다(client_id 'demo:…').
 * - 실제 사용자 글·댓글·후기는 건드리지 않는다. --reset 은 is_demo=1 만 지운다.
 * - 쓰기 전에 DB를 백업한다.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { POSTS, REVIEWS } from './demo/content.mjs';
import { HELPFUL_EXISTING, REVIEWS_EXTRA } from './demo/content-extra.mjs';

const args = process.argv.slice(2);
const dbArg = args[args.indexOf('--db') + 1];
if (!args.includes('--db') || !dbArg) throw new Error('--db <경로> 가 필요합니다');
const path = resolve(dbArg);
if ((path.endsWith('/project/ksu-campus/server/data/ksu-campus.sqlite') || path.endsWith('/CampusLinked/app/server/data/ksu-campus.sqlite')) && !args.includes('--allow-shared')) throw new Error('공유 서버가 쓰는 DB 입니다. 터널로 공개될 수 있어 넣지 않습니다.');
if (!existsSync(path)) throw new Error(`DB 가 없습니다: ${path}`);
const db = new DatabaseSync(path);
const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 17);
db.exec(`VACUUM INTO '${path}.bak-${stamp}'`);
console.log(`백업: ${path}.bak-${stamp}`);

const addColumn = (table: string, name: string, def: string) => {
  const cols = (db.prepare(`PRAGMA table_info('${table}')`).all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
};
addColumn('posts', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
addColumn('posts', 'updated_at', 'TEXT');
addColumn('comments', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
addColumn('comments', 'updated_at', 'TEXT');
addColumn('reviews', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
addColumn('reviews', 'offering', 'TEXT');

db.exec(`CREATE TABLE IF NOT EXISTS review_helpful (review_id INTEGER NOT NULL, session TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, PRIMARY KEY (review_id, session));
  CREATE INDEX IF NOT EXISTS idx_review_helpful_review ON review_helpful(review_id);`);

const count = (t: string, where = '1=1') => (db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${where}`).get() as { n: number }).n;
const real = { posts: count('posts', 'is_demo = 0'), comments: count('comments', 'is_demo = 0'), reviews: count('reviews', 'is_demo = 0'), helpful: count('review_helpful', 'is_demo = 0') };

if (args.includes('--reset')) {
  const r = { comments: count('comments', 'is_demo = 1'), posts: count('posts', 'is_demo = 1'), reviews: count('reviews', 'is_demo = 1'), helpful: count('review_helpful', 'is_demo = 1') };
  // 데모 반응과 데모 후기에 달린 반응만 지운다 (실제 후기의 실제 반응은 그대로)
  db.exec('DELETE FROM review_helpful WHERE is_demo = 1 OR review_id IN (SELECT id FROM reviews WHERE is_demo = 1); DELETE FROM comments WHERE is_demo = 1; DELETE FROM posts WHERE is_demo = 1; DELETE FROM reviews WHERE is_demo = 1;');
  console.log('데모만 지움', r);
} else {
  const translate = (target: string, source: string, out: string) => db.prepare('INSERT OR REPLACE INTO translations (hash, target, text, created_at) VALUES (?, ?, ?, ?)').run(createHash('sha256').update(`${target}|${source}`).digest('hex'), target, out, new Date().toISOString());
  /** 첫 문자열이 원문, 둘째가 번역 */
  const pair = (lang: string, original: string, translated: string) => {
    translate(lang === 'ko' ? 'ja' : 'ko', original, translated);
    return original;
  };
  // 작성 시각은 과거에 고르게 흩어 놓는다
  let n = 0;
  const at = () => new Date(Date.UTC(2026, 9, 28) - (n++ % 90) * 7_200_000).toISOString();
  let reviews = 0;
  for (const [lectureId, list] of Object.entries(REVIEWS)) {
    (list as (string | number)[][]).forEach((r, i) => {
      const [w, d, ev, y, g, lang, ko, ja] = r as [number, number, string, number, number, string, string, string];
      const body = pair(lang, ko, ja);
      const when = at();
      const session = `demo-seed:${lectureId}:${i}`;
      if (db.prepare('SELECT 1 FROM reviews WHERE author_session = ? AND lecture_id = ?').get(session, lectureId)) return;
      db.prepare('INSERT INTO reviews (lecture_id, taken_year, grade, attendance, evaluation, workload, difficulty, body, author_session, client_id, created_at, updated_at, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)').run(lectureId, y, g, 'in_person', ev, w, d, body, session, `demo:r:${lectureId}:${i}`, when, when);
      reviews += 1;
    });
  }
  // 추가 데모 후기와 도움돼요. 노출 수는 항상 저장된 반응 행을 세어 나오므로 숫자만 넣지 않는다
  let extra = 0;
  let helpful = 0;
  const react = (reviewId: number, reviewKey: string, n: number) => {
    for (let k = 0; k < n; k++) {
      const info = db.prepare('INSERT OR IGNORE INTO review_helpful (review_id, session, is_demo, created_at) VALUES (?, ?, 1, ?)').run(reviewId, `demo-seed:helpful:${reviewKey}:${k}`, at());
      helpful += Number(info.changes);
    }
  };
  for (const [lectureId, list] of Object.entries(REVIEWS_EXTRA)) {
    (list as (string | number)[][]).forEach((r, i) => {
      const [w, d, ev, y, g, lang, ko, ja, h] = r as [number, number, string, number, number, string, string, string, number];
      const body = pair(lang, ko, ja);
      const session = `demo-seed:x:${lectureId}:${i}`;
      let row = db.prepare('SELECT id FROM reviews WHERE author_session = ? AND lecture_id = ?').get(session, lectureId) as { id: number } | undefined;
      if (!row) {
        const when = at();
        const info = db.prepare('INSERT INTO reviews (lecture_id, taken_year, grade, attendance, evaluation, workload, difficulty, body, author_session, client_id, created_at, updated_at, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)').run(lectureId, y, g, 'in_person', ev, w, d, body, session, `demo:x:${lectureId}:${i}`, when, when);
        row = { id: Number(info.lastInsertRowid) };
        extra += 1;
      }
      react(row.id, `x:${lectureId}:${i}`, h);
    });
  }
  for (const [lectureId, list] of Object.entries(HELPFUL_EXISTING)) {
    (list as number[]).forEach((h, i) => {
      const row = db.prepare('SELECT id FROM reviews WHERE author_session = ? AND lecture_id = ?').get(`demo-seed:${lectureId}:${i}`, lectureId) as { id: number } | undefined;
      if (row) react(row.id, `${lectureId}:${i}`, h);
    });
  }
  console.log('추가 데모', { extra, helpful });
  let posts = 0;
  let comments = 0;
  (POSTS as unknown as [string, string, [string, string], [string, string], string | null, [string, string, string][]][]).forEach((p, i) => {
    const [cat, lang, koP, jaP, lectureId, cs] = p;
    const title = pair(lang, koP[0], jaP[0]);
    const body = pair(lang, koP[1], jaP[1]);
    const session = `demo-seed:post:${i}`;
    const clientId = `demo:p:${i}`;
    let row = db.prepare('SELECT id FROM posts WHERE author_session = ? AND client_id = ?').get(session, clientId) as { id: number } | undefined;
    if (!row) {
      const info = db.prepare('INSERT INTO posts (category, title, body, lecture_id, author_session, author_name, anonymous, is_sample, client_id, created_at, is_demo) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?, 1)').run(cat, title, body, lectureId, session, 'demo', clientId, at());
      row = { id: Number(info.lastInsertRowid) };
      posts += 1;
    }
    cs.forEach((c, k) => {
      const text = pair(c[0], c[1], c[2]);
      const cSession = `demo-seed:comment:${i}:${k}`;
      const cClient = `demo:c:${i}:${k}`;
      if (db.prepare('SELECT 1 FROM comments WHERE author_session = ? AND client_id = ?').get(cSession, cClient)) return;
      db.prepare('INSERT INTO comments (post_id, body, author_session, author_name, anonymous, client_id, created_at, is_demo) VALUES (?, ?, ?, ?, 1, ?, ?, 1)').run(row!.id, text, cSession, 'demo', cClient, at());
      comments += 1;
    });
  });
  console.log('새로 넣음', { reviews, posts, comments });
}
const after = { posts: count('posts', 'is_demo = 0'), comments: count('comments', 'is_demo = 0'), reviews: count('reviews', 'is_demo = 0'), helpful: count('review_helpful', 'is_demo = 0') };
if (JSON.stringify(real) !== JSON.stringify(after)) throw new Error('실제 데이터 수가 바뀌었습니다');
console.log('실제 데이터 그대로', after, '데모', { posts: count('posts', 'is_demo = 1'), comments: count('comments', 'is_demo = 1'), reviews: count('reviews', 'is_demo = 1'), helpful: count('review_helpful', 'is_demo = 1') });
