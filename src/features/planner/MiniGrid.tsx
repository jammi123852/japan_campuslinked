import { StyleSheet, View } from 'react-native';

import { T } from '@/components/ui';
import { useI18n } from '@/i18n';
import { colors, radius } from '@/theme/tokens';

/** 대안 비교용 작은 주간 격자 (모든 안이 같은 축척: 월~금 × 1~5교시). 기존 수업=회색, 추가 수업=파랑 */
export function MiniGrid({ fixed, added, blocked, testID }: { fixed: { weekday: number; period: number }[]; added: { weekday: number; period: number }[]; blocked?: Set<string>; testID?: string }) {
  const { t } = useI18n();
  const has = (list: { weekday: number; period: number }[], d: number, p: number) => list.some((x) => x.weekday === d && x.period === p);
  return (
    <View testID={testID} accessibilityLabel={`${added.length} + ${fixed.length}`}>
      <View style={styles.row}>
        <View style={styles.head} />
        {[0, 1, 2, 3, 4].map((d) => (
          <T key={d} variant="caption" tone="tertiary" style={styles.headText}>
            {t.common.weekdays[d]}
          </T>
        ))}
      </View>
      {[1, 2, 3, 4, 5].map((p) => (
        <View key={p} style={styles.row}>
          <T variant="caption" tone="tertiary" style={styles.head}>
            {p}
          </T>
          {[0, 1, 2, 3, 4].map((d) => (
            <View
              key={d}
              style={[
                styles.cell,
                has(fixed, d, p) && { backgroundColor: colors.textDisabled },
                has(added, d, p) && { backgroundColor: colors.accent },
                blocked?.has(`${d}-${p}`) && !has(added, d, p) && !has(fixed, d, p) && styles.blocked,
              ]}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  head: { width: 14, textAlign: 'center' },
  headText: { width: 22, textAlign: 'center', marginHorizontal: 1 },
  cell: { width: 22, height: 14, margin: 1, borderRadius: radius.badge / 2, backgroundColor: colors.fill },
  blocked: { borderWidth: 1, borderColor: colors.dangerText, borderStyle: 'dashed', backgroundColor: colors.dangerSoft },
});
