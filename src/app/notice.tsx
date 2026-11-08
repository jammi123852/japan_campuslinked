import { router } from 'expo-router';
import { useTr } from '@/lib/translate';
import { useCt } from '@/lib/contentTranslate';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Collapsible } from '@/components/Collapsible';
import { ContentText } from '@/components/ContentText';
import { Block, BlockHeader, Button, Chip, EmptyText, Gap, Notice, Pill, Row, Screen, T, TextField } from '@/components/ui';
import { periodKey } from '@/features/academic/academicLogic';
import { canSaveDate, dateClock, dateLabel, noticeEvent, noticeText, savePolicy } from '@/features/notice/noticeLogic';
import { addChecklistItem } from '@/services/checklistRepository';
import { usePeriod } from '@/services/periodRepository';
import { findDepartment, findFaculty } from '@/data/faculties';
import { apiErrorText } from '@/features/community/usePosts';
import { useOfficial } from '@/features/official/useOfficial';
import { useI18n } from '@/i18n';
import { analyzeNotice, ApiError, type NoticeAnalysis } from '@/lib/api';
import { academicNow, diffDays } from '@/lib/dates';
import { createHash } from '@/lib/hash';
import { pickFileBase64 } from '@/lib/pickFile';
import { newEventId, upsertEventBySource } from '@/services/scheduleRepository';
import { useApp } from '@/state/AppContext';
import { colors, space } from '@/theme/tokens';

const MAX_TEXT = 20000;

/**
 * 공지 → 할 일·일정. 주소: /notice
 * Claude 는 문서 읽기·정리만 하고, 날짜 형식·과거 여부·원문 인용 확인·일정 중복 방지는 앱이 처리한다.
 */
export default function NoticeScreen() {
  const { session, profile } = useApp();
  const { t, locale } = useI18n();
  const tr = useTr();
  const ct = useCt();
  const official = useOfficial();
  const [text, setText] = useState('');
  const [file, setFile] = useState<{ base64: string; mediaType: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ data: NoticeAnalysis; key: string } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const today = academicNow().date;
  const per = usePeriod(session, official.kind === 'ok' ? official.data : null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<{ id: string; title: string; text: string } | null>(null);
  const [picked2, setPicked2] = useState<Set<number>>(new Set());
  const [taskMsg, setTaskMsg] = useState<string | null>(null);
  // 취소·다시 실행 뒤 늦게 도착한 응답을 화면에 넣지 않는다
  const runRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const sources = useMemo(() => {
    if (official.kind !== 'ok') return [];
    const d = official.data;
    return [
      ...d.notices.map((n) => ({ id: n.id, title: n.title, org: n.org, posted: n.posted, text: `${n.title}\n${n.text}` })),
      ...(d.scholarships ?? []).map((s) => ({ id: s.id, title: s.title, org: s.org, posted: null as string | null, text: [s.title, s.summary, s.audience.text, ...s.conditions, ...s.documents, s.method, s.deadlineText, s.contact].filter(Boolean).join('\n') })),
    ];
  }, [official]);
  const matched = useMemo(() => {
    const q = query.normalize('NFKC').toLowerCase().trim();
    if (!q) return sources;
    return sources.filter((n) => `${n.title} ${tr(n.title)} ${n.org} ${n.text}`.normalize('NFKC').toLowerCase().includes(q));
    // tr 은 표 내용이 바뀔 때만 달라진다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sources]);

  const profileText = profile
    ? `九州産業大学 ${findFaculty(profile.facultyId)?.name ?? ''} ${findDepartment(profile.facultyId, profile.departmentId)?.name ?? ''}, ${profile.currentGrade}年, ${profile.admissionYear}年度入学`
    : '정보 없음';

  const run = async () => {
    if (busy) return;
    const body = text.trim();
    if (!body && !file) return setErr(t.noticeAi.errInput);
    if ([...body].length > MAX_TEXT) return setErr(t.noticeAi.errTooLong);
    const run = ++runRef.current;
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(true);
    setErr(null);
    setSaveMsg(null);
    setTaskMsg(null);
    try {
      const data = await analyzeNotice(profile?.nickname ?? 'guest', {
        text: body || undefined,
        file: file?.base64,
        mediaType: file?.mediaType as 'application/pdf' | undefined,
        profile: profileText,
        today,
      }, ctl.signal);
      if (run !== runRef.current) return;
      setResult({ data, key: createHash(`${body}|${file?.base64.length ?? 0}|${file?.name ?? ''}`) });
      setPicked(new Set());
      setPicked2(new Set());
    } catch (e) {
      if (run !== runRef.current || (e instanceof ApiError && e.kind === 'aborted')) return;
      // 실패해도 입력한 글·첨부는 그대로 둔다
      setErr(e instanceof ApiError && e.code === 'ai_daily_limit' ? t.timetable.aiErrLimit : e instanceof ApiError && e.code === 'ai_not_configured' ? t.timetable.aiErrNotConfigured : apiErrorText(t, e));
    } finally {
      if (run === runRef.current) setBusy(false);
    }
  };

  const cancel = () => {
    runRef.current += 1;
    abortRef.current?.abort();
    setBusy(false);
    setErr(t.noticeAi.cancelled);
  };

  const attach = async () => {
    const f = await pickFileBase64(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], 3_700_000);
    if (f.kind === 'ok') setFile({ base64: f.base64, mediaType: f.mediaType, name: f.name });
    else if (f.kind === 'tooLarge') setErr(t.timetable.aiErrTooLarge);
  };

  /** 일정에 넣을 수 있는 날짜: 날짜가 확실하고, 게시·수정일이 아니고, 지나지 않은 것 */
  const addableIndexes = (result?.data.dates ?? []).flatMap((d, i) => (canSaveDate(d) && diffDays(today, d.date) >= 0 ? [i] : []));

  const saveDates = async (indexes: Iterable<number> = picked, asReference = false) => {
    if (!session || !result) return;
    const policy = savePolicy(result.data.audienceStatus, asReference);
    if (!policy.allowed) return;
    let a = 0;
    let u = 0;
    let s = 0;
    const now = new Date().toISOString();
    for (const i of indexes) {
      const d = result.data.dates[i];
      if (!d?.date) continue;
      const r = await upsertEventBySource(session, noticeEvent(d, result.key, dateLabel(d, locale) || t.noticeAi.kinds[d.kind], policy, newEventId(), now));
      if (r === 'added') a++;
      else if (r === 'updated') u++;
      else s++;
    }
    setSaveMsg(`${t.noticeAi.savedResult(a, u, s)}${result.data.audienceStatus === 'needs_check' ? ` ${t.noticeAi.needsCheckNote}` : policy.reference ? ` ${t.noticeAi.referenceNote}` : ''}`);
  };

  /** 할 일·준비물 → 오늘 쿼터의 체크리스트. 같은 제목은 다시 넣지 않는다 */
  const saveTasks = async (list: string[]) => {
    const basis = per.today?.period ?? per.period;
    if (!session || !basis) return setTaskMsg(t.noticeAi.taskNoPeriod);
    let added = 0;
    let same = 0;
    for (const title of list) {
      const r = await addChecklistItem(session, { periodKey: periodKey(basis), kind: 'manual', ref: null, title });
      if (r === 'added') added++;
      else same++;
    }
    setTaskMsg(t.noticeAi.taskSaved(added, same));
  };

  const r = result?.data;
  const view = r ? noticeText(r, locale) : null;
  const checkItems = view ? [...view.tasks.map((title) => ({ title, material: false })), ...view.materials.map((title) => ({ title, material: true }))] : [];
  return (
    <Screen layout="reading" edges={['bottom']}>
      <Notice text={t.noticeAi.lead} />
      <Gap />

      {sources.length ? (
        <>
          <Block flush testID="notice-search-block">
            <View style={{ paddingHorizontal: 20, paddingTop: space.md }}>
              <BlockHeader title={t.noticeAi.samples} />
              <TextField testID="notice-search" label={t.noticeAi.searchLabel} value={query} onChangeText={setQuery} placeholder={t.noticeAi.searchPlaceholder} />
              <T variant="caption" tone="tertiary" testID="notice-search-count">{t.noticeAi.searchCount(matched.length, sources.length)}</T>
            </View>
            <View style={{ paddingHorizontal: 20, paddingBottom: space.sm }}>
              {matched.length === 0 ? (
                <>
                  <EmptyText text={t.noticeAi.searchNone} />
                  <Button testID="notice-search-clear" label={t.noticeAi.searchClear} variant="text" size="md" onPress={() => setQuery('')} />
                </>
              ) : null}
              {matched.map((n) => (
                <Row
                  key={n.id}
                  testID={`notice-sample-${n.id}`}
                  title={tr(n.title)}
                  numberOfLines={2}
                  subtitle={`${tr(n.org)}${n.posted ? ` · ${n.posted}` : ''} · ${t.noticeAi.samplePast}`}
                  right={
                    <Button
                      testID={`notice-pick-source-${n.id}`}
                      label={selected?.id === n.id ? t.noticeAi.selectedSample : t.noticeAi.useSample}
                      size="md"
                      variant="tertiary"
                      onPress={() => {
                        setSelected({ id: n.id, title: n.title, text: n.text });
                        setText(n.text);
                      }}
                    />
                  }
                />
              ))}
            </View>
          </Block>
          <Gap />
        </>
      ) : null}
      {selected ? (
        <>
          <Block testID="notice-source-view">
            <BlockHeader title={t.noticeAi.sourceTitle} />
            <Collapsible text={selected.text} testID="notice-source-text" />
            <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>{t.noticeAi.sourceNote}</T>
          </Block>
          <Gap />
        </>
      ) : null}

      <Block>
        <TextField
          testID="notice-input"
          label={t.noticeAi.input}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={MAX_TEXT}
          textAlignVertical="top"
          style={{ height: 180, paddingTop: space.md }}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip testID="notice-attach" label={t.noticeAi.attach} icon="attach" onPress={attach} />
          {file ? (
            <>
              <Pill text={t.noticeAi.attached(file.name)} />
              <Chip label={t.noticeAi.removeFile} icon="close" onPress={() => setFile(null)} />
            </>
          ) : null}
        </View>
        <T variant="caption" tone="tertiary" style={{ marginVertical: space.sm }}>
          {t.noticeAi.sendNote}
        </T>
        {err ? <Notice tone="danger" text={`${err} ${t.community.keptInput}`} /> : null}
        <Button testID="notice-analyze" label={busy ? t.noticeAi.analyzing : t.noticeAi.analyze} icon="sparkles-outline" onPress={run} loading={busy} />
      </Block>

      {busy ? (
        <View style={{ alignItems: 'center' }}>
          <ActivityIndicator color={colors.accent} style={{ marginVertical: space.lg }} />
          <Button testID="notice-cancel" label={t.common.cancel} variant="tertiary" size="md" onPress={cancel} />
        </View>
      ) : null}

      {r ? (
        <>
          <Gap />
          <Block testID="notice-result">
            <Pill text={t.noticeAi.aiLabel} tone="warning" />
            <BlockHeader title={t.noticeAi.summary} />
            <ContentText text={view!.summary} testID="notice-summary" />
            <Gap size={space.md} />
            <Row
              title={t.noticeAi.audience}
              subtitle={`${ct(view!.audience) || '-'}${view!.audienceReason ? `\n${ct(view!.audienceReason)}` : ''}`}
              right={<Pill text={t.noticeAi.audienceStatus[r.audienceStatus]} tone={r.audienceStatus === 'target' ? 'success' : r.audienceStatus === 'excluded' ? 'danger' : 'warning'} />}
            />
            {r.audienceStatus === 'excluded' ? <Notice tone="warning" text={t.noticeAi.excludedNote} /> : r.audienceStatus === 'needs_check' ? <Notice text={t.noticeAi.needsCheckHint} /> : null}
            {view!.howTo ? <Row title={t.noticeAi.howTo} subtitle={ct(view!.howTo)} /> : null}
            {view!.uncertain.length ? <Notice tone="warning" text={`${t.noticeAi.uncertain}: ${view!.uncertain.map(ct).join(' / ')}`} /> : null}
            {checkItems.length ? (
              <View testID="notice-tasks" style={{ marginTop: space.sm }}>
                <BlockHeader title={t.noticeAi.taskTitle} />
                {checkItems.map((x, i) => (
                  <Chip
                    key={`${i}-${x.title}`}
                    testID={`notice-task-${i}`}
                    label={`${x.material ? t.noticeAi.materialPrefix : ''}${ct(x.title)}`}
                    icon={picked2.has(i) ? 'checkmark-circle' : 'ellipse-outline'}
                    selected={picked2.has(i)}
                    onPress={() => setPicked2((p) => {
                      const n = new Set(p);
                      if (n.has(i)) n.delete(i);
                      else n.add(i);
                      return n;
                    })}
                  />
                ))}
                {r.audienceStatus === 'excluded' ? null : <Button testID="notice-task-all" label={t.noticeAi.taskAll(checkItems.length)} variant="tertiary" icon="checkbox-outline" onPress={() => saveTasks(checkItems.map((x) => ct(x.title)))} />}
                <Gap size={space.xs} />
                <Button testID="notice-task-selected" label={r.audienceStatus === 'excluded' ? t.noticeAi.taskSelectedRef(picked2.size) : t.noticeAi.taskSelected(picked2.size)} variant="text" size="md" disabled={picked2.size === 0} onPress={() => saveTasks([...picked2].map((i) => ct(checkItems[i].title)))} />
                {taskMsg ? <Notice text={taskMsg} /> : null}
              </View>
            ) : null}
            {r.cached ? (
              <T variant="caption" tone="tertiary">
                {t.noticeAi.cachedNote}
              </T>
            ) : null}
          </Block>
          <Gap />
          <Block>
            <BlockHeader title={t.noticeAi.dates} />
            {r.dates.length === 0 ? (
              <EmptyText text="-" />
            ) : (
              r.dates.map((d, i) => {
                const isPast = !!d.date && diffDays(today, d.date) < 0;
                const canPick = canSaveDate(d);
                return (
                  <View key={i} style={{ paddingVertical: space.sm }} testID={`notice-date-${i}`}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
                      <Pill text={t.noticeAi.kinds[d.kind]} tone={d.kind === 'deadline' ? 'danger' : d.kind === 'exam' ? 'accent' : 'neutral'} />
                      <T variant="body" style={{ fontWeight: '600' }}>
                        {d.date ? `${d.date}${dateClock(d) ? ` ${dateClock(d)}` : ''}` : d.rawText}
                      </T>
                      {isPast ? <Pill text={t.noticeAi.past} /> : null}
                    </View>
                    <T variant="sub" tone="secondary">
                      {ct(dateLabel(d, locale))}
                    </T>
                    {!d.date ? (
                      <T variant="caption" tone="tertiary">
                        {t.noticeAi.noDate}
                      </T>
                    ) : null}
                    {d.evidence ? (
                      <T variant="caption" tone="tertiary">
                        {t.noticeAi.evidence(d.evidence)}
                      </T>
                    ) : null}
                    {d.evidenceFound === false ? (
                      <T variant="caption" tone="danger">
                        {t.noticeAi.evidenceMissing}
                      </T>
                    ) : null}
                    {canPick ? (
                      <Chip
                        testID={`notice-pick-${i}`}
                        label={t.schedule.add}
                        icon={picked.has(i) ? 'checkmark-circle' : 'ellipse-outline'}
                        selected={picked.has(i)}
                        onPress={() => setPicked((p) => {
                          const n = new Set(p);
                          if (n.has(i)) n.delete(i);
                          else n.add(i);
                          return n;
                        })}
                      />
                    ) : null}
                  </View>
                );
              })
            )}
            {r.audienceStatus === 'excluded' ? (
              <>
                <Button testID="notice-save-reference" label={t.noticeAi.saveReference(picked.size)} variant="tertiary" icon="bookmark-outline" onPress={() => saveDates(picked, true)} disabled={picked.size === 0} />
                <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>{t.noticeAi.referenceHelp}</T>
              </>
            ) : (
              <>
                <Button testID="notice-save-all" label={t.noticeAi.addAll(addableIndexes.length)} icon="calendar-outline" onPress={() => saveDates(addableIndexes)} disabled={addableIndexes.length === 0} />
                <Gap size={space.sm} />
                <Button testID="notice-save" label={t.noticeAi.addSelected(picked.size)} variant="tertiary" onPress={() => saveDates()} disabled={picked.size === 0} />
              </>
            )}
            {saveMsg ? <Notice text={saveMsg} /> : null}
            <Gap size={space.sm} />
            <Button
              testID="notice-open-month"
              label={t.noticeAi.openMonth}
              variant="text"
              size="md"
              onPress={() => {
                // 넣을 수 있는 날짜 중 가장 빠른 날짜의 달로 간다
                const first = addableIndexes.map((i) => r.dates[i].date).sort()[0] ?? today;
                router.push({ pathname: '/calendar', params: { view: 'month', date: first } });
              }}
            />
          </Block>
        </>
      ) : null}
    </Screen>
  );
}
