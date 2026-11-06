import { router, useLocalSearchParams } from 'expo-router';

import { Button, Screen, T } from '@/components/ui';
import { OfficialSearch } from '@/features/official/OfficialSearch';
import { useI18n } from '@/i18n';
import { space } from '@/theme/tokens';

/** 검색 탭: 2026 공식 개설 강의만 (발표용 가상 강의 탭은 2026-11-01 사용자 지시로 제거) */
export default function SearchScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ q?: string }>();

  return (
    <Screen>
      <T variant="display" header style={{ marginTop: space.sm, marginBottom: space.lg }}>
        {t.tabs.search}
      </T>
      <Button testID="search-dept" label={t.dept.open} variant="text" size="md" icon="school-outline" onPress={() => router.push('/department')} />
      <OfficialSearch key={params.q ?? ''} initialQuery={params.q ?? ''} />
    </Screen>
  );
}
