import { StyleSheet, View } from 'react-native';

import { useCourseName } from '@/data/useCourseName';
import { Pill, T } from '@/components/ui';
import type { TimetableEntry } from '@/data/types';
import { useI18n } from '@/i18n';
import { colors, radius, space } from '@/theme/tokens';

/**
 * 홈용 간단한 주간 시간표: 긴 격자 대신 요일별 한 줄. 같은 시간표 데이터를 그대로 쓴다(복제 안 함).
 */
export function WeekList({ entries, today }: { entries: TimetableEntry[]; today: number }) {
  const { t } = useI18n();
  const cn = useCourseName();
  const days = [0, 1, 2, 3, 4, ...(entries.some((e) => e.weekday === 5) ? [5] : []), ...(entries.some((e) => e.weekday === 6) ? [6] : [])];
  return (
    <View testID="home-week">
      {days.map((d) => {
        const list = entries.filter((e) => e.weekday === d).sort((a, b) => a.period - b.period);
        return (
          <View key={d} style={[styles.row, d === today && styles.today]} testID={`week-day-${d}`}>
            <T variant="sub" tone={d === today ? 'accent' : 'secondary'} style={styles.day}>
              {t.common.weekdays[d]}
            </T>
            <View style={{ flex: 1, gap: 2 }}>
              {list.length === 0 ? (
                <T variant="sub" tone="tertiary">
                  —
                </T>
              ) : (
                list.map((e) => (
                  <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                    <T variant="sub" tone="tertiary" style={{ width: 52, fontVariant: ['tabular-nums'] }}>
                      {t.common.period(e.period)}
                    </T>
                    <T variant="sub" style={{ flexShrink: 1 }} numberOfLines={1}>
                      {cn(e.courseName)}
                    </T>
                    {!e.term ? <Pill text={t.period.unclassified} /> : null}
                    {e.needsRecheck ? <Pill text={t.period.recheck} tone="warning" /> : null}
                  </View>
                ))
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingVertical: space.sm, paddingHorizontal: space.sm, borderRadius: radius.control },
  today: { backgroundColor: colors.accentSoft },
  day: { width: 28, fontWeight: '700' },
});
