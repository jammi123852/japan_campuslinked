import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Block, BlockHeader, Button, Chip, EmptyText, Gap, Notice, Pill, Screen, T, TextField, useWide } from '@/components/ui';
import { useCourseName } from '@/data/useCourseName';
import { type AcademicPeriod } from '@/features/academic/academicLogic';
import { shiftQuarter, usePeriodLabel } from '@/features/academic/PeriodBar';
import { PREFS, type PlanInput, type Pref } from '@/features/assistant/assistantLogic';
import { applyPlanInChat, loadPlanInput, undoPlanInChat } from '@/features/assistant/assistantTools';
import { apiErrorText } from '@/features/community/usePosts';
import { categoryLabel, ruleLabel } from '@/features/official/courseLogic';
import { useOfficial } from '@/features/official/useOfficial';
import { AltHighlights } from '@/features/planner/AltHighlights';
import { ReviewNotes } from '@/features/planner/ReviewNotes';
import { altHighlights, altReviewNotes, buildAlternatives, draftBlockers, draftImpact, EMPTY_BUILDER, evaluateDraft, prepareBuilder, replacementsFor, type AltKey, type BuilderConditions, type DraftMetrics, type Highlights, type ReviewNote } from '@/features/planner/builderLogic';
import { MiniGrid } from '@/features/planner/MiniGrid';
import { PlanWeekGrid, type GridCell } from '@/features/planner/PlanWeekGrid';
import { useI18n } from '@/i18n';
import { ApiError, explainPlan, type PlanExplanation } from '@/lib/api';
import { confirmDestructive } from '@/lib/confirm';
import { readJson, StorageKeys, writeJson } from '@/lib/storage';
import { useTr } from '@/lib/translate';
import { usePeriod } from '@/services/periodRepository';
import { useTimetableBackup } from '@/services/plannerRepository';
import { useRecordsVersion } from '@/services/recordsRepository';
import { useTimetableVersion } from '@/services/timetableRepository';
import { useApp } from '@/state/AppContext';
import { colors, space } from '@/theme/tokens';

type Stage = 'conditions' | 'compare' | 'detail' | 'applied';
interface Saved {
  cond: BuilderConditions;
  target: AcademicPeriod | null;
}
interface LastApply {
  recordIds: string[];
  added: number;
}

function Line({ label, value, tone, testID }: { label: string; value: string; tone?: 'danger' | 'accent'; testID?: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, paddingVertical: 2 }}>
      <T variant="caption" tone="tertiary" style={{ width: 92 }}>{label}</T>
      <T variant="caption" tone={tone ?? 'secondary'} style={{ flex: 1 }} testID={testID}>{value}</T>
    </View>
  );
}

/**
 * 직접 시간표 짜기: 조건 → 완성 시간표 대안 비교 → 과목 조정(영향 미리보기) → 확인 후 적용.
 * 정책: 조건은 이 기기에 저장해 다시 열어도 남는다. 과목 조정은 이 화면에서만 유지되고, 나가면 사라진다.
 * '시간표에 적용'을 확인하기 전에는 실제 시간표·취득 기록을 바꾸지 않는다.
 */
export default function PlanBuilderScreen() {
  const { session, profile } = useApp();
  const { t, locale } = useI18n();
  const cn = useCourseName();
  const tr = useTr();
  const label = usePeriodLabel();
  const wide = useWide();
  const official = useOfficial();
  const od = official.kind === 'ok' ? official.data : null;
  const per = usePeriod(session, od);
  const ttVersion = useTimetableVersion();
  const recVersion = useRecordsVersion();
  const backup = useTimetableBackup(session);

  const storageKey = session ? StorageKeys.userData(session.userId, 'planBuilder') : null;
  const applyKey = session ? StorageKeys.userData(session.userId, 'planBuilderApplied') : null;
  const [stage, setStage] = useState<Stage>('conditions');
  const [cond, setCond] = useState<BuilderConditions>(EMPTY_BUILDER);
  const [target, setTarget] = useState<AcademicPeriod | null>(null);
  const [restored, setRestored] = useState(false);
  const [input, setInput] = useState<PlanInput | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [selected, setSelected] = useState<AltKey | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [history, setHistory] = useState<string[][]>([]);
  const [pending, setPending] = useState<{ removeId: string; replaceId: string | null } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [lastApply, setLastApply] = useState<LastApply | null>(null);
  const [ai, setAi] = useState<{ busy: boolean; data: PlanExplanation | null; err: string | null; version: string | null }>({ busy: false, data: null, err: null, version: null });
  const aiAbort = useRef<AbortController | null>(null);

  // 다른 화면(강의 후기 등)에서 돌아오면 후기·시간표 집계를 다시 읽는다
  useFocusEffect(useCallback(() => setFocusTick((n) => n + 1), []));

  useEffect(() => {
    if (!storageKey || !applyKey) return;
    let alive = true;
    Promise.all([readJson<Saved>(storageKey), readJson<LastApply>(applyKey)]).then(([s, a]) => {
      if (!alive) return;
      if (s?.cond) setCond({ ...EMPTY_BUILDER, ...s.cond });
      if (s?.target) setTarget(s.target);
      setLastApply(a ?? null);
      setRestored(true);
    });
    return () => {
      alive = false;
    };
  }, [storageKey, applyKey]);
  useEffect(() => {
    if (restored && storageKey) writeJson(storageKey, { cond, target } satisfies Saved).catch(() => undefined);
  }, [restored, storageKey, cond, target]);

  const defaultTarget = per.today ? shiftQuarter(per.today.period, 1) : per.period;
  const tgt = target ?? defaultTarget;
  const targets = per.today ? [per.today.period, shiftQuarter(per.today.period, 1), shiftQuarter(per.today.period, 2), shiftQuarter(per.today.period, 3)] : per.period ? [per.period, shiftQuarter(per.period, 1)] : [];
  const ctx = useMemo(() => (session && profile && od ? { session, profile, od, t } : null), [session, profile, od, t]);
  const tgtKey = tgt ? `${tgt.year}-${tgt.quarter}` : '';

  useEffect(() => {
    if (!ctx || !tgtKey) return;
    let alive = true;
    const [year, quarter] = tgtKey.split('-');
    loadPlanInput(ctx, { year: Number(year), quarter: quarter as AcademicPeriod['quarter'] })
      .then((v) => {
        if (!alive) return;
        setInput(v);
        setLoadErr(null);
      })
      .catch((e) => alive && setLoadErr(apiErrorText(t, e)));
    return () => {
      alive = false;
    };
  }, [ctx, tgtKey, ttVersion, recVersion, focusTick, t]);

  // 조건이 바뀌면 바로 다시 계산한다. 옛 대안을 저장해 두지 않으므로 오래된 결과가 남지 않는다
  const result = useMemo(() => (input ? buildAlternatives(input, cond) : null), [input, cond]);
  const b = result?.build ?? null;
  const current = useMemo(() => (input && b && draft.length ? evaluateDraft(input, cond, b, draft) : null), [input, cond, b, draft]);

  // 보는 사이 시간표가 바뀌어 초안이 더 이상 넣을 수 없게 되면 비교 화면으로 돌려보낸다
  if (stage === 'detail' && b && !busy && draftBlockers(b, draft).length) {
    setStage('compare');
    setPending(null);
    setConfirming(false);
    setMsg(t.builder.draftOutdated);
  }

  const change = (patch: Partial<BuilderConditions>) => {
    setCond((c) => ({ ...c, ...patch }));
    setSelected(null);
    setDraft([]);
    setHistory([]);
    setPending(null);
    setConfirming(false);
    setMsg(null);
  };
  const toggleDay = (d: number) => change({ excludeWeekdays: cond.excludeWeekdays.includes(d) ? cond.excludeWeekdays.filter((x) => x !== d) : [...cond.excludeWeekdays, d] });
  const togglePref = (p: Pref) => change({ prefs: cond.prefs.includes(p) ? cond.prefs.filter((x) => x !== p) : [...cond.prefs, p] });

  const areaLabel = (id: string) => {
    if (id === 'flex') return t.grad.flex.split(' (')[0];
    const pool = (input?.rule as { pools?: { id: string; label: string }[] } | null | undefined)?.pools?.find((x) => x.id === id);
    return pool ? ruleLabel(pool.label, locale) : categoryLabel(id, input?.rule, t.records.categories, locale);
  };
  const courseName = (id: string) => cn(b?.byId.get(id)?.course.name ?? id);

  const unmetText = (m: DraftMetrics) =>
    m.unmet.map((u) => (u.key === 'prefNoEvidence' ? t.builder.unmet.prefNoEvidence(t.assistant.prefs[u.pref!], u.n) : t.builder.unmet[u.key](u.n))).join(' · ') || t.builder.none;
  const reviewText = (m: DraftMetrics) => {
    if (!m.reviews.length) return t.digest.none;
    const demo = m.reviews.reduce((a, r) => a + r.demo, 0);
    return t.builder.reviewLine(m.reviewTotal, demo, m.noReviewCourses, m.reviews.filter((r) => r.mixed).length, m.reviews.filter((r) => r.smallSample).length);
  };

  /** 모든 대안·상세가 같은 항목을 같은 순서로 보여 준다 */
  const metricsView = (m: DraftMetrics, id: string) => (
    <View testID={`builder-metrics-${id}`}>
      {m.gradBefore != null ? <Line label={t.builder.m.grad} value={t.builder.gradLine(m.gradBefore, m.gradAfter ?? m.gradBefore, m.gradFilled)} tone={m.gradFilled ? 'accent' : undefined} testID={`builder-grad-${id}`} /> : null}
      <Line label={t.builder.m.credits} value={t.builder.creditLine(m.addedCredits, m.totalCredits, m.addedUnknown + m.fixedUnknown)} testID={`builder-credits-${id}`} />
      <Line label={t.builder.m.fills} value={m.fills.length ? m.fills.map((f) => t.builder.fillLine(areaLabel(f.id), f.before, f.after)).join(', ') : t.builder.none} tone={m.fills.length ? 'accent' : undefined} testID={`builder-fills-${id}`} />
      <Line label={t.builder.m.days} value={t.builder.days(m.days)} testID={`builder-days-${id}`} />
      <Line label={t.builder.m.gaps} value={t.builder.gapLine(m.gapPeriods, t.planner.minutes(m.gapMinutes), m.freeWeekdays)} testID={`builder-gaps-${id}`} />
      <Line label={t.builder.m.lunch} value={t.builder.lunchLine(m.lunchOkDays, m.days, m.maxConsecutive)} testID={`builder-lunch-${id}`} />
      <Line label={t.builder.m.reviews} value={reviewText(m)} testID={`builder-reviews-${id}`} />
      <Line label={t.builder.m.unmet} value={unmetText(m)} testID={`builder-unmet-${id}`} />
      <Line label={t.builder.m.checks} value={m.checks.length ? t.builder.checksCount(m.checks.length) : t.builder.none} testID={`builder-checks-${id}`} />
    </View>
  );

  const highlights = altHighlights((result?.alternatives ?? []).map((a) => ({ id: a.key, m: a.metrics }))) as Record<AltKey, Highlights>;
  // 조정한 계획도 나머지 대안과 같은 기준으로 비교한다
  const currentHighlights = current ? altHighlights<string>([{ id: 'current', m: current }, ...(result?.alternatives ?? []).filter((a) => a.key !== selected).map((a) => ({ id: a.key, m: a.metrics }))]).current : null;

  const candOf = (ids: string[]) => ids.map((id) => b?.byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
  const reviewNotes = input ? (altReviewNotes((result?.alternatives ?? []).map((a) => ({ id: a.key as string, courses: candOf(a.ids) })), input.digests) as Record<string, ReviewNote[]>) : ({} as Record<string, ReviewNote[]>);
  const currentNotes = input && current ? altReviewNotes<string>([{ id: 'current', courses: candOf(draft) }, ...(result?.alternatives ?? []).filter((a) => a.key !== selected).map((a) => ({ id: a.key as string, courses: candOf(a.ids) }))], input.digests, 6).current : [];

  const openAlt = (key: AltKey, ids: string[]) => {
    setSelected(key);
    setDraft(ids);
    setHistory([]);
    setPending(null);
    setConfirming(false);
    setStage('detail');
  };

  const askAi = async () => {
    if (!result?.alternatives.length || !profile || ai.busy) return;
    const ctl = new AbortController();
    aiAbort.current = ctl;
    const version = result.version;
    setAi({ busy: true, data: null, err: null, version });
    try {
      const ids = [...new Set(result.alternatives.flatMap((a) => a.ids))].slice(0, 40);
      const data = await explainPlan(
        profile.nickname ?? 'guest',
        {
          wish: t.builder.condSummary(cond, t),
          lang: locale,
          candidates: ids.map((id) => {
            const c = b!.byId.get(id)!;
            return { id, name: cn(c.course.name), facts: [c.requirement, c.fillsCategory ?? '', c.credits != null ? `${c.credits}credits` : 'credits unknown', c.prerequisite ? 'prerequisite text exists' : '', (() => {
              const d = input?.digests[id];
              return d?.count ? `studentReviews n=${d.count}${d.smallSample ? ' few' : ''}${d.workload?.mixed ? ' mixed' : ''} workload=${d.weighted?.workload ?? d.workload?.avg}/5 difficulty=${d.weighted?.difficulty ?? d.difficulty?.avg}/5` : 'studentReviews none';
            })()].filter(Boolean).join(', ') };
          }),
          plans: result.alternatives.map((a) => ({
            id: a.key,
            courseIds: a.ids,
            facts: `addedCredits=${a.metrics.addedCredits}, days=${a.metrics.days}, gapMin=${a.metrics.gapMinutes}, lunchOkDays=${a.metrics.lunchOkDays}, maxConsecutive=${a.metrics.maxConsecutive}, fills=${a.metrics.fills.map((f) => f.id).join('/') || 'none'}`,
          })),
        },
        ctl.signal,
      );
      setAi({ busy: false, data, err: null, version });
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'aborted') return setAi({ busy: false, data: null, err: null, version: null });
      setAi({ busy: false, data: null, err: e instanceof ApiError && e.code === 'ai_daily_limit' ? t.timetable.aiErrLimit : apiErrorText(t, e), version });
    }
  };

  const confirmChange = () => {
    if (!pending) return;
    const next = draft.filter((id) => id !== pending.removeId);
    if (pending.replaceId) next.push(pending.replaceId);
    setHistory((h) => [...h, draft]);
    setDraft(next.sort());
    setPending(null);
    setConfirming(false);
    setMsg(t.builder.changeApplied);
  };
  const undoChange = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setDraft(prev);
    setHistory((h) => h.slice(0, -1));
    setPending(null);
    setMsg(t.builder.changeUndone);
  };

  const apply = async () => {
    if (!ctx || !tgt || busy || !draft.length) return;
    setBusy(true);
    setErr(null);
    try {
      // 적용 직전에 최신 시간표로 다시 확인한다
      const fresh = await loadPlanInput(ctx, tgt);
      const blockers = draftBlockers(prepareBuilder(fresh, cond), draft);
      if (blockers.length) {
        setErr(t.builder.blocked(blockers.map((n) => cn(n)).join(', ')));
        setConfirming(false);
        return;
      }
      setStage('applied');
      const r = await applyPlanInChat(ctx, tgt, draft);
      const saved = { recordIds: r.recordIds, added: r.added };
      setLastApply(saved);
      if (applyKey) await writeJson(applyKey, saved);
      setConfirming(false);
      setMsg(null);
    } catch (e) {
      setStage('detail');
      setErr(apiErrorText(t, e));
    } finally {
      setBusy(false);
    }
  };
  const undoApply = () => {
    if (!session || !lastApply) return;
    confirmDestructive(t.planner.undo, t.planner.undoConfirmBody, { ok: t.common.ok, cancel: t.common.cancel }, async () => {
      setBusy(true);
      try {
        await undoPlanInChat(session, lastApply.recordIds);
        setLastApply(null);
        if (applyKey) await writeJson(applyKey, null);
        setDraft([]);
        setSelected(null);
        setStage('compare');
        setMsg(t.planner.undone);
      } finally {
        setBusy(false);
      }
    });
  };

  if (official.kind === 'loading' || !restored) return <ActivityIndicator color={colors.accent} style={{ marginTop: space.huge }} accessibilityLabel={t.common.loading} />;
  if (official.kind !== 'ok') {
    return (
      <Screen edges={['bottom']}>
        <Notice tone="warning" text={t.official.missing} />
      </Screen>
    );
  }

  const canUndo = !!lastApply && !!backup;

  // ---------- 1. 조건
  const conditionsView = (
    <>
      <Block testID="builder-conditions">
        <BlockHeader title={t.builder.target} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {targets.map((p) => (
            <Chip key={`${p.year}-${p.quarter}`} testID={`builder-target-${p.year}-${p.quarter}`} label={label(p)} selected={!!tgt && tgt.year === p.year && tgt.quarter === p.quarter} onPress={() => { setTarget(p); change({}); }} />
          ))}
        </View>
        {tgt && tgt.year !== od!.calendar.year ? <Notice tone="warning" text={t.planner.targetNotConfirmed} /> : null}
        <Gap size={space.sm} />
        <T variant="sub" style={{ fontWeight: '700' }}>{t.builder.mustTitle}</T>
        <T variant="caption" tone="tertiary" style={{ marginBottom: space.xs }}>{t.builder.mustNote}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {[0, 1, 2, 3, 4].map((d) => (
            <Chip key={d} testID={`builder-day-${d}`} label={t.assistant.condDay(t.common.weekdays[d])} selected={cond.excludeWeekdays.includes(d)} onPress={() => toggleDay(d)} />
          ))}
          <Chip testID="builder-must-first" label={t.builder.mustFirst} selected={cond.avoidPeriods.includes(1)} onPress={() => change({ avoidPeriods: cond.avoidPeriods.includes(1) ? [] : [1] })} />
          <Chip testID="builder-must-lunch" label={t.builder.mustLunch} selected={cond.lunch} onPress={() => change({ lunch: !cond.lunch })} />
          <Chip testID="builder-required" label={t.assistant.condRequired} selected={cond.keepRequired} onPress={() => change({ keepRequired: !cond.keepRequired })} />
          <Chip testID="builder-need" label={t.assistant.condNeed} selected={cond.needOnly} onPress={() => change({ needOnly: !cond.needOnly })} />
        </View>
        <Gap size={space.sm} />
        <T variant="sub" style={{ fontWeight: '700' }}>{t.builder.softTitle}</T>
        <T variant="caption" tone="tertiary" style={{ marginBottom: space.xs }}>{t.builder.softNote}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Chip testID="builder-soft-first" label={t.builder.softFirst} selected={cond.softFirst} onPress={() => change({ softFirst: !cond.softFirst })} />
          <Chip testID="builder-soft-lunch" label={t.builder.softLunch} selected={cond.softLunch} onPress={() => change({ softLunch: !cond.softLunch })} />
          <Chip testID="builder-gaps" label={t.assistant.condGaps} selected={cond.minimizeGaps} onPress={() => change({ minimizeGaps: !cond.minimizeGaps })} />
          <Chip testID="builder-fewer-days" label={t.assistant.condFewerDays} selected={cond.fewerDays} onPress={() => change({ fewerDays: !cond.fewerDays })} />
          {PREFS.map((p) => (
            <Chip key={p} testID={`builder-pref-${p}`} label={t.assistant.prefs[p]} selected={cond.prefs.includes(p)} onPress={() => togglePref(p)} />
          ))}
        </View>
        <T variant="caption" tone="tertiary">{t.digest.prefNote}</T>
        <Gap size={space.sm} />
        <TextField
          testID="builder-credit"
          label={t.assistant.condCredit}
          keyboardType="number-pad"
          maxLength={2}
          value={cond.creditGoal ? String(cond.creditGoal) : ''}
          onChangeText={(v) => {
            const n = Number(v.replace(/\D/g, ''));
            change({ creditGoal: n > 0 && n <= 30 ? n : null });
          }}
        />
        <Button testID="builder-make" label={t.builder.make} icon="grid-outline" onPress={() => setStage('compare')} disabled={!tgt} />
        <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>{t.builder.keepNote}</T>
      </Block>
      {canUndo ? (
        <>
          <Gap />
          <Block>
            <T variant="sub">{t.builder.lastApplied(lastApply!.added)}</T>
            <Button testID="builder-undo-last" label={t.planner.undo} variant="tertiary" size="md" icon="arrow-undo-outline" onPress={undoApply} loading={busy} />
          </Block>
        </>
      ) : null}
    </>
  );

  // ---------- 2. 대안 비교
  const altCard = (a: NonNullable<typeof result>['alternatives'][number]) => {
    const note = ai.version === result!.version ? ai.data?.planNotes.find((n) => n.planId === a.key) : null;
    return (
      <View key={a.key} testID={`builder-alt-${a.key}`} style={{ width: wide ? 340 : 300, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider, borderRadius: 16, padding: space.lg }}>
        <T variant="headline" style={{ fontWeight: '700' }} testID={`builder-alt-title-${a.key}`}>{a.merged.map((k) => t.builder.alt[k]).join(' · ')}</T>
        {a.merged.length > 1 ? <T variant="caption" tone="tertiary">{t.builder.merged}</T> : null}
        <T variant="caption" tone="tertiary" style={{ marginBottom: space.sm }}>{t.builder.altNote[a.key]}</T>
        <MiniGrid fixed={b!.pre.fixed} added={a.ids.flatMap((id) => b!.byId.get(id)?.course.meetings ?? [])} testID={`builder-grid-${a.key}`} />
        <Gap size={space.sm} />
        {a.ids.map((id) => (
          <T key={id} variant="sub" numberOfLines={1}>• {courseName(id)}</T>
        ))}
        <Gap size={space.sm} />
        <View testID={`builder-summary-${a.key}`} style={{ marginBottom: space.xs }}>
          <T variant="sub" tone="accent" style={{ fontWeight: '700' }}>{t.builder.summaryLine(a.metrics.freeWeekdays, a.metrics.gradBefore != null ? a.metrics.gradFilled : null)}</T>
          {(() => {
            const n = reviewNotes[a.key]?.find((x) => x.betterThan) ?? reviewNotes[a.key]?.find((x) => x.tags.length);
            if (!n) return null;
            return <T variant="sub">{n.betterThan ? t.builder.summaryBetter(cn(n.name), cn(n.betterThan.name)) : t.builder.summaryReview(cn(n.name), t.builder.reviewTag[n.tags[0]], n.n)}</T>;
          })()}
        </View>
        <AltHighlights h={highlights[a.key]} testID={`builder-highlights-${a.key}`} />
        <ReviewNotes notes={reviewNotes[a.key] ?? []} testID={`builder-review-notes-${a.key}`} />
        <Gap size={space.sm} />
        {metricsView(a.metrics, a.key)}
        {note ? <Notice text={note.text} /> : null}
        <Gap size={space.sm} />
        <Button testID={`builder-open-${a.key}`} label={t.builder.openAlt} size="md" onPress={() => openAlt(a.key, a.ids)} />
      </View>
    );
  };
  const relaxLabel = (r: NonNullable<typeof result>['outcome']['relax'][number]) => t.assistant.relax(r.key === 'day' ? t.assistant.condDay(t.common.weekdays[r.day!]) : r.key === 'period' ? t.common.period(r.period!) : t.assistant.relaxKeys[r.key as 'keepRequired' | 'needOnly' | 'lunch'], r.usableAfter);
  const compareView = (
    <>
      <Block testID="builder-compare">
        <BlockHeader title={tgt ? t.builder.compareTitle(label(tgt)) : t.builder.compareTitle('')} />
        <T variant="sub" tone="secondary" testID="builder-cond-summary">{t.builder.condSummary(cond, t)}</T>
        <Button testID="builder-edit-cond" label={t.builder.editCond} variant="text" size="md" onPress={() => setStage('conditions')} />
        {!result ? <ActivityIndicator color={colors.accent} accessibilityLabel={t.common.loading} /> : null}
        {input?.digestsFailed ? <Notice tone="warning" text={t.builder.digestsFailed} /> : null}
        {result?.outcome.conflicts.length ? (
          <View testID="builder-conflicts">
            <Notice tone="warning" text={t.assistant.conflictTitle(result.outcome.conflicts.map((c) => `${cn(c.name)} (${t.assistant.conflictReason[c.reason]}${c.with ? `: ${cn(c.with)}` : ''})`).join(', '))} />
          </View>
        ) : null}
        {result && !result.alternatives.length ? <EmptyText text={t.builder.noAlt} /> : null}
        {result?.outcome.relax.length ? (
          <View testID="builder-relax">
            <T variant="sub" style={{ fontWeight: '700', marginTop: space.sm }}>{t.assistant.relaxTitle}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {result.outcome.relax.map((r, i) => (
                <Chip key={i} testID={`builder-relax-${r.key}${r.day ?? r.period ?? ''}`} label={relaxLabel(r)} onPress={() => change(r.key === 'day' ? { excludeWeekdays: cond.excludeWeekdays.filter((x) => x !== r.day) } : r.key === 'period' ? { avoidPeriods: cond.avoidPeriods.filter((x) => x !== r.period) } : { [r.key]: false })} />
              ))}
            </View>
          </View>
        ) : null}
        {result && result.alternatives.length > 0 && result.alternatives.length < 3 ? <T variant="caption" tone="tertiary" testID="builder-fewer-note">{t.builder.fewerAlt(result.alternatives.length)}</T> : null}
      </Block>
      {result?.alternatives.length ? (
        <>
          <Gap />
          {wide ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>{result.alternatives.map(altCard)}</View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ gap: space.md }}>{result.alternatives.map(altCard)}</ScrollView>
          )}
          <Gap />
          <Block testID="builder-ai">
            <T variant="caption" tone="tertiary">{t.builder.aiNote}</T>
            {ai.busy ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm }}>
                <ActivityIndicator color={colors.accent} accessibilityLabel={t.common.loading} />
                <T variant="sub" tone="secondary">{t.builder.aiRunning}</T>
                <Button testID="builder-ai-cancel" label={t.common.cancel} variant="tertiary" size="md" onPress={() => aiAbort.current?.abort()} />
              </View>
            ) : (
              <Button testID="builder-ai-run" label={ai.err ? t.community.retry : t.builder.aiRun} variant="tertiary" size="md" icon="sparkles-outline" onPress={askAi} />
            )}
            {ai.err && ai.version === result.version ? <Notice tone="danger" text={ai.err} /> : null}
            {ai.data && ai.version === result.version ? (
              <View testID="builder-ai-result" style={{ marginTop: space.sm }}>
                <Pill text={t.digest.aiLabel} tone="accent" />
                <T variant="sub" style={{ marginTop: space.xs }}>{ai.data.wishSummary}</T>
                {ai.data.cautions.map((c) => <T key={c} variant="caption" tone="secondary">• {c}</T>)}
              </View>
            ) : null}
          </Block>
        </>
      ) : null}
    </>
  );

  // ---------- 3. 선택한 대안 크게 + 과목 조정
  const cells: GridCell[] = [
    ...(b?.pre.fixed ?? []).map((e) => ({ weekday: e.weekday, period: e.period, name: e.courseName })),
    ...draft.flatMap((id) => (b?.byId.get(id)?.course.meetings ?? []).map((m) => ({ weekday: m.weekday, period: m.period, name: b!.byId.get(id)!.course.name, addedId: id }))),
  ];
  const impact = input && b && pending ? draftImpact(input, cond, b, draft, [...draft.filter((id) => id !== pending.removeId), ...(pending.replaceId ? [pending.replaceId] : [])]) : null;
  const replacements = input && b && pending ? replacementsFor(input, b, draft, pending.removeId) : [];
  const diff = (a: number, z: number, fmt: (n: number) => string) => (a === z ? fmt(z) : `${fmt(a)} → ${fmt(z)}`);
  const detailView = current ? (
    <>
      <Block testID="builder-detail">
        <BlockHeader title={selected ? t.builder.alt[selected] : t.builder.compareTitle('')} right={<Button testID="builder-back-compare" label={t.builder.backCompare} variant="text" size="md" onPress={() => { setStage('compare'); setPending(null); setConfirming(false); }} />} />
        {history.length ? <Pill text={t.builder.adjusted(history.length)} tone="accent" /> : null}
        <PlanWeekGrid cells={cells} testID="builder-big-grid" onPressAdded={(id) => { setPending({ removeId: id, replaceId: null }); setConfirming(false); }} />
        <Gap size={space.sm} />
        {currentHighlights ? <AltHighlights h={currentHighlights} testID="builder-highlights-current" /> : null}
        {currentNotes.length ? <ReviewNotes notes={currentNotes} testID="builder-review-notes-current" /> : null}
        <Gap size={space.sm} />
        {metricsView(current, 'current')}
        {current.requiredMissing.length ? <Notice tone="warning" text={t.builder.requiredMissing(current.requiredMissing.map((n) => cn(n)).join(', '))} /> : null}
        {current.remaining.length ? <T variant="caption" tone="secondary" testID="builder-remaining">{t.builder.remaining(current.remaining.map((r) => `${areaLabel(r.id)} ${r.short}`).join(', '))}</T> : null}
        <T variant="caption" tone="tertiary">{t.builder.fillNote}</T>
        {msg ? <Notice text={msg} /> : null}
        {history.length ? <Button testID="builder-change-undo" label={t.builder.changeUndo} variant="text" size="md" icon="arrow-undo-outline" onPress={undoChange} /> : null}
      </Block>
      <Gap />
      <Block testID="builder-courses">
        <BlockHeader title={t.builder.coursesTitle(draft.length)} />
        {draft.map((id) => {
          const c = b!.byId.get(id);
          if (!c) return null;
          const d = input!.digests[id];
          const checks = current.checks.filter((x) => x.id === id);
          return (
            <View key={id} testID={`builder-course-${id}`} style={{ paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colors.divider }}>
              <T variant="body" style={{ fontWeight: '700' }}>{cn(c.course.name)}{c.course.section ? ` [${c.course.section}]` : ''}</T>
              <T variant="caption" tone="secondary">{t.assistant.planOfficial(t.planner.reasons[c.requirement], c.credits, c.fillsCategory ? areaLabel(c.fillsCategory) : null, b!.pre.forced.includes(c))}</T>
              <T variant="caption" tone="secondary">{c.course.meetings.map((m) => t.lectures.meeting(t.common.weekdays[m.weekday], m.period)).join(', ')}</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, alignItems: 'center' }}>
                <T variant="caption" tone="tertiary" testID={`builder-digest-${id}`}>{d?.count ? t.digest.line(d.count, d.demoIncluded ? d.demoCount : 0, d.workload?.avg ?? null, d.difficulty?.avg ?? null) : t.digest.none}</T>
                {d?.smallSample ? <Pill text={t.builder.smallPill} /> : null}
                {d?.workload?.mixed || d?.difficulty?.mixed ? <Pill text={t.digest.mixedPill} /> : null}
              </View>
              {checks.map((x, i) => <T key={i} variant="caption" tone="secondary" numberOfLines={3} testID={`builder-check-${id}-${x.kind}`}>• {t.builder.check[x.kind]}{x.text ? `: ${tr(x.text)}` : ''}</T>)}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
                <Button testID={`builder-remove-${id}`} label={t.builder.removeOrSwap} variant="tertiary" size="md" onPress={() => { setPending({ removeId: id, replaceId: null }); setConfirming(false); }} />
                <Button testID={`builder-evidence-${id}`} label={t.assistant.reviewEvidence} variant="text" size="md" onPress={() => router.push({ pathname: '/course', params: { id } })} />
              </View>
            </View>
          );
        })}
      </Block>
      {pending && impact ? (
        <>
          <Gap />
          <Block testID="builder-impact">
            <BlockHeader title={pending.replaceId ? t.builder.impactSwap(courseName(pending.removeId), courseName(pending.replaceId)) : t.builder.impactRemove(courseName(pending.removeId))} />
            <Line label={t.builder.m.credits} value={`${diff(impact.before.addedCredits, impact.after.addedCredits, (n) => String(n))} (${impact.creditsDelta >= 0 ? '+' : ''}${impact.creditsDelta})`} testID="builder-impact-credits" />
            <Line label={t.builder.m.days} value={diff(impact.before.days, impact.after.days, t.builder.days)} testID="builder-impact-days" />
            <Line label={t.builder.m.gaps} value={diff(impact.before.gapMinutes, impact.after.gapMinutes, t.planner.minutes)} testID="builder-impact-gaps" />
            <Line label={t.builder.lunchOnly} value={diff(impact.before.lunchOkDays, impact.after.lunchOkDays, t.builder.days)} testID="builder-impact-lunch" />
            <Line label={t.builder.consecutive} value={diff(impact.before.maxConsecutive, impact.after.maxConsecutive, t.builder.periods)} testID="builder-impact-run" />
            <Line label={t.builder.required} value={impact.after.requiredIncluded.length ? impact.after.requiredIncluded.map((n) => cn(n)).join(', ') : t.builder.none} testID="builder-impact-required" />
            {impact.requiredLost.length ? <Notice tone="warning" text={t.builder.requiredLost(impact.requiredLost.map((n) => cn(n)).join(', '))} /> : null}
            {impact.areasWorse.length ? <Notice tone="warning" text={t.builder.areasWorse(impact.areasWorse.map((a) => t.builder.fillLine(areaLabel(a.id), a.before, a.after)).join(', '))} /> : null}
            {impact.areasBetter.length ? <Notice text={t.builder.areasBetter(impact.areasBetter.map((a) => t.builder.fillLine(areaLabel(a.id), a.before, a.after)).join(', '))} /> : null}
            {impact.prereqAffected.length ? <Notice tone="warning" text={t.builder.prereqAffected(impact.prereqAffected.map((n) => cn(n)).join(', '))} /> : null}
            <T variant="caption" tone="tertiary" testID="builder-impact-note">{t.builder.impactNote}</T>
            <T variant="sub" style={{ fontWeight: '700', marginTop: space.sm }}>{t.builder.replacements}</T>
            {replacements.length === 0 ? <EmptyText text={t.builder.noReplacement} /> : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {replacements.map((c) => (
                  <Chip key={c.course.id} testID={`builder-swap-${c.course.id}`} label={`${cn(c.course.name)}${c.course.section ? ` [${c.course.section}]` : ''} · ${c.credits ?? '?'}${t.official.creditsUnit}`} selected={pending.replaceId === c.course.id} onPress={() => setPending({ removeId: pending.removeId, replaceId: pending.replaceId === c.course.id ? null : c.course.id })} />
                ))}
              </View>
            )}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm }}>
              <Button testID="builder-change-confirm" label={pending.replaceId ? t.builder.confirmSwap : t.builder.confirmRemove} size="md" onPress={confirmChange} />
              <Button testID="builder-change-cancel" label={t.common.cancel} variant="tertiary" size="md" onPress={() => setPending(null)} />
            </View>
          </Block>
        </>
      ) : null}
      <Gap />
      <Block testID="builder-apply">
        {err ? <Notice tone="danger" text={err} /> : null}
        {confirming ? (
          <View testID="builder-apply-preview">
            <Notice text={t.builder.applyPreview(tgt ? label(tgt) : '', draft.length, current.addedCredits)} />
            <T variant="caption" tone="tertiary">{t.builder.applyNote}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm }}>
              <Button testID="builder-apply-confirm" label={t.assistant.planConfirm} size="md" onPress={apply} loading={busy} />
              <Button testID="builder-apply-cancel" label={t.common.cancel} variant="tertiary" size="md" onPress={() => setConfirming(false)} />
            </View>
          </View>
        ) : (
          <>
            <Button testID="builder-apply-open" label={t.builder.applyOpen} icon="checkmark" onPress={() => { setConfirming(true); setPending(null); }} />
            <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>{t.builder.notAppliedYet}</T>
          </>
        )}
      </Block>
    </>
  ) : (
    <Block>
      <EmptyText text={t.builder.emptyDraft} />
      <Button testID="builder-back-compare" label={t.builder.backCompare} variant="tertiary" size="md" onPress={() => setStage('compare')} />
    </Block>
  );

  // ---------- 4. 적용 결과
  const appliedView = (
    <Block testID="builder-applied">
      {busy ? <ActivityIndicator color={colors.accent} accessibilityLabel={t.common.loading} /> : (
        <>
          <Notice text={t.assistant.planApplied(lastApply?.added ?? 0)} />
          <T variant="caption" tone="tertiary">{t.builder.appliedNote}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm }}>
            <Button testID="builder-undo" label={t.planner.undo} variant="tertiary" size="md" icon="arrow-undo-outline" onPress={undoApply} />
            <Button testID="builder-open-calendar" label={t.homeTT.openCalendar} variant="secondary" size="md" onPress={() => router.push('/calendar')} />
          </View>
        </>
      )}
    </Block>
  );

  return (
    <Screen edges={['bottom']}>
      <Notice text={t.builder.lead} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.md }} testID="builder-steps">
        {(['conditions', 'compare', 'detail', 'applied'] as const).map((s, i) => (
          <Pill key={s} text={`${i + 1}. ${t.builder.steps[s]}`} tone={stage === s ? 'accent' : 'neutral'} />
        ))}
      </View>
      {loadErr ? (
        <>
          <Notice tone="danger" text={loadErr} />
          <Button testID="builder-reload" label={t.community.retry} variant="tertiary" size="md" onPress={() => setFocusTick((n) => n + 1)} />
        </>
      ) : null}
      {msg && stage !== 'detail' ? <Notice text={msg} /> : null}
      {stage === 'conditions' ? conditionsView : stage === 'compare' ? compareView : stage === 'detail' ? detailView : appliedView}
      <Gap />
    </Screen>
  );
}
