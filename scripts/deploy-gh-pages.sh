#!/usr/bin/env bash
# KSU Campus 발표용 웹을 GitHub Pages 에 배포한다 (정적 빌드만 공개, 소스는 올리지 않음).
# 사용: bash scripts/deploy-gh-pages.sh [저장소이름]   (기본: ksu-campus-demo)
# 필요: gh CLI 로그인(gh auth status). 공개 저장소 + Pages 는 무료이며 결제 수단이 필요 없다.
# 하는 일: ① 정적 웹 빌드 ② 공개 저장소가 없으면 생성 ③ gh-pages 브랜치 강제 갱신 ④ Pages 설정 ⑤ 공개 주소 응답 확인
set -euo pipefail

REPO_NAME="${1:-ksu-campus-demo}"
OWNER="$(gh api user --jq .login)"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "[1/5] 정적 웹 빌드 (baseUrl=/$REPO_NAME)"
cd "$ROOT"
if [ -f .env ] && grep -qE '^EXPO_PUBLIC_SUPABASE_(URL|PUBLISHABLE_KEY)=.+' .env; then
  echo "  주의: .env 에 Supabase 값이 있어 빌드에 포함됩니다(publishable 키만 허용). 데모 전용 배포라면 .env 를 치우고 다시 실행하세요."
fi
KSU_WEB_DEPLOY=1 KSU_WEB_BASE_URL="/$REPO_NAME" npx expo export -p web --output-dir "$WORK/site" > "$WORK/export.log" 2>&1 || { tail -30 "$WORK/export.log"; exit 1; }
cp "$WORK/site/+not-found.html" "$WORK/site/404.html"   # 없는 주소용 (Pages 는 404.html 을 보여 준다)
# 공식자료는 재배포 허가 미확인 → 공개 빌드에서 기본 제외 (OFFICIAL_DATA_PUBLIC=1 일 때만 포함)
if [ "${OFFICIAL_DATA_PUBLIC:-}" != "1" ]; then
  # 공개 최소본(학교 구조·공식 링크)만 남기고 과목·교원·시라버스·공지 데이터는 뺀다
  MIN="$WORK/public-min.json"
  [ -f "$WORK/site/official/public-min.json" ] && cp "$WORK/site/official/public-min.json" "$MIN"
  rm -rf "$WORK/site/official"
  [ ! -e "$WORK/site/official" ] || { echo "  중단: official/ 제거 실패"; exit 1; }
  if [ -f "$MIN" ]; then mkdir -p "$WORK/site/official"; cp "$MIN" "$WORK/site/official/public-min.json"; fi
  echo "  공식자료 제외, 공개 최소본만 포함 (전체 포함은 OFFICIAL_DATA_PUBLIC=1 — 학교 허가 확인 전 사용 금지)"
else
  echo "  주의: OFFICIAL_DATA_PUBLIC=1 — 공식자료를 공개 빌드에 포함합니다"
fi
touch "$WORK/site/.nojekyll"                             # _expo 폴더가 무시되지 않게
# 공유 서버 주소(api-config.json)는 npm run share 가 따로 갱신하므로, 배포 때 현재 값을 그대로 유지한다
if gh api "repos/$(gh api user --jq .login)/$REPO_NAME/contents/api-config.json?ref=gh-pages" --jq .content 2>/dev/null | base64 -d > "$WORK/site/api-config.json" 2>/dev/null && [ -s "$WORK/site/api-config.json" ]; then
  echo "  기존 api-config.json 유지: $(cat "$WORK/site/api-config.json")"
else
  echo '{"apiUrl":null}' > "$WORK/site/api-config.json"
fi

echo "[2/5] 공개 전 검사 (개인 경로·비밀키 흔적)"
if [ -e "$WORK/site/official/courses-2026.json" ] && [ "${OFFICIAL_DATA_PUBLIC:-}" != "1" ]; then echo "  중단: 공식 과목 데이터가 공개 빌드에 남아 있습니다"; exit 1; fi
if grep -rlE '/home/|sk-ant|service_role|eyJhbGci|ghp_|BEGIN PRIVATE|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.' "$WORK/site" > "$WORK/hits.txt"; then
  echo "  중단: 공개하면 안 되는 문자열이 빌드에 있습니다:"; cat "$WORK/hits.txt"; exit 1
fi

echo "[3/5] 저장소 $OWNER/$REPO_NAME"
if ! gh repo view "$OWNER/$REPO_NAME" > /dev/null 2>&1; then
  gh repo create "$OWNER/$REPO_NAME" --public --description "KSU Campus 발표용 데모 웹 (정적 빌드, 가상 샘플 데이터)"
fi

echo "[4/5] gh-pages 브랜치 업로드"
cd "$WORK/site"
git init -q -b gh-pages
git -c user.name="$OWNER" -c user.email="$OWNER@users.noreply.github.com" add -A
git -c user.name="$OWNER" -c user.email="$OWNER@users.noreply.github.com" commit -q -m "Deploy KSU Campus demo web (static export)"
git -c credential.helper= -c credential.helper='!gh auth git-credential' push -q -f "https://github.com/$OWNER/$REPO_NAME.git" gh-pages

echo "[5/5] Pages 설정"
if ! gh api "repos/$OWNER/$REPO_NAME/pages" > /dev/null 2>&1; then
  gh api -X POST "repos/$OWNER/$REPO_NAME/pages" -f "source[branch]=gh-pages" -f "source[path]=/" > /dev/null
fi
URL="https://$(echo "$OWNER" | tr '[:upper:]' '[:lower:]').github.io/$REPO_NAME/"
echo "  공개 주소: $URL"
for i in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)"
  if [ "$code" = "200" ]; then echo "  응답 200 확인 (첫 배포는 수 분 걸릴 수 있음)"; exit 0; fi
  sleep 10
done
echo "  아직 응답이 200이 아닙니다(마지막: $code). 몇 분 뒤 다시 열어 보세요. 상태: gh api repos/$OWNER/$REPO_NAME/pages"
