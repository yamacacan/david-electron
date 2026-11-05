// D. masaüstü kabuğu: arayüzü sunucudan yükler; ekran paylaşımı, izinler, tepsi, kısayollar ve otomatik güncellemeyi yönetir.
const { app, BrowserWindow, Menu, Tray, desktopCapturer, globalShortcut, ipcMain, nativeImage, powerMonitor, session, shell } = require('electron');
const { cleanShortcuts } = require('./shortcuts');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const STATE_FILE = path.join(app.getPath('userData'), 'window.json');
const LOG_FILE = path.join(app.getPath('userData'), 'update.log');
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
};
const writeConfig = (patch) => fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...readJson(CONFIG_FILE), ...patch }));

const SERVER = process.env.D_SERVER || readJson(CONFIG_FILE).server || 'https://david.acysoft.com.tr';
const ORIGIN = new URL(SERVER).origin;
const ALLOWED = new Set(['media', 'display-capture', 'notifications', 'fullscreen', 'clipboard-sanitized-write', 'clipboard-read', 'speaker-selection']);
const UPDATE_EVERY = 4 * 3600e3;

app.setAppUserModelId('tr.com.acysoft.d');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');
app.commandLine.appendSwitch('force-fieldtrials', 'WebRTC-Audio-Red-For-Opus/Enabled/');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win = null;
let splash = null;
let tray = null;
let quitting = false;
let retryTimer = null;
let sources = new Map();
let pendingShare = null;

const iconPath = path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

function createWindow() {
  const st = readJson(STATE_FILE);
  win = new BrowserWindow({
    width: st.width || 1280,
    height: st.height || 800,
    x: st.x,
    y: st.y,
    minWidth: 940,
    minHeight: 560,
    show: false,
    title: 'D.',
    icon: iconPath,
    backgroundColor: '#0e0f13',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0e0f13', symbolColor: '#b4b3c4', height: 32 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => {
    if (st.maximized) win.maximize();
    win.show();
    closeSplash();
  });
  win.on('focus', () => win.flashFrame(false));

  win.on('close', (e) => {
    saveWindowState();
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!readJson(CONFIG_FILE).trayHintShown && tray && process.platform === 'win32') {
      tray.displayBalloon({ iconType: 'info', title: 'D. arka planda çalışıyor', content: 'Sesli sohbet ve bildirimler devam ediyor. Kapatmak için tepsideki simgeye sağ tıkla.' });
      writeConfig({ trayHintShown: true });
    }
  });

  const wc = win.webContents;
  wc.on('will-navigate', (e, url) => {
    if (url.startsWith('file:') || new URL(url).origin === ORIGIN) return;
    e.preventDefault();
    shell.openExternal(url);
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (!isMain || code === -3 || url.startsWith('file:')) return;
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { server: SERVER } });
    clearTimeout(retryTimer);
    retryTimer = setTimeout(load, 5000);
  });
  wc.on('context-menu', (_e, p) => {
    const items = [];
    if (p.mediaType === 'image' && p.srcURL) {
      items.push({ label: 'Resmi kopyala', click: () => wc.copyImageAt(p.x, p.y) });
      items.push({ label: 'Resmi kaydet…', click: () => wc.downloadURL(p.srcURL) });
    }
    if (p.linkURL && /^https?:/.test(p.linkURL)) items.push({ label: 'Bağlantıyı kopyala', click: () => require('electron').clipboard.writeText(p.linkURL) });
    if (p.isEditable) {
      items.push({ role: 'cut', label: 'Kes' }, { role: 'copy', label: 'Kopyala' }, { role: 'paste', label: 'Yapıştır' }, { type: 'separator' }, { role: 'selectAll', label: 'Tümünü seç' });
    } else if (p.selectionText) {
      items.push({ role: 'copy', label: 'Kopyala' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
  wc.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && input.control && input.shift) wc.toggleDevTools();
  });

  load();
}

function load() {
  clearTimeout(retryTimer);
  win.loadURL(SERVER);
}

function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds();
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...b, maximized: win.isMaximized() }));
}

function showWindow() {
  if (!win) {
    splash?.focus();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------------------------------------------------------------- otomatik güncelleme

// Kurulum dosyası ve latest.yml sunucunun /download/ klasöründen alınır (electron-updater, NSIS).
const update = { state: 'idle', version: null, percent: 0, transferred: 0, total: 0, current: app.getVersion() };
let startupWaiter = null;
let trayKey = '';
let updaterReady = false;

const updatesEnabled = () => updaterReady;

function log(level, ...args) {
  try {
    if (fs.statSync(LOG_FILE, { throwIfNoEntry: false })?.size > 512 * 1024) fs.writeFileSync(LOG_FILE, '');
    const text = args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${level} ${text}\n`);
  } catch {}
}

function setupUpdater() {
  // Yalnızca kurulu Windows sürümü güncellenir (geliştirme ortamında ve D_NO_UPDATE ile kapalı).
  if (!app.isPackaged || process.platform !== 'win32' || process.env.D_NO_UPDATE) return;
  autoUpdater.logger = { info: (m) => log('info', m), warn: (m) => log('warn', m), error: (m) => log('error', m), debug: () => {} };
  try {
    // Sunucu çoklu aralık (multipart range) desteklemiyor; fark güncellemesi tekli aralık istekleriyle yapılır.
    autoUpdater.setFeedURL({ provider: 'generic', url: `${SERVER}/download/`, useMultipleRangeRequest: false });
  } catch (err) {
    log('error', err);
    return;
  }
  updaterReady = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => setUpdate({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => setUpdate({ state: 'latest', version: null, percent: 0 }));
  autoUpdater.on('update-available', (info) => setUpdate({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => setUpdate({ state: 'downloading', percent: Math.floor(p.percent), transferred: p.transferred, total: p.total }));
  autoUpdater.on('update-downloaded', (info) => {
    setUpdate({ state: 'ready', version: info.version, percent: 100 });
    if (!startupWaiter) {
      tray?.displayBalloon({ iconType: 'info', title: 'D. güncellemesi hazır', content: `${info.version} indirildi. Uygulamadaki Güncelle düğmesiyle ya da tepsi menüsünden yükleyebilirsin; D.'den çıkınca da kendiliğinden yüklenir.` });
    }
  });
  autoUpdater.on('error', (err) => {
    log('error', err);
    if (update.state !== 'ready') setUpdate({ state: 'error' });
  });
}

function setUpdate(patch) {
  Object.assign(update, patch);
  const snapshot = { ...update };
  if (win && !win.isDestroyed()) win.webContents.send('d:update', snapshot);
  pushSplash();
  if (startupWaiter) {
    if (snapshot.state === 'ready') startupWaiter('install');
    else if (snapshot.state === 'latest' || snapshot.state === 'error') startupWaiter('continue');
  }
  // İndirme ilerlemesi sık gelir; tepsi menüsü yalnızca görünen metin değişince yeniden kurulur.
  const key = `${snapshot.state}:${snapshot.state === 'downloading' ? Math.floor(snapshot.percent / 5) : ''}`;
  if (key !== trayKey) {
    trayKey = key;
    refreshTray();
  }
}

function checkForUpdates(manual = false) {
  if (!updatesEnabled() || ['checking', 'downloading', 'ready'].includes(update.state)) return Promise.resolve({ ...update });
  setUpdate({ state: 'checking' });
  return autoUpdater
    .checkForUpdates()
    .catch((err) => {
      log('error', err);
      setUpdate({ state: 'error' });
    })
    .then(() => {
      if (manual && update.state === 'latest') tray?.displayBalloon({ iconType: 'info', title: 'D. güncel', content: `${app.getVersion()} en son sürüm.` });
      if (manual && update.state === 'error') tray?.displayBalloon({ iconType: 'warning', title: 'Güncelleme denetlenemedi', content: 'Sunucuya ulaşılamadı. Daha sonra tekrar denenecek.' });
      return { ...update };
    });
}

function installUpdate() {
  if (update.state !== 'ready') return;
  log('info', `${update.version} yükleniyor`);
  quitting = true;
  saveWindowState();
  // Sessiz kurulum; kurulum bitince uygulama kendiliğinden yeniden açılır.
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
}

// Discord gibi: açılışta küçük pencerede güncelleme denetlenir. Yeni sürüm varsa indirilir, kurulur ve
// uygulama yeni sürümle yeniden başlar (o durumda bu fonksiyon bitmeden uygulama kapanır).
async function startupUpdate() {
  if (!updatesEnabled()) return;
  createSplash();
  const result = await new Promise((resolve) => {
    startupWaiter = resolve;
    // Sunucu yanıt vermezse açılış bekletilmez; indirme sürüyorsa bekleme devam eder (atlanabilir).
    setTimeout(() => ['idle', 'checking'].includes(update.state) && resolve('continue'), 10_000);
    checkForUpdates();
  });
  startupWaiter = null;
  if (result === 'install') {
    // Kurulum başarısız olup aynı sürüm tekrar gelirse açılış döngüye girmesin.
    const last = readJson(CONFIG_FILE).lastInstallAttempt;
    if (last?.version === update.version && Date.now() - last.at < 15 * 60e3) {
      log('warn', `${update.version} kurulumu az önce denendi; açılışta tekrar denenmiyor`);
    } else {
      writeConfig({ lastInstallAttempt: { version: update.version, at: Date.now() } });
      installUpdate();
      // Kurulum başlatılabildiyse uygulama bu sürede kapanır; başlatılamadıysa mevcut sürümle açılış sürer.
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      log('warn', `${update.version} kurulumu başlamadı; mevcut sürümle açılıyor`);
      quitting = false;
    }
  }
  pushSplash();
}

function createSplash() {
  splash = new BrowserWindow({
    width: 320,
    height: 360,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    title: 'D.',
    icon: iconPath,
    backgroundColor: '#14151b',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  splash.once('ready-to-show', () => splash?.show());
  splash.webContents.on('did-finish-load', pushSplash);
  splash.webContents.on('did-navigate-in-page', (_e, url) => url.endsWith('#skip') && startupWaiter?.('continue'));
  splash.on('closed', () => (splash = null));
}

function pushSplash() {
  if (!splash || splash.isDestroyed() || splash.webContents.isLoading()) return;
  // Denetim sürerken ya da güncelleme kurulurken gerçek durum, sonra ana arayüz yüklenene kadar "Başlatılıyor" gösterilir.
  const state = startupWaiter || (quitting && update.state === 'ready') ? update : { ...update, state: 'starting' };
  splash.webContents.executeJavaScript(`setStatus(${JSON.stringify(state)})`).catch(() => {});
}

function closeSplash() {
  if (splash && !splash.isDestroyed()) splash.destroy();
  splash = null;
}

// ---------------------------------------------------------------- oturum, IPC, tepsi

function setupSession() {
  const ses = session.defaultSession;
  const sameOrigin = (url) => {
    try {
      return new URL(url).origin === ORIGIN;
    } catch {
      return false;
    }
  };
  ses.setPermissionRequestHandler((wc, permission, cb, details) => cb(ALLOWED.has(permission) && sameOrigin(details.requestingUrl || wc.getURL())));
  ses.setPermissionCheckHandler((_wc, permission, origin) => ALLOWED.has(permission) && sameOrigin(origin));

  // Arayüz kendi kaynak seçicisini gösterir; burada seçilen kaynak getDisplayMedia isteğine verilir.
  // Windows'ta "loopback" sistem sesini de yakalar.
  ses.setDisplayMediaRequestHandler((_req, callback) => {
    const sel = pendingShare;
    pendingShare = null;
    const src = sel && sources.get(sel.id);
    if (!src) return callback({});
    callback({ video: src, audio: sel.audio && process.platform === 'win32' ? 'loopback' : undefined });
  });
}

function setupIpc() {
  ipcMain.on('d:version', (e) => (e.returnValue = app.getVersion()));
  ipcMain.handle('d:sources', async () => {
    const list = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
    sources = new Map(list.map((s) => [s.id, s]));
    return list
      .filter((s) => s.name !== 'D.')
      .map((s) => ({
        id: s.id,
        name: s.name,
        type: s.id.startsWith('screen:') ? 'screen' : 'window',
        thumbnail: s.thumbnail.toDataURL(),
        icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
      }));
  });
  ipcMain.handle('d:select-source', (_e, id, audio) => {
    pendingShare = { id: String(id), audio: !!audio };
  });
  ipcMain.on('d:flash', () => win && !win.isFocused() && win.flashFrame(true));
  ipcMain.on('d:focus', showWindow);
  ipcMain.on('d:unread', (_e, n) => {
    tray?.setToolTip(n ? `D. — ${n} okunmamış kanal` : 'D.');
    if (process.platform === 'darwin') app.dock?.setBadge(n ? String(n) : '');
  });
  ipcMain.handle('d:update-state', () => ({ ...update }));
  ipcMain.handle('d:update-check', () => checkForUpdates());
  ipcMain.on('d:update-install', installUpdate);
  // Her yerde çalışan kısayollar arayüzden gelir (Ayarlar → Tuş atamaları). Tutmayanların adları geri döner.
  ipcMain.handle('d:shortcuts', (_e, map) => {
    globalShortcut.unregisterAll();
    const failed = [];
    for (const [name, accel] of cleanShortcuts(map)) {
      let ok = false;
      try {
        ok = globalShortcut.register(accel, () => win?.webContents.send('d:shortcut', name));
      } catch {}
      if (!ok) failed.push(name);
    }
    return failed;
  });
}

function refreshTray() {
  if (!tray) return;
  const updateItem = {
    ready: { label: `Güncellemeyi yükle ve yeniden başlat (${update.version})`, click: installUpdate },
    downloading: { label: `Güncelleme indiriliyor… %${update.percent}`, enabled: false },
    checking: { label: 'Güncellemeler denetleniyor…', enabled: false },
  }[update.state] || { label: 'Güncellemeleri denetle', click: () => checkForUpdates(true) };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "D.'yi aç", click: showWindow },
      { type: 'separator' },
      { label: 'Mikrofonu aç/kapat', click: () => win?.webContents.send('d:shortcut', 'toggle-mute') },
      { label: 'Sağırlaştır', click: () => win?.webContents.send('d:shortcut', 'toggle-deafen') },
      { type: 'separator' },
      ...(updatesEnabled() ? [updateItem] : []),
      { label: `Sürüm ${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      {
        label: 'Çıkış',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function setupTray() {
  const img = nativeImage.createFromPath(iconPath);
  tray = new Tray(img.isEmpty() ? img : img.resize({ width: 16, height: 16 }));
  tray.setToolTip('D.');
  refreshTray();
  tray.on('click', showWindow);
}

app.on('second-instance', showWindow);
app.on('before-quit', () => {
  quitting = true;
  saveWindowState();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('activate', showWindow);

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  setupSession();
  setupIpc();
  setupUpdater();
  try {
    await startupUpdate();
  } catch (err) {
    // Güncelleme denetimi hiçbir durumda uygulamanın açılmasını engellemez.
    log('error', err);
  }
  createWindow();
  setupTray();
  if (updatesEnabled()) {
    setInterval(() => checkForUpdates(), UPDATE_EVERY);
    powerMonitor.on('resume', () => checkForUpdates());
  }
});
