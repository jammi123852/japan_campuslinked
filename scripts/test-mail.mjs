// 메일 공지 확인 테스트. 가짜 IMAP·가짜 Anthropic 서버와 임시 DB 만 쓴다 (실제 메일·API 호출·과금 없음).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as httpServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SERVER_DIR = process.env.TEST_SERVER_DIR ?? 'server';
const { decodeHeaderValue, isNoticeSender, parseMailBody, scanMailbox, mailConfigFromEnv } = await import(new URL(`../${SERVER_DIR}/mail.ts`, import.meta.url).href);

const PASSWORD = 'app-pass "x" word';
const DAY = 24 * 60 * 60 * 1000;
// 'お知らせ' 의 ISO-2022-JP 바이트
const JP_SUBJECT = 'GyRCJCpDTiRpJDsbKEI=';
const crlf = (s) => s.replace(/\n/g, '\r\n');
const rfcDate = (ago) => new Date(Date.now() - ago).toUTCString();

const mails = () => [
  { uid: 1, raw: crlf(`From: friend <a@example.com>\nSubject: private\nDate: ${rfcDate(DAY)}\nMessage-ID: <1@x>\n\nSECRET-PERSONAL-BODY\n`) },
  { uid: 2, raw: crlf(`From: =?UTF-8?B?${Buffer.from('학사과').toString('base64')}?= <office@kyusan-u.ac.jp>\nSubject: =?ISO-2022-JP?B?${JP_SUBJECT}?=\nDate: ${rfcDate(2 * DAY)}\nMessage-ID: <2@x>\nContent-Type: multipart/mixed; boundary="b1"\n\n--b1\nContent-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: base64\n\n${Buffer.from('수강 정정 마감 11월 20일').toString('base64')}\n--b1\nContent-Type: application/pdf; name="a.pdf"\nContent-Disposition: attachment; filename="a.pdf"\nContent-Transfer-Encoding: base64\n\nAAAA\n--b1--\n`) },
  { uid: 3, raw: crlf(`From: old <office@kyusan-u.ac.jp>\nSubject: too old\nDate: ${rfcDate(8 * DAY)}\nMessage-ID: <3@x>\n\nOLD-BODY\n`) },
  { uid: 4, raw: crlf(`From: phish <office@kyusan-u.ac.jp.evil.com>\nSubject: phish\nDate: ${rfcDate(DAY)}\nMessage-ID: <4@x>\n\nPHISH-BODY\n`) },
];

function fakeImap({ list = mails, rejectLogin = false } = {}) {
  const state = { connections: 0, commands: [] };
  const server = netServer((sock) => {
    state.connections++;
    sock.on('error', () => undefined);
    sock.write('* OK fake ready\r\n');
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString('latin1');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const [tag, ...rest] = line.split(' ');
        const cmd = rest.join(' ');
        state.commands.push(cmd);
        if (cmd.startsWith('LOGIN')) {
          const expected = `LOGIN "me@example.com" "${PASSWORD.replace(/"/g, '\\"')}"`;
          if (rejectLogin || cmd !== expected) sock.write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
          else sock.write(`${tag} OK logged in\r\n`);
        } else if (cmd.startsWith('EXAMINE')) {
          sock.write(`* 4 EXISTS\r\n${tag} OK [READ-ONLY] done\r\n`);
        } else if (cmd.startsWith('UID SEARCH')) {
          sock.write(`* SEARCH ${list().map((m) => m.uid).join(' ')}\r\n${tag} OK\r\n`);
        } else if (cmd.startsWith('UID FETCH')) {
          const uids = cmd.split(' ')[2].split(',').map(Number);
          const headerOnly = cmd.includes('HEADER.FIELDS');
          for (const m of list().filter((x) => uids.includes(x.uid))) {
            const part = headerOnly ? m.raw.slice(0, m.raw.indexOf('\r\n\r\n') + 4) : m.raw;
            const bytes = Buffer.from(part, 'latin1');
            sock.write(`* ${m.uid} FETCH (RFC822.SIZE ${m.raw.length} BODY[] {${bytes.length}}\r\n`);
            sock.write(bytes);
            // UID 가 본문 뒤에 오는 서버도 있다
            sock.write(` UID ${m.uid})\r\n`);
          }
          sock.write(`${tag} OK\r\n`);
        } else if (cmd === 'LOGOUT') {
          sock.write(`* BYE\r\n${tag} OK\r\n`);
          sock.end();
        } else sock.write(`${tag} BAD unknown\r\n`);
      }
    });
  });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res({ server, state, port: server.address().port })));
}

function fakeAnthropic() {
  const state = { calls: 0, bodies: [] };
  const server = httpServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      state.calls++;
      state.bodies.push(b);
      const text = JSON.stringify({ summaryKo: '요약', summaryJa: '要約', audience: '전체', audienceStatus: 'target', audienceReason: '', tasks: ['정정'], materials: [], howTo: '', dates: [{ kind: 'deadline', label: '정정 마감', date: '2026-11-20', time: '', rawText: '11월 20일', evidence: '11월 20일' }], uncertain: [] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'fake', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res({ server, state, port: server.address().port })));
}

const dir = mkdtempSync(join(tmpdir(), 'ksu-mail-test-'));
let nextDb = 0;
const newDb = () => join(dir, `t${nextDb++}.sqlite`);

async function startServer(db, env) {
  const port = 19000 + Math.floor(Math.random() * 900);
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('MAIL_') || k.startsWith('ANTHROPIC')) delete clean[k];
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', `${SERVER_DIR}/index.ts`], { env: { ...clean, PORT: String(port), DB_PATH: db, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  p.stderr.on('data', (d) => (log += d));
  await new Promise((res, rej) => {
    p.stdout.on('data', (d) => {
      log += d;
      if (d.toString().includes('listening')) res();
    });
    p.on('exit', (c) => rej(new Error(`server exited ${c}: ${log}`)));
  });
  p.removeAllListeners('exit');
  return { port, proc: p, log: () => log, stop: () => new Promise((r) => { p.on('exit', r); p.kill('SIGTERM'); }) };
}

const get = async (s, headers = {}) => {
  const r = await fetch(`http://127.0.0.1:${s.port}/api/mail/digest`, { headers });
  return { status: r.status, json: await r.json() };
};
async function digestOf(s) {
  for (let i = 0; i < 100; i++) {
    const d = await get(s);
    if (d.json.status !== 'pending') return d.json;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('digest stayed pending');
}
const mailEnv = (port, extra = {}) => ({ MAIL_IMAP_USER: 'me@example.com', MAIL_IMAP_PASSWORD: PASSWORD, MAIL_IMAP_HOST: '127.0.0.1', MAIL_IMAP_PORT: String(port), MAIL_IMAP_TLS: '0', ...extra });

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
};

try {
  await test('머리글·본문 해석 (일본어·첨부·발신자 위장)', () => {
    assert.equal(decodeHeaderValue(`=?ISO-2022-JP?B?${JP_SUBJECT}?=`), 'お知らせ');
    assert.equal(isNoticeSender('A <x@kyusan-u.ac.jp>', ['kyusan-u.ac.jp']), true);
    assert.equal(isNoticeSender('A <x@st.kyusan-u.ac.jp>', ['kyusan-u.ac.jp']), true);
    assert.equal(isNoticeSender('A <x@kyusan-u.ac.jp.evil.com>', ['kyusan-u.ac.jp']), false);
    assert.equal(isNoticeSender('x@kyusan-u.ac.jp <x@evil.com>', ['kyusan-u.ac.jp']), false);
    assert.equal(isNoticeSender('A <me@gmail.com>', ['me@gmail.com']), true);
    const p = parseMailBody(Buffer.from(crlf('Content-Type: text/html; charset=UTF-8\n\n<style>x{}</style><p>마감&nbsp;안내</p>')));
    assert.equal(p.text, '마감 안내');
    const q = parseMailBody(Buffer.from(crlf('Content-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: quoted-printable\n\n=E8=AA=B2=E9=A1=8C')));
    assert.equal(q.text, '課題');
  });

  await test('암호화 없는 접속은 이 PC 안에서만 허용', () => {
    assert.equal(mailConfigFromEnv({ MAIL_IMAP_USER: 'a', MAIL_IMAP_PASSWORD: 'b', MAIL_IMAP_HOST: 'imap.example.com', MAIL_IMAP_TLS: '0' }).tls, true);
    assert.equal(mailConfigFromEnv({ MAIL_IMAP_USER: 'a' }), null);
  });

  await test('연결 안 하면 메일 접속 없음, 기능 꺼짐', async () => {
    const imap = await fakeImap();
    const s = await startServer(newDb(), {});
    assert.deepEqual((await get(s)).json, { status: 'not_configured' });
    await s.stop();
    assert.equal(imap.state.connections, 0);
    imap.server.close();
  });

  await test('공지 없는 계정: 빈 결과, 본문·AI 호출 없음, 읽기 전용', async () => {
    const imap = await fakeImap({ list: () => mails().filter((m) => m.uid === 1) });
    const ai = await fakeAnthropic();
    const s = await startServer(newDb(), mailEnv(imap.port, { MAIL_AI_ENABLED: '1', ANTHROPIC_API_KEY: 'fake', ANTHROPIC_BASE_URL: `http://127.0.0.1:${ai.port}` }));
    const d = await digestOf(s);
    assert.equal(d.status, 'ok');
    assert.deepEqual(d.notices, []);
    assert.equal(d.scanned, 1);
    assert.equal(d.truncated, false);
    assert.equal(ai.state.calls, 0);
    assert.ok(imap.state.commands.includes('EXAMINE "INBOX"'));
    assert.ok(!imap.state.commands.some((c) => /\bSELECT\b|STORE|EXPUNGE|COPY|MOVE|APPEND|DELETE/.test(c)));
    assert.ok(!imap.state.commands.some((c) => c.includes('BODY.PEEK[]')), '공지가 아닌 메일 본문을 받으면 안 된다');
    await s.stop();
    imap.server.close();
    ai.server.close();
  });

  await test('AI 꺼짐(기본): 공지는 보이지만 AI 호출 없음, 8일 전·위장 발신자 제외', async () => {
    const imap = await fakeImap();
    const ai = await fakeAnthropic();
    const s = await startServer(newDb(), mailEnv(imap.port, { ANTHROPIC_API_KEY: 'fake', ANTHROPIC_BASE_URL: `http://127.0.0.1:${ai.port}` }));
    const d = await digestOf(s);
    assert.equal(d.notices.length, 1);
    const n = d.notices[0];
    assert.equal(n.subject, 'お知らせ');
    assert.ok(n.from.includes('학사과'));
    assert.equal(n.analysisStatus, 'off');
    assert.equal(n.hasAttachment, true);
    assert.equal(d.scanned, 3);
    assert.equal(ai.state.calls, 0);
    assert.equal(imap.state.commands.filter((c) => c.includes('BODY.PEEK[]')).length, 1);
    await s.stop();
    imap.server.close();
    ai.server.close();
  });

  await test('AI 켬: 공지 본문만 전송, 일주일 안에는 다시 확인 안 함, 일주일 뒤 재확인·같은 메일 재호출 없음', async () => {
    const imap = await fakeImap();
    const ai = await fakeAnthropic();
    const db = newDb();
    const env = mailEnv(imap.port, { MAIL_AI_ENABLED: '1', ANTHROPIC_API_KEY: 'fake', ANTHROPIC_BASE_URL: `http://127.0.0.1:${ai.port}` });
    let s = await startServer(db, env);
    const d = await digestOf(s);
    assert.equal(d.notices[0].analysisStatus, 'done');
    assert.equal(d.notices[0].analysis.dates[0].date, '2026-11-20');
    assert.equal(ai.state.calls, 1);
    assert.ok(ai.state.bodies[0].includes('수강 정정 마감'));
    assert.ok(!/SECRET-PERSONAL-BODY|PHISH-BODY|OLD-BODY/.test(ai.state.bodies[0]));
    assert.ok(Date.parse(d.nextCheckAt) - Date.parse(d.checkedAt) === 7 * DAY);
    await s.stop();
    const before = imap.state.connections;

    s = await startServer(db, env);
    await new Promise((r) => setTimeout(r, 300));
    await s.stop();
    assert.equal(imap.state.connections, before, '일주일 안에 다시 접속하면 안 된다');

    const raw = new DatabaseSync(db);
    raw.prepare('UPDATE mail_digests SET run_at = ?').run(new Date(Date.now() - 7 * DAY - 1000).toISOString());
    const rows = raw.prepare('SELECT COUNT(*) AS n FROM mail_digests').get().n;
    raw.close();
    s = await startServer(db, env);
    for (let i = 0; i < 100 && imap.state.connections === before; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(imap.state.connections, before + 1, '일주일이 지나면 다시 확인해야 한다');
    for (let i = 0; i < 100; i++) {
      const check = new DatabaseSync(db);
      const n = check.prepare('SELECT COUNT(*) AS n FROM mail_digests').get().n;
      check.close();
      if (n > rows) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(ai.state.calls, 1, '같은 메일은 저장된 분석을 재사용');
    assert.equal((await get(s)).json.notices[0].analysisStatus, 'done');
    await s.stop();
    imap.server.close();
    ai.server.close();
  });

  await test('AI 실패: 공지는 남고 실패로 표시', async () => {
    const imap = await fakeImap();
    const s = await startServer(newDb(), mailEnv(imap.port, { MAIL_AI_ENABLED: '1', ANTHROPIC_API_KEY: 'fake', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' }));
    const d = await digestOf(s);
    assert.equal(d.status, 'ok');
    assert.equal(d.notices[0].analysisStatus, 'failed');
    await s.stop();
    imap.server.close();
  });

  await test('로그인 실패: 공지 없음이 아니라 오류, 24시간 안에는 재시도 안 함, 비밀번호 노출 없음', async () => {
    const imap = await fakeImap({ rejectLogin: true });
    const db = newDb();
    let s = await startServer(db, mailEnv(imap.port));
    const d = await digestOf(s);
    assert.equal(d.status, 'error');
    assert.equal(d.errorCode, 'auth');
    assert.equal(d.notices, undefined);
    assert.equal(Date.parse(d.nextCheckAt) - Date.parse(d.checkedAt), DAY);
    assert.ok(!s.log().includes(PASSWORD));
    assert.ok(!JSON.stringify(d).includes(PASSWORD));
    await s.stop();
    const before = imap.state.connections;
    s = await startServer(db, mailEnv(imap.port));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(imap.state.connections, before);
    await s.stop();
    imap.server.close();
  });

  await test('비밀번호를 고치고 다시 켜면 예정일을 기다리지 않고 바로 확인, 비밀번호 원문은 DB 에 없음', async () => {
    const imap = await fakeImap({ rejectLogin: true });
    const db = newDb();
    let s = await startServer(db, mailEnv(imap.port));
    await digestOf(s);
    await s.stop();
    const before = imap.state.connections;
    s = await startServer(db, mailEnv(imap.port, { MAIL_IMAP_PASSWORD: 'fixed-password' }));
    for (let i = 0; i < 100 && imap.state.connections === before; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(imap.state.connections, before + 1);
    await new Promise((r) => setTimeout(r, 200));
    await s.stop();
    const raw = new DatabaseSync(db);
    const dump = JSON.stringify(raw.prepare('SELECT * FROM meta').all());
    raw.close();
    assert.ok(!dump.includes('fixed-password') && !dump.includes(PASSWORD));
    imap.server.close();
  });

  await test('서버 연결 불가: 오류로 표시', async () => {
    const s = await startServer(newDb(), mailEnv(9));
    const d = await digestOf(s);
    assert.equal(d.status, 'error');
    assert.equal(d.errorCode, 'network');
    await s.stop();
  });

  await test('터널·외부 요청은 메일 결과를 볼 수 없음', async () => {
    const imap = await fakeImap();
    const s = await startServer(newDb(), mailEnv(imap.port));
    const d = await digestOf(s);
    assert.equal(d.notices.length, 1);
    for (const headers of [{ 'cf-connecting-ip': '1.2.3.4' }, { 'cf-ray': 'x' }, { 'x-forwarded-for': '1.2.3.4' }, { forwarded: 'for=1.2.3.4' }, { origin: 'https://campuslinked.io' }, { origin: 'https://evil.example' }]) {
      const r = await get(s, headers);
      assert.equal(r.status, 404, JSON.stringify(headers));
      assert.ok(!JSON.stringify(r.json).includes('notices'));
    }
    assert.equal((await get(s, { origin: 'http://localhost:8081' })).status, 200);
    // Host 위조 확인 (fetch 는 Host 를 못 바꾸므로 원시 요청)
    const host = await new Promise((res, rej) => {
      import('node:http').then(({ request }) => {
        const q = request({ host: '127.0.0.1', port: s.port, path: '/api/mail/digest', headers: { Host: 'abc.trycloudflare.com' } }, (r) => { r.resume(); res(r.statusCode); });
        q.on('error', rej);
        q.end();
      });
    });
    assert.equal(host, 404);
    await s.stop();
    imap.server.close();
  });

  await test('메일이 너무 많으면 잘림을 표시', async () => {
    const imap = await fakeImap();
    const cfg = { host: '127.0.0.1', port: imap.port, tls: false, user: 'me@example.com', password: PASSWORD, senders: ['kyusan-u.ac.jp'] };
    const r = await scanMailbox(cfg, Date.now(), { maxScan: 2 });
    assert.equal(r.truncated, true);
    const c = await scanMailbox(cfg, Date.now(), { maxCandidates: 0 });
    assert.equal(c.omitted, 1);
    assert.deepEqual(c.candidates, []);
    imap.server.close();
  });

  console.log(`\n${passed} tests passed`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
