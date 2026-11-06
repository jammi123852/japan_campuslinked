# 설계 메모

## 데이터 출처 분리

모든 표시 데이터는 `SourceMeta.kind`를 가진다 (`src/data/types.ts`).

| kind | 의미 | 화면 배지 |
|---|---|---|
| `user_input` | 본인 입력 | 직접 입력 |
| `official_public` | 학교 공개자료. URL·수집일·적용 연도·확인 상태 보관 | 학교 공개자료 / 미확인이면 "확인 필요" |
| `community` | 학생 작성 | 학생 작성 |
| `demo` | 가상 샘플 | 샘플 |
| `kslife` | 향후 K'sLife 공식 연동 | K'sLife (현재 미연결) |

- K'sLife 아이디/비밀번호 수집, 비공식 로그인, 내부 API 무단 호출은 하지 않는다.
- K'sLife 공식 API가 나오면 `services/homeRepository.ts`의 가져오는 곳만 바꾼다.

## 인증·저장

| 모드 | 인증 | 프로필 저장 |
|---|---|---|
| 데모 | 기기 내 세션(`demo-local`) | AsyncStorage만 |
| Supabase | 이메일+비밀번호 | `profiles` 테이블(RLS: 본인만) + 기기 캐시 |

- AsyncStorage 키는 `ksu:v1:<userId>:...`로 사용자별 분리. 언어 설정은 `ksu:v1:locale`.
- 화면 분기는 `src/app/_layout.tsx`의 `Stack.Protected` (로그인 전 → `(auth)`, 프로필 없음 → `onboarding`, 완료 → `(tabs)`).
- 학교 메일 재학 인증은 `services/auth.ts`의 `verifySchoolAffiliation`(미구현)과 `profiles.school_verified_at`으로 확장.
- 서비스 계층은 문구 대신 코드(`AuthMessage`, `SaveResult.code`)를 돌려주고, 화면이 `src/i18n/messages.ts`로 현재 언어 문구로 바꾼다.

## 다국어

- `src/i18n/ko.ts`가 기준 테이블이고 `ja.ts`는 같은 키·함수 시그니처를 가져야 한다(타입 `Strings`로 강제).
- 학부·학과명 등 학교 고유명사는 번역하지 않고 공식 일본어 표기를 쓴다.
- 관심 분야는 언어와 무관한 id(`INTEREST_IDS`)로 저장한다.
- 한국어는 어절 단위 줄바꿈(웹 `word-break: keep-all`, iOS `hangul-word`), 일본어는 기본 줄바꿈.

## 학부·학과

- `src/data/faculties.ts`. 출처: https://www.kyusan-u.ac.jp/faculty/ (2026-10-29 수집, `needs_review`).
- "〜2025年"으로 표시된 학과(機械工学科·電気工学科)는 `lastAdmissionYear: 2025` → 2026년도 이후 입학생에게는 숨김.
- 코스명은 공식 페이지에 없어 직접 입력. 상태는 `selected / undecided / none` 3가지.

## 출석

- `src/lib/attendance.ts`. 기준(`minRate`)은 과목별로 본인이 정한 값만 쓰고, 2/3·80%를 모든 과목에 일괄 적용하지 않는다.
- 장학금 출석 기준은 `scholarship_requirements`로 따로 관리.
- 본인 입력 기록은 추정치로 표시. DB에서도 본인은 `source_kind = 'user_input'` 외에는 등록할 수 없다(restrictive policy).

## 디자인

- 방향: 대학 커뮤니티 앱 카테고리 표준(사용자 선택). 기준 앱: 에브리타임·토스·당근·LINE.
- 회색 바탕(#F2F4F6) + 흰 그룹 블록(모서리 20), 테두리·그림자 없음, 강조색 하나(#087A70). 토큰은 `src/theme/tokens.ts`.
- 방향 계약서: `.impeccable/surfaces/src-app.md`, 제품 기준: `PRODUCT.md`.
