// Arayüzün istediği global kısayolların denetimi. Arayüz sunucudan yüklendiği için ana süreç ona körü körüne güvenmez:
// yalnızca bilinen eylemler kabul edilir ve yazı tuşları Ctrl ya da Alt olmadan atanamaz; yani global kısayollar
// yazılanları yakalamak için kullanılamaz.
const ACTIONS = new Set(['toggle-mute', 'toggle-deafen', 'toggle-camera', 'toggle-screen', 'leave-voice', 'music-toggle', 'music-skip']);
const MODIFIERS = new Set(['CommandOrControl', 'Alt', 'Shift']);
const BARE = /^(F([1-9]|1\d|2[0-4])|Media\w+|Volume\w+|Insert|Scrolllock|PrintScreen)$/;

function safeAccelerator(accel) {
  if (typeof accel !== 'string' || accel.length > 60) return false;
  const parts = accel.split('+');
  const key = parts.pop();
  if (!key || !parts.every((m) => MODIFIERS.has(m))) return false;
  return parts.includes('CommandOrControl') || parts.includes('Alt') || BARE.test(key);
}

// { eylem: hızlandırıcı } içinden kabul edilenler: [[eylem, hızlandırıcı], …]
function cleanShortcuts(map) {
  return Object.entries(map && typeof map === 'object' ? map : {}).filter(([name, accel]) => ACTIONS.has(name) && safeAccelerator(accel));
}

module.exports = { cleanShortcuts, safeAccelerator };
