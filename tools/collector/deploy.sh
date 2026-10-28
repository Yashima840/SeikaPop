#!/usr/bin/env bash
# 受け取り口（Code.gs）を上げて、番号の付いたデプロイを全部この版にする（URL は変わらない）。
# 使い方: bash tools/collector/deploy.sh "説明"
# 法人アカウントで clasp -u seikapop login 済みであること。
set -euo pipefail
cd "$(dirname "$0")"
desc="${1:-受け取り口の更新}"

clasp -u seikapop push --force
# @HEAD は上げたままの版（試し用）なので更新しない。番号の付いたもの（アプリと古いリンクが使う）だけ
ids=$(clasp -u seikapop list-deployments | grep -E '^- \S+ @[0-9]+' | awk '{print $2}')
if [ -z "$ids" ]; then
  echo "番号の付いたデプロイが見つかりません（clasp -u seikapop list-deployments で確かめてください）" >&2
  exit 1
fi
for id in $ids; do
  clasp -u seikapop update-deployment "$id" -d "$desc"
done
clasp -u seikapop list-deployments
