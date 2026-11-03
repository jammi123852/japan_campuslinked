import { Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native';

import { useI18n } from '@/i18n';
import { monthGrid, parseDateKey } from '@/lib/dates';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme/tokens';

/**
 * 월간 달력 (월요일 시작). 날짜를 누르면 onSelect. 일정이 있는 날은 점으로 표시하고,
 * 점만으로 알리지 않도록 접근성 이름에 일정 개수를 넣는다.
 */
export function MonthCalendar({
  year,
  month,
  selected,
  today,
  counts,
  onSelect,
}: {
  year: number;
  month: number;
  selected: string;
  today: string;
  /** 날짜별 일정 개수 */
  counts: Record<string, number>;
  onSelect: (key: string) => void;
}) {
  const { t } = useI18n();
  const weeks = monthGrid(year, month);
  return (
    <View accessibilityRole="grid">
      <View style={styles.row}>
        {t.common.weekdays.map((w, i) => (
          <Text key={w} style={[type.caption as TextStyle, styles.head, i >= 5 && { color: colors.textTertiary }]}>
            {w}
          </Text>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0].key} style={styles.row}>
          {week.map((c) => {
            const isSel = c.key === selected;
            const isToday = c.key === today;
            const n = counts[c.key] ?? 0;
            const p = parseDateKey(c.key);
            return (
              <Pressable
                key={c.key}
                testID={`day-${c.key}`}
                accessibilityRole="button"
                accessibilityLabel={t.schedule.dayLabel(p.month, p.day, n)}
                accessibilityState={{ selected: isSel }}
                onPress={() => onSelect(c.key)}
                style={({ pressed }) => [styles.cell, pressed && { backgroundColor: colors.surfacePressed }]}
              >
                <View style={[styles.dayCircle, isToday && styles.today, isSel && styles.selected]}>
                  <Text
                    style={[
                      type.sub as TextStyle,
                      { fontVariant: ['tabular-nums'], color: isSel ? colors.onAccent : c.inMonth ? colors.text : colors.textDisabled },
                      (isSel || isToday) && { fontWeight: '700' },
                    ]}
                  >
                    {c.day}
                  </Text>
                </View>
                <View style={[styles.dot, { backgroundColor: n > 0 ? (c.inMonth ? colors.accent : colors.textDisabled) : 'transparent' }]} />
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  head: { flex: 1, textAlign: 'center', color: colors.textSecondary, paddingVertical: space.xs },
  cell: { flex: 1, minHeight: MIN_TOUCH + 4, alignItems: 'center', justifyContent: 'center', borderRadius: radius.control },
  dayCircle: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 1.5, borderColor: colors.accent },
  selected: { backgroundColor: colors.accent, borderColor: colors.accent },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 2 },
});
