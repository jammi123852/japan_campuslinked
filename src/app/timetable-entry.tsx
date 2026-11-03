import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useLayoutEffect, useState } from 'react';
import { View } from 'react-native';

import { Block, Button, Chip, Gap, Notice, Screen, T } from '@/components/ui';
import type { TimetableEntry } from '@/data/types';
import { QUARTERS, type Quarter } from '@/features/official/types';
import { useOfficial } from '@/features/official/useOfficial';
import { usePeriod } from '@/services/periodRepository';
import {
  draftToEntry,
  entryToDraft,
  EntryFields,
  validateDraft,
  type DraftErrors,
  type EntryDraft,
} from '@/features/timetableImport/EntryFields';
import { useI18n } from '@/i18n';
import { confirmDestructive } from '@/lib/confirm';
import { loadEditableTimetable, newEntryId, removeEntry, upsertEntry } from '@/services/timetableRepository';
import { useApp } from '@/state/AppContext';
import { space } from '@/theme/tokens';

export default function TimetableEntryScreen() {
  const { session } = useApp();
  const { t } = useI18n();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ id?: string; weekday?: string; period?: string }>();
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [isSample, setIsSample] = useState(false);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [saving, setSaving] = useState(false);
  const [original, setOriginal] = useState<TimetableEntry | null>(null);
  const [term, setTerm] = useState<TimetableEntry['term'] | null | undefined>(undefined);
  const official = useOfficial();
  const per = usePeriod(session, official.kind === 'ok' ? official.data : null);
  const editing = Boolean(params.id);
  // 새 수업은 지금 보고 있는 기간을 기본값으로 (기간을 모르면 미지정)
  const effectiveTerm = term === undefined ? (original ? original.term : per.period ? { year: per.period.year, quarters: [per.period.quarter] } : undefined) : (term ?? undefined);
  const termYear = effectiveTerm?.year ?? per.period?.year ?? null;

  useLayoutEffect(() => {
    navigation.setOptions({ title: editing ? t.timetable.entryEdit : t.timetable.entryAdd });
  }, [navigation, editing, t]);

  useEffect(() => {
    if (!session) return;
    loadEditableTimetable(session, t).then(({ entries, isSample: sample }) => {
      setIsSample(sample);
      const found = params.id ? entries.find((e) => e.id === params.id) : undefined;
      if (found) setOriginal(found);
      setDraft(
        found
          ? entryToDraft(found)
          : {
              key: newEntryId(),
              weekday: params.weekday ? Number(params.weekday) : 0,
              period: params.period ? Number(params.period) : null,
              courseName: '',
              room: '',
              memo: '',
              startTime: '',
              endTime: '',
            },
      );
    });
    // 화면이 열릴 때 한 번만 초기값을 만든다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (!session || !draft) return null;

  const save = async () => {
    const e = validateDraft(draft, t);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSaving(true);
    try {
      // 편집할 때 원래 항목의 강의 연결(lectureId)·재확인 표시 등은 보존하고 입력칸 값과 기간만 바꾼다
      await upsertEntry(session, t, { ...(original ?? {}), ...draftToEntry(draft, draft.key, 'manual'), term: effectiveTerm });
      if (router.canGoBack()) router.back();
      else router.replace('/calendar');
    } finally {
      setSaving(false);
    }
  };

  const remove = () =>
    confirmDestructive(
      t.timetable.deleteConfirmTitle,
      t.timetable.deleteConfirmBody(draft.courseName),
      { ok: t.timetable.delete, cancel: t.common.cancel },
      async () => {
        await removeEntry(session, t, draft.key);
        if (router.canGoBack()) router.back();
        else router.replace('/calendar');
      },
    );

  return (
    <Screen layout="reading" edges={['bottom']} footer={<Button testID="save-entry" label={t.timetable.save} onPress={save} loading={saving} />}>
      {isSample && <Notice tone="warning" text={t.timetable.sampleNote} />}
      <Block>
        <EntryFields draft={draft} errors={errors} onChange={setDraft} testIDPrefix="entry" />
        <T variant="caption" tone="tertiary">
          {t.timetable.timesNote}
        </T>
      </Block>
      <Gap />
      <Block>
        <T variant="sub" tone="secondary" style={{ fontWeight: '600', marginBottom: space.sm }}>
          {t.period.termField}
        </T>
        {termYear != null ? (
          <>
            <T variant="caption" tone="tertiary" style={{ marginBottom: space.xs }}>
              {t.period.termYear}
            </T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {[termYear - 1, termYear, termYear + 1].map((y) => (
                <Chip key={y} testID={`term-year-${y}`} label={String(y)} selected={effectiveTerm?.year === y} onPress={() => setTerm({ year: y, quarters: effectiveTerm?.quarters.length ? effectiveTerm.quarters : ['1Q'] })} />
              ))}
            </View>
            <T variant="caption" tone="tertiary" style={{ marginVertical: space.xs }}>
              {t.period.termQuarters}
            </T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {QUARTERS.map((q: Quarter) => {
                const on = !!effectiveTerm?.quarters.includes(q);
                return (
                  <Chip
                    key={q}
                    testID={`term-q-${q}`}
                    label={q}
                    selected={on}
                    onPress={() => {
                      const cur = effectiveTerm?.quarters ?? [];
                      const next = on ? cur.filter((x) => x !== q) : [...cur, q].sort();
                      setTerm(next.length ? { year: effectiveTerm?.year ?? termYear, quarters: next } : null);
                    }}
                  />
                );
              })}
              <Chip testID="term-none" label={t.period.termNone} selected={!effectiveTerm} onPress={() => setTerm(null)} />
            </View>
          </>
        ) : (
          <T variant="sub" tone="tertiary">
            {t.period.unset}
          </T>
        )}
      </Block>
      {editing && (
        <>
          <Gap size={space.huge} />
          <Button testID="delete-entry" label={t.timetable.delete} variant="dangerText" onPress={remove} />
        </>
      )}
    </Screen>
  );
}
