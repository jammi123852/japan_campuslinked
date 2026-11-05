#!/usr/bin/env bash
# KSU Campus 웹을 Vercel 에 배포하고 campuslinked.io 에 연결한다 (정적 빌드만 올림, 소스·DB·로그는 올리지 않음).
# 사용: npm run deploy:vercel            (먼저 한 번: npx vercel@65.9.0 login — 도메인을 가진 계정)
# 하는 일: ① 도메인 최상위 기준 정적 빌드(미리보기 태그 포함) ② 공개 전 검사 ③ vercel.json 추가
#          ④ 프로덕션 배포(프로젝트 없으면 생성) ⑤ campuslinked.io / www 도메인을 프로젝트에 연결 ⑥ 응답 확인
# 공유 서버 주소: /api-config.json 은 GitHub Pages 의 파일을 그대로 가져온다(npm run share 가 갱신하는 파일).
set -euo pipefail

PROJECT="${VERCEL_PROJECT:-campuslinked}"
DOMAIN="${SITE_DOMAIN:-campuslinked.io}"
VERCEL="npx --yes vercel@65.9.0"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$ROOT"

$VERCEL whoami > /dev/null 2>&1 || { echo "중단: Vercel CLI 로그인이 필요합니다 → npx vercel@65.9.0 login"; exit 1; }

echo "[1/6] 정적 웹 빌드 (도메인 최상위, https://$DOMAIN)"
KSU_WEB_DEPLOY=1 EXPO_PUBLIC_SITE_URL="https://$DOMAIN" npx expo export -p web --output-dir "$WORK/site" > "$WORK/export.log" 2>&1 || { tail -30 "$WORK/export.log"; exit 1; }
cp "$WORK/site/+not-found.html" "$WORK/site/404.html"
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
  echo "  주의: OFFICIAL_DATA_PUBLIC=1 — 공식자료를 공개 빌드에 포함합니다 (학교 재배포 허가 미확인, 검색 노출 차단)"
  # 포털(학내 전용) 공지에서 온 문장은 공개본에서 뺀다
  python3 - "$WORK/site/official/ksu-2026.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding='utf8'))
d['examNotes'] = [n for n in d['examNotes'] if '2026-10-29' not in n]
d['usage'] = 'public'
json.dump(d, open(p, 'w', encoding='utf8'), ensure_ascii=False)
PY
  if grep -q "2026-10-29 공지" "$WORK/site/official/ksu-2026.json"; then echo "  중단: 학내 공지 문장이 남아 있습니다"; exit 1; fi
fi
rm -f "$WORK/site/api-config.json"   # 아래 vercel.json 이 GitHub Pages 의 현재 값을 가져온다
# Vercel CLI 는 node_modules 라는 폴더를 업로드에서 뺀다 → 아이콘 글꼴(assets/node_modules/...)이 404 가 되므로
# 폴더 이름을 바꾸고, 원래 주소는 아래 rewrites 로 바뀐 위치를 보여 준다(빌드된 JS 는 수정하지 않음)
if [ -d "$WORK/site/assets/node_modules" ]; then mv "$WORK/site/assets/node_modules" "$WORK/site/assets/_nm"; fi
# 공식자료를 포함한 빌드는 검색 노출을 막는다 (링크로 들어오는 것만)
ROBOTS_HEADER=""
if [ "${OFFICIAL_DATA_PUBLIC:-}" = "1" ]; then ROBOTS_HEADER=$',\n    { "source": "/(.*)", "headers": [{ "key": "X-Robots-Tag", "value": "noindex, nofollow" }] }'; fi
cat > "$WORK/site/vercel.json" <<JSON
{
  "cleanUrls": true,
  "trailingSlash": false,
  "redirects": [
    { "source": "/:path(.*)", "has": [{ "type": "host", "value": "www.$DOMAIN" }], "destination": "https://$DOMAIN/:path", "permanent": true }
  ],
  "rewrites": [
    { "source": "/api-config.json", "destination": "https://jammi123852.github.io/japan_campuslinked/api-config.json" },
    { "source": "/assets/node_modules/:path(.*)", "destination": "/assets/_nm/:path" }
  ],
  "headers": [
    { "source": "/api-config.json", "headers": [{ "key": "Cache-Control", "value": "no-store" }] }$ROBOTS_HEADER
  ]
}
JSON

echo "[2/6] 공개 전 검사 (개인 경로·비밀키 흔적)"
if [ -e "$WORK/site/official/courses-2026.json" ] && [ "${OFFICIAL_DATA_PUBLIC:-}" != "1" ]; then echo "  중단: 공식 과목 데이터가 공개 빌드에 남아 있습니다"; exit 1; fi
if grep -rlE '/home/|sk-ant|service_role|eyJhbGci|ghp_|BEGIN PRIVATE|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.' "$WORK/site" > "$WORK/hits.txt"; then
  echo "  중단: 공개하면 안 되는 문자열이 빌드에 있습니다:"; cat "$WORK/hits.txt"; exit 1
fi
grep -q 'og:image' "$WORK/site/index.html" || { echo "  중단: 미리보기 태그가 빌드에 없습니다"; exit 1; }
if find "$WORK/site" -type d -name node_modules | grep -q .; then echo "  중단: 업로드에서 빠지는 node_modules 폴더가 남아 있습니다"; exit 1; fi

echo "[3/6] Vercel 프로덕션 배포 (프로젝트: $PROJECT)"
$VERCEL deploy "$WORK/site" --prod --yes --project "$PROJECT" --create-if-missing 2>&1 | tee "$WORK/deploy.log" | tail -5

echo "[4/6] 도메인 연결"
for d in "$DOMAIN" "www.$DOMAIN"; do
  $VERCEL domains add "$d" "$PROJECT" 2>&1 | tail -3 || echo "  ($d: 이미 연결됐거나 실패 — 위 메시지 확인)"
done

echo "[5/6] 응답 확인"
for i in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/" || true)"
  [ "$code" = "200" ] && break
  sleep 10
done
echo "  https://$DOMAIN/ → $code"
curl -sI "https://www.$DOMAIN/" | grep -iE '^HTTP|^location' | sed 's/^/  www: /'
curl -s "https://$DOMAIN/" | grep -o '<meta property="og:image"[^>]*>' | head -1 | sed 's/^/  /'
FONT="$(cd "$WORK/site" && find assets/_nm -name 'Ionicons*.ttf' | head -1 | sed 's#^assets/_nm#assets/node_modules#')"
[ -n "$FONT" ] && echo "  아이콘 글꼴: $(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/$FONT")"
echo "[6/6] 끝. 미리보기 캐시 초기화(카카오톡): https://developers.kakao.com/tool/debugger/sharing"
