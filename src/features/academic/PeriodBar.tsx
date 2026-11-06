import { View } from 'react-native';

import { Button, Chip, IconButton, Pill, T } from '@/components/ui';
import type { AppSession } from '@/data/types';
import { useI18n } from '@/i18n';
import { academicNow } from '@/lib/dates';
import { setSelectedPeriod } from '@/services/periodRepository';
import { space } from '@/theme/tokens';
import { QUARTERS, type Quarter } from '../official/types';
import { periodKey, QUARTER_TERM, type AcademicPeriod } from './academicLogic';

/** 쿼터 하나 앞·뒤 (4Q → 다음 학년도 1Q) */
export function shiftQuarter(p: AcademicPeriod, delta: number): AcademicPeriod {
  const i = p.year * 4 + QUARTERS.indexOf(p.quarter) + delta;
  return { year: Math.floor(i / 4), quarter: QUARTERS[((i % 4) + 4) % 4] };
}

/** 학년도는 4월 시작 (1~3월은 전 학년도) */
export function academicYearOf(dateKey: string) {
  const [y, m] = dateKey.split('-').map(Number);
  return m >= 4 ? y : y - 1;
}

export function usePeriodLabel() {
  const { t } = useI18n();
  return (p: AcademicPeriod) => t.period.title(p.year, p.quarter, t.period.terms[QUARTER_TERM[p.quarter]]);
}

/**
 * 학년도·쿼터 선택 줄. 선택한 기간은 저장되고, 오늘 기준 쿼터(학년력)가 있으면 그 상태도 함께 보여 준다.
 */
export function PeriodBar({
  session,
  period,
  today,
  source,
}: {
  session: AppSession;
  period: AcademicPeriod | null;
  today: { period: AcademicPeriod; inSession: boolean } | null;
  source: 'saved' | 'calendar' | 'none';
}) {
  const { t } = useI18n();
  const label = usePeriodLabel();
  if (!period) {
    const y = academicYearOf(academicNow().date);
    return (
      <View testID="period-bar" style={{ marginBottom: space.md }}>
        <T variant="sub" tone="secondary" style={{ marginBottom: space.sm }}>
          {t.period.unset} ({t.period.yearNote})
        </T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {QUARTERS.map((q: Quarter) => (
            <Chip key={q} testID={`period-pick-${q}`} onGray label={`${y} ${q}`} onPress={() => setSelectedPeriod(session, { year: y, quarter: q })} />
          ))}
        </View>
      </View>
    );
  }
  const isPast = today ? periodKey(period) < periodKey(today.period) : false;
  return (
    <View testID="period-bar" style={{ marginBottom: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <IconButton testID="period-prev" icon="chevron-back" label={t.period.prev} onPress={() => setSelectedPeriod(session, shiftQuarter(period, -1))} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <T variant="headline" testID="period-title" style={{ fontWeight: '700' }}>
            {label(period)}
          </T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, justifyContent: 'center', marginTop: 2 }}>
            {isPast ? <Pill text={t.period.past} /> : null}
            {today && periodKey(today.period) === periodKey(period) ? (
              <Pill text={today.inSession ? t.period.todayIs(today.period.quarter) : t.period.notInSession(today.period.quarter)} tone="accent" />
            ) : source === 'saved' ? (
              <Pill text={t.period.selected} />
            ) : null}
          </View>
        </View>
        <IconButton testID="period-next" icon="chevron-forward" label={t.period.next} onPress={() => setSelectedPeriod(session, shiftQuarter(period, 1))} />
      </View>
      {source === 'saved' && today && periodKey(today.period) !== periodKey(period) ? (
        <Button testID="period-today" label={t.period.today} variant="text" size="md" onPress={() => setSelectedPeriod(session, null)} />
      ) : null}
    </View>
  );
}
