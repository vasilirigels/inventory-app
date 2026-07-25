// Electron main process. Owns the app window and, in production, the Express
// server subprocess. In dev we assume `npm run dev` is already running Vite
// (5173) + the Express server (3001) — Electron just points at Vite.
const { app, BrowserWindow, shell, dialog } = require('electron');
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
  const userDataDir = path.join(portableDir, 'AriShop-Data');
  try { fs.mkdirSync(userDataDir, { recursive: true }); } catch (_) {}
  app.setPath('userData', userDataDir);
  app.setPath('sessionData', userDataDir);
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

function startServer() {
  const serverPath = path.join(__dirname, '..', 'server', 'index.js');
  const env = {
    ...process.env,
    ...loadEnv(),
    PORT: String(PORT),
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
  };
  // Log te skedar që kur aplikacioni dështon në PC të klientit, të mund të
  // shohim gabimin real pa cmd. Skedari ndodhet te userData (per-user, i
  // aksesueshëm nga %APPDATA%\Ari Shop\logs\server.log në Windows).
  const logDir = path.join(app.getPath('userData'), 'logs');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch (_) {}
  const logPath = path.join(logDir, 'server.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  logStream.write(`\n\n===== ${new Date().toISOString()} startup =====\n`);
  serverProcess = spawn(process.execPath, [serverPath], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', d => logStream.write(d));
  serverProcess.stderr.on('data', d => logStream.write(d));
  serverProcess.on('exit', (code) => {
    logStream.write(`[server] exited with code ${code}\n`);
    console.log(`[server] exited with code ${code}. Log: ${logPath}`);
    serverProcess = null;
  });
  serverProcess.on('error', (err) => {
    logStream.write(`[server] spawn error: ${err.message}\n`);
    console.error('[server] spawn error:', err.message);
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
    title: 'Ari Shop',
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

function setupAutoUpdate() {
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-downloaded', async () => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Përditësim i ri',
      message: 'Një version i ri i aplikacionit u shkarkua. Rinis tani për ta instaluar?',
      buttons: ['Rinis dhe instalo', 'Më vonë'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (err) => {
    console.warn('[updater] error:', err?.message || err);
  });
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}

app.whenReady().then(async () => {
  if (!isDev) {
    startServer();
    try { await waitForServer(); }
    catch (err) {
      const logPath = path.join(app.getPath('userData'), 'logs', 'server.log');
      dialog.showErrorBox(
        'Server-i nuk startohet',
        `Aplikacioni s'mund të hapet sepse server-i i brendshëm dështoi.\n\nSheko log-un për detaje:\n${logPath}\n\nGabim: ${err.message}`
      );
      app.quit();
      return;
    }
  }
  createWindow();
  if (!isDev) setupAutoUpdate();

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
