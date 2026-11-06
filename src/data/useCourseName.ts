import { useCourseTitle } from '@/lib/translate';

/** 지금 언어에 맞는 과목명 (한국어 모드: 사전 → 없으면 번역, 일본어 모드: 공식 표기) */
export function useCourseName() {
  return useCourseTitle();
}
