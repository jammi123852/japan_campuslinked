import { useCt } from '@/lib/contentTranslate';
import { useCourseName } from '@/data/useCourseName';
import { useTr } from '@/lib/translate';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Block, BlockHeader, Button, EmptyText, Gap, IconButton, Notice, Pill, Screen, Segmented, T, TextField } from '@/components/ui';
import { periodKey } from '@/features/academic/academicLogic';
import { PeriodBar, shiftQuarter, usePeriodLabel } from '@/features/academic/PeriodBar';
import {
  carryOver,
  CHECK_STATUSES,
  eventsInRange,
  isDuplicate,
  itemsForPeriod,
  liveLink,
  periodRange,
  recordsInPeriod,
  summarize,
  type ChecklistItem,
  type CheckStatus,
} from '@/features/checklist/checklistLogic';
import { deptKeyOf } from '@/features/official/SourceLine';
import { categoryLabel, ruleLabel } from '@/features/official/courseLogic';
import { useOfficial } from '@/features/official/useOfficial';
import { computeProgress, pickRule } from '@/features/records/gradLogic';
import { isClosed } from '@/features/scholarship/scholarshipLogic';
import { useI18n } from '@/i18n';
import { confirmDestructive } from '@/lib/confirm';
import { academicNow } from '@/lib/dates';
import { addChecklistItem, newChecklistId, saveChecklist, useChecklist } from '@/services/checklistRepository';
import { usePeriod } from '@/services/periodRepository';
import { upsertRecord, useRecords } from '@/services/recordsRepository';
import { useEvents } from '@/services/scheduleRepository';
import { useApp } from '@/state/AppContext';
import { colors, space } from '@/theme/tokens';

/** 기간별 체크리스트. 일정·기록·장학금은 id 로 연결해 현재 값을 보여 준다. 주소: /checklist */
export default function ChecklistScreen() {
  const { session, profile } = useApp();
  const { t, locale } = useI18n();
  const tr = useTr();
  const ct = useCt();
  const cn = useCourseName();
  const official = useOfficial();
  const od = official.kind === 'ok' ? official.data : null;
  const per = usePeriod(session, od);
  const label = usePeriodLabel();
  const { items } = useChecklist(session);
  const { records } = useRecords(session);
  const { events } = useEvents(session);
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  if (official.kind === 'loading' || !session) return <ActivityIndicator color={colors.accent} style={{ marginTop: space.huge }} />;

  const period = per.period;
  const key = period ? periodKey(period) : null;
  const mine = key ? itemsForPeriod(items, key) : [];
  const sum = summarize(mine);
  const now = academicNow();
  const range = period ? periodRange(od?.calendar, period) : null;
  const periodEvents = eventsInRange(events ?? [], range);
  const periodRecords = period ? recordsInPeriod(records, period) : [];
  const enrolled = periodRecords.filter((r) => r.status === 'enrolled');

  const dk = deptKeyOf(profile?.facultyId, profile?.departmentId);
  const picked = pickRule(od && dk ? od.departments[dk]?.rules : undefined, profile?.admissionYear, profile?.courseName);
  const progress = computeProgress(records, picked, 'current');
  const gradShort: Record<string, number> | null = progress.noRule
    ? null
    : { ...Object.fromEntries(progress.categories.map((c) => [c.id, c.short])), ...(progress.flex ? { flex: progress.flex.short } : {}) };
  const shortItems = [
    ...progress.categories.filter((c) => c.short > 0).map((c) => ({ ref: c.id as string, name: categoryLabel(c.id, picked?.rule, t.records.categories, locale), short: c.short })),
    ...progress.pools.filter((p) => p.short > 0).map((p) => ({ ref: p.id, name: ruleLabel(p.label, locale), short: p.short })),
    ...(progress.flex && progress.flex.short > 0 ? [{ ref: 'flex', name: t.grad.flex.split(' (')[0], short: progress.flex.short }] : []),
  ];

  const ctx = { events: events ?? [], records, scholarships: od?.scholarships ?? [], gradShort };
  const inList = (kind: ChecklistItem['kind'], ref: string) => !!key && isDuplicate(items, { periodKey: key, kind, ref, title: '' });

  const add = async (kind: ChecklistItem['kind'], ref: string | null, title: string) => {
    if (!key) return;
    const r = await addChecklistItem(session, { periodKey: key, kind, ref, title });
    setMsg(r === 'added' ? t.checklist.added : t.checklist.exists);
  };
  const addManual = async () => {
    const title = draft.trim();
    if (!title) return;
    await add('manual', null, title);
    setDraft('');
  };
  const setStatus = (id: string, status: CheckStatus) =>
    saveChecklist(session, items.map((i) => (i.id === id ? { ...i, status, updatedAt: new Date().toISOString() } : i)));
  const remove = (id: string) =>
    confirmDestructive(t.checklist.delete, t.checklist.deleteConfirm, { ok: t.common.ok, cancel: t.common.cancel }, () => {
      saveChecklist(session, items.filter((i) => i.id !== id));
    });
  const carry = () => {
    if (!period) return;
    confirmDestructive(t.checklist.carry(label(shiftQuarter(period, 1))), t.checklist.carryConfirm, { ok: t.common.ok, cancel: t.common.cancel }, async () => {
      const r = carryOver(items, period, shiftQuarter(period, 1), newChecklistId, new Date().toISOString());
      if (r.moved === 0 && r.items.every((x, i) => x === items[i])) {
        setMsg(t.checklist.carryNone);
        return;
      }
      await saveChecklist(session, r.items);
      setMsg(t.checklist.carryDone(r.moved));
    });
  };
  const keyLabel = (k: string) => {
    const [y, q] = k.split('-');
    return `${y} ${q}`;
  };

  /** 항목의 표시 제목과 현재 값 한 줄 */
  const view = (item: ChecklistItem) => {
    const link = liveLink(item, ctx);
    switch (link.kind) {
      case 'event':
        return { title: link.event.title, detail: [link.event.date, link.event.time, link.event.done ? t.checklist.statuses.done : ''].filter(Boolean).join(' '), missing: false };
      case 'record':
        return { title: link.record.name, detail: t.records.statuses[link.record.status], missing: false };
      case 'scholarship':
        return { title: link.scholarship.title, detail: `${isClosed(link.scholarship, now.date, now.minutes) ? t.scholarship.closed : t.scholarship.open_} · ${link.scholarship.deadlineText}`, missing: false };
      case 'grad':
        return { title: item.title, detail: link.short == null ? t.checklist.gradUnknown : link.short > 0 ? t.checklist.gradShort(link.short) : t.checklist.gradOk, missing: false };
      case 'missing':
        return { title: item.title, detail: t.checklist.missing, missing: true };
      default:
        return { title: item.title, detail: '', missing: false };
    }
  };

  return (
    <Screen layout="reading" edges={['bottom']}>
      <Notice text={t.checklist.lead} />
      <PeriodBar session={session} period={period} today={per.today} source={per.source} />
      {official.kind !== 'ok' ? <Notice tone="warning" text={official.kind === 'missing' ? t.official.missing : t.official.loadError} /> : null}

      <Block testID="checklist-items">
        <BlockHeader title={t.checklist.items} />
        {period ? (
          <T variant="caption" tone="tertiary" testID="checklist-summary" style={{ marginBottom: space.sm }}>
            {t.checklist.summary(sum.todo, sum.doing, sum.done, sum.na)}
          </T>
        ) : null}
        {mine.length === 0 ? <EmptyText text={t.checklist.empty} /> : null}
        {mine.map((item) => {
          const v = view(item);
          return (
            <View key={item.id} style={styles.item} testID={`check-${item.id}`}>
              <View style={styles.itemHead}>
                <View style={{ flex: 1 }}>
                  <T variant="body" style={{ fontWeight: '600' }}>
                    {ct(tr(v.title))}
                  </T>
                  {v.detail ? (
                    <T variant="caption" tone={v.missing ? 'danger' : 'secondary'}>
                      {tr(v.detail)}
                    </T>
                  ) : null}
                </View>
                <IconButton icon="trash-outline" label={t.checklist.delete} onPress={() => remove(item.id)} />
              </View>
              <View style={styles.pills}>
                <Pill text={t.checklist.kinds[item.kind]} />
                {item.carriedFrom ? <Pill text={t.checklist.carriedFrom(keyLabel(item.carriedFrom))} tone="accent" /> : null}
                {item.carriedTo ? <Pill text={t.checklist.carriedTo(keyLabel(item.carriedTo))} tone="warning" /> : null}
              </View>
              <Segmented
                label={t.checklist.statusLabel}
                testIDPrefix={`check-status-${item.id}`}
                value={item.status}
                onChange={(s: CheckStatus) => setStatus(item.id, s)}
                options={CHECK_STATUSES.map((s) => ({ value: s, label: t.checklist.statuses[s] }))}
              />
            </View>
          );
        })}
        <Gap size={space.sm} />
        <TextField testID="checklist-draft" label={t.checklist.addLabel} value={draft} onChangeText={setDraft} placeholder={t.checklist.addPh} maxLength={80} />
        <Button testID="checklist-add" label={t.checklist.add} variant="secondary" size="md" icon="add" onPress={addManual} disabled={!period || !draft.trim()} />
        {msg ? (
          <>
            <Gap size={space.sm} />
            <Notice text={msg} />
          </>
        ) : null}
        {period ? (
          <>
            <Gap size={space.sm} />
            <Button testID="checklist-carry" label={t.checklist.carry(keyLabel(periodKey(shiftQuarter(period, 1))))} variant="tertiary" size="md" icon="arrow-forward-outline" onPress={carry} />
          </>
        ) : null}
        <T variant="caption" tone="tertiary" style={{ marginTop: space.sm }}>
          {t.checklist.device}
        </T>
      </Block>
      <Gap />

      <Block testID="checklist-events">
        <BlockHeader title={t.checklist.eventsTitle} />
        {!range ? <EmptyText text={t.checklist.noRange} /> : periodEvents.length === 0 ? <EmptyText text={t.checklist.eventsNone} /> : null}
        {periodEvents.map((e) => (
          <View key={e.id} style={styles.line}>
            <View style={{ flex: 1 }}>
              <T variant="sub">{tr(e.title)}</T>
              <T variant="caption" tone="tertiary">
                {[e.date, e.time].filter(Boolean).join(' ')}
              </T>
            </View>
            {inList('event', e.id) ? <Pill text={t.checklist.inList} tone="success" /> : <Button testID={`check-add-event-${e.id}`} label={t.checklist.addToList} variant="tertiary" size="md" onPress={() => add('event', e.id, e.title)} />}
          </View>
        ))}
      </Block>
      <Gap />

      <Block testID="checklist-records">
        <BlockHeader title={t.checklist.recordsTitle} />
        <T variant="caption" tone="tertiary" style={{ marginBottom: space.sm }}>
          {t.checklist.recordsNote}
        </T>
        {enrolled.length === 0 ? <EmptyText text={t.checklist.recordsNone} /> : null}
        {enrolled.map((r) => (
          <View key={r.id} style={styles.line}>
            <View style={{ flex: 1 }}>
              <T variant="sub">{cn(r.name)}</T>
              <T variant="caption" tone="tertiary">
                {t.records.statuses[r.status]}
              </T>
            </View>
            <Button
              testID={`check-confirm-${r.id}`}
              label={t.records.confirmPassed}
              variant="secondary"
              size="md"
              onPress={() =>
                confirmDestructive(t.checklist.confirmTitle, t.checklist.confirmBody(r.name), { ok: t.common.ok, cancel: t.common.cancel }, () => {
                  const iso = new Date().toISOString();
                  upsertRecord(session, { ...r, status: 'passed', confirmedAt: iso, updatedAt: iso });
                })
              }
            />
          </View>
        ))}
      </Block>
      <Gap />

      <Block testID="checklist-grad">
        <BlockHeader title={t.checklist.gradTitle} />
        {progress.noRule ? <EmptyText text={t.checklist.gradNone} /> : null}
        {progress.partialRule ? <Notice tone="warning" text={t.checklist.gradPartial} /> : null}
        {!progress.noRule && shortItems.length === 0 ? <EmptyText text={t.checklist.gradAllOk} /> : null}
        {shortItems.map((s) => (
          <View key={s.ref} style={styles.line}>
            <View style={{ flex: 1 }}>
              <T variant="sub">{tr(s.name)}</T>
              <T variant="caption" tone="danger">
                {t.checklist.gradShort(s.short)}
              </T>
            </View>
            {inList('grad', s.ref) ? <Pill text={t.checklist.inList} tone="success" /> : <Button testID={`check-add-grad-${s.ref}`} label={t.checklist.addToList} variant="tertiary" size="md" onPress={() => add('grad', s.ref, s.name)} />}
          </View>
        ))}
      </Block>
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { paddingVertical: space.md, borderTopWidth: 1, borderTopColor: colors.divider },
  itemHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginVertical: space.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colors.divider },
});
