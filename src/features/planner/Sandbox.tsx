import { Pressable, StyleSheet, View } from 'react-native';
import { useCourseName } from '@/data/useCourseName';
import { useState } from 'react';

import { Block, BlockHeader, Button, Chip, EmptyText, Gap, Notice, Pill, Row, T } from '@/components/ui';
import type { TimetableEntry } from '@/data/types';
import { AltHighlights } from '@/features/planner/AltHighlights';
import { altHighlights } from '@/features/planner/builderLogic';
import { planMetrics, type Candidate } from '@/features/planner/plannerLogic';
import { useI18n } from '@/i18n';
import { colors, radius, space } from '@/theme/tokens';

type TimeRange = { start: string; end: string };
type Slot = { weekday: number; period: number };

const DAYS = [0, 1, 2, 3, 4, 5];
const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/**
 * 가상 시간표: 실제 시간표(회색)는 그대로 두고, 후보 과목을 칸에 넣었다 뺐다 하며 직접 짜 본다.
 * 저장하기 전에는 실제 시간표·이수 기록을 바꾸지 않는다.
 */
const normName = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');

/**
 * 가상 시간표에 과목 넣기. 실제 시간표처럼 한 칸에 한 과목만:
 * 같은 과목의 다른 분반이 이미 있으면 바꿔 넣고, 시간이 겹치는 과목이 있으면 그 과목을 빼고 넣는다.
 */
export function withPick(picked: string[], id: string, candidates: Candidate[]): { ids: string[]; replaced: Candidate[] } {
  const byId = new Map(candidates.map((c) => [c.course.id, c]));
  const add = byId.get(id);
  if (!add || picked.includes(id)) return { ids: picked, replaced: [] };
  const slots = new Set(add.course.meetings.map((m) => `${m.weekday}-${m.period}`));
  const replaced = picked
    .map((x) => byId.get(x))
    .filter((c): c is Candidate => !!c && (normName(c.course.name) === normName(add.course.name) || c.course.meetings.some((m) => slots.has(`${m.weekday}-${m.period}`))));
  const drop = new Set(replaced.map((c) => c.course.id));
  return { ids: [...picked.filter((x) => !drop.has(x)), id], replaced };
}

export function Sandbox({
  candidates,
  fixed,
  periodTimes,
  lunch,
  picked,
  onPicked,
  onApply,
  creditGoal,
  gradOf,
}: {
  candidates: Candidate[];
  fixed: TimetableEntry[];
  periodTimes: { period: number; start: string; end: string }[];
  lunch: TimeRange | null;
  picked: string[];
  onPicked: (ids: string[]) => void;
  onApply: (ids: string[]) => void;
  creditGoal?: number | null;
  /** 넣은 과목으로 채워지는 졸업요건 (수강 계획과 같은 계산) */
  gradOf?: (chosen: Candidate[]) => { before: number | null; after: number | null; filled: number };
}) {
  const { t } = useI18n();
  const cn = useCourseName();
  const s = t.planner.sandbox;
  const [slot, setSlot] = useState<Slot | null>(null);
  const byId = new Map(candidates.map((c) => [c.course.id, c]));
  const chosen = picked.map((id) => byId.get(id)).filter((c): c is Candidate => !!c);
  const periods = [1, 2, 3, 4, 5, ...(chosen.some((c) => c.course.meetings.some((m) => m.period >= 6)) || fixed.some((e) => e.period >= 6) ? [6] : [])];
  const days = DAYS.filter((d) => d <= 4 || chosen.some((c) => c.course.meetings.some((m) => m.weekday === d)) || fixed.some((e) => e.weekday === d));

  const lunchAt = (p: number) => {
    if (!lunch) return false;
    const tm = periodTimes.find((x) => x.period === p);
    return !!tm && toMin(tm.start) < toMin(lunch.end) && toMin(lunch.start) < toMin(tm.end);
  };
  const fixedAt = (d: number, p: number) => fixed.filter((e) => e.weekday === d && e.period === p);
  const chosenAt = (d: number, p: number) => chosen.filter((c) => c.course.meetings.some((m) => m.weekday === d && m.period === p));
  const hitsLunch = (c: Candidate) => c.course.meetings.some((m) => lunchAt(m.period));

  const [note, setNote] = useState<string | null>(null);
  const toggle = (id: string) => {
    if (picked.includes(id)) {
      setNote(null);
      return onPicked(picked.filter((x) => x !== id));
    }
    const r = withPick(picked, id, candidates);
    setNote(r.replaced.length ? s.replacedNote(r.replaced.map((c) => cn(c.course.name)).join(', ')) : null);
    onPicked(r.ids);
  };

  // 지표: 실제 시간표 + 가상으로 넣은 과목
  const cells = [...fixed.map((e) => ({ weekday: e.weekday, period: e.period })), ...chosen.flatMap((c) => c.course.meetings)];
  const m = planMetrics(cells, periodTimes, lunch);
  const credits = chosen.reduce((a, c) => a + (c.credits ?? 0), 0);
  const unknownCredits = chosen.filter((c) => c.credits == null).length;
  const grad = gradOf ? gradOf(chosen) : null;
  const clashes = new Set<string>();
  for (const d of days) for (const p of periods) if (fixedAt(d, p).length + chosenAt(d, p).length > 1) clashes.add(`${d}-${p}`);

  const slotList = slot
    ? candidates
        .filter((c) => c.course.meetings.some((mm) => mm.weekday === slot.weekday && mm.period === slot.period))
        .sort((a, b) => Number(hitsLunch(a)) - Number(hitsLunch(b)) || a.course.name.localeCompare(b.course.name))
    : [];

  return (
    <Block testID="sandbox">
      <BlockHeader title={s.title} />
      <T variant="caption" tone="tertiary" style={{ marginBottom: space.sm }}>
        {s.lead}
      </T>

      {lunch ? (
        <T variant="caption" tone="tertiary" style={{ marginBottom: space.sm }}>
          {s.lunchNote(lunch.start, lunch.end)}
        </T>
      ) : null}

      <View testID="sandbox-grid">
        <View style={styles.row}>
          <View style={styles.pcol} />
          {days.map((d) => (
            <T key={d} variant="caption" tone="tertiary" style={styles.dayHead}>
              {t.common.weekdays[d]}
            </T>
          ))}
        </View>
        {periods.map((p) => (
          <View key={p} style={styles.row}>
            <T variant="caption" tone="tertiary" style={styles.pcol}>
              {p}
            </T>
            {days.map((d) => {
              const f = fixedAt(d, p);
              const c = chosenAt(d, p);
              const clash = clashes.has(`${d}-${p}`);
              const selected = slot?.weekday === d && slot?.period === p;
              const name = cn(c[0]?.course.name ?? f[0]?.courseName ?? '');
              return (
                <Pressable
                  key={d}
                  testID={`sandbox-cell-${d}-${p}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${t.common.weekdays[d]} ${p} ${name}`}
                  onPress={() => setSlot(selected ? null : { weekday: d, period: p })}
                  style={[
                    styles.cell,
                    lunch && lunchAt(p) && !name ? styles.cellLunch : null,
                    f.length ? styles.cellFixed : null,
                    c.length ? styles.cellMine : null,
                    clash ? styles.cellClash : null,
                    selected ? styles.cellSelected : null,
                  ]}
                >
                  <T variant="caption" numberOfLines={3} style={[styles.cellText, c.length ? { color: colors.surface } : null]}>
                    {name || (lunch && lunchAt(p) ? s.lunchCell : '')}
                  </T>
                </Pressable>
              );
            })}
          </View>
        ))}
        <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>
          {s.legend}
        </T>
      </View>

      {slot ? (
        <View testID="sandbox-slot" style={{ marginTop: space.md }}>
          <T variant="sub" style={{ fontWeight: '700' }}>
            {s.slotTitle(t.common.weekdays[slot.weekday], slot.period)}
          </T>
          {fixedAt(slot.weekday, slot.period).map((e) => (
            <Row key={e.id} title={cn(e.courseName)} subtitle={s.fixedNote} />
          ))}
          {slotList.length === 0 ? <EmptyText text={s.slotEmpty} /> : null}
          {slotList.map((c) => {
            const on = picked.includes(c.course.id);
            return (
              <Row
                key={c.course.id}
                testID={`sandbox-pick-${c.course.id}`}
                title={`${cn(c.course.name)}${c.course.section ? ` [${c.course.section}]` : ''}`}
                subtitle={[
                  c.course.instructor,
                  c.credits != null ? `${c.credits}${t.official.creditsUnit}` : t.planner.reasons.creditsUnknown,
                  c.fillsCategory ? t.planner.reasons.fills : '',
                  hitsLunch(c) ? t.planner.reasons.lunchHit : '',
                  c.conflicts.length ? t.planner.reasons.conflict(c.conflicts.join(', ')) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={<Chip label={on ? s.remove : s.add} selected={on} onPress={() => toggle(c.course.id)} />}
              />
            );
          })}
        </View>
      ) : (
        <T variant="caption" tone="secondary" style={{ marginTop: space.sm }}>
          {s.tapHint}
        </T>
      )}

      <Gap size={space.md} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        <Pill text={creditGoal ? s.creditsGoal(credits, creditGoal) : s.credits(credits)} tone={creditGoal && credits >= creditGoal ? 'success' : 'accent'} />
        {unknownCredits ? <Pill text={s.creditsUnknown(unknownCredits)} tone="warning" /> : null}
        <Pill text={`${t.planner.m.days} ${m.days}`} />
        <Pill text={`${t.planner.m.gaps} ${t.planner.minutes(m.gapMinutes)}`} />
        {chosen.length ? <Pill text={t.builder.gapLine(m.gapPeriods, t.planner.minutes(m.gapMinutes), m.freeWeekdays)} /> : null}
        {lunch ? <Pill text={`${t.planner.m.lunchOk} ${m.lunchOkDays} / ${m.days}`} tone={m.lunchBadDays ? 'warning' : 'success'} /> : null}
        {clashes.size ? <Pill text={s.clashes(clashes.size)} tone="danger" /> : null}
      </View>
      {chosen.length ? (
        <View testID="sandbox-effect" style={{ marginTop: space.sm }}>
          {grad && grad.before != null ? <T variant="sub" tone="accent" testID="sandbox-grad">{t.builder.gradLine(grad.before, grad.after ?? grad.before, grad.filled)}</T> : null}
          <AltHighlights h={altHighlights([{ id: 'sandbox', m: { ...m, gradFilled: grad ? grad.filled : null } }]).sandbox} testID="sandbox-highlights" />
        </View>
      ) : null}
      {chosen.length ? (
        <View style={{ marginTop: space.sm }}>
          {chosen.map((c) => (
            <Row
              key={c.course.id}
              title={`${cn(c.course.name)}${c.course.section ? ` [${c.course.section}]` : ''}`}
              subtitle={c.course.meetings.map((mm) => t.lectures.meeting(t.common.weekdays[mm.weekday], mm.period)).join(', ')}
              right={<Chip label={s.remove} onPress={() => toggle(c.course.id)} />}
            />
          ))}
        </View>
      ) : null}
      {note ? <Notice text={note} /> : null}
      {clashes.size ? <Notice tone="warning" text={s.clashNote} /> : null}
      <Gap size={space.sm} />
      <Button testID="sandbox-apply" label={s.apply} icon="checkmark-circle-outline" onPress={() => onApply(picked)} disabled={chosen.length === 0 || clashes.size > 0} />
      <Gap size={space.xs} />
      <Button testID="sandbox-clear" label={s.clear} variant="text" size="md" onPress={() => onPicked([])} disabled={chosen.length === 0} />
    </Block>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch' },
  pcol: { width: 18, textAlign: 'center', alignSelf: 'center' },
  dayHead: { flex: 1, textAlign: 'center', marginBottom: 2 },
  cell: { flex: 1, minHeight: 52, margin: 2, borderRadius: radius.badge, backgroundColor: colors.fill, padding: 3, justifyContent: 'center' },
  cellText: { fontSize: 10, lineHeight: 13, textAlign: 'center' },
  cellFixed: { backgroundColor: colors.textDisabled },
  cellMine: { backgroundColor: colors.accent },
  cellLunch: { backgroundColor: colors.warningSoft },
  cellClash: { borderWidth: 2, borderColor: colors.dangerText },
  cellSelected: { borderWidth: 2, borderColor: colors.text },
});
