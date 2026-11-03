---
name: KSU Campus
description: 규슈산업대 학생용 비공식 캠퍼스 앱. 대학 커뮤니티 앱 카테고리 표준(에브리타임형)을 최고 완성도로.
colors:
  accent: "#087A70"
  accent-pressed: "#06635B"
  accent-soft: "#E6F4F2"
  on-accent: "#FFFFFF"
  bg: "#F2F4F6"
  surface: "#FFFFFF"
  surface-pressed: "#F2F4F6"
  fill: "#F2F4F6"
  divider: "#E5E8EB"
  text: "#191F28"
  text-secondary: "#4E5968"
  text-tertiary: "#6B7684"
  text-disabled: "#B0B8C1"
  danger: "#D92D20"
  danger-soft: "#FDECEA"
  danger-text: "#B42318"
  warning-soft: "#FFF4E5"
  warning-text: "#B54708"
  success-soft: "#E7F5EC"
  success-text: "#0B6B3A"
typography:
  display:
    fontFamily: "System (iOS SF Pro / Android Roboto / web system-ui)"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: "36px"
  title:
    fontFamily: "System"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: "28px"
  headline:
    fontFamily: "System"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: "26px"
  body:
    fontFamily: "System"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
  sub:
    fontFamily: "System"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  caption:
    fontFamily: "System"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
rounded:
  badge: "6px"
  control: "14px"
  block: "20px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
  xxxl: "32px"
  huge: "40px"
  gutter: "20px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.headline}"
    rounded: "{rounded.control}"
    padding: "0 20px"
    height: "56px"
  button-primary-pressed:
    backgroundColor: "{colors.accent-pressed}"
  button-secondary:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    height: "56px"
  button-tertiary:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.control}"
    height: "56px"
  button-tertiary-md:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.sub}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.control}"
    height: "56px"
  button-danger-text:
    backgroundColor: "transparent"
    textColor: "{colors.danger-text}"
    rounded: "{rounded.control}"
    height: "56px"
  text-field:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "52px"
  text-field-focused:
    backgroundColor: "{colors.surface}"
  block:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.block}"
    padding: "20px"
  row:
    backgroundColor: "{colors.surface}"
    typography: "{typography.body}"
    padding: "12px 20px"
    height: "56px"
  row-pressed:
    backgroundColor: "{colors.surface-pressed}"
  chip:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.text}"
    typography: "{typography.sub}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "40px"
  chip-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
  segmented:
    backgroundColor: "{colors.fill}"
    rounded: "{rounded.control}"
    padding: "4px"
  segmented-option-on:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    height: "40px"
  badge:
    typography: "{typography.caption}"
    rounded: "{rounded.badge}"
    padding: "2px 6px"
  notice-info:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    typography: "{typography.sub}"
    rounded: "{rounded.control}"
    padding: "12px"
  notice-warning:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning-text}"
    rounded: "{rounded.control}"
    padding: "12px"
  deadline-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.block}"
    padding: "12px 16px"
    width: "220px"
  tab-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
---

# Design System: KSU Campus

## Overview

**Creative North Star: "회색 책상 위 흰 카드 묶음"**

KSU Campus는 새 시각 언어를 만들지 않는다. 에브리타임·토스·당근·LINE이 이미 길들인 카테고리 표준을 그대로 쓰고, 그 완성도로 경쟁한다. 회색 바탕 위에 흰 둥근 블록을 쌓고, 블록 사이는 테두리나 그림자가 아니라 바탕색 틈과 간격으로 나눈다. 장식·은유·일러스트 테마는 없다. 화면을 여는 것은 큰 문장 하나다(홈: "오늘 수업 2개" + 강조색 다음 수업 줄).

위계는 시스템 폰트의 크기와 굵기, 그리고 회색 세 단계 글자색으로 만든다. 색은 청록 강조색 하나뿐이며, 상태(경고·위험·성공)는 옅은 바탕 + 진한 글자 쌍으로만 나온다. 출처(공식·학생·샘플)는 항상 작은 글자 배지로 보이며, 색과 글자를 함께 써서 색만으로 구분하지 않는다.

라이트 모드 고정이다. 다크 모드는 지원하지 않으므로 다크 토큰을 만들지 않는다. 학교 공식 색·로고·교표는 쓰지 않는다.

**Key Characteristics:**
- 회색 바탕(bg) + 흰 블록(surface, 20 둥근 모서리), 테두리·그림자 없음
- 강조색 하나(청록), 상태색은 soft 바탕 + 진한 글자 쌍
- 시스템 폰트, 6단계 글자 크기, 굵기로 위계
- 4 단위 간격, 화면 좌우 여백 20
- 한 손 조작: 터치 영역 48, 주 버튼 높이 56, 주 버튼은 하단 고정
- 출처 배지가 모든 정보 항목에 붙는다

## Colors

차갑고 옅은 회색 중립 위에 청록 하나가 행동과 "지금"을 가리키는 팔레트다.

### Primary
- **캠퍼스 청록** (accent): 주 버튼 바탕, 다음/지금 수업 줄의 교시·문장, 선택된 칩·라디오, 진행 막대, 답변 수, 키보드 포커스 링. 흰 바탕 대비 5.2:1.
- **눌린 청록** (accent-pressed): 주 버튼 눌림 상태 전용.
- **옅은 청록** (accent-soft): 다음/지금 수업 줄 바탕, 보조 버튼 바탕, 정보 안내 바탕, 공식 출처 배지 바탕, 선택된 칩 바탕.

### Neutral
- **회색 책상** (bg): 탭 화면·상세 화면의 바탕. 블록 사이 틈이 이 색이다.
- **흰 블록** (surface): 블록, 마감 카드, 하단 탭바, 그리고 입력 흐름 화면의 바탕.
- **채움 회색** (fill): 블록 안의 입력칸, 칩, 세그먼트 트랙, 3차 버튼 바탕. bg와 같은 값이지만 역할이 다르다.
- **구분선 회색** (divider): 탭바 윗선, 진행 막대 빈 칸, 3차 버튼 눌림.
- **먹색** (text): 본문·제목.
- **보조 회색** (text-secondary): 소속·날짜 캡션, 보조 문장, 3차 버튼 글자. 7.1:1.
- **3차 회색** (text-tertiary): 강의실·작성일 등 메타 정보, 힌트. 4.6:1.
- **비활성 회색** (text-disabled): 꺾쇠(chevron), 미선택 라디오, 비활성 탭 아이콘. 글자 본문에는 쓰지 않는다.

### Status
- **위험** (danger / danger-soft / danger-text): 입력 오류 테두리, 알림 숫자 점(danger), D-2 이내 마감 글자·위험 안내(danger-text).
- **주의** (warning-soft / warning-text): 데모 모드 안내, 샘플 출처 배지, 출석 주의.
- **성공** (success-soft / success-text): 출석 양호 배지.

### Named Rules
**The One Accent Rule.** 강조색은 청록 하나다. 두 번째 브랜드색을 들이지 않는다. 상태색은 정보 전달용이며 장식으로 쓰지 않는다.

**The Tertiary-on-White Rule.** text-tertiary는 흰 블록(surface) 위에서만 쓴다. 회색 바탕(bg) 위의 보조 글자는 text-secondary를 쓴다.

**The Source Badge Rule.** 공식=청록 배지, 학생 작성·본인 입력=회색 배지, 샘플=황색 배지. 배지는 항상 글자를 담아 색만으로 출처를 말하지 않는다.

## Typography

**Display Font:** 시스템 폰트 (iOS SF Pro / Android Roboto / 웹 system-ui)
**Body Font:** 시스템 폰트

**Character:** 하나의 시스템 서체를 굵기(400·500·600·700)로만 나눈다. 숫자(교시 시각, D-day, 날짜, 출석률)는 tabular-nums.

### Hierarchy
- **Display** (700, 26/36): 화면을 여는 큰 문장. 홈 헤드라인, 단계 제목, 마이 화면 제목, 앱 이름. 화면당 하나.
- **Title** (700, 20/28): 블록 제목(BlockHeader), 가로 스크롤 섹션 제목, 출석률 숫자.
- **Headline** (600, 17/26): 버튼 라벨, 교시, D-day(700), 알림 제목, 입력 필드 라벨(프로필), 네비게이션 헤더 제목.
- **Body** (400, 16/24): 행 제목, 과목명(600), 입력값.
- **Sub** (400, 14/20): 메타 정보, 칩·세그먼트·md 버튼 라벨, 안내문, 날짜 캡션.
- **Caption** (500, 12/16): 시작 시각, 추정치 각주, 배지(600).

### Named Rules
**The Same-Level Same-Step Rule.** 같은 계층은 같은 단계만 쓴다. 위계를 바꿀 때는 크기를 새로 만들지 말고 단계나 굵기를 바꾼다.

**The Korean Word-Break Rule.** 한국어는 어절 단위 줄바꿈(iOS hangul-word, 웹 keep-all), 일본어는 기본 줄바꿈.

## Layout

- **화면 틀:** 좌우 여백 20(gutter), 위 16, 아래 40. 웹에서는 최대 폭 480의 가운데 열, 바깥은 divider 회색.
- **블록 쌓기:** 블록 사이 12(Gap 기본), 섹션 성격이 바뀌는 곳은 24. 되돌리기 어려운 동작(로그아웃 등)은 40 띄워 분리한다.
- **블록 안:** 안쪽 여백 20. 목록 블록은 `flush`로 위아래 8만 두고, 행이 좌우 20을 스스로 채워 눌림 바탕이 블록 끝까지 닿는다.
- **하단 고정 주 버튼:** 입력 흐름과 편집 화면의 주 동작은 화면 하단 footer에 고정(좌우 20, 위 12, 아래 16), 바탕은 화면 바탕과 같다.
- **가로 스크롤:** 가로 목록은 gutter만큼 화면 끝까지 뻗고(음수 여백 −20 + 안쪽 20), 카드 사이 12.
- **터치:** 최소 터치 48, 행 최소 높이 56, 주 버튼 56, 입력칸 52.

### Named Rules
**The Gray-Desk / White-Form Rule.** 입력 흐름 화면(온보딩 단계·로그인·회원가입·비밀번호 재설정)은 흰 바탕(surface)에 블록 없이 필드를 바로 놓는다. 그 외 화면(시작 화면·탭 5개·알림·프로필 편집)은 회색 바탕(bg) 위 흰 블록이다.

**The Title Placement Rule.** 섹션 제목은 블록 안(BlockHeader, Title 단계)에 둔다. 예외는 가로 스크롤 섹션(홈 "다가오는 마감") 하나뿐이며, 이때만 제목을 블록 밖 회색 바탕 위에 두고 아래 12를 띄운다.

## Elevation & Depth

평면 시스템이다. 깊이는 그림자가 아니라 바탕 톤 차이(bg 회색 → surface 흰색 → 블록 안 fill 회색)로 만든다. 블록·카드·버튼·탭바 어디에도 그림자를 두지 않는다.

### Shadow Vocabulary
- **세그먼트 썸** (`shadowColor #191F28, opacity 0.08, radius 4, offset 0/1, elevation 1`): 세그먼트 컨트롤의 선택된 칸에만. iOS 세그먼트 컨트롤의 고유 표현이라 유일하게 허용한다.

### Named Rules
**The Tone-Not-Shadow Rule.** 층은 회색과 흰색의 교대로만 나눈다. 세그먼트 썸 외에는 그림자를 쓰지 않는다.

## Shapes

네 단계 모서리: 블록·마감 카드 20 / 버튼·입력칸·안내·세그먼트 트랙·강조된 수업 줄 14 / 배지 6 / 칩·아이콘 버튼·진행 막대 pill. 블록에는 테두리가 없다. 테두리(1.5)는 상태를 알릴 때만 나타난다: 입력칸 포커스(청록)·오류(위험), 선택된 칩(청록).

## Components

### Buttons
- **Shape:** 둥근 모서리(14), 높이 lg 56 / input 52 / md 44.
- **Primary:** 청록 바탕, 흰 글자, Headline 600. 화면당 하나, 보통 하단 고정.
- **Secondary:** 옅은 청록 바탕, 청록 글자.
- **Tertiary:** 채움 회색 바탕, 보조 회색 글자. 프로필 편집 같은 블록 안 보조 동작(md).
- **Text / Danger text:** 투명 바탕, 눌리면 fill 또는 danger-soft 바탕.
- **Pressed:** 바탕 한 단계 진하게 + 0.98 축소. **Disabled:** 불투명도 0.4. **Loading:** 라벨 대신 스피너.
- **Focus:** 웹에서 키보드 입력일 때만 청록 2px 외곽선, 2px 띄움.

### Chips
- **Style:** 채움 회색 pill, 높이 40, 좌우 16, Sub 글자.
- **Selected:** 옅은 청록 바탕 + 청록 1.5 테두리 + 청록 600 글자.

### Segmented
- 채움 회색 트랙(14, 안쪽 4), 선택 칸은 흰 바탕(모서리 10) + 세그먼트 썸 그림자 + 700 글자, 미선택은 보조 회색 500.

### Cards / Containers
- **Block:** 흰 바탕, 모서리 20, 안쪽 20, 테두리·그림자 없음.
- **Deadline card:** 폭 220 흰 카드(20), 안쪽 12/16. D-day(Headline 700, 2일 이내 danger-text) + 출처 배지 + 제목 + 메타.
- **Notice:** soft 바탕 + 같은 계열 진한 글자 + 18 아이콘, 모서리 14, 안쪽 12. info/warning/danger.

### Inputs / Fields
- **Style:** 채움 회색 바탕, 모서리 14, 높이 52, 좌우 16, 투명 1.5 테두리. 라벨은 위에 Sub 600 보조 회색.
- **Focus:** 바탕이 흰색으로, 테두리가 청록으로.
- **Error:** 위험색 테두리 + 아래 Sub danger-text 문구(스크린리더 알림).

### Lists / Rows
- 최소 높이 56, 위아래 12, 제목 Body + 부제 Sub 3차 회색. 눌림은 surface-pressed 바탕. 탐색 행은 20 꺾쇠(비활성 회색), 선택 행은 오른쪽 24 원형 체크.

### Badges & Pills
- 모서리 6, 안쪽 2/6, 12/16 600 글자. 출처 배지와 상태 Pill이 같은 모양을 공유한다.

### Navigation
- **하단 탭 5개:** 흰 바탕, divider 윗선, 아이콘 24(선택 시 채움형, 비선택 외곽선형), 선택 먹색 / 비선택 비활성 회색, 라벨 11/15 600.
- **스택 헤더:** 화면 바탕과 같은 색, 제목 17/600 먹색.
- **알림 종:** 우상단 48 원형 아이콘 버튼, 읽지 않은 수는 위험색 숫자 점(테두리 2, 바탕색).

### Today Timetable (Signature)
- 흰 블록 안 수업 행: 교시 열 56(Headline 700 + 시작 시각 Caption), 과목명 Body 600, 상태 Pill·강의실·출처 배지 줄. 지금/다음 수업 행 하나만 옅은 청록 바탕(14)과 청록 교시로 강조, 끝난 수업은 3차 회색.

## Do's and Don'ts

### Do:
- **Do** 새 화면을 회색 바탕 + 흰 블록(20)으로 짓고, 블록 사이는 12, 섹션 전환은 24로 띄운다.
- **Do** 입력 흐름 화면만 흰 바탕에 블록 없이 필드를 놓는다.
- **Do** 섹션 제목은 블록 안 Title로 두고, 가로 스크롤 섹션만 블록 밖에 둔다.
- **Do** 모든 정보 항목에 글자 있는 출처 배지를 붙인다.
- **Do** 주 동작은 화면당 하나의 청록 56 버튼으로, 하단에 고정한다.
- **Do** 숫자에는 tabular-nums를 쓴다.
- **Do** 미구현 기능은 "n단계 예정" Pill과 누를 수 없는 목록으로 보인다.

### Don't:
- **Don't** 블록·카드에 테두리나 그림자를 넣는다(세그먼트 썸만 예외).
- **Don't** 두 번째 강조색이나 학교 공식 색·로고를 쓴다.
- **Don't** 회색 바탕 위에 text-tertiary 글자를 쓴다.
- **Don't** 토큰에 없는 글자 크기를 새로 만든다.
- **Don't** 다크 모드 토큰을 만든다(라이트 고정).
- **Don't** 색만으로 상태나 출처를 구분한다.
