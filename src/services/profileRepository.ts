import type { AppSession, UserProfile } from '@/data/types';
import { readJson, StorageKeys, writeJson } from '@/lib/storage';
import { supabase } from '@/lib/supabase';

/**
 * プロフィールの保存先。
 * - 常に端末ローカルに保存(オフライン時・再起動時の表示用キャッシュ)
 * - Supabase モードでは profiles テーブルにも保存(RLS で本人のみ読み書き可)
 */

interface ProfileRow {
  id: string;
  nickname: string;
  faculty_id: string;
  department_id: string;
  course_status: UserProfile['courseStatus'];
  course_name: string | null;
  admission_year: number;
  current_grade: number;
  enrolled_courses: string[];
  interests: string[];
  updated_at: string;
}

function toRow(userId: string, p: UserProfile): ProfileRow {
  return {
    id: userId,
    nickname: p.nickname,
    faculty_id: p.facultyId,
    department_id: p.departmentId,
    course_status: p.courseStatus,
    course_name: p.courseName,
    admission_year: p.admissionYear,
    current_grade: p.currentGrade,
    enrolled_courses: p.enrolledCourses,
    interests: p.interests,
    updated_at: p.updatedAt,
  };
}

function fromRow(r: ProfileRow): UserProfile {
  return {
    nickname: r.nickname,
    facultyId: r.faculty_id,
    departmentId: r.department_id,
    courseStatus: r.course_status,
    courseName: r.course_name,
    admissionYear: r.admission_year,
    currentGrade: r.current_grade,
    enrolledCourses: r.enrolled_courses ?? [],
    interests: r.interests ?? [],
    updatedAt: r.updated_at,
  };
}

export async function loadProfile(session: AppSession): Promise<UserProfile | null> {
  const cached = await readJson<UserProfile>(StorageKeys.profile(session.userId));
  if (session.mode !== 'supabase' || !supabase) return cached;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.userId)
    .maybeSingle<ProfileRow>();
  if (error) {
    console.warn('[profile] remote load failed, using local cache', error.message);
    return cached;
  }
  if (!data) return cached;
  const remote = fromRow(data);
  await writeJson(StorageKeys.profile(session.userId), remote);
  return remote;
}

/** 화면에서 i18n 문구(profile.err*)로 바꿔 표시하는 실패 코드 */
export type SaveResult = { ok: true } | { ok: false; code: 'supabaseMissing' | 'notSignedIn' | 'server'; detail?: string };

export async function saveProfile(session: AppSession, profile: UserProfile): Promise<SaveResult> {
  if (session.mode === 'supabase') {
    if (!supabase) return { ok: false, code: 'supabaseMissing' };
    const { error } = await supabase.from('profiles').upsert(toRow(session.userId, profile));
    if (error) return { ok: false, code: 'server', detail: error.message };
  }
  await writeJson(StorageKeys.profile(session.userId), profile);
  return { ok: true };
}
