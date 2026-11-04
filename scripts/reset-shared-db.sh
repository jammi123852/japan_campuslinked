#!/usr/bin/env bash
# 개발용: 발표용 공유 서버 DB(게시글·댓글·후기·데모 세션)를 처음 상태로 되돌린다. 일반 사용자 화면과 분리된 절차다.
# 지우지 않고 server/data/backup-<시각>/ 으로 옮긴다. 다음 서버 시작 때 예시 글 3개만 있는 새 DB 가 만들어진다.
# 사용: 공유 서버를 끈 뒤  bash scripts/reset-shared-db.sh --yes
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${DB_PATH:-$ROOT/server/data/ksu-campus.sqlite}"
if [ "${1:-}" != "--yes" ]; then
  echo "공유 DB 를 백업 폴더로 옮겨 초기화합니다: $DB"
  echo "모든 사용자의 공유 글·댓글·후기가 화면에서 사라집니다(백업은 남음). 계속하려면 --yes 를 붙여 다시 실행하세요."
  exit 1
fi
if ss -ltn 2>/dev/null | grep -q ":${PORT:-8787} "; then
  echo "중단: 포트 ${PORT:-8787} 에서 공유 서버가 실행 중입니다. 서버를 먼저 끄세요."; exit 1
fi
if [ ! -f "$DB" ]; then echo "DB 파일이 없습니다: $DB (이미 초기 상태)"; exit 0; fi
BK="$(dirname "$DB")/backup-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BK"
for f in "$DB" "$DB-wal" "$DB-shm"; do [ -f "$f" ] && mv "$f" "$BK/"; done
echo "백업으로 이동 완료: $BK"
