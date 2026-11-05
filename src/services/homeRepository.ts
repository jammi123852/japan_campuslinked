import {
  buildDemoDeadlines,
  buildDemoInbox,
  buildDemoNotices,
  buildDemoPosts,
} from '@/data/sampleData';
import type {
  AppSession,
  CommunityPost,
  Deadline,
  InboxItem,
  Notice,
  TimetableEntry,
} from '@/data/types';
import type { Strings } from '@/i18n/ko';
import { readJson, StorageKeys } from '@/lib/storage';
import { loadTimetable } from '@/services/timetableRepository';

/**
 * ホーム画面に必要なデータの取得口。
 * デモモード: 架空のサンプルデータ。
 * 通常モード: 端末に保存されたユーザー入力データ(時間割・締切・出席は3段階で入力画面を実装予定)。
 *   お知らせ・コミュニティは 2段階で Supabase テーブル、将来は K'sLife 連携に差し替える。
 */
export interface HomeData {
  timetable: TimetableEntry[];
  notices: Notice[];
  deadlines: Deadline[];
  posts: CommunityPost[];
  inbox: InboxItem[];
}

export async function loadHomeData(session: AppSession, t: Strings): Promise<HomeData> {
  if (session.mode === 'demo') {
    // 시간표는 데모에서도 샘플 없이, 사용자가 저장한 것만 보여 준다
    const stored = await loadTimetable(session);
    return {
      timetable: stored ?? [],
      notices: buildDemoNotices(t),
      deadlines: buildDemoDeadlines(t),
      posts: buildDemoPosts(t),
      inbox: buildDemoInbox(t),
    };
  }
  const uid = session.userId;
  const [timetable, deadlines] = await Promise.all([
    readJson<TimetableEntry[]>(StorageKeys.userData(uid, 'timetable')),
    readJson<Deadline[]>(StorageKeys.userData(uid, 'deadlines')),
  ]);
  return {
    timetable: timetable ?? [],
    notices: [],
    deadlines: deadlines ?? [],
    posts: [],
    inbox: [],
  };
}
