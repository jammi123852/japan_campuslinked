import { useEffect, useState } from 'react';

import type { AppSession } from '@/data/types';
import { useI18n } from '@/i18n';
import { loadHomeData, type HomeData } from './homeRepository';
import { useTimetableVersion } from './timetableRepository';

export function useHomeData(session: AppSession | null) {
  const { t } = useI18n();
  const timetableVersion = useTimetableVersion();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    loadHomeData(session, t)
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [session, t, timetableVersion]);

  return { data, error };
}
