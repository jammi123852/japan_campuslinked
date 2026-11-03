import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useLayoutEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Chip, Notice, Screen, Segmented, T, TextField } from '@/components/ui';
import { timetableCourses, type CourseRef } from '@/features/attendance/courses';
import { EVENT_KINDS, EVENT_LIMITS, isDeadlineKind, validateEvent, type EventErrors, type EventKind, type PersonalEvent } from '@/features/schedule/scheduleLogic';
import { useI18n } from '@/i18n';
import { confirmDestructive } from '@/lib/confirm';
import { academicNow } from '@/lib/dates';
import { deleteEvent, loadEvents, newEventId, upsertEvent } from '@/services/scheduleRepository';
import { loadEditableTimetable } from '@/services/timetableRepository';
import { useApp } from '@/state/AppContext';
import { colors, gutter, space } from '@/theme/tokens';

interface Draft {
  title: string;
  kind: EventKind;
  date: string;
  time: string;
  course: { key: string; name: string } | null;
  memo: string;
  notify: boolean;
  done: boolean;
}

/** 일정 추가·수정. 주소: /event-edit?date=2026-11-05 (추가) / ?id=ev-... (수정) */
export default function EventEditScreen() {
  const { session } = useApp();
  const { t } = useI18n();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ id?: string; date?: string }>();
  const [original, setOriginal] = useState<PersonalEvent | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [courses, setCourses] = useState<CourseRef[]>([]);
  const [errors, setErrors] = useState<EventErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const editing = Boolean(params.id);

  useLayoutEffect(() => {
    navigation.setOptions({ title: editing ? t.schedule.editTitle : t.schedule.newTitle });
  }, [navigation, editing, t]);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    Promise.all([loadEvents(session), loadEditableTimetable(session, t)]).then(([events, tt]) => {
      if (!alive) return;
      setCourses(timetableCourses(tt.entries));
      if (params.id) {
        const found = (events ?? []).find((e) => e.id === params.id);
        if (!found) return setNotFound(true);
        setOriginal(found);
        setDraft({ title: found.title, kind: found.kind, date: found.date, time: found.time ?? '', course: found.course, memo: found.memo, notify: found.notify, done: found.done });
      } else {
        setDraft({ title: '', kind: 'assignment', date: params.date ?? academicNow().date, time: '', course: null, memo: '', notify: true, done: false });
      }
    });
    return () => {
      alive = false;
    };
    // 화면을 열 때 한 번만 읽는다 (편집 중인 입력을 덮어쓰지 않음)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, params.id]);

  if (notFound) {
    return (
      <Screen layout="reading" edges={['bottom']}>
        <Notice tone="danger" text={t.schedule.notFound} />
      </Screen>
    );
  }
  if (!draft || !session) return <Screen layout="reading" edges={['bottom']}>{null}</Screen>;

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const errText = (field: keyof EventErrors) => {
    const e = errors[field];
    if (!e) return null;
    if (field === 'title') return e === 'tooLong' ? t.schedule.errTitleLong : t.schedule.errTitle;
    if (field === 'date') return e === 'required' ? t.schedule.errDate : t.schedule.errDateInvalid;
    if (field === 'time') return t.schedule.errTime;
    return t.schedule.errMemoLong;
  };

  const save = async () => {
    if (saving) return;
    const e = validateEvent(draft);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSaving(true);
    setMessage(null);
    const nowIso = new Date().toISOString();
    const deadline = isDeadlineKind(draft.kind);
    const ev: PersonalEvent = {
      id: original?.id ?? newEventId(),
      title: draft.title.trim(),
      kind: draft.kind,
      date: draft.date.trim(),
      time: draft.time.trim() || null,
      course: draft.course,
      memo: draft.memo.trim(),
      notify: deadline && draft.notify,
      done: deadline && draft.done,
      createdAt: original?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };
    try {
      await upsertEvent(session, ev);
      router.back();
    } catch {
      setMessage(t.schedule.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const remove = () =>
    confirmDestructive(t.schedule.deleteConfirmTitle, t.schedule.deleteConfirmBody(original?.title ?? ''), { ok: t.common.ok, cancel: t.common.cancel }, async () => {
      if (!original) return;
      await deleteEvent(session, original.id);
      router.back();
    });

  const courseInList = draft.course && courses.some((c) => c.key === draft.course!.key);
  const deadline = isDeadlineKind(draft.kind);

  return (
    <Screen layout="reading"
      edges={['bottom']}
      background={colors.surface}
      footer={
        <>
          {message && <Notice tone="danger" text={message} />}
          <Button testID="save-event" label={t.schedule.save} onPress={save} loading={saving} />
          {editing ? <Button testID="delete-event" label={t.schedule.delete} variant="dangerText" size="md" onPress={remove} /> : null}
        </>
      }
    >
      <TextField testID="ev-title" label={t.schedule.titleLabel} value={draft.title} onChangeText={(title) => set({ title })} maxLength={EVENT_LIMITS.title} error={errText('title')} />
      <T variant="sub" tone="secondary" style={styles.label}>
        {t.schedule.kind}
      </T>
      <Segmented<EventKind>
        label={t.schedule.kind}
        testIDPrefix="ev-kind"
        value={draft.kind}
        onChange={(kind) => set({ kind })}
        options={EVENT_KINDS.map((k) => ({ value: k, label: t.schedule.kinds[k] }))}
      />
      <View style={{ height: space.xl }} />
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <View style={{ flex: 3 }}>
          <TextField
            testID="ev-date"
            label={t.schedule.date}
            value={draft.date}
            onChangeText={(date) => set({ date })}
            placeholder="2026-11-05"
            maxLength={10}
            autoCorrect={false}
            error={errText('date')}
          />
        </View>
        <View style={{ flex: 2 }}>
          <TextField
            testID="ev-time"
            label={t.schedule.time}
            value={draft.time}
            onChangeText={(time) => set({ time })}
            placeholder="18:00"
            maxLength={5}
            autoCorrect={false}
            error={errText('time')}
          />
        </View>
      </View>
      <T variant="sub" tone="secondary" style={[styles.label, { marginTop: 0 }]}>
        {t.schedule.course}
      </T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hScroll} contentContainerStyle={styles.hScrollContent}>
        <Chip testID="ev-course-none" label={t.schedule.noCourse} selected={draft.course == null} onPress={() => set({ course: null })} />
        {draft.course && !courseInList ? <Chip label={t.schedule.courseRemoved(draft.course.name)} selected /> : null}
        {courses.map((c) => (
          <Chip key={c.key} testID={`ev-course-${c.key}`} label={c.name} selected={draft.course?.key === c.key} onPress={() => set({ course: { key: c.key, name: c.name } })} />
        ))}
      </ScrollView>
      <TextField
        testID="ev-memo"
        label={t.schedule.memo}
        value={draft.memo}
        onChangeText={(memo) => set({ memo })}
        multiline
        maxLength={EVENT_LIMITS.memo}
        textAlignVertical="top"
        style={{ height: 96, paddingTop: space.md }}
        error={errText('memo')}
      />
      {deadline ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Chip
              testID="ev-notify"
              icon={draft.notify ? 'notifications' : 'notifications-off-outline'}
              label={t.schedule.notify}
              selected={draft.notify}
              onPress={() => set({ notify: !draft.notify })}
            />
            {editing ? <Chip testID="ev-done" icon={draft.done ? 'checkmark-circle' : 'ellipse-outline'} label={t.schedule.doneLabel} selected={draft.done} onPress={() => set({ done: !draft.done })} /> : null}
          </View>
          <T variant="caption" tone="tertiary">
            {t.schedule.notifyHint}
          </T>
        </>
      ) : null}
      <T variant="caption" tone="tertiary" style={{ marginTop: space.md }}>
        {t.schedule.tzNote} {t.schedule.deviceNote}
      </T>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontWeight: '600', marginBottom: space.sm },
  hScroll: { marginHorizontal: -gutter, marginBottom: space.lg },
  hScrollContent: { paddingHorizontal: gutter },
});
