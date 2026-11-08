import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';

import { Block, BlockHeader, Button, Chip, EmptyText, Notice, Pill, T, TextField } from '@/components/ui';
import { periodKey, type AcademicPeriod } from '@/features/academic/academicLogic';
import { apiErrorText } from '@/features/community/usePosts';
import { useI18n } from '@/i18n';
import { useCt } from '@/lib/contentTranslate';
import { ApiError, findCareerCerts, type CareerCertResult } from '@/lib/api';
import { academicNow } from '@/lib/dates';
import { readJson, StorageKeys, writeJson } from '@/lib/storage';
import { addChecklistItem } from '@/services/checklistRepository';
import { newEventId, upsertEventBySource } from '@/services/scheduleRepository';
import { useApp } from '@/state/AppContext';
import { colors, space } from '@/theme/tokens';

import { normalizeCert, planCerts, type CertPlanRow } from './certLogic';

const WEEKLY = [3, 5, 10, 15];

/** 관심 직업 → 자격증 찾기(웹 검색 근거) → 취득 시기 결정(앱 계산) → 일정·체크리스트 등록 */
export function CertFinder({ period, initialJob }: { period: AcademicPeriod | null; initialJob: string }) {
  const { session, profile } = useApp();
  const { t, locale } = useI18n();
  const ct = useCt();
  const [job, setJob] = useState(initialJob);
  const [weekly, setWeekly] = useState(5);
  const [result, setResult] = useState<CareerCertResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const abort = useRef<AbortController | null>(null);
  const run = useRef(0);
  const key = session ? StorageKeys.userData(session.userId, 'careerCerts') : null;

  useEffect(() => {
    if (!key) return;
    let alive = true;
    readJson<{ job: string; weekly: number; result: CareerCertResult }>(key).then((v) => {
      if (!alive || !v) return;
      setJob((j) => j || v.job);
      setWeekly(v.weekly);
      setResult(v.result);
    });
    return () => {
      alive = false;
    };
  }, [key]);

  const search = async () => {
    const q = job.trim();
    if (!q || busy) return;
    const id = ++run.current;
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    setErr(null);
    try {
      const r = await findCareerCerts(profile?.nickname ?? 'guest', q, ctl.signal);
      if (id !== run.current) return;
      setResult(r);
      setMsg({});
      if (key) await writeJson(key, { job: q, weekly, result: r });
    } catch (e) {
      if (id !== run.current || (e instanceof ApiError && e.kind === 'aborted')) return;
      setErr(e instanceof ApiError && e.code === 'ai_daily_limit' ? t.certs.limit : e instanceof ApiError && (e.code === 'ai_error' || e.code === 'ai_not_configured') ? t.certs.failed : apiErrorText(t, e));
    } finally {
      if (id === run.current) setBusy(false);
    }
  };
  const cancel = () => {
    run.current += 1;
    abort.current?.abort();
    setBusy(false);
  };
  const changeWeekly = (n: number) => {
    setWeekly(n);
    if (key && result) writeJson(key, { job, weekly: n, result }).catch(() => undefined);
  };

  const today = academicNow().date;
  const rows = useMemo(() => {
    if (!result) return [];
    const certs = result.certs.map(normalizeCert).filter((c): c is NonNullable<typeof c> => !!c);
    return planCerts(certs, { today, grade: profile?.currentGrade ?? 1, weeklyHours: weekly });
  }, [result, today, profile?.currentGrade, weekly]);

  const when = (r: CertPlanRow) => {
    const [y, m] = r.target.split('-');
    const g = t.common.grade(r.grade);
    if (r.timing === 'after_graduation') return t.certs.afterGrad;
    if (r.timing === 'dated') return t.certs.dated(g, r.target);
    if (r.timing === 'year_round') return t.certs.yearRound(g, Number(y), Number(m));
    return t.certs.estimated(g, Number(y), Number(m));
  };
  const name = (r: CertPlanRow) => (locale === 'ko' ? r.cert.nameKo : r.cert.name);
  const addEvent = async (r: CertPlanRow) => {
    if (!session) return;
    const nowIso = new Date().toISOString();
    const res = await upsertEventBySource(session, { id: newEventId(), sourceKey: `cert:${r.cert.name}:${r.target}`, title: t.certs.eventTitle(name(r), r.examLabel), kind: 'exam', date: r.target, time: null, course: null, memo: r.sourceUrl, notify: true, done: false, createdAt: nowIso, updatedAt: nowIso });
    setMsg((m) => ({ ...m, [r.cert.name]: res === 'added' ? t.certs.addedEvent : t.certs.exists }));
  };
  const addTask = async (r: CertPlanRow) => {
    if (!session || !period) return;
    const res = await addChecklistItem(session, { periodKey: periodKey(period), kind: 'career', ref: null, title: t.certs.taskTitle(name(r), r.startBy, r.hours) });
    setMsg((m) => ({ ...m, [r.cert.name]: res === 'added' ? t.certs.addedTask : t.certs.exists }));
  };

  return (
    <Block testID="career-certs">
      <BlockHeader title={t.certs.title} />
      <T variant="sub" tone="secondary" style={{ marginBottom: space.sm }}>{t.certs.lead}</T>
      <TextField testID="certs-job" label={t.certs.jobLabel} value={job} onChangeText={setJob} placeholder={t.certs.jobPh} maxLength={60} onSubmitEditing={search} />
      <Button testID="certs-search" label={busy ? t.certs.searching : t.certs.search} icon="search-outline" onPress={search} loading={busy} disabled={!job.trim()} />
      <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>{t.certs.note}</T>
      {busy ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm }}>
          <ActivityIndicator color={colors.accent} accessibilityLabel={t.common.loading} />
          <T variant="sub" tone="secondary" style={{ flexShrink: 1 }}>{t.certs.stage}</T>
          <Button testID="certs-cancel" label={t.common.cancel} variant="tertiary" size="md" onPress={cancel} />
        </View>
      ) : null}
      {err ? (
        <View style={{ marginTop: space.sm }}>
          <Notice tone="danger" text={err} />
          <Button testID="certs-retry" label={t.community.retry} variant="tertiary" size="md" onPress={search} />
        </View>
      ) : null}
      {result ? (
        <View testID="certs-result" style={{ marginTop: space.md }}>
          <T variant="caption" tone="tertiary" testID="certs-basis">{t.certs.basis(result.searchedAt.slice(0, 10), result.cached)}</T>
          <T variant="sub" style={{ fontWeight: '700', marginTop: space.sm }}>{t.certs.weekly}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {WEEKLY.map((n) => (
              <Chip key={n} testID={`certs-weekly-${n}`} label={t.certs.weeklyN(n)} selected={weekly === n} onPress={() => changeWeekly(n)} />
            ))}
          </View>
          {rows.length === 0 ? <EmptyText text={t.certs.none} /> : null}
          {rows.map((r) => (
            <View key={r.cert.name} testID={`certs-row-${r.order}`} style={{ paddingVertical: space.md, borderTopWidth: 1, borderTopColor: colors.divider }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, alignItems: 'center' }}>
                <Pill text={t.certs.order(r.order)} tone="accent" />
                <T variant="body" style={{ fontWeight: '700' }}>{name(r)}</T>
              </View>
              {locale === 'ko' && r.cert.nameKo !== r.cert.name ? <T variant="caption" tone="tertiary">{r.cert.name}</T> : null}
              <T variant="headline" tone="accent" testID={`certs-when-${r.order}`} style={{ marginTop: space.xs }}>{when(r)}</T>
              <T variant="sub" tone="secondary" testID={`certs-prep-${r.order}`}>{t.certs.prep(r.startBy, r.weeks, r.hours, weekly)}</T>
              <T variant="sub" style={{ marginTop: space.xs }}>{locale === 'ja' ? r.cert.whyJa : r.cert.whyKo}</T>
              <T variant="caption" tone="secondary" style={{ marginTop: space.xs }}>{t.certs.level(r.cert.difficulty, r.cert.hoursMin, r.cert.hoursMax, r.cert.hoursBasis === 'source')}</T>
              {(locale === 'ja' ? r.cert.eligibilityJa : r.cert.eligibilityKo) ? <T variant="caption" tone="secondary">{t.certs.eligibility(locale === 'ja' ? r.cert.eligibilityJa : r.cert.eligibilityKo)}</T> : null}
              {r.cert.scheduleText ? <T variant="caption" tone="secondary">{t.certs.schedule(ct(r.cert.scheduleText))}</T> : null}
              {r.applyEnd ? <T variant="caption" tone="danger">{t.certs.applyEnd(r.applyEnd)}</T> : null}
              {r.timing === 'estimated' ? <Notice tone="warning" text={t.certs.unverified} /> : null}
              {r.grade <= 4 && !r.beforeJobHunt ? <T variant="caption" tone="tertiary">{t.certs.afterHunt}</T> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs }}>
                {r.timing === 'dated' ? <Button testID={`certs-add-event-${r.order}`} label={t.certs.addEvent} variant="tertiary" size="md" icon="calendar-outline" onPress={() => addEvent(r)} /> : null}
                {period ? <Button testID={`certs-add-task-${r.order}`} label={t.certs.addTask} variant="tertiary" size="md" icon="checkbox-outline" onPress={() => addTask(r)} /> : null}
                {r.cert.officialUrl ? <Button testID={`certs-source-${r.order}`} label={t.certs.official} variant="text" size="md" onPress={() => Linking.openURL(r.cert.officialUrl)} /> : null}
                {r.sourceUrl && r.sourceUrl !== r.cert.officialUrl ? <Button testID={`certs-date-source-${r.order}`} label={t.certs.dateSource} variant="text" size="md" onPress={() => Linking.openURL(r.sourceUrl)} /> : null}
              </View>
              {msg[r.cert.name] ? <T variant="caption" tone="secondary" testID={`certs-msg-${r.order}`}>{msg[r.cert.name]}</T> : null}
            </View>
          ))}
          <T variant="caption" tone="tertiary">{t.certs.disclaimer}</T>
        </View>
      ) : null}
    </Block>
  );
}
