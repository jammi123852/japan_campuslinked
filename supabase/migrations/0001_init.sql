-- KSU Campus 初期スキーマ
-- 1段階: profiles を使用。2〜3段階のテーブルも先に定義し、RLS を有効化しておく。
-- 実行方法: Supabase ダッシュボードの SQL Editor に貼り付けて実行、または supabase CLI の db push。
-- 方針:
--   * すべてのテーブルで RLS を有効化。ポリシーのないテーブルは読み書き不可。
--   * 個人データ(プロフィール・時間割・出席・予定・ブックマーク)は本人のみ。
--   * 公式情報(official_sources/notices)は認証済みユーザーが読み取りのみ。書き込みは service_role(管理側)のみ。
--   * 投稿は認証済みユーザーが読み取り可。作成・編集・削除は本人のみ。匿名投稿でも author_id は保存し、表示時のみ伏せる。

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------ 共通: データの出所
do $$ begin
  create type data_source_kind as enum ('user_input', 'official_public', 'community', 'demo', 'kslife');
exception when duplicate_object then null; end $$;

do $$ begin
  create type verification_status as enum ('verified', 'needs_review', 'unverified');
exception when duplicate_object then null; end $$;

-- 公式資料の出典メタデータ(URL・収集日・適用年度)
create table if not exists public.official_sources (
  id uuid primary key default gen_random_uuid(),
  kind data_source_kind not null default 'official_public',
  url text,
  title text,
  collected_at date,
  academic_year int,
  verification verification_status not null default 'needs_review',
  note text,
  created_at timestamptz not null default now(),
  constraint official_needs_url check (kind <> 'official_public' or url is not null)
);

-- ------------------------------------------------------------ 1段階: プロフィール
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 20),
  faculty_id text not null,
  department_id text not null,
  course_status text not null check (course_status in ('selected', 'undecided', 'none')),
  course_name text,
  admission_year int not null check (admission_year between 1990 and 2100),
  current_grade int not null check (current_grade between 1 and 6),
  enrolled_courses text[] not null default '{}',
  interests text[] not null default '{}',
  -- 学校所属の確認状態(将来の学校メール認証用)
  school_verified_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint course_name_when_selected check (course_status <> 'selected' or course_name is not null)
);

-- ------------------------------------------------------------ 2段階: お知らせ・講義・コミュニティ
create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  category text not null default 'other',
  target_faculty_ids text[] not null default '{}',
  target_department_ids text[] not null default '{}',
  target_grades int[] not null default '{}',
  published_at timestamptz not null,
  source_kind data_source_kind not null,
  source_id uuid references public.official_sources(id),
  created_at timestamptz not null default now(),
  constraint notice_source_required check (source_kind not in ('official_public', 'kslife') or source_id is not null)
);

create table if not exists public.lectures (
  id uuid primary key default gen_random_uuid(),
  code text,
  name text not null,
  instructor text,
  faculty_id text,
  department_id text,
  academic_year int,
  term text,
  source_kind data_source_kind not null,
  source_id uuid references public.official_sources(id),
  created_at timestamptz not null default now()
);

create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  board_type text not null check (board_type in ('university', 'faculty', 'department', 'course', 'lecture')),
  ref_id text,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  is_anonymous boolean not null default true,
  is_question boolean not null default false,
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '',
  -- 講義レビュー用(任意)
  lecture_id uuid references public.lectures(id),
  rating int check (rating between 1 and 5),
  -- 将来の投稿期限・情報保存機能用
  expires_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  is_anonymous boolean not null default true,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table if not exists public.bookmarks (
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'notice', 'lecture')),
  target_id uuid not null,
  read_later boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

-- ------------------------------------------------------------ 3段階: 時間割・予定・出席
create table if not exists public.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_name text not null,
  lecture_id uuid references public.lectures(id),
  weekday int not null check (weekday between 0 and 6),
  period int not null check (period between 1 and 10),
  room text,
  remind_minutes_before int,
  created_at timestamptz not null default now()
);

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  kind text not null check (kind in ('personal', 'assignment', 'exam', 'other')),
  course_name text,
  starts_at timestamptz,
  due_at timestamptz,
  notice_id uuid references public.notices(id) on delete set null,
  remind_minutes_before int,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_rules (
  user_id uuid not null references auth.users(id) on delete cascade,
  course_name text not null,
  -- 科目ごとに本人が設定。全科目共通の基準は持たない
  min_rate numeric check (min_rate is null or (min_rate > 0 and min_rate <= 1)),
  late_counts_as_absence int check (late_counts_as_absence is null or late_counts_as_absence > 0),
  total_sessions int check (total_sessions is null or total_sessions > 0),
  primary key (user_id, course_name)
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_name text not null,
  date date not null,
  mark text not null check (mark in ('present', 'absent', 'late')),
  -- 本人入力は user_input(推定値扱い)。公式記録は kslife 連携時のみ
  source_kind data_source_kind not null default 'user_input',
  created_at timestamptz not null default now()
);

-- 奨学金ごとの出席基準(科目の出席基準とは別管理)
create table if not exists public.scholarship_requirements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  min_attendance_rate numeric check (min_attendance_rate is null or (min_attendance_rate > 0 and min_attendance_rate <= 1)),
  note text,
  source_kind data_source_kind not null default 'user_input',
  source_id uuid references public.official_sources(id),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------ RLS
alter table public.official_sources enable row level security;
alter table public.profiles enable row level security;
alter table public.notices enable row level security;
alter table public.lectures enable row level security;
alter table public.boards enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.bookmarks enable row level security;
alter table public.timetable_entries enable row level security;
alter table public.calendar_events enable row level security;
alter table public.attendance_rules enable row level security;
alter table public.attendance_records enable row level security;
alter table public.scholarship_requirements enable row level security;

-- プロフィール: 本人のみ
create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "profiles_delete_own" on public.profiles for delete to authenticated using ((select auth.uid()) = id);

-- 公式情報・講義・掲示板一覧: 認証済みユーザーは読み取りのみ(書き込みポリシーなし = service_role のみ)
create policy "official_sources_read" on public.official_sources for select to authenticated using (true);
create policy "notices_read" on public.notices for select to authenticated using (true);
create policy "lectures_read" on public.lectures for select to authenticated using (true);
create policy "boards_read" on public.boards for select to authenticated using (true);

-- 投稿・コメント: 読み取りは認証済み全員、作成・更新・削除は本人
create policy "posts_read" on public.posts for select to authenticated using (archived_at is null);
create policy "posts_insert_own" on public.posts for insert to authenticated with check ((select auth.uid()) = author_id);
create policy "posts_update_own" on public.posts for update to authenticated
  using ((select auth.uid()) = author_id) with check ((select auth.uid()) = author_id);
create policy "posts_delete_own" on public.posts for delete to authenticated using ((select auth.uid()) = author_id);

create policy "comments_read" on public.comments for select to authenticated using (true);
create policy "comments_insert_own" on public.comments for insert to authenticated with check ((select auth.uid()) = author_id);
create policy "comments_delete_own" on public.comments for delete to authenticated using ((select auth.uid()) = author_id);

-- 個人データ: 本人のみ全操作
create policy "bookmarks_own" on public.bookmarks for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "timetable_own" on public.timetable_entries for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "events_own" on public.calendar_events for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "attendance_rules_own" on public.attendance_rules for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "attendance_records_own" on public.attendance_records for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "scholarship_own" on public.scholarship_requirements for all to authenticated
  using ((select auth.uid()) = user_id and source_kind <> 'kslife')
  with check ((select auth.uid()) = user_id and source_kind <> 'kslife');

-- 本人入力の出席記録を「公式記録(kslife)」と偽って登録できないようにする
create policy "attendance_records_no_fake_official" on public.attendance_records as restrictive for insert to authenticated
  with check (source_kind = 'user_input');

-- 匿名投稿の author_id を他ユーザーに見せないための公開ビュー(2段階で posts の代わりに読む)
-- TODO(2段階): posts_read ポリシーのままだと posts を直接 select して author_id を取得できる。
--   掲示板実装時に「posts の直接 select を本人のみに制限 + 公開用は security definer 関数/ビュー経由」へ変更すること。
create or replace view public.posts_public with (security_invoker = true) as
  select id, board_id, is_anonymous, is_question, title, body, lecture_id, rating, expires_at, created_at, updated_at,
         case when is_anonymous then null else author_id end as author_id,
         (author_id = (select auth.uid())) as is_mine
  from public.posts;
