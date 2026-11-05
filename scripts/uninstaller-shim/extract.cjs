// electron-builder, kaldırıcıyı üretmek için ara kurulumu wine ile çalıştırır.
// Aynı işi macOS'ta kullandığı UninstallerReader ile, wine olmadan yapıyoruz.
const path = require('node:path');
const { UninstallerReader } = require(path.join(__dirname, '../../node_modules/app-builder-lib/out/targets/nsis/nsisUtil.js'));

const installer = process.argv[2];
const out = path.join(path.dirname(installer), `${path.basename(installer, 'exe')}__uninstaller.exe`);
UninstallerReader.exec(installer, out).then(
  () => console.log(`kaldırıcı çıkarıldı: ${out}`),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
