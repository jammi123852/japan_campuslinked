#!/usr/bin/env bash
# 공유 서버를 새 코드로 다시 켠다: 데모 콘텐츠를 넣고(실제 데이터 유지, 자동 백업) 서버+터널 시작.
# 사용: 기존 share 창에서 Ctrl+C 후 npm run share:update
# 옛 서버는 데모 후기를 실제 후기와 구분하지 못하므로, 켜져 있으면 넣지 않고 멈춘다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PORT="${PORT:-8787}"
if curl -fsS -m 3 "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1; then
  echo "중단: 공유 서버가 아직 켜져 있습니다. 그 창에서 Ctrl+C 로 끈 뒤 다시 실행하세요."
  exit 1
fi
node --disable-warning=ExperimentalWarning scripts/seed-demo.ts --db server/data/ksu-campus.sqlite --allow-shared 2>&1 | grep -E '백업|새로 넣음|실제 데이터'
exec bash scripts/start-share.sh
