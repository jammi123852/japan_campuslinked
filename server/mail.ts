/**
 * 메일함 읽기 전용 수집 (의존성 없음: node:tls·node:net).
 *
 * 안전 규칙
 * - EXAMINE(읽기 전용)으로만 연다. 쓰기 명령(STORE·COPY·EXPUNGE 등)은 이 파일에 없다.
 * - 먼저 머리글만 받아 발신자를 거른다. 공지 발신자가 아닌 메일의 본문은 받지 않는다.
 * - BODY.PEEK 를 써서 '읽음' 표시가 바뀌지 않는다.
 * - 비밀번호·메일 내용은 로그에 쓰지 않는다.
 */
import { createHash } from 'node:crypto';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

export const MAIL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SCAN = 500;
const MAX_CANDIDATES = 10;
const MAX_BODY_BYTES = 15 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 40 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface MailConfig {
  host: string;
  port: number;
  tls: boolean;
  user: string;
  password: string;
  /** 도메인(kyusan-u.ac.jp) 또는 전체 주소 */
  senders: string[];
}

export type MailErrorCode = 'auth' | 'network' | 'protocol';

export class MailError extends Error {
  code: MailErrorCode;
  constructor(code: MailErrorCode) {
    super(code);
    this.code = code;
  }
}

export interface MailCandidate {
  id: string;
  from: string;
  subject: string;
  date: string | null;
  text: string;
  hasAttachment: boolean;
  tooLarge: boolean;
}

export interface MailScan {
  scanned: number;
  /** 메일이 너무 많아 최근 일부만 확인함 → '공지 없음'이라고 단정하면 안 된다 */
  truncated: boolean;
  /** 후보 상한을 넘어 빠진 공지 수 */
  omitted: number;
  candidates: MailCandidate[];
}

/** 환경변수에서 설정을 읽는다. 계정·비밀번호가 없으면 null (기능 꺼짐) */
export function mailConfigFromEnv(env: NodeJS.ProcessEnv): MailConfig | null {
  const user = env.MAIL_IMAP_USER?.trim();
  const password = env.MAIL_IMAP_PASSWORD;
  if (!user || !password) return null;
  const host = env.MAIL_IMAP_HOST?.trim() || 'imap.gmail.com';
  // 암호화 없는 접속은 이 PC 안(테스트 서버)에서만 허용한다
  const tls = !(env.MAIL_IMAP_TLS === '0' && host === '127.0.0.1');
  return {
    host,
    port: Number(env.MAIL_IMAP_PORT ?? 993) || 993,
    tls,
    user,
    password,
    senders: (env.MAIL_NOTICE_SENDERS ?? 'kyusan-u.ac.jp')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  };
}

// ------------------------------------------------------------ 머리글·본문 해석

function decodeBytes(bytes: Buffer, charset: string | null): string {
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function decodeQuotedPrintable(s: string, header = false): Buffer {
  const src = header ? s.replace(/_/g, ' ') : s.replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const hex = src.slice(i + 1, i + 3);
    if (src[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      out.push(parseInt(hex, 16));
      i += 2;
    } else {
      out.push(src.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(out);
}

/** RFC 2047 머리글 복호화 (=?charset?B|Q?...?=). 일본어 ISO-2022-JP 포함 */
export function decodeHeaderValue(raw: string): string {
  const joined = raw.replace(/\?=\s+=\?/g, '?==?');
  const decoded = joined.replace(/=\?([^?\s]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset: string, enc: string, data: string) => {
    const bytes = enc.toUpperCase() === 'B' ? Buffer.from(data, 'base64') : decodeQuotedPrintable(data, true);
    return decodeBytes(bytes, charset);
  });
  // 인코딩 없이 온 UTF-8 머리글도 깨지지 않게 읽는다
  return /[\x80-\xff]/.test(decoded) && !/[^\x00-\xff]/.test(decoded) ? decodeBytes(Buffer.from(decoded, 'latin1'), 'utf-8') : decoded;
}

function parseHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    if (!(name in headers)) headers[name] = line.slice(i + 1).trim();
  }
  return headers;
}

function headerParam(value: string, name: string): string | null {
  const m = new RegExp(`(?:^|;)\\s*${name}\\*?=(?:"([^"]*)"|([^;\\s]*))`, 'i').exec(value);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

export function fromAddress(from: string): string {
  const inBrackets = /<([^<>\s]+@[^<>\s]+)>/.exec(from);
  const bare = inBrackets ? inBrackets[1] : /[^\s<>"',;:]+@[^\s<>"',;:]+/.exec(from)?.[0];
  return (bare ?? '').trim().toLowerCase();
}

/** 정확히 그 주소, 그 도메인, 또는 그 도메인의 하위 도메인만 인정한다 (kyusan-u.ac.jp.evil.com 은 아님) */
export function isNoticeSender(from: string, senders: string[]): boolean {
  const address = fromAddress(from);
  const domain = address.split('@')[1];
  if (!domain) return false;
  return senders.some((s) => (s.includes('@') ? address === s : domain === s || domain.endsWith(`.${s}`)));
}

function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

interface ParsedParts {
  plain: string[];
  html: string[];
  hasAttachment: boolean;
}

function walkMime(raw: string, out: ParsedParts, depth: number) {
  const m = /\r?\n\r?\n/.exec(raw);
  const headers = parseHeaders(m ? raw.slice(0, m.index) : raw);
  const body = m ? raw.slice(m.index + m[0].length) : '';
  const contentType = headers['content-type'] ?? 'text/plain';
  const type = contentType.split(';')[0].trim().toLowerCase();
  const disposition = headers['content-disposition'] ?? '';
  const boundary = headerParam(contentType, 'boundary');

  if (type.startsWith('multipart/') && boundary && depth < 6) {
    const parts = body.split(`--${boundary}`);
    // 첫 조각은 머리말, '--' 로 시작하는 조각은 끝 표시
    for (const part of parts.slice(1)) {
      if (part.startsWith('--')) break;
      walkMime(part.replace(/^\r?\n/, ''), out, depth + 1);
    }
    return;
  }
  const isAttachment = /^attachment/i.test(disposition) || headerParam(disposition, 'filename') != null || headerParam(contentType, 'name') != null;
  if (isAttachment || (type !== 'text/plain' && type !== 'text/html')) {
    out.hasAttachment = out.hasAttachment || isAttachment || !type.startsWith('multipart/');
    return;
  }
  const encoding = (headers['content-transfer-encoding'] ?? '').trim().toLowerCase();
  const bytes = encoding === 'base64' ? Buffer.from(body.replace(/\s+/g, ''), 'base64') : encoding === 'quoted-printable' ? decodeQuotedPrintable(body) : Buffer.from(body, 'latin1');
  const text = decodeBytes(bytes, headerParam(contentType, 'charset'));
  (type === 'text/html' ? out.html : out.plain).push(text);
}

/** 메일 원문 → 본문 글자. 일반 글자 본문을 우선하고, 없으면 HTML 을 글자로 바꾼다 */
export function parseMailBody(raw: Buffer): { text: string; hasAttachment: boolean } {
  const parts: ParsedParts = { plain: [], html: [], hasAttachment: false };
  walkMime(raw.toString('latin1'), parts, 0);
  const plain = parts.plain.join('\n').trim();
  return { text: plain || htmlToText(parts.html.join('\n')), hasAttachment: parts.hasAttachment };
}

// ------------------------------------------------------------ IMAP 접속

interface Unit {
  text: string;
  literals: Buffer[];
}

class ImapConnection {
  private socket: Socket;
  private buffer = Buffer.alloc(0);
  private received = 0;
  private literalSize: number | null = null;
  private current: Unit = { text: '', literals: [] };
  private units: Unit[] = [];
  private tagCounter = 0;
  private pending: { tag: string | null; resolve: (units: Unit[]) => void; reject: (e: MailError) => void } | null = null;
  private failure: MailError | null = null;

  constructor(cfg: MailConfig) {
    this.socket = cfg.tls ? tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host }) : netConnect({ host: cfg.host, port: cfg.port });
    this.socket.setTimeout(TIMEOUT_MS, () => this.fail(new MailError('network')));
    this.socket.on('data', (chunk: Buffer) => this.onData(chunk));
    this.socket.on('error', () => this.fail(new MailError('network')));
    this.socket.on('close', () => this.fail(new MailError('network')));
  }

  private fail(e: MailError) {
    this.failure ??= e;
    this.socket.destroy();
    const p = this.pending;
    this.pending = null;
    p?.reject(this.failure);
  }

  private onData(chunk: Buffer) {
    this.received += chunk.length;
    if (this.received > MAX_RESPONSE_BYTES) return this.fail(new MailError('protocol'));
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.literalSize != null) {
        if (this.buffer.length < this.literalSize) return;
        this.current.literals.push(this.buffer.subarray(0, this.literalSize));
        this.buffer = this.buffer.subarray(this.literalSize);
        this.literalSize = null;
        continue;
      }
      const end = this.buffer.indexOf('\r\n');
      if (end < 0) return;
      const line = this.buffer.subarray(0, end).toString('latin1');
      this.buffer = this.buffer.subarray(end + 2);
      this.current.text += line;
      const literal = /\{(\d+)\}$/.exec(line);
      if (literal) {
        this.literalSize = Number(literal[1]);
        continue;
      }
      const unit = this.current;
      this.current = { text: '', literals: [] };
      this.onUnit(unit);
    }
  }

  private onUnit(unit: Unit) {
    const p = this.pending;
    if (!p) return;
    // 접속 인사
    if (p.tag == null) {
      this.pending = null;
      if (/^\* (OK|PREAUTH)\b/i.test(unit.text)) p.resolve([unit]);
      else this.fail(new MailError('protocol'));
      return;
    }
    if (unit.text.startsWith(`${p.tag} `)) {
      this.pending = null;
      const units = this.units;
      this.units = [];
      if (/^\S+ OK\b/i.test(unit.text)) p.resolve(units);
      else p.reject(new MailError(/AUTH|LOGIN|credential|password/i.test(unit.text) ? 'auth' : 'protocol'));
      return;
    }
    this.units.push(unit);
  }

  greeting() {
    return new Promise<Unit[]>((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      this.pending = { tag: null, resolve, reject };
    });
  }

  command(command: string) {
    return new Promise<Unit[]>((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      const tag = `K${++this.tagCounter}`;
      this.pending = { tag, resolve, reject };
      this.socket.write(`${tag} ${command}\r\n`);
    });
  }

  resetBudget() {
    this.received = 0;
  }

  close() {
    this.failure ??= new MailError('network');
    this.pending = null;
    this.socket.destroy();
  }
}

function quoted(s: string): string {
  if (/[\r\n]/.test(s)) throw new MailError('auth');
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function imapDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

/**
 * 최근 7일 메일 중 공지 발신자의 메일만 본문까지 읽어 돌려준다.
 * 실패하면 MailError 를 던진다 (호출자는 실패를 '공지 없음'으로 표시하면 안 된다).
 */
export async function scanMailbox(cfg: MailConfig, now = Date.now(), limits: { maxScan?: number; maxCandidates?: number } = {}): Promise<MailScan> {
  const maxScan = limits.maxScan ?? MAX_SCAN;
  const maxCandidates = limits.maxCandidates ?? MAX_CANDIDATES;
  const since = now - MAIL_WINDOW_MS;
  const conn = new ImapConnection(cfg);
  try {
    await conn.greeting();
    await conn.command(`LOGIN ${quoted(cfg.user)} ${quoted(cfg.password)}`);
    await conn.command('EXAMINE "INBOX"');
    // 시간대 차이를 고려해 하루 넓게 찾고, 정확한 7일은 Date 머리글로 다시 거른다
    const search = await conn.command(`UID SEARCH SINCE ${imapDate(since - 24 * 60 * 60 * 1000)}`);
    const uids = search
      .flatMap((u) => (/^\* SEARCH\b/i.test(u.text) ? u.text.replace(/^\* SEARCH\s*/i, '').trim().split(/\s+/) : []))
      .filter((x) => /^\d+$/.test(x))
      .map(Number)
      .sort((a, b) => b - a);
    const targets = uids.slice(0, maxScan);
    if (targets.length === 0) return { scanned: 0, truncated: false, omitted: 0, candidates: [] };

    const heads = await conn.command(`UID FETCH ${targets.join(',')} (UID RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)])`);
    const rows: { uid: number; size: number; from: string; subject: string; date: string | null; messageId: string }[] = [];
    let scanned = 0;
    for (const unit of heads) {
      const uid = /\bUID (\d+)/.exec(unit.text);
      if (!uid || !unit.literals[0]) continue;
      const h = parseHeaders(unit.literals[0].toString('latin1'));
      const ms = Date.parse(h.date ?? '');
      // 날짜를 못 읽으면 놓치지 않도록 포함한다
      if (!Number.isNaN(ms) && ms < since) continue;
      scanned++;
      if (!isNoticeSender(h.from ?? '', cfg.senders)) continue;
      rows.push({
        uid: Number(uid[1]),
        size: Number(/RFC822\.SIZE (\d+)/.exec(unit.text)?.[1] ?? 0),
        from: decodeHeaderValue(h.from ?? ''),
        subject: decodeHeaderValue(h.subject ?? ''),
        date: Number.isNaN(ms) ? null : new Date(ms).toISOString(),
        messageId: h['message-id'] ?? `uid:${uid[1]}`,
      });
    }
    rows.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

    const candidates: MailCandidate[] = [];
    for (const row of rows.slice(0, maxCandidates)) {
      const base = { id: createHash('sha256').update(row.messageId).digest('hex').slice(0, 16), from: row.from, subject: row.subject, date: row.date };
      if (row.size > MAX_BODY_BYTES) {
        candidates.push({ ...base, text: '', hasAttachment: true, tooLarge: true });
        continue;
      }
      conn.resetBudget();
      const body = await conn.command(`UID FETCH ${row.uid} (BODY.PEEK[])`);
      const raw = body.find((u) => u.literals[0])?.literals[0];
      const parsed = raw ? parseMailBody(raw) : { text: '', hasAttachment: false };
      candidates.push({ ...base, text: parsed.text, hasAttachment: parsed.hasAttachment, tooLarge: false });
    }
    await conn.command('LOGOUT').catch(() => undefined);
    return { scanned, truncated: uids.length > targets.length, omitted: Math.max(0, rows.length - maxCandidates), candidates };
  } finally {
    conn.close();
  }
}
