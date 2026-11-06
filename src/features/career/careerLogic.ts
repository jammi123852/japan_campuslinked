/**
 * 진로 탐색 (순수 함수, Node 에서 바로 테스트).
 * 키워드와 공식 자료의 글자 일치만 본다. 직업별 필수 자격은 근거 자료가 없어 만들지 않는다.
 */
import type { OfficialActivity, OfficialCourse } from '../official/types';

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

export function parseKeywords(text: string) {
  const seen = new Set<string>();
  return text
    .split(/[,、，\n]/)
    .map((k) => k.trim())
    .filter((k) => {
      const n = norm(k);
      if (!n || seen.has(n)) return false;
      seen.add(n);
      return true;
    });
}

/** 키워드별 공식 강의 (같은 과목명의 분반은 하나로) */
export function coursesForKeyword(courses: OfficialCourse[], keyword: string) {
  const k = norm(keyword);
  if (!k) return [];
  const names = new Set<string>();
  return courses.filter((c) => {
    if (!norm(c.name).includes(k) || names.has(c.name)) return false;
    names.add(c.name);
    return true;
  });
}

/** 학교 프로그램을 키워드 일치 순으로. 일치하지 않아도 빼지 않는다(학교 프로그램은 모두 보여 줌) */
export function rankActivities(activities: OfficialActivity[], keywords: string[]) {
  return activities
    .map((a) => {
      const hay = norm([a.name, a.text, ...a.keywords].join(' '));
      return { activity: a, hits: keywords.filter((k) => hay.includes(norm(k))) };
    })
    .sort((a, b) => b.hits.length - a.hits.length);
}
