import { useCourseName } from '@/data/useCourseName';
import { Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';

import type { TimetableEntry } from '@/data/types';
import { useI18n } from '@/i18n';
import { colors, radius, space, type } from '@/theme/tokens';

const MIN_PERIODS = 5;

/**
 * 주간 시간표 격자. 열=요일(월~금, 토·일은 수업이 있을 때만), 행=교시.
 * 칸을 누르면 수정(수업 있음) 또는 추가(빈 칸)로 이동한다.
 */
export function TimetableGrid({
  entries,
  onPressEntry,
  onPressEmpty,
}: {
  entries: TimetableEntry[];
  onPressEntry: (e: TimetableEntry) => void;
  onPressEmpty: (weekday: number, period: number) => void;
}) {
  const { t } = useI18n();
  const cn = useCourseName();
  const lastDay = Math.max(4, ...entries.map((e) => e.weekday));
  const days = Array.from({ length: lastDay + 1 }, (_, i) => i);
  const maxPeriod = Math.max(MIN_PERIODS, ...entries.map((e) => e.period));
  const periods = Array.from({ length: maxPeriod }, (_, i) => i + 1);
  const at = (d: number, p: number) => entries.filter((e) => e.weekday === d && e.period === p);

  return (
    <View>
      <View style={styles.row}>
        <View style={styles.periodCol} />
        {days.map((d) => (
          <Text key={d} style={[type.caption as TextStyle, styles.dayLabel]}>
            {t.common.weekdays[d]}
          </Text>
        ))}
      </View>
      {periods.map((p) => (
        <View key={p} style={styles.row}>
          <Text style={[type.caption as TextStyle, styles.periodLabel]}>{p}</Text>
          {days.map((d) => {
            const list = at(d, p);
            const e = list[0];
            if (!e) {
              return (
                <Pressable
                  key={d}
                  testID={`cell-${d}-${p}`}
                  accessibilityRole="button"
                  accessibilityLabel={t.timetable.emptyCellLabel(t.common.weekdays[d], p)}
                  onPress={() => onPressEmpty(d, p)}
                  style={({ pressed }) => [styles.cell, styles.cellEmpty, pressed && { backgroundColor: colors.divider }]}
                />
              );
            }
            return (
              <Pressable
                key={d}
                testID={`cell-${d}-${p}`}
                accessibilityRole="button"
                accessibilityLabel={t.timetable.cellLabel(t.common.weekdays[d], p, e.courseName)}
                onPress={() => onPressEntry(e)}
                style={({ pressed }) => [styles.cell, styles.cellFilled, pressed && { backgroundColor: colors.accentSoftPressed }]}
              >
                <Text numberOfLines={3} style={styles.cellName}>
                  {cn(e.courseName)}
                </Text>
                {e.room ? (
                  <Text numberOfLines={1} style={styles.cellRoom}>
                    {e.room}
                  </Text>
                ) : null}
                {list.length > 1 ? <Text style={styles.cellMore}>+{list.length - 1}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 3, marginBottom: 3 },
  periodCol: { width: 16 },
  dayLabel: { flex: 1, textAlign: 'center', color: colors.textSecondary, paddingVertical: space.xs },
  periodLabel: { width: 16, color: colors.textTertiary, paddingTop: space.sm, textAlign: 'center' },
  cell: { flex: 1, minHeight: 72, borderRadius: radius.badge + 2, paddingHorizontal: 3, paddingVertical: space.xs, overflow: 'hidden' },
  cellEmpty: { backgroundColor: colors.fill },
  cellFilled: { backgroundColor: colors.accentSoft },
  cellName: { fontSize: 12, lineHeight: 15, fontWeight: '600', color: colors.text },
  cellRoom: { fontSize: 10, lineHeight: 13, color: colors.textSecondary, marginTop: 2 },
  cellMore: { fontSize: 10, lineHeight: 13, color: colors.accent, fontWeight: '700', marginTop: 2 },
});
