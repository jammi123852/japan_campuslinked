import { View } from 'react-native';

import { Segmented, T, TextField } from '@/components/ui';
import type { TimetableEntry } from '@/data/types';
import { useI18n } from '@/i18n';
import type { Strings } from '@/i18n/ko';
import { isValidTime } from '@/services/timetableRepository';
import { space } from '@/theme/tokens';

/** 수업 한 개의 입력값 (사진 인식 결과 확인 화면과 직접 추가 화면이 같이 쓴다) */
export interface EntryDraft {
  key: string;
  weekday: number;
  period: number | null;
  courseName: string;
  room: string;
  memo: string;
  startTime: string;
  endTime: string;
}

export type DraftErrors = Partial<Record<'courseName' | 'period' | 'startTime' | 'endTime', string>>;

const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];
const DAYS = [0, 1, 2, 3, 4, 5, 6];

export function validateDraft(d: EntryDraft, t: Strings): DraftErrors {
  const e: DraftErrors = {};
  if (!d.courseName.trim()) e.courseName = t.timetable.errCourseName;
  if (d.period == null) e.period = t.timetable.errPeriod;
  if (d.startTime.trim() && !isValidTime(d.startTime.trim())) e.startTime = t.timetable.errTime;
  if (d.endTime.trim() && !isValidTime(d.endTime.trim())) e.endTime = t.timetable.errTime;
  return e;
}

export function draftToEntry(d: EntryDraft, id: string, note: string): TimetableEntry {
  const opt = (s: string) => (s.trim() ? s.trim() : undefined);
  return {
    id,
    courseName: d.courseName.trim(),
    weekday: d.weekday,
    period: d.period ?? 1,
    room: opt(d.room),
    memo: opt(d.memo),
    startTime: opt(d.startTime),
    endTime: opt(d.endTime),
    source: { kind: 'user_input', note },
  };
}

export function entryToDraft(e: TimetableEntry): EntryDraft {
  return {
    key: e.id,
    weekday: e.weekday,
    period: e.period,
    courseName: e.courseName,
    room: e.room ?? '',
    memo: e.memo ?? '',
    startTime: e.startTime ?? '',
    endTime: e.endTime ?? '',
  };
}

export function EntryFields({
  draft,
  errors,
  onChange,
  testIDPrefix,
}: {
  draft: EntryDraft;
  errors: DraftErrors;
  onChange: (d: EntryDraft) => void;
  testIDPrefix: string;
}) {
  const { t } = useI18n();
  const set = (patch: Partial<EntryDraft>) => onChange({ ...draft, ...patch });

  return (
    <View>
      <TextField
        testID={`${testIDPrefix}-name`}
        label={t.timetable.courseName}
        value={draft.courseName}
        onChangeText={(v) => set({ courseName: v })}
        error={errors.courseName}
      />
      <T variant="sub" tone="secondary" style={{ fontWeight: '600', marginBottom: space.sm }}>
        {t.timetable.weekday}
      </T>
      <Segmented<number>
        label={t.timetable.weekday}
        testIDPrefix={`${testIDPrefix}-day`}
        value={draft.weekday}
        onChange={(v) => set({ weekday: v })}
        options={DAYS.map((d) => ({ value: d, label: t.common.weekdays[d] }))}
      />
      <T variant="sub" tone="secondary" style={{ fontWeight: '600', marginTop: space.lg, marginBottom: space.sm }}>
        {t.timetable.period}
      </T>
      <Segmented<number>
        label={t.timetable.period}
        testIDPrefix={`${testIDPrefix}-period`}
        value={draft.period}
        onChange={(v) => set({ period: v })}
        options={PERIODS.map((p) => ({ value: p, label: String(p) }))}
      />
      {errors.period ? (
        <T variant="sub" tone="danger" style={{ marginTop: space.sm }} live>
          {errors.period}
        </T>
      ) : null}
      <View style={{ height: space.xl }} />
      <TextField testID={`${testIDPrefix}-room`} label={t.timetable.room} value={draft.room} onChangeText={(v) => set({ room: v })} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <TextField
            label={t.timetable.startTime}
            value={draft.startTime}
            onChangeText={(v) => set({ startTime: v })}
            placeholder="09:00"
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            error={errors.startTime}
          />
        </View>
        <View style={{ flex: 1 }}>
          <TextField
            label={t.timetable.endTime}
            value={draft.endTime}
            onChangeText={(v) => set({ endTime: v })}
            placeholder="10:30"
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            error={errors.endTime}
          />
        </View>
      </View>
      <TextField label={t.timetable.memo} value={draft.memo} onChangeText={(v) => set({ memo: v })} />
    </View>
  );
}
