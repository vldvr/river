#!/bin/bash
# Два релизных zip одной архитектуры. Патч публикуем только после пробной установки.
set -euo pipefail
old_zip=$1
new_zip=$2
output=$3
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

ditto -x -k "$old_zip" "$work/base"
ditto -x -k "$new_zip" "$work/next"
base="$work/base/River.app/"
next="$work/next/River.app/"
# -c сравнивает содержимое, даже если у двух файлов совпали размер и дата.
# --no-whole-file включает поиск совпадающих блоков при локальной сборке патча.
/usr/bin/rsync -rlptc --delete --no-whole-file --only-write-batch="$work/batch" "$next" "$base"
/usr/bin/rsync -rlptc --delete --read-batch="$work/batch" "$base"
codesign --verify --deep --strict "$base"
# Проверяем также имена, права и символьные ссылки в восстановленном приложении.
/usr/sbin/mtree -c -k type,mode,link,sha256digest -p "$next" > "$work/tree"
/usr/sbin/mtree -f "$work/tree" -p "$base"
gzip -c "$work/batch" > "$work/patch.gz"
if (( $(stat -f %z "$work/patch.gz") < $(stat -f %z "$new_zip") )); then
  mv "$work/patch.gz" "$output"
fi
