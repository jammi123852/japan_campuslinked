/**
 * 공유 서버에 작성된 후기만으로 만든 요약 (순수 함수). 샘플 후기(lectures.ts)는 넣지 않는다.
 * 후기가 없으면 null — 화면은 "요약 없음"과 예시 값 안내를 따로 보여 준다.
 */
import type { ReviewEvaluation, SharedReview } from '../../lib/api';

export interface ReviewSummary {
  count: number;
  /** 소수 첫째 자리 */
  workload: number;
  difficulty: number;
  /** 가장 많이 고른 값 (같으면 먼저 나온 값) */
  attendance: SharedReview['attendance'];
  evaluation: ReviewEvaluation;
}

const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;

function mode<T extends string>(xs: T[]): T {
  const counts = new Map<T, number>();
  xs.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1));
  let best = xs[0];
  for (const [k, n] of counts) if (n > (counts.get(best) ?? 0)) best = k;
  return best;
}

export function summarizeReviews(list: SharedReview[]): ReviewSummary | null {
  if (list.length === 0) return null;
  return {
    count: list.length,
    workload: avg(list.map((r) => r.workload)),
    difficulty: avg(list.map((r) => r.difficulty)),
    attendance: mode(list.map((r) => r.attendance)),
    evaluation: mode(list.map((r) => r.evaluation)),
  };
}
