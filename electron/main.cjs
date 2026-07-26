// Electron main process. Owns the app window and, in production, the Express
// server subprocess. In dev we assume `npm run dev` is already running Vite
// (5173) + the Express server (3001) — Electron just points at Vite.
const { app, BrowserWindow, shell, dialog, Menu } = require('electron');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const http = require('http');

const isDev = !app.isPackaged;
const PORT = 3001;
const DEV_URL = 'http://localhost:5173';
const PROD_URL = `http://localhost:${PORT}`;

// Portable mode: electron-builder-i portable seton PORTABLE_EXECUTABLE_DIR te
// direktoria ku ndodhet .exe-ja në USB. Ruajmë userData (sesion, cache, logs)
// pranë saj që sesioni të vijë me USB-në dhe të mos lërë gjurmë në PC.
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
if (portableDir) {
  const newDir = path.join(portableDir, 'ChamShop-Data');
  const oldDir = path.join(portableDir, 'AriShop-Data');
  // Migration nga emri i vjetër Ari Shop → Cham Shop (rebrand). Nëse ekziston
  // folder-i i vjetër dhe i riu jo, riemërtoje që të ruhen DB + settings.
  try {
    if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
      fs.renameSync(oldDir, newDir);
    }
  } catch (_) {}
  try { fs.mkdirSync(newDir, { recursive: true }); } catch (_) {}
  app.setPath('userData', newDir);
  app.setPath('sessionData', newDir);
}

// Installed mode (Windows/Mac/Linux): electron përdor productName si emër
// folder-i te %APPDATA% / ~/Library / ~/.config. Meqë e ndryshuam nga
// "Ari Shop" → "Cham Shop", migro folder-in që user-i të mos humbë DB-në.
if (!portableDir) {
  try {
    const appDataRoot = app.getPath('appData');
    const oldInstalled = path.join(appDataRoot, 'Ari Shop');
    const newInstalled = path.join(appDataRoot, 'Cham Shop');
    if (fs.existsSync(oldInstalled) && !fs.existsSync(newInstalled)) {
      fs.renameSync(oldInstalled, newInstalled);
    }
  } catch (_) {}
}

let mainWindow = null;
let serverProcess = null;

// Load .env manually so we can forward vars to the server child regardless of
// what cwd Electron was launched with.
function loadEnv() {
  const envPath = isDev
    ? path.join(__dirname, '..', '.env')
    : path.join(process.resourcesPath, 'app.asar', '.env');
  if (!fs.existsSync(envPath)) {
    console.warn('[electron] .env not found at', envPath);
    return {};
  }
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// Buffer i outputit të server-it (memory) që të mund ta tregojmë te dialog
// kur server-i dështon — pa varësi nga skedari log.
let serverOutput = '';
let serverExitCode = null;

function startServer() {
  const serverPath = path.join(__dirname, '..', 'server', 'index.js');
  const envLoaded = loadEnv();
  // Folderi për upload-e produktesh — brenda userData që të mos përpiqet të
  // shkruajë brenda app.asar (read-only) dhe të ruhet me user-in.
  const uploadDir = path.join(app.getPath('userData'), 'uploads', 'products');
  try { fs.mkdirSync(uploadDir, { recursive: true }); } catch (_) {}
  const env = {
    ...process.env,
    ...envLoaded,
    PORT: String(PORT),
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    UPLOAD_DIR: uploadDir,
  };
  serverOutput = `[env keys]: ${Object.keys(envLoaded).join(', ') || '(none)'}\n`;
  serverOutput += `[server path]: ${serverPath}\n`;
  serverOutput += `[exec path]: ${process.execPath}\n\n`;
  // Provo edhe log-un në skedar (backup), por parësor është buffer-i memory.
  const logDir = path.join(app.getPath('userData'), 'logs');
  let logStream = null;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    logStream = fs.createWriteStream(path.join(logDir, 'server.log'), { flags: 'a' });
    logStream.on('error', () => { logStream = null; });
    logStream.write(`\n\n===== ${new Date().toISOString()} startup =====\n${serverOutput}`);
  } catch (_) {}
  const capture = (d) => {
    const s = d.toString();
    serverOutput += s;
    if (logStream) { try { logStream.write(s); } catch (_) {} }
  };
  try {
    serverProcess = spawn(process.execPath, [serverPath], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    capture(`[spawn threw]: ${err.message}\n`);
    return;
  }
  serverProcess.stdout.on('data', capture);
  serverProcess.stderr.on('data', capture);
  serverProcess.on('exit', (code) => {
    serverExitCode = code;
    capture(`[server] exited with code ${code}\n`);
    serverProcess = null;
  });
  serverProcess.on('error', (err) => {
    capture(`[server] spawn error: ${err.message}\n`);
  });
}

function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`${PROD_URL}/api/products`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error('server did not start in time'));
        } else {
          setTimeout(check, 250);
        }
      });
      req.setTimeout(1000, () => req.destroy());
    };
    check();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Cham Shop',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(isDev ? DEV_URL : PROD_URL);
  // Open external http(s) links in the OS browser, not inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// Log-o çdo event të updater-it te fajl (userData/updater.log) që të mund të
// diagnostikohet post-mortem pse s'erdhi një update. Gjithashtu ekspozohet
// menu-ja "Kontrollo për Update" për trigger manual.
let updaterLogPath = null;
function updaterLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    if (!updaterLogPath) updaterLogPath = path.join(app.getPath('userData'), 'updater.log');
    fs.appendFileSync(updaterLogPath, line);
  } catch (_) {}
  console.log('[updater]', msg);
}

let manualUpdateCheck = false;
function setupAutoUpdate() {
  autoUpdater.autoDownload = true;
  autoUpdater.logger = { info: updaterLog, warn: updaterLog, error: updaterLog, debug: () => {} };

  autoUpdater.on('checking-for-update', () => updaterLog('checking-for-update'));
  autoUpdater.on('update-available', (info) => {
    updaterLog(`update-available: v${info?.version}`);
    // Njofto user-in menjëherë kur zbulohet version i ri (para se të mbarojë
    // shkarkimi). Dialog jo-modal që të mos bllokojë punën — thjesht informoi.
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Version i ri i disponueshëm',
      message: `Version i ri: v${info?.version}`,
      detail: `Version-i aktual: v${app.getVersion()}\n\nPo shkarkohet automatikisht në sfond. Kur të mbarojë, do të të pyesim nëse do të rinisësh për ta instaluar.`,
      buttons: ['Në rregull'],
      defaultId: 0,
    });
  });
  autoUpdater.on('update-not-available', (info) => {
    updaterLog(`update-not-available (aktuali: v${app.getVersion()}, i fundit: v${info?.version || '?'})`);
    if (manualUpdateCheck) {
      manualUpdateCheck = false;
      dialog.showMessageBox(mainWindow, {
        type: 'info', title: 'Nuk ka update',
        message: `Je te versioni më i fundit (v${app.getVersion()}).`,
      });
    }
  });
  autoUpdater.on('download-progress', (p) => {
    updaterLog(`download-progress: ${Math.round(p.percent || 0)}% (${p.transferred}/${p.total})`);
  });
  autoUpdater.on('update-downloaded', async (info) => {
    updaterLog(`update-downloaded: v${info?.version}`);
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Përditësim i ri',
      message: `Versioni v${info?.version} u shkarkua. Rinis tani për ta instaluar?`,
      buttons: ['Rinis dhe instalo', 'Më vonë'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (err) => {
    const msg = err?.message || String(err);
    updaterLog(`ERROR: ${msg}`);
    if (manualUpdateCheck) {
      manualUpdateCheck = false;
      dialog.showMessageBox(mainWindow, {
        type: 'error', title: 'Gabim update',
        message: 'Nuk u kontrollua dot për update.',
        detail: `${msg}\n\nLog: ${updaterLogPath || 'userData/updater.log'}`,
      });
    }
  });

  updaterLog(`autoUpdater init — aktuali: v${app.getVersion()}, feed: ${JSON.stringify(autoUpdater.getFeedURL?.() || 'default')}`);
  autoUpdater.checkForUpdatesAndNotify().catch(err => updaterLog(`check failed: ${err?.message || err}`));

  // Rikontrollo çdo orë ndërsa app-i është hapur. Nëse user-i s'e mbyll për
  // ditë të tëra, do të marrë update-in që del ndërkohë pa iu dashur rifillim.
  setInterval(() => {
    updaterLog('periodic re-check (1h)');
    autoUpdater.checkForUpdates().catch(err => updaterLog(`periodic check failed: ${err?.message || err}`));
  }, 60 * 60 * 1000);
}

// Menu me opsion manual për të kontrolluar update-in (Help → Kontrollo për Update).
function buildAppMenu() {
  const template = [
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      label: 'Ndihmë',
      submenu: [
        {
          label: 'Kontrollo për Update',
          click: () => {
            manualUpdateCheck = true;
            updaterLog('manual check triggered from menu');
            autoUpdater.checkForUpdates().catch(err => {
              updaterLog(`manual check failed: ${err?.message || err}`);
              dialog.showMessageBox(mainWindow, {
                type: 'error', title: 'Gabim',
                message: 'Nuk u kontrollua dot për update.',
                detail: String(err?.message || err),
              });
            });
          },
        },
        {
          label: 'Hap log-un e update-it',
          click: () => {
            if (updaterLogPath && fs.existsSync(updaterLogPath)) shell.openPath(updaterLogPath);
            else dialog.showMessageBox(mainWindow, { type: 'info', message: 'Log-u i update-it nuk ekziston ende.' });
          },
        },
        { type: 'separator' },
        { label: `Versioni: v${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showServerErrorInWindow(err) {
  // Në vend të dialog-ut, hap një dritare me output-in e server-it dhe hap
  // DevTools automatikisht që user-i të mund të kopjojë tekstin lehtë.
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Cham Shop — Server Error</title>
<style>
  body { font-family: -apple-system, Segoe UI, sans-serif; background: #1e293b; color: #f1f5f9; padding: 24px; margin: 0; }
  h1 { color: #f87171; margin: 0 0 16px; font-size: 20px; }
  .meta { color: #94a3b8; font-size: 13px; margin-bottom: 16px; }
  pre { background: #0f172a; padding: 16px; border-radius: 8px; overflow: auto; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
  .hint { margin-top: 20px; padding: 12px; background: #334155; border-left: 4px solid #60a5fa; font-size: 13px; border-radius: 4px; }
</style></head>
<body>
  <h1>⚠️ Server-i i brendshëm nuk u nis</h1>
  <div class="meta">Gabim: ${err.message.replace(/</g, '&lt;')} · Exit code: ${serverExitCode ?? 'ende po funksionon'}</div>
  <pre id="log"></pre>
  <div class="hint">Kopjo tekstin më sipër dhe dërgoja programuesit. DevTools është hapur automatikisht — mund të përdorësh Console për debug.</div>
<script>
  const log = ${JSON.stringify(serverOutput)};
  document.getElementById('log').textContent = log;
  console.log('===== SERVER OUTPUT =====\\n' + log);
  console.error('Server failed to start: ${err.message.replace(/'/g, "\\'")}');
</script>
</body></html>`;
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    title: 'Cham Shop — Server Error',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  mainWindow.webContents.openDevTools({ mode: 'bottom' });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  if (!isDev) {
    startServer();
    try { await waitForServer(); }
    catch (err) {
      // Prit deri në 500ms që stdout/stderr të shterojë para hapjes së dritares.
      await new Promise(r => setTimeout(r, 500));
      showServerErrorInWindow(err);
      return;
    }
  }
  createWindow();
  if (!isDev) {
    buildAppMenu();
    setupAutoUpdate();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) {
    try { serverProcess.kill(); } catch (_) {}
    serverProcess = null;
  }
});
