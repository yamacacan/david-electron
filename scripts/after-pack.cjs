// Paketlenen D.exe'ye ikon ve sürüm bilgisini gömer (wine/rcedit gerektirmez).
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const { appInfo } = context.packager;
  const exeName = fs.readdirSync(context.appOutDir).find((f) => /\.exe$/i.test(f) && !/^(elevate|uninstall)/i.test(f));
  const exePath = path.join(context.appOutDir, exeName);

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(context.packager.projectDir, 'build/icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups[0]?.id ?? 1;
  const lang = groups[0]?.lang ?? 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((i) => i.data));

  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const version = appInfo.version.split('.').map(Number);
  vi.setFileVersion(...version, 0, 1033);
  vi.setProductVersion(...version, 0, 1033);
  for (const { lang: l, codepage } of vi.getAllLanguagesForStringValues()) {
    vi.setStringValues(
      { lang: l, codepage },
      {
        FileDescription: 'D.',
        ProductName: 'D.',
        CompanyName: 'D.',
        LegalCopyright: `© ${new Date().getFullYear()} D.`,
        OriginalFilename: exeName,
        InternalName: 'D',
        FileVersion: appInfo.version,
        ProductVersion: appInfo.version,
      },
    );
  }
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • ${exeName}: ikon ve sürüm bilgisi gömüldü`);
};
