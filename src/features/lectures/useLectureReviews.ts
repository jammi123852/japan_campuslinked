import { useCallback, useEffect, useState } from 'react';

import type { LoadState } from '@/features/community/usePosts';
import { listReviews, type SharedReview } from '@/lib/api';

/** 강의의 작성된(공유 서버) 후기. reload() 로 다시 불러온다 */
export function useLectureReviews(lectureId: string | undefined) {
  const [state, setState] = useState<LoadState<SharedReview[]>>({ kind: 'loading' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!lectureId) return;
    let alive = true;
    listReviews(lectureId)
      .then((data) => alive && setState({ kind: 'ok', data }))
      .catch((error: unknown) => alive && setState({ kind: 'error', error }));
    return () => {
      alive = false;
    };
  }, [lectureId, tick]);

  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { state, reload };
}
