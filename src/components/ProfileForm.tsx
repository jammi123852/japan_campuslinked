import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Block, Button, Chip, Gap, Notice, Row, Screen, Segmented, T, TextField } from '@/components/ui';
import { FACULTIES, FACULTY_SOURCE, INTEREST_IDS, interestLabel, selectableDepartments, orgLabel } from '@/data/faculties';
import type { CourseStatus, UserProfile } from '@/data/types';
import { useI18n } from '@/i18n';
import type { Strings } from '@/i18n/ko';
import { colors, radius, space } from '@/theme/tokens';

export type ProfileInput = Omit<UserProfile, 'updatedAt'>;

const CURRENT_YEAR = new Date().getFullYear();
/** 학년은 휴학·유급이 있어 입학 연도로 계산하지 않고 본인이 고른다 */
const GRADES = [1, 2, 3, 4, 5, 6];
const ADMISSION_YEARS = Array.from({ length: 8 }, (_, i) => CURRENT_YEAR - i);

type FieldKey = 'nickname' | 'faculty' | 'department' | 'courseName' | 'grade';
type Errors = Partial<Record<FieldKey, string>>;

/** 단계별 검사 대상 필드 (onboarding 의 '다음' 버튼) */
const STEP_FIELDS: FieldKey[][] = [['faculty', 'department', 'courseName'], ['nickname', 'grade'], []];

export function validateProfile(p: Partial<ProfileInput>, t: Strings): Errors {
  const e: Errors = {};
  const nick = p.nickname?.trim() ?? '';
  if (nick.length === 0) e.nickname = t.profile.errNickname;
  else if (nick.length > 20) e.nickname = t.profile.errNicknameLong;
  if (!p.facultyId) e.faculty = t.profile.errFaculty;
  if (!p.departmentId) e.department = t.profile.errDepartment;
  if (p.courseStatus === 'selected' && !p.courseName?.trim()) e.courseName = t.profile.errCourseName;
  if (!p.currentGrade) e.grade = t.profile.errGrade;
  return e;
}

/**
 * 프로필 입력 화면.
 * - steps: 처음 설정. 소속 → 학년·닉네임 → 수업·관심사 3단계, 하단 고정 버튼.
 * - single: 편집. 모든 항목을 블록으로 한 화면에.
 */
export function ProfileForm({
  initial,
  mode,
  onSubmit,
  topSlot,
  bottomSlot,
  lastSlot,
}: {
  initial?: UserProfile | null;
  mode: 'steps' | 'single';
  onSubmit: (input: ProfileInput) => Promise<string | null>;
  /** 첫 단계 위에 보일 안내 (데모 안내 등) */
  topSlot?: ReactNode;
  /** 마지막에 보일 보조 동작 (로그인 화면으로 등) */
  bottomSlot?: ReactNode;
  /** 마지막 단계의 제출 버튼 바로 아래 (데모 버전 등) */
  lastSlot?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const [step, setStep] = useState(0);
  const [nickname, setNickname] = useState(initial?.nickname ?? '');
  const [admissionYear, setAdmissionYear] = useState(initial?.admissionYear ?? CURRENT_YEAR);
  const [currentGrade, setCurrentGrade] = useState<number | null>(initial?.currentGrade ?? null);
  const [facultyId, setFacultyId] = useState(initial?.facultyId ?? '');
  const [departmentId, setDepartmentId] = useState(initial?.departmentId ?? '');
  const [courseStatus, setCourseStatus] = useState<CourseStatus>(initial?.courseStatus ?? 'undecided');
  const [courseName, setCourseName] = useState(initial?.courseName ?? '');
  const [enrolled, setEnrolled] = useState<string[]>(initial?.enrolledCourses ?? []);
  const [enrolledDraft, setEnrolledDraft] = useState('');
  const [interests, setInterests] = useState<string[]>(initial?.interests ?? []);
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const departments = useMemo(
    () => (facultyId ? selectableDepartments(facultyId, admissionYear) : []),
    [facultyId, admissionYear],
  );

  const chooseFaculty = (id: string) => {
    setFacultyId(id);
    const deps = selectableDepartments(id, admissionYear);
    // 학과가 하나뿐인 학부는 자동 선택
    setDepartmentId(deps.length === 1 ? deps[0].id : '');
    setErrors((e) => ({ ...e, faculty: undefined, department: undefined }));
  };

  const chooseYear = (year: number) => {
    setAdmissionYear(year);
    // 입학 연도를 바꿔 고를 수 없게 된 학과는 해제
    if (facultyId && !selectableDepartments(facultyId, year).some((d) => d.id === departmentId)) setDepartmentId('');
  };

  const addEnrolled = () => {
    const name = enrolledDraft.trim();
    if (!name || enrolled.includes(name)) return;
    setEnrolled([...enrolled, name]);
    setEnrolledDraft('');
  };

  const toggleInterest = (id: string) =>
    setInterests(interests.includes(id) ? interests.filter((x) => x !== id) : [...interests, id]);

  const buildInput = (): ProfileInput => ({
    nickname: nickname.trim(),
    facultyId,
    departmentId,
    courseStatus,
    courseName: courseStatus === 'selected' ? courseName.trim() : null,
    admissionYear,
    currentGrade: currentGrade ?? 0,
    enrolledCourses: enrolled,
    interests,
  });

  const submit = async () => {
    const input = buildInput();
    const e = validateProfile(input, t);
    setErrors(e);
    if (Object.keys(e).length > 0) {
      setSubmitError(t.profile.errSummary);
      // 단계 모드에서는 오류가 있는 첫 단계로 돌아간다
      if (mode === 'steps') {
        const first = STEP_FIELDS.findIndex((fields) => fields.some((f) => e[f]));
        if (first >= 0) setStep(first);
      }
      return;
    }
    setSubmitError(null);
    setSaving(true);
    try {
      const err = await onSubmit(input);
      if (err) setSubmitError(err);
    } finally {
      setSaving(false);
    }
  };

  const goNext = () => {
    const e = validateProfile(buildInput(), t);
    const stepErrors: Errors = {};
    for (const f of STEP_FIELDS[step]) if (e[f]) stepErrors[f] = e[f];
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length === 0) {
      setSubmitError(null);
      setStep(step + 1);
    }
  };

  // ------------------------------------------------------------ 섹션

  const affiliation = (
    <>
      <FieldLabel text={t.profile.admissionYear} />
      <View style={[styles.wrap, { marginBottom: space.lg }]}>
        {ADMISSION_YEARS.map((y) => (
          <Chip key={y} testID={`year-${y}`} label={t.common.year(y)} selected={admissionYear === y} onPress={() => chooseYear(y)} />
        ))}
      </View>

      <FieldLabel text={t.profile.faculty} error={errors.faculty} />
      <View accessibilityRole="radiogroup" accessibilityLabel={t.profile.faculty}>
        {FACULTIES.map((f) => (
          <Row key={f.id} testID={`faculty-${f.id}`} role="radio" title={orgLabel(f.name, locale)} selected={facultyId === f.id} onPress={() => chooseFaculty(f.id)} />
        ))}
      </View>

      <Gap size={space.xl} />
      <FieldLabel text={t.profile.department} error={errors.department} />
      {facultyId ? (
        <View accessibilityRole="radiogroup" accessibilityLabel={t.profile.department}>
          {departments.map((d) => (
            <Row
              key={d.id}
              testID={`dept-${d.id}`}
              role="radio"
              title={orgLabel(d.name, locale)}
              subtitle={d.lastAdmissionYear ? t.profile.deptUntil(d.lastAdmissionYear) : undefined}
              selected={departmentId === d.id}
              onPress={() => {
                setDepartmentId(d.id);
                setErrors((x) => ({ ...x, department: undefined }));
              }}
            />
          ))}
        </View>
      ) : (
        <T variant="sub" tone="tertiary" style={{ paddingVertical: space.md }}>
          {t.profile.pickFacultyFirst}
        </T>
      )}

      <Gap size={space.xl} />
      <FieldLabel text={t.profile.course} />
      <Segmented<CourseStatus>
        label={t.profile.course}
        testIDPrefix="course"
        value={courseStatus}
        onChange={setCourseStatus}
        options={[
          { value: 'selected', label: t.profile.courseSelected },
          { value: 'undecided', label: t.profile.courseUndecided },
          { value: 'none', label: t.profile.courseNone },
        ]}
      />
      <Gap size={space.lg} />
      {courseStatus === 'selected' && (
        <TextField
          testID="field-course"
          label={t.profile.courseName}
          value={courseName}
          onChangeText={setCourseName}
          placeholder={t.profile.coursePlaceholder}
          error={errors.courseName}
        />
      )}
      <T variant="sub" tone="tertiary">
        {t.profile.courseNote}
      </T>
    </>
  );

  const identity = (
    <>
      <TextField
        testID="field-nickname"
        label={t.profile.nickname}
        hint={t.profile.nicknameHint}
        value={nickname}
        onChangeText={setNickname}
        placeholder={t.profile.nicknamePlaceholder}
        maxLength={20}
        error={errors.nickname}
      />
      <FieldLabel text={t.profile.currentGrade} error={errors.grade} />
      <Segmented<number>
        label={t.profile.currentGrade}
        testIDPrefix="grade"
        value={currentGrade}
        onChange={(g) => {
          setCurrentGrade(g);
          setErrors((x) => ({ ...x, grade: undefined }));
        }}
        options={GRADES.map((g) => ({ value: g, label: t.common.grade(g) }))}
      />
      <T variant="sub" tone="tertiary" style={{ marginTop: space.sm }}>
        {t.profile.gradeHint}
      </T>
    </>
  );

  const studies = (
    <>
      <TextField
        testID="field-enrolled"
        label={t.profile.enrolled}
        hint={t.profile.enrolledHint}
        value={enrolledDraft}
        onChangeText={setEnrolledDraft}
        onSubmitEditing={addEnrolled}
        placeholder={t.profile.enrolledPlaceholder}
        returnKeyType="done"
        right={
          <View style={{ width: 76 }}>
            <Button testID="add-enrolled" label={t.profile.add} variant="secondary" onPress={addEnrolled} disabled={!enrolledDraft.trim()} size="input" />
          </View>
        }
      />
      {enrolled.length > 0 && (
        <View style={[styles.wrap, { marginTop: -space.sm, marginBottom: space.lg }]}>
          {enrolled.map((c) => (
            <Chip
              key={c}
              label={c}
              icon="close"
              accessibilityLabel={t.profile.remove(c)}
              onPress={() => setEnrolled(enrolled.filter((x) => x !== c))}
            />
          ))}
        </View>
      )}

      <FieldLabel text={t.profile.interests} />
      <T variant="sub" tone="tertiary" style={{ marginTop: -space.xs, marginBottom: space.md }}>
        {t.profile.interestsHint}
      </T>
      <View style={styles.wrap}>
        {INTEREST_IDS.map((id) => (
          <Chip
            key={id}
            testID={`interest-${id}`}
            label={interestLabel(id, t.interests)}
            selected={interests.includes(id)}
            onPress={() => toggleInterest(id)}
          />
        ))}
      </View>
      <T variant="caption" tone="tertiary" style={{ marginTop: space.lg }}>
        {t.profile.sourceNote(FACULTY_SOURCE.url ?? '', FACULTY_SOURCE.collectedAt ?? '')}
      </T>
    </>
  );

  // ------------------------------------------------------------ 단계 모드

  if (mode === 'steps') {
    const sections = [affiliation, identity, studies];
    const last = step === sections.length - 1;
    return (
      <Screen
        background={colors.surface}
        footer={
          <>
            {submitError && <Notice tone="danger" text={submitError} />}
            <Button
              testID={last ? 'submit-profile' : 'next-step'}
              label={last ? t.profile.submitOnboarding : t.common.next}
              onPress={last ? submit : goNext}
              loading={saving}
            />
            {last && lastSlot}
            {step === 0 && bottomSlot}
          </>
        }
      >
        <View style={styles.stepHeader}>
          {step > 0 ? (
            <Pressable
              testID="prev-step"
              accessibilityRole="button"
              accessibilityLabel={t.common.back}
              onPress={() => setStep(step - 1)}
              hitSlop={8}
              style={styles.backButton}
            >
              <Ionicons aria-hidden name="chevron-back" size={26} color={colors.text} />
            </Pressable>
          ) : (
            <View style={styles.backButton} />
          )}
          <T variant="sub" tone="tertiary" style={{ fontWeight: '600' }}>
            {t.profile.stepCount(step + 1, sections.length)}
          </T>
        </View>
        <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: sections.length, now: step + 1 }}>
          {sections.map((_, i) => (
            <View key={i} style={[styles.progressSeg, i <= step && { backgroundColor: colors.accent }]} />
          ))}
        </View>

        <T variant="display" header style={{ marginTop: space.xxl, marginBottom: space.sm }} testID="step-title">
          {t.profile.stepTitles[step]}
        </T>
        {step === 0 ? (
          <T variant="body" tone="tertiary" style={{ marginBottom: space.xxl }}>
            {t.profile.onboardingLead}
          </T>
        ) : (
          <Gap size={space.xl} />
        )}
        {step === 0 && topSlot}
        {sections[step]}
      </Screen>
    );
  }

  // ------------------------------------------------------------ 편집 모드

  return (
    <Screen
      edges={[]}
      footer={
        <>
          {submitError && <Notice tone="danger" text={submitError} />}
          <Button testID="submit-profile" label={t.profile.submitEdit} onPress={submit} loading={saving} />
        </>
      }
    >
      <Block>
        <T variant="title" header style={{ marginBottom: space.lg }}>
          {t.profile.steps[0]}
        </T>
        {affiliation}
      </Block>
      <Gap />
      <Block>
        <T variant="title" header style={{ marginBottom: space.lg }}>
          {t.profile.steps[1]}
        </T>
        {identity}
      </Block>
      <Gap />
      <Block>
        <T variant="title" header style={{ marginBottom: space.lg }}>
          {t.profile.steps[2]}
        </T>
        {studies}
      </Block>
    </Screen>
  );
}

function FieldLabel({ text, error }: { text: string; error?: string }) {
  return (
    <View style={{ marginBottom: space.sm }}>
      <T variant="headline">{text}</T>
      {error ? (
        <T variant="sub" tone="danger" style={{ marginTop: 2 }} live>
          {error}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  stepHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  backButton: { width: 44, height: 44, justifyContent: 'center', marginLeft: -10 },
  progressTrack: { flexDirection: 'row', gap: space.xs, marginTop: space.sm },
  progressSeg: { flex: 1, height: 4, borderRadius: radius.pill, backgroundColor: colors.divider },
});
