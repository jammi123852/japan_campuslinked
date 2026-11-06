import { useEffect, useState } from 'react';

import type { AppSession } from '@/data/types';
import type { Answers } from '@/features/scholarship/scholarshipLogic';
import { readJson, StorageKeys, writeJson } from '@/lib/storage';
import { createVersion } from '@/lib/storeVersion';

/** 진로 메모와 장학금 답변. 이 기기에만 저장 */
export interface CareerData {
  jobs: string;
  experiences: { id: string; text: string; createdAt: string }[];
}
export const EMPTY_CAREER: CareerData = { jobs: '', experiences: [] };

const careerKey = (s: AppSession) => StorageKeys.userData(s.userId, 'career');
const answersKey = (s: AppSession) => StorageKeys.userData(s.userId, 'scholarshipAnswers');
const store = createVersion();

export async function saveCareer(session: AppSession, v: CareerData) {
  await writeJson(careerKey(session), v);
  store.bump();
}

export function useCareer(session: AppSession | null) {
  const version = store.useVersion();
  const [state, setState] = useState<CareerData>(EMPTY_CAREER);
  useEffect(() => {
    if (!session) return;
    let alive = true;
    readJson<CareerData>(careerKey(session)).then((v) => alive && setState({ ...EMPTY_CAREER, ...(v ?? {}) }));
    return () => {
      alive = false;
    };
  }, [session, version]);
  return state;
}

export async function loadScholarshipAnswers(session: AppSession): Promise<Answers> {
  return (await readJson<Answers>(answersKey(session))) ?? {};
}

export async function saveScholarshipAnswers(session: AppSession, v: Answers) {
  await writeJson(answersKey(session), v);
  store.bump();
}

export function useScholarshipAnswers(session: AppSession | null) {
  const version = store.useVersion();
  const [state, setState] = useState<Answers>({});
  useEffect(() => {
    if (!session) return;
    let alive = true;
    readJson<Answers>(answersKey(session)).then((v) => alive && setState(v ?? {}));
    return () => {
      alive = false;
    };
  }, [session, version]);
  return state;
}
