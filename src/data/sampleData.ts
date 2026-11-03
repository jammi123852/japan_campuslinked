import type { Strings } from '@/i18n/ko';
import type {
  CommunityPost,
  Deadline,
  InboxItem,
  Notice,
  SourceMeta,
} from './types';

/**
 * 데모 모드용 샘플 데이터. 전부 가상이며 실제 수업·공지가 아니다.
 * 화면에서는 반드시 "샘플" 배지와 함께 보여 준다. 문구는 현재 언어 테이블(t.sample)에서 가져온다.
 * 수업 시각도 가상 값이다(학교 공식 교시 시간은 확인하지 않았다).
 */
const DEMO: SourceMeta = { kind: 'demo', note: '架空のサンプルデータ' };

function daysFromNow(days: number, hour = 23, minute = 59) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** 오늘 요일 (0=월 … 6=일) */
export function todayWeekday(date = new Date()) {
  return (date.getDay() + 6) % 7;
}

export function buildDemoNotices(t: Strings): Notice[] {
  return [
    { id: 'n-1', title: t.sample.notice1, body: t.sample.noticeBody, category: 'academic', target: {}, publishedAt: daysFromNow(-1, 9, 0), source: DEMO },
    { id: 'n-2', title: t.sample.notice2, body: t.sample.noticeBody, category: 'scholarship', target: {}, publishedAt: daysFromNow(-3, 10, 0), source: DEMO },
  ];
}

export function buildDemoDeadlines(t: Strings): Deadline[] {
  const [, c2, c3] = t.sample.classes;
  return [
    { id: 'd-1', title: t.sample.deadline1, kind: 'assignment', courseName: c3, dueAt: daysFromNow(2), source: DEMO },
    { id: 'd-2', title: t.sample.deadline2, kind: 'exam', courseName: c2, dueAt: daysFromNow(6, 10, 40), source: DEMO },
  ];
}

export function buildDemoPosts(t: Strings): CommunityPost[] {
  return [
    {
      id: 'p-1',
      boardType: 'department',
      boardId: 'sample',
      title: t.sample.post1,
      body: t.sample.postBody,
      authorDisplay: { type: 'anonymous' },
      isQuestion: true,
      answerCount: 3,
      createdAt: daysFromNow(0, 8, 30),
      expiresAt: null,
      source: DEMO,
    },
    {
      id: 'p-2',
      boardType: 'university',
      boardId: 'ksu',
      title: t.sample.post2,
      body: t.sample.postBody,
      authorDisplay: { type: 'nickname', nickname: t.sample.sampleNick },
      isQuestion: true,
      answerCount: 1,
      createdAt: daysFromNow(-1, 20, 0),
      expiresAt: null,
      source: DEMO,
    },
  ];
}

export function buildDemoInbox(t: Strings): InboxItem[] {
  return [{ id: 'i-1', title: t.sample.inboxTitle, body: t.sample.inboxBody, createdAt: daysFromNow(0, 8, 0), read: false, source: DEMO }];
}
