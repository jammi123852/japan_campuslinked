---
version: 1
slug: "src-app"
primary_target: "src/app"
related_targets: []
---

# Surface brief: KSU Campus app shell (Operate)

Scope: 앱 전체 1단계 화면(시작·로그인·프로필 설정·홈·하단 탭 5개·마이·알림). 방문 모드 Operate.
Audience/job: 수업 사이 이동 중 한 손으로 오늘 수업·마감·공지를 확인하는 규슈산업대 학부생.
Constraints: PRODUCT.md 참조. 개발 UI 한국어(i18n), 비공식(학교 색·로고 금지), 미구현은 미구현으로.
Quality bar (user, 2026-10-29): 에브리타임, 토스, 당근, LINE와 나란히 놓아도 완성도가 같아야 함.
Unresolved: 다크 모드(1단계 범위 밖, light 고정), 앱 아이콘.

## Direction contract

THESIS: 대학 커뮤니티 앱 카테고리 표준을 그대로, 최고 완성도로. 흰 그룹 블록 위 큰 문장 하나가 화면을 연다. 장식·은유 없음.
OWN-WORLD: 회색 바탕(#F2F4F6) 위 흰 둥근 블록(20), 테두리·그림자 없음. 강조색 하나(청록 #087A70, 흰 바탕 대비 5.2:1 확보로 #0B8A7E에서 조정, 다른 앱·학교 색과 겹치지 않게). 시스템 폰트, 굵기로 위계. 출처는 작은 글자 배지(공식=강조색, 학생=회색, 샘플=황색).
STORY: 열자마자 "오늘 수업 n개, 다음은 몇 교시 어디"를 알고, 가까운 마감 D-day를 훑고, 관련 공지와 새 질문으로 내려간다.
FIRST VIEWPORT: 상단 왼쪽 날짜 캡션 + 큰 문장(오늘 수업 수, 다음 수업). 바로 아래 흰 블록에 오늘 시간표 행(교시·시간·과목·강의실), 다음 수업 행만 강조색 바탕. 그 아래 가로 스크롤 D-day 칩. 알림 종 아이콘 우상단. 하단 탭 5개.
FORM: canon (카테고리 표준, 사용자가 결정 페이지에서 선택). seed key 983e1a8a.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
