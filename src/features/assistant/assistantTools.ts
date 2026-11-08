/**
 * 도우미가 고른 기능을 앱에서 실행한다. 허용 목록 밖의 기능·인자는 여기서 끝난다.
 * 읽기·검색·계산은 바로, 데이터 변경은 '확인 카드'만 만들고 사용자가 누를 때 실행한다.
 */
import type { AppSession, TimetableEntry, UserProfile } from '@/data/types';
import { entryInPeriod, officialToEntries, type AcademicPeriod } from '@/features/academic/academicLogic';
import { courseNameFor } from '@/data/courseNamesKo';
import { categoryLabel, coursesForDept, deptCodeOf, suggestCategory, quartersKnown } from '@/features/official/courseLogic';
import { deptKeyOf } from '@/features/official/SourceLine';
import type { OfficialCourse, OfficialData } from '@/features/official/types';
import { recommendForShort } from '@/features/planner/recommend';
import { computeProgress, pickRule, type CourseRecord } from '@/features/records/gradLogic';
import { findPlaces, type RoomInfo } from '@/features/campus/campusLogic';
import { loadCampus } from '@/features/campus/useCampus';
import { analyzeNotice, fetchDigests, type AssistantCall, type CourseDigest, type NoticeAnalysis } from '@/lib/api';
import { academicNow } from '@/lib/dates';
import { createHash } from '@/lib/hash';
import { loadScholarshipAnswers } from '@/services/careerRepository';
import { loadChecklist } from '@/services/checklistRepository';
import { deleteRecord, loadRecords, newRecordId, upsertRecords } from '@/services/recordsRepository';
import { loadEvents } from '@/services/scheduleRepository';
import { clearTimetableBackup, loadTimetableBackup, saveTimetableBackup } from '@/services/plannerRepository';
import { loadEditableTimetable, newEntryId, saveTimetable } from '@/services/timetableRepository';
import type { Strings } from '@/i18n/ko';

import { conditionsFromCall, gradView, planFingerprint, planForModel, planFromConditions, scholarshipView, type PlanConditions, type PlanInput } from './assistantLogic';

export type Card =
  | { type: 'grad'; view: ReturnType<typeof gradView>; recIds: Record<string, string[]> }
  | { type: 'courses'; ids: string[]; query: string; total: number }
  | { type: 'compare'; ids: string[] }
  | { type: 'comparePicker' }
  /** calcVersion: AI 문장을 만들 때의 계산 결과. 다시 계산한 값과 다르면 문장을 오래됨으로 처리한다 */
  | { type: 'plan'; conditions: PlanConditions; targetYear: number; targetQuarter: AcademicPeriod['quarter']; calcVersion?: string; answerStale?: boolean; answerMismatch?: boolean }
  | { type: 'scholarships' }
  | { type: 'notices'; query: string }
  | { type: 'noticeResult'; key: string; title: string; analysis: NoticeAnalysis }
  | { type: 'agenda' }
  | { type: 'timetable'; year: number; quarter: AcademicPeriod['quarter'] }
  | { type: 'confirmChecklist'; title: string; done?: boolean }
  | { type: 'confirmEvent'; title: string; date: string; time: string; done?: boolean }
  | { type: 'place'; hits: { id: string; ko: string; ja: string; room: RoomInfo | null; facilities: { ko: string; ja: string }[] }[] }
  | { type: 'open'; screen: string };

export interface ToolCtx {
  session: AppSession;
  profile: UserProfile;
  od: OfficialData;
  t: Strings;
  locale: 'ko' | 'ja';
  today: { period: AcademicPeriod; inSession: boolean } | null;
  period: AcademicPeriod | null;
  shiftQuarter: (p: AcademicPeriod, n: number) => AcademicPeriod;
  signal?: AbortSignal;
}

export const planTarget = (ctx: Pick<ToolCtx, 'today' | 'period' | 'shiftQuarter'>) => (ctx.today ? ctx.shiftQuarter(ctx.today.period, 1) : ctx.period);

const ruleOf = (ctx: Pick<ToolCtx, 'od' | 'profile'>) => {
  const dk = deptKeyOf(ctx.profile.facultyId, ctx.profile.departmentId);
  return pickRule(dk ? ctx.od.departments[dk]?.rules : undefined, ctx.profile.admissionYear, ctx.profile.courseName);
};

/** 계획 계산 입력 (채팅 조건 변경 때도 같은 함수를 쓴다) */
export async function loadPlanInput(ctx: Pick<ToolCtx, 'session' | 'od' | 'profile' | 't'>, target: AcademicPeriod, ids?: string[]): Promise<PlanInput> {
  const [records, { entries }] = await Promise.all([loadRecords(ctx.session), loadEditableTimetable(ctx.session, ctx.t)]);
  const dept = deptCodeOf(ctx.profile.facultyId, ctx.profile.departmentId);
  const picked = ruleOf(ctx);
  const prog = computeProgress(records, picked, 'current');
  const shortCategories = [...prog.categories.filter((c) => c.short > 0).map((c) => c.id as string), ...prog.pools.filter((x) => x.short > 0).map((x) => x.id)];
  const courses = coursesForDept(ctx.od.courses, dept).filter((c) => c.quarters.includes(target.quarter));
  let digestsFailed = false;
  const digests = await fetchDigests(ids ?? courses.map((c) => c.id)).catch(() => {
    digestsFailed = true;
    return {} as Record<string, CourseDigest>;
  });
  return { od: ctx.od, target, records, timetable: entries, admissionYear: ctx.profile.admissionYear, grade: ctx.profile.currentGrade, dept, rule: picked?.rule ?? null, digests, shortCategories, picked, digestsFailed };
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

function searchCourses(ctx: ToolCtx, query: string) {
  const dept = deptCodeOf(ctx.profile.facultyId, ctx.profile.departmentId);
  const q = norm(query);
  const list = (dept ? coursesForDept(ctx.od.courses, dept) : ctx.od.courses).filter((c) => !q || `${c.name}${c.instructor ?? ''}${c.code ?? ''}`.normalize('NFKC').toLowerCase().replace(/\s+/g, '').includes(q));
  return list;
}

export const coursePublic = (c: OfficialCourse) => ({ id: c.id, name: c.name, section: c.section, instructor: c.instructor, credits: c.credits ?? c.syllabus?.credits ?? null, quarters: c.quarters, meetings: c.meetings, mark: c.mark, cohort: c.cohortText ?? c.cohort });

async function syllabusOf(c: OfficialCourse) {
  if (!c.hasSyllabus) return null;
  const base = '';
  const r = await fetch(`${base}/official/syl/${c.id.slice(1, 3)}.json`).catch(() => null);
  if (!r || !r.ok) return null;
  const m = (await r.json().catch(() => null)) as Record<string, { outline: string; evaluation: string; prereq: string; checkedAt: string }> | null;
  return m?.[c.id] ?? null;
}

export function noticeSources(od: OfficialData) {
  return [
    ...od.notices.map((n) => ({ id: n.id, title: n.title, org: n.org, posted: n.posted, text: n.text })),
    ...(od.scholarships ?? []).map((s) => ({ id: s.id, title: s.title, org: s.org, posted: null as string | null, text: [s.title, s.summary, s.audience.text, ...s.conditions, ...s.documents, s.method, s.deadlineText, s.contact].filter(Boolean).join('\n') })),
  ];
}

export async function runNoticeAnalysis(ctx: ToolCtx, text: string, title: string): Promise<Card> {
  const dept = ctx.profile;
  const analysis = await analyzeNotice(dept.nickname ?? 'guest', { text, profile: `九州産業大学 ${dept.facultyId} ${dept.departmentId}, ${dept.currentGrade}年, ${dept.admissionYear}年度入学`, today: academicNow().date }, ctx.signal);
  return { type: 'noticeResult', key: createHash(text), title, analysis };
}

export async function runTool(call: Partial<AssistantCall>, ctx: ToolCtx): Promise<{ result: unknown; cards: Card[] }> {
  switch (call.tool) {
    case 'get_profile':
      return { result: { faculty: ctx.profile.facultyId, department: ctx.profile.departmentId, admissionYear: ctx.profile.admissionYear, grade: ctx.profile.currentGrade, course: ctx.profile.courseName ?? null }, cards: [] };
    case 'get_graduation': {
      const records = await loadRecords(ctx.session);
      const picked = ruleOf(ctx);
      const view = gradView(records, picked);
      const target = planTarget(ctx);
      const recIds: Record<string, string[]> = {};
      if (picked && target) {
        const { entries } = await loadEditableTimetable(ctx.session, ctx.t);
        const rec = recommendForShort({ courses: coursesForDept(ctx.od.courses, deptCodeOf(ctx.profile.facultyId, ctx.profile.departmentId)), rule: picked.rule, shortCategories: view.rowsCurrent.map((r) => r.id), records, timetable: entries, target, admissionYear: ctx.profile.admissionYear, dept: deptCodeOf(ctx.profile.facultyId, ctx.profile.departmentId), interests: [], perCategory: 3 });
        for (const [k, list] of Object.entries(rec)) recIds[k] = list.map((r) => r.course.id);
      }
      // 모델에게도 화면과 같은 이름을 준다 (내부 id·다른 언어 이름이 답에 섞이지 않게)
      const rowLabel = (id: string) => (id === 'flex' ? ctx.t.assistant.flex : picked?.rule.pools?.find((p) => p.id === id)?.label ?? categoryLabel(id, picked?.rule ?? null, ctx.t.records.categories, ctx.locale));
      const named = (rows: typeof view.rows) => rows.map((r) => ({ ...r, id: undefined, area: rowLabel(r.id) }));
      return { result: { ...view, rows: named(view.rows), rowsCurrent: named(view.rowsCurrent), candidates: Object.fromEntries(Object.entries(recIds).map(([k, ids]) => [rowLabel(k), ids.map((id) => ({ id, name: courseNameFor(ctx.od.courses.find((c) => c.id === id)?.name, ctx.locale) }))])) }, cards: [{ type: 'grad', view, recIds }] };
    }
    case 'get_timetable': {
      const basis = ctx.today?.period ?? ctx.period;
      const { entries } = await loadEditableTimetable(ctx.session, ctx.t);
      const list = basis ? entries.filter((e) => entryInPeriod(e, basis) !== 'no') : entries;
      return { result: { period: basis, classes: list.map((e) => ({ weekday: e.weekday, period: e.period, name: e.courseName })) }, cards: basis ? [{ type: 'timetable', year: basis.year, quarter: basis.quarter }] : [] };
    }
    case 'search_courses': {
      const list = searchCourses(ctx, call.query ?? '');
      const ids = list.slice(0, 8).map((c) => c.id);
      const digests = await fetchDigests(ids).catch(() => ({} as Record<string, CourseDigest>));
      return { result: { total: list.length, courses: list.slice(0, 8).map((c) => ({ ...coursePublic(c), reviewCount: digests[c.id]?.count ?? 0 })) }, cards: [{ type: 'courses', ids, query: call.query ?? '', total: list.length }] };
    }
    case 'get_course':
    case 'compare_courses': {
      let ids = (call.ids ?? []).filter((id) => ctx.od.courses.some((c) => c.id === id)).slice(0, 3);
      if (call.tool === 'compare_courses' && ids.length < 2 && call.query) {
        // 이름으로 물었으면 질문 속 과목명과 맞는 강의를 찾는다
        const q = norm(call.query);
        const found = coursesForDept(ctx.od.courses, deptCodeOf(ctx.profile.facultyId, ctx.profile.departmentId)).filter((c) => [...norm(c.name)].length >= 3 && q.includes(norm(c.name)));
        ids = [...new Set([...ids, ...found.map((c) => c.id)])].slice(0, 3);
      }
      if (call.tool === 'compare_courses' && ids.length < 2) return { result: { needPick: true }, cards: [{ type: 'comparePicker' }] };
      const courses = ids.map((id) => ctx.od.courses.find((c) => c.id === id)!);
      const digests = await fetchDigests(ids).catch(() => ({} as Record<string, CourseDigest>));
      const syl = await Promise.all(courses.map(syllabusOf));
      return {
        result: courses.map((c, i) => ({ ...coursePublic(c), syllabus: syl[i] ? { outline: syl[i]!.outline.slice(0, 500), evaluation: syl[i]!.evaluation, restriction: syl[i]!.prereq, checkedAt: syl[i]!.checkedAt } : null, reviewDigest: digests[c.id] ?? null })),
        cards: [call.tool === 'compare_courses' ? { type: 'compare', ids } : { type: 'courses', ids, query: '', total: ids.length }],
      };
    }
    case 'plan_courses': {
      const target = planTarget(ctx);
      if (!target) return { result: { error: 'no_period' }, cards: [] };
      const conditions = conditionsFromCall(call);
      const input = await loadPlanInput(ctx, target);
      const o = planFromConditions(input, conditions);
      const model = planForModel(o, input.digests, conditions.prefs);
      model.plans.forEach((p) => p.courses.forEach((c) => (c.name = courseNameFor(c.name, ctx.locale))));
      return { result: { target, conditions, ...model }, cards: [{ type: 'plan', conditions, targetYear: target.year, targetQuarter: target.quarter, calcVersion: planFingerprint(o) }] };
    }
    case 'find_place': {
      const data = await loadCampus();
      if (!data) return { result: { error: 'no_map_data' }, cards: [] };
      const hits = findPlaces(data, call.query ?? '');
      const list = hits.map((h) => ({ id: h.building.id, ko: h.building.ko, ja: h.building.ja, room: h.room, facilities: h.facility ? [h.facility] : h.building.facilities }));
      return { result: { places: list.map((p) => ({ name: ctx.locale === 'ja' ? p.ja : p.ko, wing: p.room?.wing ?? null, floor: p.room?.floor ?? null, roomBasis: p.room?.basis ?? null, facilities: p.facilities.map((f) => (ctx.locale === 'ja' ? f.ja : f.ko)) })), note: 'floor plans inside buildings are not available' }, cards: [{ type: 'place', hits: list }] };
    }
    case 'get_scholarships': {
      const now = academicNow();
      const answers = await loadScholarshipAnswers(ctx.session);
      const list = ctx.od.scholarships ?? [];
      const view = scholarshipView(list, answers, now.date, now.minutes);
      return { result: { scope: 'app_collected_only', today: now.date, items: view.map((v) => { const s = list.find((x) => x.id === v.id)!; return { ...v, title: s.title, deadline: s.deadlineText, documents: s.documents, contact: s.contact }; }), openCount: view.filter((v) => v.recruit === 'open').length }, cards: [{ type: 'scholarships' }] };
    }
    case 'search_notices': {
      const q = norm(call.query ?? '');
      const hits = noticeSources(ctx.od).filter((n) => !q || norm(`${n.title}${n.text}`).includes(q));
      return { result: { total: hits.length, notices: hits.slice(0, 8).map((n) => ({ id: n.id, title: n.title, org: n.org, posted: n.posted })) }, cards: [{ type: 'notices', query: call.query ?? '' }] };
    }
    case 'analyze_notice': {
      const source = (call.ids ?? []).map((id) => noticeSources(ctx.od).find((n) => n.id === id)).find(Boolean);
      const text = source?.text ?? (call.text ?? '');
      if (!text.trim()) return { result: { needPick: true }, cards: [{ type: 'notices', query: '' }] };
      const card = await runNoticeAnalysis(ctx, text, source?.title ?? ctx.t.assistant.pastedNotice);
      const a = (card as Extract<Card, { type: 'noticeResult' }>).analysis;
      return { result: { audienceStatus: a.audienceStatus, summary: ctx.locale === 'ja' ? a.summaryJa : a.summaryKo, tasks: a.tasks, materials: a.materials, dates: a.dates.map((d) => ({ kind: d.kind, label: d.label, date: d.date, time: d.time, startTime: d.startTime, endTime: d.endTime })), uncertain: a.uncertain }, cards: [card] };
    }
    case 'get_agenda': {
      const [events, items] = await Promise.all([loadEvents(ctx.session), loadChecklist(ctx.session)]);
      const today = academicNow().date;
      return { result: { events: (events ?? []).filter((e) => e.date >= today && !e.done && !e.reference).slice(0, 12).map((e) => ({ title: e.title, date: e.date, time: e.time, kind: e.kind })), checklist: items.filter((i) => i.status === 'todo' || i.status === 'doing').slice(0, 12).map((i) => ({ title: i.title, status: i.status })) }, cards: [{ type: 'agenda' }] };
    }
    case 'propose_checklist': {
      const title = (call.text ?? '').trim().slice(0, 120);
      return title ? { result: { proposed: true, note: 'user must confirm' }, cards: [{ type: 'confirmChecklist', title }] } : { result: { error: 'empty' }, cards: [] };
    }
    case 'propose_event': {
      const title = (call.text ?? '').trim().slice(0, 120);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(call.date ?? '') ? call.date! : '';
      const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(call.time ?? '') ? call.time! : '';
      return title && date ? { result: { proposed: true, note: 'user must confirm' }, cards: [{ type: 'confirmEvent', title, date, time }] } : { result: { error: 'title_and_date_required' }, cards: [] };
    }
    case 'open_screen': {
      const allowed = ['graduation', 'records', 'planner', 'calendar', 'checklist', 'scholarship', 'notice', 'search', 'timetable-import', 'department', 'career'];
      return allowed.includes(call.screen ?? '') ? { result: { ok: true }, cards: [{ type: 'open', screen: call.screen! }] } : { result: { error: 'unknown_screen' }, cards: [] };
    }
    default:
      return { result: { error: 'unknown_tool' }, cards: [] };
  }
}

// ------------------------------------------------------------ 확인 뒤 실행 (채팅 안에서 완료)

export async function applyPlanInChat(ctx: Pick<ToolCtx, 'session' | 't' | 'od' | 'profile'>, target: AcademicPeriod, courseIds: string[]) {
  const { entries } = await loadEditableTimetable(ctx.session, ctx.t);
  await saveTimetableBackup(ctx.session, entries);
  const picked = ruleOf(ctx);
  const courses = courseIds.map((id) => ctx.od.courses.find((c) => c.id === id)).filter((c): c is OfficialCourse => !!c);
  const adds: TimetableEntry[] = courses.flatMap((c) => officialToEntries(c, target.year, ctx.od.periods.items, newEntryId));
  await saveTimetable(ctx.session, [...entries, ...adds]);
  const records = await loadRecords(ctx.session);
  const existing = new Set(records.map((r) => r.officialId));
  const nowIso = new Date().toISOString();
  const newRecords: CourseRecord[] = courses
    .filter((c) => !existing.has(c.id) && quartersKnown(c))
    .map((c) => ({ id: newRecordId(), year: target.year, quarters: [...c.quarters], name: c.name, code: c.code ?? c.syllabus?.code ?? null, section: c.section, credits: c.credits ?? c.syllabus?.credits ?? null, category: 'unknown', suggestedCategory: picked ? suggestCategory(c, picked.rule) : null, status: 'planned', confirmedAt: null, officialId: c.id, note: '', createdAt: nowIso, updatedAt: nowIso }));
  await upsertRecords(ctx.session, newRecords);
  return { added: adds.length, recordIds: newRecords.map((r) => r.id) };
}

export async function undoPlanInChat(session: AppSession, recordIds: string[]) {
  const backup = await loadTimetableBackup(session);
  if (!backup || !Array.isArray(backup.entries)) return false;
  await saveTimetable(session, backup.entries);
  await clearTimetableBackup(session);
  for (const id of recordIds) await deleteRecord(session, id);
  return true;
}
