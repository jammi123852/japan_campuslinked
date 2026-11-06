import { useEffect, useState } from 'react';

import type { AppSession } from '@/data/types';
import { isDuplicate, type ChecklistItem } from '@/features/checklist/checklistLogic';
import { readJson, StorageKeys, writeJson } from '@/lib/storage';
import { createVersion } from '@/lib/storeVersion';

/** 기간별 체크리스트. 이 기기에만 저장 */
const key = (s: AppSession) => StorageKeys.userData(s.userId, 'checklist');
const store = createVersion();

export async function loadChecklist(session: AppSession): Promise<ChecklistItem[]> {
  const v = await readJson<ChecklistItem[]>(key(session));
  return Array.isArray(v) ? v : [];
}

export async function saveChecklist(session: AppSession, items: ChecklistItem[]) {
  await writeJson(key(session), items);
  store.bump();
}

export function newChecklistId() {
  return `chk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 항목 추가. 같은 기간에 이미 있으면 저장하지 않고 'exists' */
export async function addChecklistItem(
  session: AppSession,
  input: Pick<ChecklistItem, 'periodKey' | 'kind' | 'ref' | 'title'>,
): Promise<'added' | 'exists'> {
  const items = await loadChecklist(session);
  if (isDuplicate(items, input)) return 'exists';
  const now = new Date().toISOString();
  await saveChecklist(session, [...items, { ...input, id: newChecklistId(), status: 'todo', carriedFrom: null, carriedTo: null, createdAt: now, updatedAt: now }]);
  return 'added';
}

export function useChecklist(session: AppSession | null) {
  const version = store.useVersion();
  const [state, setState] = useState<{ items: ChecklistItem[]; loaded: boolean }>({ items: [], loaded: false });
  useEffect(() => {
    if (!session) return;
    let alive = true;
    loadChecklist(session).then((items) => alive && setState({ items, loaded: true }));
    return () => {
      alive = false;
    };
  }, [session, version]);
  return state;
}
