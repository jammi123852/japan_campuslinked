import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

import { Block, Button, Chip, Gap, Notice, Screen, T, Segmented } from '@/components/ui';
import { devSampleEnabled } from '@/features/timetableImport/devFlags';
import { DEV_SAMPLE_OCR } from '@/features/timetableImport/devSample';
import {
  draftToEntry,
  EntryFields,
  validateDraft,
  type DraftErrors,
  type EntryDraft,
} from '@/features/timetableImport/EntryFields';
import { parseTimetable, type OcrLine } from '@/features/timetableImport/parseTimetable';
import { useI18n } from '@/i18n';
import type { Strings } from '@/i18n/ko';
import { ApiError, analyzeTimetablePhoto } from '@/lib/api';
import { isOcrAvailable, recognizeLines } from '@/lib/ocr';
import { apiErrorText } from '@/features/community/usePosts';
import { matchOfficialCourse, splitSectionFromName } from '@/features/timetableImport/officialMatch';
import { confirmDestructive } from '@/lib/confirm';
import { clearTimetableBackup, saveTimetableBackup, useTimetableBackup } from '@/services/plannerRepository';
import { loadEditableTimetable, loadTimetable, newEntryId, saveTimetable } from '@/services/timetableRepository';
import type { TimetableEntry } from '@/data/types';
import { entryInPeriod } from '@/features/academic/academicLogic';
import { usePeriodLabel } from '@/features/academic/PeriodBar';
import { QUARTERS, type Quarter } from '@/features/official/types';
import { useOfficial } from '@/features/official/useOfficial';
import type { AiTimetableEntry } from '@/lib/api';
import { pickFileBase64 } from '@/lib/pickFile';
import { usePeriod } from '@/services/periodRepository';
import { useApp } from '@/state/AppContext';
import { colors, radius, space } from '@/theme/tokens';

type Phase =
  | { kind: 'idle' }
  | { kind: 'reading'; uri: string | null; ai?: boolean }
  | { kind: 'review'; uri: string | null; unassigned: string[]; noPeriod: boolean; aiNotes?: string }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

const emptyDraft = (): EntryDraft => ({
  key: newEntryId(),
  weekday: 0,
  period: null,
  courseName: '',
  room: '',
  memo: '',
  startTime: '',
  endTime: '',
});

/** OCR 결과 → 확인 화면 상태 (순수 함수) */
function buildReview(lines: OcrLine[], uri: string | null, t: Strings): { phase: Phase; drafts: EntryDraft[] } {
  const r = parseTimetable(lines);
  if (r.failure) {
    return { phase: { kind: 'error', message: r.failure === 'noText' ? t.timetable.failNoText : t.timetable.failNoHeader }, drafts: [] };
  }
  return {
    phase: { kind: 'review', uri, unassigned: r.unassigned, noPeriod: r.periodRows === 0 },
    drafts: r.entries.map((e) => ({
      key: newEntryId(),
      weekday: e.weekday,
      period: e.period,
      courseName: e.courseName,
      room: e.room ?? '',
      memo: e.memo ?? '',
      startTime: e.startTime ?? '',
      endTime: e.endTime ?? '',
    })),
  };
}

/** AI 인식용 사진 준비: 긴 변 최대 2000px JPEG 로 줄여 base64 (전송량·비용 절약) */
async function prepareForAi(asset: ImagePicker.ImagePickerAsset) {
  const longEdge = Math.max(asset.width, asset.height);
  const m = ImageManipulator.manipulate(asset.uri);
  if (longEdge > 2000) m.resize(asset.width >= asset.height ? { width: 2000 } : { height: 2000 });
  const saved = await (await m.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
  return (saved.base64 ?? '').replace(/^data:[^,]+,/, '');
}

export default function TimetableImportScreen() {
  const { session, profile } = useApp();
  const { t, locale } = useI18n();
  const params = useLocalSearchParams<{ devSample?: string }>();
  // 개발 확인용: ?devSample=1 이면 가상 OCR 결과로 확인 화면부터 연다 (__DEV__ 한정)
  const [initial] = useState(() =>
    devSampleEnabled(params.devSample) ? buildReview(DEV_SAMPLE_OCR, null, t) : { phase: { kind: 'idle' } as Phase, drafts: [] },
  );
  const [phase, setPhase] = useState<Phase>(initial.phase);
  const [drafts, setDrafts] = useState<EntryDraft[]>(initial.drafts);
  const [errors, setErrors] = useState<Record<string, DraftErrors>>({});
  const [existingCount, setExistingCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const backup = useTimetableBackup(session);
  /** 저장 직후 화면: 되돌리기·시간표 보기 */
  const [savedInfo, setSavedInfo] = useState<{ added: number; removed: number; matched: number } | null>(null);
  const [undone, setUndone] = useState(false);
  // 취소 뒤 늦게 도착한 AI 결과는 화면에 넣지 않는다
  const runRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const cancelReading = () => {
    runRef.current += 1;
    abortRef.current?.abort();
    setPhase({ kind: 'error', message: t.timetable.aiCancelled });
  };
  const ocrReady = isOcrAvailable();
  const official = useOfficial();
  const per = usePeriod(session, official.kind === 'ok' ? official.data : null);
  const periodLabel = usePeriodLabel();
  const [mode, setMode] = useState<'add' | 'replace'>('add');
  const [existing, setExisting] = useState<TimetableEntry[]>([]);
  // AI 가 읽은 추가 정보(과목코드·교원·분반·학기·불확실)는 행 키로 따로 보관
  const [aiMeta, setAiMeta] = useState<Record<string, AiTimetableEntry>>({});
  const [timesFilled, setTimesFilled] = useState(0);

  useEffect(() => {
    if (!session) return;
    loadTimetable(session).then((list) => setExistingCount(list?.length ?? 0));
    loadEditableTimetable(session, t).then((r) => setExisting(r.entries));
  }, [session, t]);

  const review = (lines: OcrLine[], uri: string | null) => {
    const next = buildReview(lines, uri, t);
    setDrafts(next.drafts);
    setErrors({});
    setPhase(next.phase);
  };

  const pick = async (source: 'library' | 'camera') => {
    const perm =
      source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setPhase({ kind: 'error', message: t.timetable.permissionDenied });
      return;
    }
    const res =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (res.canceled || !res.assets[0]) return;
    const uri = res.assets[0].uri;
    setPhase({ kind: 'reading', uri });
    try {
      const lines = await recognizeLines(uri, locale === 'ko' ? 'korean' : 'japanese');
      review(lines, uri);
    } catch (e) {
      setPhase({ kind: 'error', message: t.timetable.failError(e instanceof Error ? e.message : String(e)) });
    }
  };

  /** 웹 등 기기 OCR 이 없을 때: 공유 서버를 거쳐 Claude 로 인식 (개발·시연용) */
  const pickAi = async (source: 'library' | 'camera') => {
    const perm =
      source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setPhase({ kind: 'error', message: t.timetable.permissionDenied });
      return;
    }
    const res =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    const run = ++runRef.current;
    const ctl = new AbortController();
    abortRef.current = ctl;
    setPhase({ kind: 'reading', uri: asset.uri, ai: true });
    try {
      const image = await prepareForAi(asset);
      if (run !== runRef.current) return;
      const r = await analyzeTimetablePhoto(profile?.nickname ?? 'guest', { image, mediaType: 'image/jpeg' }, ctl.signal);
      if (run !== runRef.current) return;
      if (r.entries.length === 0) {
        setPhase({ kind: 'error', message: r.notes ? `${t.timetable.aiEmpty} (${r.notes})` : t.timetable.aiEmpty });
        return;
      }
      applyAi(r.entries, r.notes, asset.uri);
    } catch (e) {
      if (run !== runRef.current) return;
      setPhase({ kind: 'error', message: aiErrorMessage(e) });
    }
  };

  /** AI 결과 → 확인 화면. 교시만 있고 시각이 빈 칸은 공식 수업 시각으로 채운다(공식 자료가 있을 때) */
  const applyAi = (list: AiTimetableEntry[], notes: string, uri: string | null) => {
    const periods = official.kind === 'ok' ? official.data.periods.items : [];
    let filled = 0;
    const meta: Record<string, AiTimetableEntry> = {};
    const next = list.map((e) => {
      const key = newEntryId();
      meta[key] = e;
      const time = e.period != null && !e.startTime && !e.endTime ? periods.find((p) => p.period === e.period) : undefined;
      if (time) filled++;
      return {
        key,
        weekday: e.weekday,
        period: e.period,
        // 파일의 분반 표기 '([102])' 는 과목명에서 떼어 메모의 분반으로만 남긴다
        courseName: splitSectionFromName(e.courseName).name,
        room: e.room,
        memo: [e.section || splitSectionFromName(e.courseName).section ? `[${e.section || splitSectionFromName(e.courseName).section}]` : '', e.instructor, e.code, e.memo].filter(Boolean).join(' '),
        startTime: time ? time.start : e.startTime,
        endTime: time ? time.end : e.endTime,
      };
    });
    setAiMeta(meta);
    setTimesFilled(filled);
    setDrafts(next);
    setErrors({});
    setPhase({ kind: 'review', uri, unassigned: [], noPeriod: list.some((e) => e.period == null), aiNotes: notes || undefined });
  };

  const pickPdf = async () => {
    const f = await pickFileBase64(['application/pdf'], 3_700_000);
    if (f.kind === 'cancel') return;
    if (f.kind === 'tooLarge') return setPhase({ kind: 'error', message: t.timetable.aiErrTooLarge });
    const run = ++runRef.current;
    const ctl = new AbortController();
    abortRef.current = ctl;
    setPhase({ kind: 'reading', uri: null, ai: true });
    try {
      const r = await analyzeTimetablePhoto(profile?.nickname ?? 'guest', { image: f.base64, mediaType: 'application/pdf' }, ctl.signal);
      if (run !== runRef.current) return;
      if (r.entries.length === 0) {
        setPhase({ kind: 'error', message: r.notes ? `${t.timetable.aiEmpty} (${r.notes})` : t.timetable.aiEmpty });
        return;
      }
      applyAi(r.entries, r.notes, null);
    } catch (e) {
      if (run !== runRef.current) return;
      setPhase({ kind: 'error', message: aiErrorMessage(e) });
    }
  };

  const aiErrorMessage = (e: unknown) => {
    const code = e instanceof ApiError ? e.code : undefined;
    const message =
      code === 'ai_not_configured'
        ? t.timetable.aiErrNotConfigured
        : code === 'ai_daily_limit'
          ? t.timetable.aiErrLimit
          : code === 'too_large' || code === 'image_invalid'
            ? t.timetable.aiErrTooLarge
            : code === 'ai_refused'
              ? t.timetable.aiErrRefused
              : code === 'ai_busy'
                ? t.timetable.aiErrBusy
                : e instanceof ApiError
                  ? apiErrorText(t, e)
                  : t.timetable.aiErr(e instanceof Error ? e.message : String(e));
    return message;
  };

  /** 파일의 학기 표기 → 쿼터 (모르면 보고 있는 기간의 쿼터) */
  const termOf = (key: string): TimetableEntry['term'] => {
    if (!per.period) return undefined;
    const raw = (aiMeta[key]?.term ?? '').normalize('NFKC');
    const qs = QUARTERS.filter((q) => raw.includes(q));
    const quarters: Quarter[] = qs.length ? qs : /前期|前学期/.test(raw) ? ['1Q', '2Q'] : /後期|後学期/.test(raw) ? ['3Q', '4Q'] : /通年/.test(raw) ? [...QUARTERS] : [per.period.quarter];
    // 파일에 학년도가 적혀 있으면 보고 있는 기간이 아니라 그 학년도로 저장한다
    const fileYear = /(20\d{2})/.exec(raw);
    return { year: fileYear ? Number(fileYear[1]) : per.period.year, quarters };
  };
  /** 공식 강의 대조: 코드 또는 과목명+분반+요일교시가 맞을 때만 연결한다 (애매하면 연결 안 함) */
  const newEntries = (): TimetableEntry[] =>
    drafts.map((d) => {
      const meta = aiMeta[d.key];
      const lectureId = official.kind === 'ok' ? matchOfficialCourse(official.data.courses, { name: d.courseName, code: meta?.code, section: meta?.section || splitSectionFromName(meta?.courseName ?? '').section, weekday: d.weekday, period: d.period }) : null;
      return { ...draftToEntry(d, d.key, 'ocr'), term: termOf(d.key), ...(lectureId ? { lectureId } : {}) };
    });
  const inThisPeriod = per.period ? existing.filter((e) => entryInPeriod(e, per.period!) === 'yes') : [];
  const conflicts =
    mode === 'add'
      ? newEntries().flatMap((n) =>
          existing
            .filter((e) => e.weekday === n.weekday && e.period === n.period && (!e.term || !n.term || (e.term.year === n.term.year && e.term.quarters.some((q) => n.term!.quarters.includes(q)))))
            .map((e) => `${t.common.weekdays[e.weekday]}${t.common.period(e.period)} ${e.courseName}`),
        )
      : [];

  const save = async () => {
    if (!session) return;
    const errs: Record<string, DraftErrors> = {};
    for (const d of drafts) {
      const e = validateDraft(d, t);
      if (Object.keys(e).length > 0) errs[d.key] = e;
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    if (conflicts.length) return;
    setSaving(true);
    try {
      // 추가: 기존 전체 유지 + 새 수업 / 교체: 이 기간 수업만 바꾸고 다른 기간·기간 미지정 수업은 보존
      const kept = mode === 'replace' && per.period ? existing.filter((e) => entryInPeriod(e, per.period!) !== 'yes') : existing;
      const adds = newEntries();
      // 저장 전 시간표를 남겨 되돌릴 수 있게 한다 (수강 계획의 되돌리기와 같은 저장소)
      await saveTimetableBackup(session, existing);
      await saveTimetable(session, [...kept, ...adds]);
      setUndone(false);
      setSavedInfo({ added: adds.length, removed: existing.length - kept.length, matched: adds.filter((e) => e.lectureId).length });
      setPhase({ kind: 'saved' });
    } finally {
      setSaving(false);
    }
  };

  const undoImport = () =>
    confirmDestructive(t.planner.undo, t.timetable.undoBody, { ok: t.common.ok, cancel: t.common.cancel }, async () => {
      if (!session || !backup) return;
      await saveTimetable(session, backup.entries);
      await clearTimetableBackup(session);
      setExisting(backup.entries);
      setExistingCount(backup.entries.length);
      setUndone(true);
    });

  // ------------------------------------------------------------ 저장 뒤 화면

  if (phase.kind === 'saved') {
    return (
      <Screen layout="reading" edges={['bottom']}>
        <T variant="display" header testID="import-saved-title">
          {undone ? t.timetable.undoneTitle : t.timetable.savedTitle}
        </T>
        {savedInfo && !undone ? (
          <T variant="body" tone="secondary" testID="import-saved-line" style={{ marginTop: space.sm, marginBottom: space.lg }}>
            {t.timetable.savedLine(savedInfo.added, savedInfo.removed, savedInfo.matched)}
          </T>
        ) : <Gap />}
        {!undone && backup ? <Button testID="import-undo" label={t.planner.undo} variant="secondary" icon="arrow-undo-outline" onPress={undoImport} /> : null}
        <Gap size={space.sm} />
        <Button testID="import-open-calendar" label={t.homeTT.openCalendar} icon="calendar-outline" onPress={() => router.replace('/calendar')} />
        <Gap size={space.sm} />
        <Button testID="import-again" label={t.timetable.importAgain} variant="tertiary" onPress={() => { setSavedInfo(null); setDrafts([]); setPhase({ kind: 'idle' }); }} />
      </Screen>
    );
  }

  // ------------------------------------------------------------ 확인 화면

  if (phase.kind === 'review') {
    const errorCount = Object.keys(errors).length;
    return (
      <Screen layout="reading"
        edges={['bottom']}
        footer={
          <>
            {errorCount > 0 && <Notice tone="danger" text={t.timetable.errCheckRows} />}
            {existingCount > 0 ? (
              <View style={{ marginBottom: space.sm }}>
                <Segmented<'add' | 'replace'>
                  label={t.timetable.modeAdd}
                  testIDPrefix="import-mode"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'add', label: t.timetable.modeAdd },
                    { value: 'replace', label: t.timetable.modeReplace },
                  ]}
                />
              </View>
            ) : null}
            {conflicts.length ? <Notice tone="danger" text={t.timetable.conflictsBlock(conflicts.join(', '))} /> : null}
            <T variant="sub" tone="secondary" style={{ marginBottom: space.sm, textAlign: 'center' }} testID="import-preview">
              {!per.period
                ? t.timetable.previewNoPeriod
                : mode === 'replace'
                  ? t.timetable.previewReplace(inThisPeriod.length, drafts.length, periodLabel(per.period))
                  : t.timetable.previewAdd(drafts.length, periodLabel(per.period))}
            </T>
            <Button
              testID="save-import"
              label={t.timetable.saveCount(drafts.length)}
              onPress={save}
              loading={saving}
              disabled={drafts.length === 0 || conflicts.length > 0}
            />
          </>
        }
      >
        <T variant="display" header testID="review-title">
          {t.timetable.reviewTitle(drafts.length)}
        </T>
        <T variant="body" tone="secondary" style={{ marginTop: space.xs, marginBottom: space.lg }}>
          {t.timetable.reviewLead}
        </T>
        {phase.uri ? <Image source={{ uri: phase.uri }} style={styles.preview} resizeMode="contain" accessibilityIgnoresInvertColors /> : null}
        {phase.noPeriod && <Notice tone="warning" text={t.timetable.noPeriodFound} />}
        {phase.aiNotes ? <Notice text={`${t.timetable.aiNotesTitle}: ${phase.aiNotes}`} /> : null}
        {timesFilled > 0 ? <Notice text={t.timetable.officialTimes(timesFilled)} /> : null}
        {Object.entries(aiMeta).some(([k, m]) => m.uncertain && drafts.some((d) => d.key === k)) ? (
          <Notice
            tone="warning"
            text={`${t.timetable.uncertainTitle}: ${Object.entries(aiMeta)
              .filter(([k, m]) => m.uncertain && drafts.some((d) => d.key === k))
              .map(([, m]) => `${m.courseName} — ${m.uncertain}`)
              .join(' / ')}`}
          />
        ) : null}

        {drafts.map((d, i) => (
          <View key={d.key}>
            <Block>
              <EntryFields
                draft={d}
                errors={errors[d.key] ?? {}}
                testIDPrefix={`row${i}`}
                onChange={(nd) => setDrafts(drafts.map((x) => (x.key === d.key ? nd : x)))}
              />
              <Button
                testID={`row${i}-remove`}
                label={t.timetable.remove}
                variant="dangerText"
                size="md"
                onPress={() => setDrafts(drafts.filter((x) => x.key !== d.key))}
              />
            </Block>
            <Gap />
          </View>
        ))}

        <Button testID="add-row" label={t.timetable.addRow} variant="tertiary" icon="add" onPress={() => setDrafts([...drafts, emptyDraft()])} />

        {phase.unassigned.length > 0 && (
          <>
            <Gap size={space.xxl} />
            <T variant="headline" style={{ marginBottom: space.sm }}>
              {t.timetable.unassigned}
            </T>
            <View style={styles.wrap}>
              {phase.unassigned.map((u, i) => (
                <Chip key={`${u}-${i}`} label={u} />
              ))}
            </View>
          </>
        )}
      </Screen>
    );
  }

  // ------------------------------------------------------------ 사진 고르기

  return (
    <Screen layout="reading" edges={['bottom']}>
      <T variant="display" header>
        {t.timetable.importTitle}
      </T>
      <T variant="body" tone="secondary" style={{ marginTop: space.sm, marginBottom: space.xxl }}>
        {t.timetable.importLead}
      </T>

      <Notice text={ocrReady ? t.timetable.deviceNote : t.timetable.aiNote} />
      <T variant="caption" tone="tertiary" style={{ marginBottom: space.md }}>{t.timetable.pdfNote}</T>
      {phase.kind === 'error' && <Notice tone="danger" text={phase.message} />}

      {phase.kind === 'reading' ? (
        <Block style={{ alignItems: 'center' }}>
          {phase.uri ? <Image source={{ uri: phase.uri }} style={styles.preview} resizeMode="contain" /> : null}
          <ActivityIndicator color={colors.accent} style={{ marginVertical: space.lg }} />
          <T variant="body" tone="secondary">
            {phase.ai ? t.timetable.aiReading : t.timetable.reading}
          </T>
          {phase.ai ? (
            <View style={{ marginTop: space.md }}>
              <Button testID="import-cancel" label={t.common.cancel} variant="tertiary" size="md" onPress={cancelReading} />
            </View>
          ) : null}
        </Block>
      ) : (
        <>
          {/* 기기 OCR 이 있으면(개발 빌드) 기기에서, 없으면(웹·Expo Go) AI 인식으로 */}
          <Button
            testID="pick-photo"
            label={ocrReady ? t.timetable.pickPhoto : t.timetable.aiPick}
            icon="images-outline"
            onPress={() => (ocrReady ? pick('library') : pickAi('library'))}
          />
          <Gap size={space.sm} />
          <Button
            testID="take-photo"
            label={ocrReady ? t.timetable.takePhoto : t.timetable.aiTake}
            icon="camera-outline"
            variant="secondary"
            onPress={() => (ocrReady ? pick('camera') : pickAi('camera'))}
          />
          <Gap size={space.sm} />
          <Button testID="pick-pdf" label={t.timetable.aiPdf} icon="document-outline" variant="secondary" onPress={pickPdf} />
          <Gap size={space.sm} />
          <Button testID="manual-instead" label={t.timetable.addManual} variant="tertiary" onPress={() => router.replace('/timetable-entry')} />
          {backup ? (
            <>
              <Gap size={space.sm} />
              <Button testID="import-undo-last" label={t.timetable.undoLast} variant="text" size="md" icon="arrow-undo-outline" onPress={undoImport} />
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { width: '100%', height: 200, borderRadius: radius.control, backgroundColor: colors.surface, marginBottom: space.lg },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
