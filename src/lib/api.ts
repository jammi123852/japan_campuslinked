import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * 공유 API(게시글·댓글) 클라이언트. 서버는 사용자 PC 의 server/index.ts.
 *
 * 서버 주소 결정 순서
 * 1. 빌드 시 EXPO_PUBLIC_API_URL (네이티브·로컬 개발)
 * 2. 웹: 공개 사이트의 api-config.json  {"apiUrl": "https://....trycloudflare.com"}
 *    터널 주소가 바뀌면 scripts/start-share.sh 가 이 파일만 갱신한다 (웹 재빌드 불필요).
 *
 * 저장에 실패하면 실패로 알린다. 브라우저 저장으로 몰래 대체하지 않는다.
 */

export type ApiErrorKind = 'not_configured' | 'network' | 'http' | 'aborted';

export class ApiError extends Error {
  kind: ApiErrorKind;
  status?: number;
  code?: string;
  constructor(kind: ApiErrorKind, opts: { status?: number; code?: string } = {}) {
    super(`${kind}${opts.code ? `:${opts.code}` : ''}`);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = opts.status;
    this.code = opts.code;
  }
}

export const POST_CATEGORIES = ['class_question', 'registration', 'textbook', 'campus_life'] as const;
export type PostCategory = (typeof POST_CATEGORIES)[number];

export interface PostSummary {
  id: number;
  category: PostCategory;
  title: string;
  body: string;
  lectureId: string | null;
  author: string | null;
  anonymous: boolean;
  isSample: boolean;
  createdAt: string;
  commentCount: number;
  updatedAt?: string | null;
  isDemo?: boolean;
  /** 이 기기 세션이 쓴 글인지 (상세 조회 때 서버가 계산) */
  mine?: boolean;
}

export interface CommentItem {
  id: number;
  body: string;
  author: string | null;
  anonymous: boolean;
  isPostAuthor: boolean;
  createdAt: string;
  updatedAt?: string | null;
  isDemo?: boolean;
  mine?: boolean;
}

// ------------------------------------------------------------ 서버 주소

/** https 만 허용. 단, 로컬 개발(페이지·API 둘 다 localhost)은 http 허용 */
export function isAllowedApiUrl(url: string, pageProtocol: string | null): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    return u.protocol === 'http:' && local && pageProtocol !== 'https:';
  } catch {
    return false;
  }
}

let cachedUrl: string | null | undefined;

async function loadRuntimeConfig(): Promise<string | null> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const base = ((Constants.expoConfig?.experiments as { baseUrl?: string } | undefined)?.baseUrl ?? '').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/api-config.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as { apiUrl?: unknown };
    return typeof json.apiUrl === 'string' && json.apiUrl ? json.apiUrl : null;
  } catch {
    return null;
  }
}

export async function getApiUrl(force = false): Promise<string | null> {
  if (cachedUrl !== undefined && !force) return cachedUrl;
  const fromEnv = process.env.EXPO_PUBLIC_API_URL || null;
  const candidate = fromEnv ?? (await loadRuntimeConfig());
  const pageProtocol = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.protocol : null;
  cachedUrl = candidate && isAllowedApiUrl(candidate, pageProtocol) ? candidate.replace(/\/$/, '') : null;
  return cachedUrl;
}

// ------------------------------------------------------------ 요청

async function request<T>(path: string, init: { method?: string; body?: unknown; token?: string; signal?: AbortSignal } = {}): Promise<T> {
  const base = await getApiUrl();
  if (!base) throw new ApiError('not_configured');
  const send = (url: string) =>
    fetch(url + path, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  let res: Response;
  try {
    res = await send(base);
  } catch {
    if (init.signal?.aborted) throw new ApiError('aborted');
    // 서버를 다시 켜면 터널 주소가 바뀐다. 열려 있던 화면이 옛 주소를 쓰고 있으면 새 주소를 읽어 한 번만 다시 보낸다
    const next = await getApiUrl(true);
    if (!next || next === base) throw new ApiError('network');
    try {
      res = await send(next);
    } catch {
      if (init.signal?.aborted) throw new ApiError('aborted');
      throw new ApiError('network');
    }
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new ApiError('http', { status: res.status, code: json?.error });
  return json as T;
}

/** 데모·시연 입장일 때만 데모 콘텐츠를 받는다. 실제 데이터 모드에는 섞이지 않는다 */
let includeDemo = false;
export function setIncludeDemoContent(v: boolean) {
  includeDemo = v;
}
export const isDemoContentIncluded = () => includeDemo;

// ------------------------------------------------------------ 데모 세션 (서버별로 기기에 저장)

const sessionKey = (base: string) => `ksu:v1:apiSession:${base}`;

async function ensureSession(nickname: string): Promise<string> {
  const base = await getApiUrl();
  if (!base) throw new ApiError('not_configured');
  const saved = await AsyncStorage.getItem(sessionKey(base)).catch(() => null);
  if (saved) {
    const parsed = JSON.parse(saved) as { token: string; nickname: string };
    if (parsed.nickname === nickname) return parsed.token;
    // 닉네임이 바뀌어도 같은 토큰(불변 식별자)을 유지한다. 새 세션을 만들면 내 글·후기 연결이 끊긴다
    try {
      await request<{ nickname: string }>('/api/session', { method: 'PUT', body: { nickname }, token: parsed.token });
      await AsyncStorage.setItem(sessionKey(base), JSON.stringify({ token: parsed.token, nickname }));
      return parsed.token;
    } catch (e) {
      // 401: 세션 없음 → 새로 발급. 404: 아직 재시작 전 이전 서버 → 이전 방식으로 동작
      if (!(e instanceof ApiError && (e.status === 401 || e.status === 404))) throw e;
    }
  }
  const r = await request<{ token: string; nickname: string }>('/api/session', { method: 'POST', body: { nickname } });
  await AsyncStorage.setItem(sessionKey(base), JSON.stringify(r));
  return r.token;
}

/** 세션이 서버에서 사라졌으면(서버 DB 초기화 등) 한 번 새로 발급받아 다시 시도 */
async function withSession<T>(nickname: string, fn: (token: string) => Promise<T>): Promise<T> {
  try {
    return await fn(await ensureSession(nickname));
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      const base = await getApiUrl();
      if (base) await AsyncStorage.removeItem(sessionKey(base));
      return fn(await ensureSession(nickname));
    }
    throw e;
  }
}

// ------------------------------------------------------------ 공개 함수

export async function checkHealth(): Promise<boolean> {
  try {
    await request<{ ok: boolean }>('/api/health');
    return true;
  } catch {
    return false;
  }
}

export async function listPosts(opts: { category?: PostCategory | null; lectureId?: string; limit?: number; q?: string } = {}) {
  const q = new URLSearchParams();
  if (opts.category) q.set('category', opts.category);
  if (opts.lectureId) q.set('lectureId', opts.lectureId);
  if (opts.limit) q.set('limit', String(opts.limit));
  if (opts.q) q.set('q', opts.q);
  if (includeDemo) q.set('demo', '1');
  const qs = q.toString();
  return (await request<{ posts: PostSummary[] }>(`/api/posts${qs ? `?${qs}` : ''}`)).posts;
}

export async function getPost(id: number) {
  const token = await existingToken();
  return request<{ post: PostSummary; comments: CommentItem[] }>(`/api/posts/${id}`, { token });
}

export async function createPost(
  nickname: string,
  input: { category: PostCategory; title: string; body: string; lectureId: string | null; anonymous: boolean; clientId: string },
) {
  return withSession(nickname, (token) => request<{ post: PostSummary }>('/api/posts', { method: 'POST', body: input, token }));
}

export async function addComment(nickname: string, postId: number, input: { body: string; anonymous: boolean; clientId: string }) {
  return withSession(nickname, (token) => request<{ ok: boolean }>(`/api/posts/${postId}/comments`, { method: 'POST', body: input, token }));
}

export async function updatePost(nickname: string, id: number, input: { category: PostCategory; title: string; body: string; lectureId: string | null }) {
  return withSession(nickname, (token) => request<{ post: PostSummary }>(`/api/posts/${id}`, { method: 'PUT', body: input, token }));
}

export async function deletePost(nickname: string, id: number) {
  return withSession(nickname, (token) => request<{ ok: boolean }>(`/api/posts/${id}`, { method: 'DELETE', token }));
}

export async function updateComment(nickname: string, id: number, body: string) {
  return withSession(nickname, (token) => request<{ ok: boolean }>(`/api/comments/${id}`, { method: 'PUT', body: { body }, token }));
}

export async function deleteComment(nickname: string, id: number) {
  return withSession(nickname, (token) => request<{ ok: boolean }>(`/api/comments/${id}`, { method: 'DELETE', token }));
}

export function newClientId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ------------------------------------------------------------ 강의 후기 (공유 서버)

export const REVIEW_EVALUATIONS = ['exam', 'report', 'mixed', 'participation'] as const;
export type ReviewEvaluation = (typeof REVIEW_EVALUATIONS)[number];
export const REVIEW_LIMITS = { min: 10, max: 1000 } as const;

export interface SharedReview {
  id: number;
  lectureId: string;
  takenYear: number;
  grade: number;
  attendance: 'in_person' | 'online' | 'hybrid';
  evaluation: ReviewEvaluation;
  workload: number;
  difficulty: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  /** 이 기기의 데모 세션이 쓴 후기인지 (서버가 계산) */
  mine: boolean;
  isDemo?: boolean;
  /** 서버가 반응 표에서 센 '도움돼요' 수 */
  helpfulCount?: number;
  helpedByMe?: boolean;
  helpfulWeight?: number;
}

export type ReviewInput = Omit<SharedReview, 'id' | 'lectureId' | 'createdAt' | 'updatedAt' | 'mine' | 'isDemo' | 'helpfulCount' | 'helpedByMe' | 'helpfulWeight'>;

/** 이미 발급받은 세션이 있으면 그 토큰 (조회 때 본인 표시용. 없으면 새로 만들지 않는다) */
async function existingToken(): Promise<string | undefined> {
  const base = await getApiUrl();
  if (!base) return undefined;
  const saved = await AsyncStorage.getItem(sessionKey(base)).catch(() => null);
  if (!saved) return undefined;
  try {
    return (JSON.parse(saved) as { token: string }).token;
  } catch {
    return undefined;
  }
}

export async function listReviews(lectureId: string) {
  const token = await existingToken();
  return (await request<{ reviews: SharedReview[] }>(`/api/lectures/${encodeURIComponent(lectureId)}/reviews${includeDemo ? '?demo=1' : ''}`, { token })).reviews;
}

export async function createReview(nickname: string, lectureId: string, input: ReviewInput & { clientId: string; offering?: string | null }) {
  return withSession(nickname, (token) =>
    request<{ review: SharedReview }>(`/api/lectures/${encodeURIComponent(lectureId)}/reviews`, { method: 'POST', body: input, token }),
  );
}

export async function updateReview(nickname: string, id: number, input: ReviewInput) {
  return withSession(nickname, (token) => request<{ review: SharedReview }>(`/api/reviews/${id}`, { method: 'PUT', body: input, token }));
}

/** 도움돼요 누르기·취소. 수를 보내지 않는다 (서버가 센 값을 돌려받는다) */
export async function setReviewHelpful(nickname: string, id: number, on: boolean) {
  return withSession(nickname, (token) => request<{ helpfulCount: number; helpedByMe: boolean; helpfulWeight: number }>(`/api/reviews/${id}/helpful${includeDemo ? '?demo=1' : ''}`, { method: on ? 'PUT' : 'DELETE', token }));
}

export async function deleteReview(nickname: string, id: number) {
  return withSession(nickname, (token) => request<{ ok: boolean }>(`/api/reviews/${id}`, { method: 'DELETE', token }));
}

// ------------------------------------------------------------ 앱 안 알림 확인 (공유 서버)

export interface ActivityResult {
  cursor: { comment: number; review: number };
  comments: { id: number; postId: number; postTitle: string; createdAt: string }[];
  reviews: { id: number; lectureId: string; createdAt: string }[];
}

/** 커서가 null 이면 서버는 기준점만 돌려준다(과거 이벤트를 알림으로 만들지 않음) */
export async function fetchActivity(nickname: string, cursor: { comment: number; review: number } | null, lectureIds: string[]) {
  const q = new URLSearchParams();
  if (cursor) {
    q.set('afterComment', String(cursor.comment));
    q.set('afterReview', String(cursor.review));
  }
  if (lectureIds.length) q.set('lectureIds', lectureIds.join(','));
  return withSession(nickname, (token) => request<ActivityResult>(`/api/me/activity?${q.toString()}`, { token }));
}

// ------------------------------------------------------------ 시간표 사진 AI 인식 (공유 서버 → Claude API)

export interface AiTimetableEntry {
  weekday: number;
  period: number | null;
  courseName: string;
  room: string;
  startTime: string;
  endTime: string;
  memo: string;
  /** 사진·PDF 에 보일 때만 (없으면 빈 문자열) */
  code?: string;
  instructor?: string;
  section?: string;
  term?: string;
  /** 잘리거나 흐려 확인이 필요한 부분 */
  uncertain?: string;
}

/** 사진(base64, 머리말 없이)을 서버로 보내 시간표 칸 목록을 받는다. 같은 사진은 서버가 저장된 결과를 돌려준다 */
export async function analyzeTimetablePhoto(nickname: string, input: { image: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' }, signal?: AbortSignal) {
  return withSession(nickname, (token) =>
    request<{ entries: AiTimetableEntry[]; notes: string; cached: boolean }>('/api/ai/timetable', { method: 'POST', body: input, token, signal }),
  );
}

// ------------------------------------------------------------ 공지 분석 (공유 서버 → Claude API)

export interface NoticeDate {
  kind: 'posted' | 'updated' | 'deadline' | 'reception' | 'entry_close' | 'event' | 'exam' | 'other';
  label: string;
  labelKo?: string;
  labelJa?: string;
  /** 접수·행사 범위의 시작·종료. 범위가 아니면 빈 문자열 */
  startTime?: string;
  endTime?: string;
  /** YYYY-MM-DD. 원문에서 연·월·일을 모두 알 수 있을 때만 (아니면 빈 문자열) */
  date: string;
  time: string;
  rawText: string;
  evidence: string;
  /** 붙여넣은 글에서 인용이 실제로 확인됐는지 (사진·PDF 는 null) */
  evidenceFound: boolean | null;
}

export interface NoticeAnalysis {
  summaryKo: string;
  summaryJa: string;
  audience: string;
  audienceStatus: 'target' | 'needs_check' | 'excluded';
  audienceReason: string;
  tasks: string[];
  materials: string[];
  howTo: string;
  dates: NoticeDate[];
  uncertain: string[];
  /** 언어별 내용. 옛 저장 결과에는 없다 (그때는 콘텐츠 번역으로 맞춘다) */
  ko?: NoticeLangPart;
  ja?: NoticeLangPart;
  cached: boolean;
}

export interface NoticeLangPart {
  audience: string;
  audienceReason: string;
  tasks: string[];
  materials: string[];
  howTo: string;
  uncertain: string[];
}

export async function analyzeNotice(
  nickname: string,
  input: { text?: string; file?: string; mediaType?: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'; profile: string; today: string },
  signal?: AbortSignal,
) {
  return withSession(nickname, (token) => request<NoticeAnalysis>('/api/ai/notice', { method: 'POST', body: input, token, signal }));
}

// ------------------------------------------------------------ 주간 메일 공지 확인 (이 PC 의 로컬 화면에서만)

export interface MailNotice {
  id: string;
  from: string;
  subject: string;
  date: string | null;
  hasAttachment: boolean;
  analysisStatus: 'done' | 'off' | 'failed' | 'no_text';
  analysis: Omit<NoticeAnalysis, 'cached'> | null;
}

export type MailDigest =
  | { status: 'not_configured' }
  | { status: 'pending'; aiEnabled: boolean }
  | { status: 'error'; errorCode: 'auth' | 'network' | 'protocol' | 'unknown'; checkedAt: string; nextCheckAt: string; aiEnabled: boolean }
  | {
      status: 'ok';
      checkedAt: string;
      nextCheckAt: string;
      aiEnabled: boolean;
      window: { from: string; to: string };
      scanned: number;
      truncated: boolean;
      omitted: number;
      notices: MailNotice[];
    };

/** 서버에 저장한 데모 학생 기록 (없으면 404) */
export function fetchDemoHistory<T>() {
  return request<{ history: T }>('/api/demo/history').then((r) => r.history);
}

export function fetchMailDigest() {
  return request<MailDigest>('/api/mail/digest');
}

// ------------------------------------------------------------ 수강 계획 설명 (계산은 앱, 설명만 Claude)

export interface PlanExplanation {
  wishSummary: string;
  suggestedPriorities: string[];
  planNotes: { planId: string; text: string }[];
  courseNotes: { id: string; text: string }[];
  cautions: string[];
  /** 서버가 목록에 없어서 버린 id 수 */
  invalid: number;
  cached: boolean;
}

export interface PlanPick {
  summary: string;
  picks: { id: string; reason: string }[];
  constraints: { lunch: { start: string; end: string } | null; creditGoal: number | null; kisoMax: number | null; onlyNeed: boolean };
  cautions: string[];
  invalid: number;
  cached: boolean;
}

/** 자연어 요청으로 후보 중 과목 고르기 (고르기만 AI, 겹침·점심·학점 검사는 앱) */
export async function pickPlan(nickname: string, input: { wish: string; lang: 'ko' | 'ja'; context: string; candidates: { id: string; facts: string }[] }, signal?: AbortSignal) {
  return withSession(nickname, (token) => request<PlanPick>('/api/ai/plan-pick', { method: 'POST', body: input, token, signal }));
}

export async function explainPlan(
  nickname: string,
  input: { wish: string; lang: 'ko' | 'ja'; candidates: { id: string; name: string; facts: string }[]; plans: { id: string; courseIds: string[]; facts: string }[] },
  signal?: AbortSignal,
) {
  return withSession(nickname, (token) => request<PlanExplanation>('/api/ai/plan-explain', { method: 'POST', body: input, token, signal }));
}

// ------------------------------------------------------------ 강의별 후기 요약 (숫자는 프로그램 집계)

export interface CourseDigest {
  lectureId: string;
  count: number;
  realCount: number;
  demoCount: number;
  demoIncluded: boolean;
  workload: { avg: number; low: number; high: number; mixed: boolean } | null;
  difficulty: { avg: number; low: number; high: number; mixed: boolean } | null;
  evaluation: Record<string, number>;
  aspects: Record<string, { mentioned: number; denied: number; reviewIds: number[]; mentionedWeight?: number; deniedWeight?: number; repeated?: boolean; singleHelpful?: number | null }>;
  weighted?: { workload: number | null; difficulty: number | null; helpfulTotal: number; top: { id: number; helpful: number; weight: number }[] };
  informativeCount: number;
  excludedReviewCount?: number;
  smallSample: boolean;
  missing: string[];
  evidenceReviewIds: number[];
  evidencePostIds: number[];
  excludedPostCount: number;
  sourceHash: string;
  reactionHash?: string;
  storedOverview?: { ko: string; ja: string } | null;
}

export interface SummaryLang {
  overview: string;
  workload: string;
  difficulty: string;
  evaluation: string;
  good: string[];
  caution: string[];
  split: string[];
  repeated?: string[];
  helpfulNotes?: string[];
  missingInfo?: string[];
}

export interface CourseSummaryState {
  digest: CourseDigest;
  status: 'no_reviews' | 'none' | 'stale' | 'fresh' | 'reactions_changed';
  version?: number;
  summary: { ko: SummaryLang; ja: SummaryLang; evidenceReviewIds: number[]; evidencePostIds: number[] } | null;
  generatedBy: string | null;
  updatedAt: string | null;
  reused?: boolean;
}

export async function fetchDigests(ids: string[]) {
  if (!ids.length) return {} as Record<string, CourseDigest>;
  // 주소 길이 때문에 나눠 받는다 (후보를 잘라 일부 후기가 빠지지 않게)
  const out: Record<string, CourseDigest> = {};
  for (let i = 0; i < ids.length; i += 300) {
    const q = new URLSearchParams({ ids: ids.slice(i, i + 300).join(',') });
    if (includeDemo) q.set('demo', '1');
    Object.assign(out, (await request<{ digests: Record<string, CourseDigest> }>(`/api/lectures/digest?${q.toString()}`)).digests);
  }
  return out;
}

export function getCourseSummary(lectureId: string) {
  return request<CourseSummaryState>(`/api/lectures/${encodeURIComponent(lectureId)}/summary${includeDemo ? '?demo=1' : ''}`);
}

export async function generateCourseSummary(nickname: string, lectureId: string, signal?: AbortSignal) {
  return withSession(nickname, (token) => request<CourseSummaryState>(`/api/lectures/${encodeURIComponent(lectureId)}/summary${includeDemo ? '?demo=1' : ''}`, { method: 'POST', body: {}, token, signal }));
}

// ------------------------------------------------------------ 강의계획서 AI 요약

export interface SyllabusPoint {
  topic: 'overview' | 'evaluation' | 'assignment' | 'exam' | 'attendance' | 'prep';
  ko: string;
  ja: string;
  evidence: string;
  evidenceFound: boolean;
}

export async function summarizeSyllabus(nickname: string, lectureId: string, text: string, signal?: AbortSignal) {
  return withSession(nickname, (token) => request<{ points: SyllabusPoint[]; cached: boolean }>('/api/ai/syllabus-summary', { method: 'POST', body: { lectureId, text }, token, signal }));
}

// ------------------------------------------------------------ 콘텐츠 번역 (저장된 문장은 호출 없음)

export async function translateTexts(nickname: string, texts: string[], target: 'ko' | 'ja') {
  return withSession(nickname, (token) => request<{ translations: (string | null)[]; unavailable?: string }>('/api/ai/translate-content', { method: 'POST', body: { texts, target }, token }));
}

// ------------------------------------------------------------ 홈 도우미 (Claude 는 허용된 기능만 고르고 실행은 앱)

export interface AssistantCall {
  tool: string;
  query: string;
  ids: string[];
  excludeWeekdays: number[];
  avoidPeriods: number[];
  keepRequired: boolean;
  needOnly: boolean;
  creditGoal: number;
  minimizeGaps: boolean;
  fewerDays: boolean;
  lunch: boolean;
  prefs: string[];
  screen: string;
  text: string;
  date: string;
  time: string;
}

export interface AssistantReply {
  kind: 'call' | 'answer' | 'unsupported' | 'need_input';
  calls: AssistantCall[];
  answer: string;
  whyMe: string;
  unverified: string[];
  courseIds: string[];
  unsupportedTopic: string;
}

export async function askAssistant(
  nickname: string,
  input: { question: string; lang: 'ko' | 'ja'; toolResults?: { tool: string; result: string }[]; history?: { q: string; a: string }[] },
  signal?: AbortSignal,
) {
  return withSession(nickname, (token) => request<AssistantReply>('/api/ai/assistant', { method: 'POST', body: input, token, signal }));
}

// ------------------------------------------------------------ 진로: 자격증 찾기 (웹 검색 근거, 시기 계산은 앱)

export interface CareerCertResult {
  job: string;
  certs: Partial<import('@/features/career/certLogic').CertInfo>[];
  searchedAt: string;
  cached: boolean;
}

export async function findCareerCerts(nickname: string, job: string, signal?: AbortSignal) {
  return withSession(nickname, (token) => request<CareerCertResult>('/api/ai/career-certs', { method: 'POST', body: { job }, token, signal }));
}

// ------------------------------------------------------------ 검색 결과 요약

export interface SearchSummaryResult {
  ko: { overview: string; points: { text: string; courseIds: string[] }[] };
  ja: { overview: string; points: { text: string; courseIds: string[] }[] };
  cached: boolean;
}

export async function summarizeSearch(nickname: string, input: { query: string; total: number; items: unknown[] }, signal?: AbortSignal) {
  return withSession(nickname, (token) => request<SearchSummaryResult>('/api/ai/search-summary', { method: 'POST', body: input, token, signal }));
}
