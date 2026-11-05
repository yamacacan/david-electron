#!/usr/bin/env bash
# Derlenen kurulumu sunucunun indirme klasörüne yayınlar. Uygulamalar latest.yml'i okuyup güncellenir;
# yarım yayın görmesinler diye önce kurulum dosyası, en son latest.yml kopyalanır.
set -euo pipefail
cd "$(dirname "$0")/.."

DEST=${DEST:-../server/data/download}
OWNER=${OWNER:-www-data}
VERSION=$(node -p "require('./package.json').version")
EXE="D-Setup-$VERSION.exe"

for f in "dist/$EXE" "dist/$EXE.blockmap" dist/latest.yml; do
  [[ -f $f ]] || { echo "eksik: $f (önce npm run dist)" >&2; exit 1; }
done
grep -q "^version: $VERSION$" dist/latest.yml || { echo "dist/latest.yml $VERSION sürümüne ait değil" >&2; exit 1; }

install -m 644 -o "$OWNER" -g "$OWNER" "dist/$EXE" "dist/$EXE.blockmap" "$DEST/"
# Sabit indirme bağlantısı (/download/D-Setup.exe) her zaman son sürümü gösterir.
ln -f "$DEST/$EXE" "$DEST/.D-Setup.exe.tmp"
mv -f "$DEST/.D-Setup.exe.tmp" "$DEST/D-Setup.exe"
install -m 644 -o "$OWNER" -g "$OWNER" dist/latest.yml "$DEST/.latest.yml.tmp"
mv -f "$DEST/.latest.yml.tmp" "$DEST/latest.yml"

# Eski kurulum dosyaları silinir; .blockmap dosyaları fark güncellemesi (yalnızca değişen parçaları indirme) için kalır.
find "$DEST" -maxdepth 1 -name 'D-Setup-*.exe' ! -name "$EXE" -delete
echo "yayınlandı: $EXE ($(du -h "$DEST/$EXE" | cut -f1))"
