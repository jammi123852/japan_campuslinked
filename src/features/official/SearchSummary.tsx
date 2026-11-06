import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Block, BlockHeader, Button, Notice, Pill, T } from '@/components/ui';
import { useCourseName } from '@/data/useCourseName';
import { apiErrorText } from '@/features/community/usePosts';
import { useI18n } from '@/i18n';
import { ApiError, fetchDigests, summarizeSearch, type CourseDigest, type SearchSummaryResult } from '@/lib/api';
import { useApp } from '@/state/AppContext';
import { colors, space } from '@/theme/tokens';

import type { OfficialCourse } from './types';

const MAX_SENT = 30;

/** 검색 결과 요약: 숫자는 앱 집계, 무엇을 볼지 정리만 AI. 결과가 바뀌면 옛 요약을 지운다 */
export function SearchSummary({ results, query }: { results: OfficialCourse[]; query: string }) {
  const { profile } = useApp();
  const { t, locale } = useI18n();
  const cn = useCourseName();
  const [digests, setDigests] = useState<Record<string, CourseDigest>>({});
  const [ai, setAi] = useState<{ key: string; data: SearchSummaryResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const shown = useMemo(() => results.slice(0, MAX_SENT), [results]);
  const key = shown.map((c) => c.id).join(',');
  useEffect(() => {
    let alive = true;
    fetchDigests(key ? key.split(',') : []).then((d) => alive && setDigests(d)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [key]);
  const stats = useMemo(() => {
    const names = new Set(results.map((c) => c.name));
    const required = new Set(results.filter((c) => c.mark === 'required' || c.mark === 'required_tech' || c.mark === 'required_math').map((c) => c.name));
    const byDay = [0, 0, 0, 0, 0];
    results.forEach((c) => c.meetings.forEach((m) => { if (m.weekday <= 4) byDay[m.weekday] += 1; }));
    return { sections: results.length, names: names.size, required: required.size, busiest: byDay.indexOf(Math.max(...byDay)), hasMeetings: byDay.some(Boolean) };
  }, [results]);
  const reviewed = shown.filter((c) => digests[c.id]?.count);
  if (results.length === 0) return null;

  const run = async () => {
    if (busy) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    setErr(null);
    try {
      const items = shown.map((c) => ({ id: c.id, name: c.name, section: c.section, credits: c.credits ?? null, mark: c.mark, quarters: c.quarters.join(','), meetings: c.meetings.map((m) => `${m.weekday}-${m.period}`).join(','), review: digests[c.id]?.count ? { n: digests[c.id].count, workload: digests[c.id].workload?.avg ?? null, difficulty: digests[c.id].difficulty?.avg ?? null, demo: digests[c.id].demoCount > 0 } : null }));
      const data = await summarizeSearch(profile?.nickname ?? 'guest', { query, total: results.length, items }, ctl.signal);
      setAi({ key, data });
    } catch (e) {
      if (!(e instanceof ApiError && e.kind === 'aborted')) setErr(apiErrorText(t, e));
    } finally {
      setBusy(false);
    }
  };
  const fresh = ai && ai.key === key ? ai.data : null;
  const view = fresh?.[locale];
  return (
    <Block testID="search-summary" style={{ marginBottom: space.md }}>
      <BlockHeader title={t.searchSummary.title} />
      <T variant="sub" testID="search-summary-stats">{t.searchSummary.stats(stats.sections, stats.names, stats.required)}</T>
      <T variant="caption" tone="secondary" testID="search-summary-reviews">{t.searchSummary.reviews(reviewed.length, shown.length)}{stats.hasMeetings ? ` · ${t.searchSummary.busiest(t.common.weekdays[stats.busiest])}` : ''}</T>
      {view ? (
        <View testID="search-summary-ai" style={{ marginTop: space.sm }}>
          <Pill text={t.digest.aiLabel} tone="accent" />
          <T variant="sub" style={{ marginTop: space.xs }}>{view.overview}</T>
          {view.points.map((p, i) => (
            <View key={i} style={{ marginTop: space.xs }}>
              <T variant="sub">• {p.text}</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {p.courseIds.map((id) => {
                  const c = results.find((x) => x.id === id);
                  return c ? <Button key={id} testID={`search-summary-open-${id}`} label={`${cn(c.name)}${c.section ? ` [${c.section}]` : ''}`} variant="text" size="md" onPress={() => router.push({ pathname: '/course', params: { id } })} /> : null;
                })}
              </View>
            </View>
          ))}
          {results.length > MAX_SENT ? <T variant="caption" tone="tertiary">{t.searchSummary.partial(MAX_SENT, results.length)}</T> : null}
          {fresh?.cached ? <T variant="caption" tone="tertiary">{t.searchSummary.cached}</T> : null}
        </View>
      ) : busy ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm }}>
          <ActivityIndicator color={colors.accent} accessibilityLabel={t.common.loading} />
          <T variant="sub" tone="secondary">{t.searchSummary.running}</T>
          <Button testID="search-summary-cancel" label={t.common.cancel} variant="tertiary" size="md" onPress={() => abort.current?.abort()} />
        </View>
      ) : (
        <Button testID="search-summary-run" label={t.searchSummary.run} variant="tertiary" size="md" icon="sparkles-outline" onPress={run} />
      )}
      {err ? <Notice tone="danger" text={err} /> : null}
    </Block>
  );
}
