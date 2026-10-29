#!/usr/bin/env bash
# 直した版を公開して、スマホで開ける状態になるまで見届ける。
# 使い方: bash tools/publish.sh "説明"
#   1. 試験（npm test）→ 2. 未コミットがあればコミット → 3. push
#   → 4. GitHub Pages の sw.js が手元の VERSION になるまで待つ（最大5分）
# 公開できたら「スマホで開き直す」と出る。スマホ側は上に「新しい版があります」が出るので押すだけ。
set -euo pipefail
cd "$(dirname "$0")/.."
PAGES_URL="https://yashima840.github.io/SeikaPop/"
desc="${1:-更新}"

version=$(sed -n "s/^const VERSION = '\([^']*\)'.*/\1/p" sw.js)
if [ -z "$version" ]; then echo "sw.js の VERSION が読めません" >&2; exit 1; fi

npm test --silent >/dev/null || { echo "試験が通らないので公開しません（npm test で中身を見てください）" >&2; exit 1; }

if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -q -m "$desc"
fi
# アプリのファイルを直したのに VERSION が前の公開と同じだと、スマホが新しい版に気付けない（ここで「公開済み」と誤っても出る）
git fetch -q origin
before=$(git show '@{u}:sw.js' | sed -n "s/^const VERSION = '\([^']*\)'.*/\1/p")
if [ "$before" = "$version" ] && ! git diff --quiet '@{u}' HEAD -- index.html manifest.webmanifest sw.js css js img icons; then
  echo "アプリのファイルが変わっているのに VERSION が ${version} のままです。sw.js と js/version.js の VERSION を上げてから、もう一度" >&2
  exit 1
fi
git push -q origin HEAD

published=""
for _ in $(seq 1 60); do
  published=$(curl -fsS -H 'Cache-Control: no-cache' "${PAGES_URL}sw.js?t=$(date +%s)" 2>/dev/null \
    | sed -n "s/^const VERSION = '\([^']*\)'.*/\1/p" || true)
  if [ "$published" = "$version" ]; then
    echo "公開済み: ${version}（$(git log -1 --format=%h)）。スマホでアプリを開くと「新しい版があります」が出るので押す → ${PAGES_URL}"
    exit 0
  fi
  sleep 5
done
echo "5分待っても公開が ${version} になりません（今は ${published:-読めない}）。GitHub の Actions / Pages の画面を確かめてください" >&2
exit 1
