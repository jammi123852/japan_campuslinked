import { findLecture } from '@/data/lectures';
import { useI18n } from '@/i18n';
import { officialCourseById } from './courseLogic';
import { useOfficial } from './useOfficial';

/** 샘플 강의 id 와 공식 강의 id 를 한 곳에서 이름으로 풀어 준다. 실제 후기·질문을 샘플과 섞지 않기 위해 종류도 돌려준다 */
export function isOfficialId(id: string | null | undefined) {
  return !!id && (/^o[0-9a-f]{13}$/.test(id) || id.startsWith('rs26-'));
}

export function useAnyLecture(id: string | null | undefined) {
  const { locale } = useI18n();
  const official = useOfficial();
  if (!id) return null;
  if (isOfficialId(id)) {
    if (official.kind !== 'ok') return { id, official: true as const, title: null, subtitle: null, course: null, loading: official.kind === 'loading' };
    const c = officialCourseById(official.data, id);
    return c
      ? { id: c.id, official: true as const, title: c.name, subtitle: [c.section ? `[${c.section}]` : '', c.instructor ?? '', c.ay ? String(c.ay) : ''].join(' ').trim(), course: c, loading: false }
      : { id, official: true as const, title: null, subtitle: null, course: null, loading: false };
  }
  const lec = findLecture(id);
  return lec ? { id: lec.id, official: false as const, title: lec.name[locale], subtitle: lec.instructor[locale], course: null, loading: false } : null;
}

export function lectureRoute(id: string) {
  return isOfficialId(id) ? ({ pathname: '/course', params: { id } } as const) : ({ pathname: '/lecture/[id]', params: { id } } as const);
}
