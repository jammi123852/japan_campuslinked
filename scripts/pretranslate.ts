/**
 * 공식 자료 미리 번역 (범위 ①: 학과 안내·장학금·진로·공지 등 + 정보과학과(RS) 강의계획서).
 * 결과는 공유 서버 DB 의 translations 표에 앱과 같은 키로 넣는다. 이미 있는 문장은 건너뛴다(이어서 실행 가능).
 * 실행: node --env-file=server/.env scripts/pretranslate.ts [--dry-run] [--limit N]
 * 내보내기(API 호출 없음): node scripts/pretranslate.ts --export public/official/ko-2026.json  → 앱이 처음부터 읽는 원문→번역 표
 * 환경: DB_PATH(기본 server/data/ksu-campus.sqlite), ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL(테스트용)
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { courseNameFor } from '../src/data/courseNamesKo.ts';
import { translateWithClaude, translationHash } from '../server/translate.ts';

const MODEL = 'claude-sonnet-5-5';
const CLIENT_MAX = 11000; // 앱이 한 문장을 이 길이로 잘라 보낸다 → 같은 키가 되도록 맞춘다
const BATCH_TEXTS = 40;
const BATCH_CHARS = 6000;
const CONCURRENCY = 4;
const JA = /[぀-ヿ一-鿿ｦ-ﾟ]/;
const SKIP_KEYS = new Set(['url', 'id', 'code', 'isbn', 'instructor', 'rooms', 'cohort', 'cohortText', 'collectedAt', 'checkedAt', 'legacyIds', 'legacyCourses', 'courses']);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const exportPath = args.includes('--export') ? args[args.indexOf('--export') + 1] : null;

const texts = new Set<string>();
const add = (s: unknown) => {
  if (typeof s === 'string' && JA.test(s)) texts.add(s.slice(0, CLIENT_MAX));
};
const walk = (x: unknown, key = '') => {
  if (SKIP_KEYS.has(key)) return;
  if (typeof x === 'string') add(x);
  else if (Array.isArray(x)) x.forEach((v) => walk(v));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) walk(v, k);
};

// 1) 학교 메타 자료 (학과 안내·장학금·진로·공지·체크리스트 등)
walk(JSON.parse(readFileSync('public/official/ksu-2026.json', 'utf8')));
// 2) 과목: 이름(사전에 없는 것만 — 사전에 있으면 앱이 번역을 요청하지 않음)·구분
const courses = (JSON.parse(readFileSync('public/official/courses-2026.json', 'utf8')) as { courses: Record<string, unknown>[] }).courses;
for (const c of courses) {
  const name = String(c.name ?? '');
  if (courseNameFor(name, 'ko') === name) add(name);
  for (const k of ['subjectType', 'kind', 'creditType']) add(c[k]);
}
// 3) 정보과학과(RS) 강의계획서
const rs = new Set(courses.filter((c) => ((c.depts as string[] | undefined) ?? []).includes('RS')).map((c) => String(c.id)));
for (const f of readdirSync('public/official/syl')) {
  const m = JSON.parse(readFileSync(`public/official/syl/${f}`, 'utf8')) as Record<string, Record<string, unknown>>;
  for (const [id, d] of Object.entries(m)) {
    if (!rs.has(id)) continue;
    for (const k of ['outline', 'goals', 'evaluation', 'textbookNote', 'prereq', 'rules', 'prep']) add(d[k]);
    for (const x of (d.plan as unknown[]) ?? []) add(x);
    for (const b of [...((d.textbooks as { title?: string }[]) ?? []), ...((d.assigned as { title?: string }[]) ?? [])]) add(b.title);
  }
}

const db = new DatabaseSync(process.env.DB_PATH ?? 'server/data/ksu-campus.sqlite');
db.exec('PRAGMA busy_timeout = 5000');
db.exec(`CREATE TABLE IF NOT EXISTS translations (hash TEXT PRIMARY KEY, target TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL)`);
const has = db.prepare('SELECT 1 FROM translations WHERE hash = ?');
if (exportPath) {
  const get = db.prepare('SELECT text FROM translations WHERE hash = ?');
  const map: Record<string, string> = {};
  for (const s of texts) {
    const row = get.get(translationHash(s)) as { text: string } | undefined;
    if (row) map[s] = row.text;
  }
  // 사람이 직접 옮긴 문장(API 없이)을 합친다
  const manual = JSON.parse(readFileSync('scripts/ko-manual.json', 'utf8')) as Record<string, string>;
  for (const [ja, ko] of Object.entries(manual)) if (!ja.startsWith('_')) map[ja] = ko;
  const { writeFileSync, renameSync } = await import('node:fs');
  writeFileSync(`${exportPath}.tmp`, JSON.stringify({ version: 1, target: 'ko', createdAt: new Date().toISOString(), map }));
  renameSync(`${exportPath}.tmp`, exportPath);
  console.log(`[pre] export ${Object.keys(map).length}개 (자동 대상 ${texts.size}, 직접 번역 포함) → ${exportPath}`);
  process.exit(0);
}
const todo = [...texts].filter((s) => !has.get(translationHash(s))).slice(0, limit);
const chars = todo.reduce((a, s) => a + s.length, 0);
console.log(`[pre] 대상 ${texts.size}문장 · 남은 ${todo.length}문장 · ${chars}자`);
if (dryRun) process.exit(0);
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[pre] ANTHROPIC_API_KEY 없음');
  process.exit(1);
}

const batches: string[][] = [];
let cur: string[] = [];
let curChars = 0;
for (const s of todo) {
  if (cur.length && (cur.length >= BATCH_TEXTS || curChars + s.length > BATCH_CHARS)) {
    batches.push(cur);
    cur = [];
    curChars = 0;
  }
  cur.push(s);
  curChars += s.length;
}
if (cur.length) batches.push(cur);

const client = new Anthropic({ maxRetries: 3 });
const insert = db.prepare('INSERT OR REPLACE INTO translations (hash, target, text, created_at) VALUES (?, ?, ?, ?)');
const usage = { input: 0, output: 0, ok: 0, missing: 0, failed: 0 };
let next = 0;
let fatal = false;
async function worker() {
  while (!fatal && next < batches.length) {
    const n = next++;
    const batch = batches[n];
    try {
      const r = await translateWithClaude(client, MODEL, batch);
      usage.input += r.usage.input;
      usage.output += r.usage.output;
      const now = new Date().toISOString();
      batch.forEach((s, i) => {
        if (r.out[i]) {
          insert.run(translationHash(s), 'ko', r.out[i]!, now);
          usage.ok++;
        } else usage.missing++;
      });
    } catch (e) {
      usage.failed += batch.length;
      const status = e instanceof Anthropic.APIError ? e.status : null;
      console.error(`[pre] 묶음 ${n + 1} 실패: ${status ?? (e instanceof Error ? e.message : 'unknown')}`);
      if (status === 401 || status === 403) fatal = true; // 키 문제면 더 호출하지 않는다
    }
    const cost = (usage.input * 2 + usage.output * 10) / 1e6;
    console.log(`[pre] ${n + 1}/${batches.length} · 저장 ${usage.ok} · 빠짐 ${usage.missing} · 실패 ${usage.failed} · 토큰 in ${usage.input} out ${usage.output} · 약 $${cost.toFixed(2)}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`[pre] DONE 저장 ${usage.ok} · 빠짐 ${usage.missing} · 실패 ${usage.failed} · 토큰 in ${usage.input} out ${usage.output} · 약 $${((usage.input * 2 + usage.output * 10) / 1e6).toFixed(2)}`);
db.close();
