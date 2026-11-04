#!/usr/bin/env bash
# 발표용 공유 서버(게시글·댓글) + HTTPS 터널을 같은 WSL 안에서 켠다.
# 사용: npm run share        (끄기: Ctrl+C — 서버와 터널을 같이 종료)
#
# 1) server/index.ts 를 127.0.0.1:8787 에서 실행 (DB: server/data/ksu-campus.sqlite)
# 2) Cloudflare Quick Tunnel 로 https://<무작위>.trycloudflare.com 주소 생성 (계정 불필요)
#    - Cloudflare 문서: 테스트·개발용, 가동 보장 없음, 실행할 때마다 주소가 바뀜
#    - DB 파일이나 PC 의 다른 포트는 공개하지 않는다. 8787 의 API 만 연결된다.
# 3) 공개 웹(GitHub Pages)의 api-config.json 만 새 주소로 갱신 (웹 재빌드 없음, 1~2분 후 반영)
#
# PC 가 꺼지거나 절전·인터넷 끊김이면 게시판 공유가 멈춘다. 다시 이 명령을 실행하면 된다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PORT="${PORT:-8787}"
REPO="${PAGES_REPO:-ksu-campus-demo}"
OWNER="$(gh api user --jq .login)"
PAGES_ORIGIN="https://$(echo "$OWNER" | tr '[:upper:]' '[:lower:]').github.io"
mkdir -p logs .tools
STAMP="$(date +%Y%m%d_%H%M%S)"
SERVER_LOG="logs/share_server_$STAMP.log"
TUNNEL_LOG="logs/share_tunnel_$STAMP.log"

# ---------------------------------------------------------------- cloudflared 준비 (공식 GitHub 릴리스)
CLOUDFLARED="$(command -v cloudflared || true)"
if [ -z "$CLOUDFLARED" ]; then
  CLOUDFLARED="$ROOT/.tools/cloudflared"
  if [ ! -x "$CLOUDFLARED" ]; then
    echo "[준비] cloudflared 내려받는 중 (github.com/cloudflare/cloudflared 공식 릴리스)"
    curl -fsSL -o "$CLOUDFLARED" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
    chmod +x "$CLOUDFLARED"
  fi
fi

cleanup() {
  echo; echo "[종료] 서버와 터널을 끕니다"
  [ -n "${TUNNEL_PID:-}" ] && kill "$TUNNEL_PID" 2>/dev/null || true
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------- 1. API 서버
echo "[1/3] 공유 서버 시작 (127.0.0.1:$PORT)"
ALLOWED_ORIGINS="$PAGES_ORIGIN,https://campuslinked.io,http://localhost:8081,http://localhost:8090" PORT="$PORT" \
  node --disable-warning=ExperimentalWarning --env-file-if-exists=server/.env server/index.ts > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
for i in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1 && break
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "서버 시작 실패:"; tail -20 "$SERVER_LOG"; exit 1; }
  sleep 0.5
done
echo "  상태 확인 OK (로그: $SERVER_LOG)"

# ---------------------------------------------------------------- 2. 터널
echo "[2/3] HTTPS 터널 시작 (Cloudflare Quick Tunnel)"
"$CLOUDFLARED" tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" > "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!
URL=""
for i in $(seq 1 60); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1 || true)"
  [ -n "$URL" ] && break
  kill -0 "$TUNNEL_PID" 2>/dev/null || { echo "터널 시작 실패:"; tail -20 "$TUNNEL_LOG"; exit 1; }
  sleep 1
done
[ -n "$URL" ] || { echo "터널 주소를 얻지 못했습니다:"; tail -20 "$TUNNEL_LOG"; exit 1; }
echo "  터널 주소: $URL"
for i in $(seq 1 30); do
  curl -fsS "$URL/api/health" > /dev/null 2>&1 && { echo "  터널 경유 상태 확인 OK"; break; }
  sleep 2
done

# ---------------------------------------------------------------- 3. 공개 웹 설정 갱신
echo "[3/3] 공개 웹의 api-config.json 갱신 ($OWNER/$REPO, gh-pages)"
CONTENT="$(printf '{"apiUrl":"%s"}\n' "$URL" | base64 -w0)"
SHA="$(gh api "repos/$OWNER/$REPO/contents/api-config.json?ref=gh-pages" --jq .sha 2>/dev/null || true)"
if [ -n "$SHA" ]; then
  gh api -X PUT "repos/$OWNER/$REPO/contents/api-config.json" -f message="Update shared API URL" -f content="$CONTENT" -f branch=gh-pages -f sha="$SHA" > /dev/null
else
  gh api -X PUT "repos/$OWNER/$REPO/contents/api-config.json" -f message="Set shared API URL" -f content="$CONTENT" -f branch=gh-pages > /dev/null
fi
echo "  완료. GitHub Pages 반영까지 1~2분 걸릴 수 있습니다."
echo
echo "공개 웹: $PAGES_ORIGIN/$REPO/"
echo "공유 API: $URL"
echo "이 창을 열어 두세요. Ctrl+C 로 서버와 터널을 함께 끕니다."
wait "$TUNNEL_PID"
