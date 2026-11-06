/**
 * 장학금 공지 상태 판정 (순수 함수, Node 에서 바로 테스트).
 *
 * 원칙: 사용자가 답한 내용만으로 판단한다. 모르면 '추가 확인 필요'. 학교가 판단하는 조건은 앱이 충족으로 치지 않는다.
 * 어떤 결과도 '수급 확정'이 아니다.
 */
import type { OfficialScholarship, ScholarshipAnswerKey } from '../official/types';

export type Answers = Partial<Record<ScholarshipAnswerKey, boolean | null>>;
export type Eligibility = 'candidate' | 'check' | 'not';

/** deadline 은 일본 시각 'YYYY-MM-DDTHH:mm'. today·minutes 도 학사 기준 시간대 값 */
export function isClosed(s: Pick<OfficialScholarship, 'deadline'>, today: string, minutes: number) {
  const [d, hm] = s.deadline.split('T');
  if (today !== d) return today > d;
  const [h, m] = (hm ?? '23:59').split(':').map(Number);
  return minutes > h * 60 + m;
}

export function eligibility(s: Pick<OfficialScholarship, 'checks' | 'judgedBySchool'>, answers: Answers) {
  const unmet = s.checks.filter((c) => answers[c.key] != null && answers[c.key] !== c.expect);
  const unknown = s.checks.filter((c) => answers[c.key] == null);
  const verdict: Eligibility = unmet.length ? 'not' : unknown.length ? 'check' : 'candidate';
  return { verdict, unmet: unmet.map((c) => c.key), unknown: unknown.map((c) => c.key), judgedBySchool: s.judgedBySchool };
}
