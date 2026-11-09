#!/usr/bin/env bash
# 공개 데모를 GitHub Pages 로 배포한다: 서버·AI 키 없이 브라우저에서만 동작하는 정적 빌드.
# 사용: bash scripts/deploy-demo-pages.sh              빌드 + 검사 + gh-pages 갱신 + Pages 켜기
#       BUILD_ONLY=1 OUT=<폴더> bash scripts/deploy-demo-pages.sh   빌드·검사만 (배포 안 함)
# 저장소: ${DEMO_REPO:-jammi123852/japan_campuslinked} → https://<owner>.github.io/<repo>/
# 들어가는 학교 자료는 scripts/build-demo-data.mjs 가 만든 가상 자료와 공개 최소본(학교 구조·공식 링크)뿐이다.
set -euo pipefail

REPO="${DEMO_REPO:-jammi123852/japan_campuslinked}"
NAME="${REPO#*/}"
OWNER="${REPO%%/*}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
OUT="${OUT:-$WORK/site}"
cd "$ROOT"

echo "[1/4] 정적 빌드 (공개 데모, baseUrl=/$NAME)"
rm -rf "$OUT"
EXPO_PUBLIC_STATIC_DEMO=1 EXPO_PUBLIC_API_URL= KSU_WEB_DEPLOY=1 KSU_WEB_BASE_URL="/$NAME" EXPO_PUBLIC_SITE_URL= \
  npx expo export -p web --output-dir "$OUT" > "$WORK/export.log" 2>&1 || { tail -30 "$WORK/export.log"; exit 1; }
cp "$OUT/+not-found.html" "$OUT/404.html"
touch "$OUT/.nojekyll"

echo "[2/4] 학교 자료 → 가상 자료로 교체"
rm -rf "$OUT/official"
node scripts/build-demo-data.mjs "$OUT"
echo '{"apiUrl":null}' > "$OUT/api-config.json"

echo "[3/4] 공개 전 검사"
# 실제 공식자료·실제 학생 기록이 섞이지 않았는지 (가상 자료 표식 확인)
for f in ksu-2026.json courses-2026.json showcase.json; do
  grep -q '"DEMO"\|가상\|デモ' "$OUT/official/$f" || { echo "  중단: $f 가 가상 자료가 아닙니다"; exit 1; }
done
[ ! -e "$OUT/official/ops-2026.json" ] && [ ! -d "$OUT/official/syl" ] && [ "$(cat "$OUT/official/ko-2026.json")" = '{"map":{}}' ] && [ ! -e "$OUT/official/campus-map.jpg" ] || { echo "  중단: 실제 공식자료 파일이 남아 있습니다"; exit 1; }
if grep -rlE '/home/[a-z]|/mnt/[c]/|sk-ant-[A-Za-z0-9]{8}|service_role|ghp_[A-Za-z0-9]{20}|-----BEGIN [A-Z ]*PRIVATE KEY|trycloudflare|127\.0\.0\.1:87|192\.168\.[0-9]' "$OUT" > "$WORK/hits.txt"; then
  echo "  중단: 공개하면 안 되는 문자열:"; cat "$WORK/hits.txt"; exit 1
fi
grep -rq 'demo://browser' "$OUT/_expo" || { echo "  중단: 공개 데모 플래그가 빌드에 없습니다"; exit 1; }
echo "  통과: $(find "$OUT" -type f | wc -l)개 파일, $(du -sh "$OUT" | cut -f1)"

if [ "${BUILD_ONLY:-0}" = 1 ]; then echo "[4/4] BUILD_ONLY — 배포 안 함 ($OUT)"; exit 0; fi

echo "[4/4] gh-pages 갱신 → https://$OWNER.github.io/$NAME/"
cd "$OUT"
git init -q -b gh-pages
git add -A
git -c user.name="$OWNER" -c user.email="$(gh api "users/$OWNER" --jq '"\(.id)+\(.login)@users.noreply.github.com"')" commit -q -m "공개 데모 빌드 $(date +%F)"
git push -q -f "https://github.com/$REPO.git" gh-pages
cd "$ROOT"
gh api "repos/$REPO/pages" > /dev/null 2>&1 || gh api -X POST "repos/$REPO/pages" -f 'source[branch]=gh-pages' -f 'source[path]=/' > /dev/null
for i in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "https://$OWNER.github.io/$NAME/")"
  [ "$code" = 200 ] && break
  sleep 10
done
echo "  https://$OWNER.github.io/$NAME/ → $code"
