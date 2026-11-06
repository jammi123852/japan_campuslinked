import { officialText } from '@/lib/officialText';
import { T } from '@/components/ui';
import { useI18n } from '@/i18n';
import { space } from '@/theme/tokens';
import type { OfficialData } from './types';

/** 출처 한 줄 (공식 자료 제목 + 페이지) */
export function SourceLine({ data, id, page }: { data: OfficialData; id: string; page?: number }) {
  const { t, locale } = useI18n();
  const src = data.sources[id];
  return (
    <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>
      {t.official.source(officialText(src?.title ?? id, locale, t.official.sourceDoc(id)), page ? String(page) : '')}
    </T>
  );
}

/** 프로필의 학부·학과 → 공식 데이터 학과 키 */
export function deptKeyOf(facultyId?: string, departmentId?: string) {
  return facultyId && departmentId ? `${facultyId}/${departmentId}` : null;
}
