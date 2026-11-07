import { Pressable, StyleSheet, View } from 'react-native';

import { T } from '@/components/ui';
import { useCourseName } from '@/data/useCourseName';
import { useI18n } from '@/i18n';
import { colors, radius, space } from '@/theme/tokens';

export interface GridCell {
  weekday: number;
  period: number;
  name: string;
  /** 이 계획에서 더하는 수업이면 과목 id */
  addedId?: string;
}

/** 직접 시간표 짜기의 큰 주간 시간표 (실제 시간표를 바꾸지 않는 미리보기). 이미 있는 수업=회색, 계획 수업=파랑 */
export function PlanWeekGrid({ cells, onPressAdded, testID }: { cells: GridCell[]; onPressAdded?: (id: string) => void; testID?: string }) {
  const { t } = useI18n();
  const cn = useCourseName();
  const lastDay = Math.max(4, ...cells.map((c) => c.weekday));
  const lastPeriod = Math.max(5, ...cells.map((c) => c.period));
  const days = Array.from({ length: lastDay + 1 }, (_, i) => i);
  const periods = Array.from({ length: lastPeriod }, (_, i) => i + 1);
  return (
    <View testID={testID}>
      <View style={styles.row}>
        <View style={styles.periodCol} />
        {days.map((d) => (
          <T key={d} variant="caption" tone="secondary" style={styles.day}>{t.common.weekdays[d]}</T>
        ))}
      </View>
      {periods.map((p) => (
        <View key={p} style={styles.row}>
          <T variant="caption" tone="tertiary" style={styles.periodCol}>{p}</T>
          {days.map((d) => {
            const c = cells.find((x) => x.weekday === d && x.period === p);
            if (!c) return <View key={d} style={[styles.cell, styles.empty]} />;
            const body = (
              <T variant="caption" numberOfLines={3} style={{ color: c.addedId ? colors.accentSoftText : colors.textSecondary, fontWeight: c.addedId ? '700' : '400' }}>{cn(c.name)}</T>
            );
            return c.addedId && onPressAdded ? (
              <Pressable key={d} testID={`plan-cell-${d}-${p}`} accessibilityRole="button" accessibilityLabel={`${t.common.weekdays[d]} ${t.common.period(p)} ${cn(c.name)}`} onPress={() => onPressAdded(c.addedId!)} style={[styles.cell, styles.added]}>
                {body}
              </Pressable>
            ) : (
              <View key={d} testID={`plan-cell-${d}-${p}`} style={[styles.cell, c.addedId ? styles.added : styles.fixed]}>{body}</View>
            );
          })}
        </View>
      ))}
      <View style={styles.legend}>
        <View style={[styles.swatch, styles.added]} />
        <T variant="caption" tone="secondary">{t.builder.legendAdded}</T>
        <View style={[styles.swatch, styles.fixed]} />
        <T variant="caption" tone="secondary">{t.builder.legendFixed}</T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 3, marginBottom: 3 },
  periodCol: { width: 16, textAlign: 'center', paddingTop: space.sm },
  day: { flex: 1, textAlign: 'center', paddingVertical: space.xs },
  cell: { flex: 1, minHeight: 64, borderRadius: radius.badge, padding: 4, minWidth: 0 },
  empty: { backgroundColor: colors.fill },
  added: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent },
  fixed: { backgroundColor: colors.divider },
  legend: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.sm },
  swatch: { width: 14, height: 14, borderRadius: 3 },
});
