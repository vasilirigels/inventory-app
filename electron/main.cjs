// Electron main process. Owns the app window and, in production, the Express
// server subprocess. In dev we assume `npm run dev` is already running Vite
// (5173) + the Express server (3001) — Electron just points at Vite.
const { app, BrowserWindow, shell, dialog, Menu, session } = require('electron');
const { spawn, execFileSync } = require('child_process');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');

const isDev = !app.isPackaged;
const PORT = 3001;
const DEV_URL = 'http://localhost:5173';
const PROD_URL = `http://localhost:${PORT}`;

// Bllokon nisjen e dytë të njëkohshme (p.sh. dy klikime te .exe portable ose
// installed + portable të hapura njëkohësisht). Pa këtë, instanca e dytë
// dështon te startServer() sepse porti 3001 është i zënë → dialog i pafat
// "Server-i i brendshëm nuk u nis". Kur bllokohet, e reja fokuson të vjetrën.
if (!isDev && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

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
// what cwd Electron was launched with. Provo disa vendndodhje sepse në portable
// asar-i ekstraktohet në temp dhe rruga mund të ndryshojë.
function loadEnv() {
  const candidates = isDev
    ? [path.join(__dirname, '..', '.env')]
    : [
        path.join(process.resourcesPath, 'app.asar', '.env'),
        path.join(process.resourcesPath, 'app.asar.unpacked', '.env'),
        path.join(process.resourcesPath, '.env'),
        path.join(app.getAppPath(), '.env'),
        path.join(path.dirname(process.execPath), '.env'),
      ];
  let envPath = null;
  for (const c of candidates) {
    try { if (fs.existsSync(c)) { envPath = c; break; } } catch (_) {}
  }
  if (!envPath) {
    console.warn('[electron] .env not found. Tried:', candidates.join(' | '));
    return { __missing: candidates };
  }
  const out = { __path: envPath };
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// Kontrollo nëse porti 3001 është i zënë; kthen 'free' | 'chamshop' | 'other'.
// 'chamshop' → një instancë Cham Shop tashmë po vraga te ky port; hapim thjesht
// dritaren dhe e riprovim. 'other' → një app tjetër e ka zënë; s'mund të nisim.
async function probePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', async (err) => {
      if (err.code !== 'EADDRINUSE') return resolve('other');
      // Provo të flasim me atë që dëgjon — nëse është Cham Shop, /healthz
      // përgjigjet menjëherë (pa varësi nga DB init).
      try {
        const r = await new Promise((res) => {
          const req = http.get(`${PROD_URL}/healthz`, (r) => { r.resume(); res(r.statusCode); });
          req.on('error', () => res(0));
          req.setTimeout(1500, () => { req.destroy(); res(0); });
        });
        resolve(r > 0 ? 'chamshop' : 'other');
      } catch (_) { resolve('other'); }
    });
    server.once('listening', () => { server.close(() => resolve('free')); });
    server.listen(PORT, '127.0.0.1');
  });
}

// Buffer i outputit të server-it (memory) që të mund ta tregojmë te dialog
// kur server-i dështon — pa varësi nga skedari log.
let serverOutput = '';
let serverExitCode = null;
let serverStarted = false;
let logStreamGlobal = null;

// Kap stdout/stderr te faji log dhe buffer-i memory. Redirect-ohet global sepse
// pas require-imit të server-it në procesin tonë, console.log i tij shkon te
// stdout-i ynë (jo te subprocess më vete).
function setupServerLogging() {
  const logDir = path.join(app.getPath('userData'), 'logs');
  try {
    fs.mkdirSync(logDir, { recursive: true });
    logStreamGlobal = fs.createWriteStream(path.join(logDir, 'server.log'), { flags: 'a' });
    logStreamGlobal.on('error', () => { logStreamGlobal = null; });
    logStreamGlobal.write(`\n\n===== ${new Date().toISOString()} startup =====\n${serverOutput}`);
  } catch (_) {}
  const write = (s) => {
    serverOutput += s;
    if (logStreamGlobal) { try { logStreamGlobal.write(s); } catch (_) {} }
  };
  // Mbivendos console.log/error që të dyshojë (write te terminal + log file + buffer).
  const origLog = console.log.bind(console);
  const origErr = console.error.bind(console);
  console.log = (...args) => { const s = args.join(' ') + '\n'; write(s); origLog(...args); };
  console.error = (...args) => { const s = args.join(' ') + '\n'; write(s); origErr(...args); };
}

// Server run-on brenda TË NJËJTIT proces si Electron main. Këtu s'ka më spawn
// të një Cham Shop.exe të dytë — për installer-in NSIS ka vetëm 1 proces
// "Cham Shop.exe" dhe nuk vjen kurrë dialog-u "app is running".
async function startServer() {
  if (serverStarted) return;
  const envLoaded = loadEnv();
  const envPathUsed = envLoaded.__path;
  const envMissingList = envLoaded.__missing;
  delete envLoaded.__path;
  delete envLoaded.__missing;
  // Folderi për upload-e produktesh — brenda userData që të mos përpiqet të
  // shkruajë brenda app.asar (read-only) dhe të ruhet me user-in.
  const uploadDir = path.join(app.getPath('userData'), 'uploads', 'products');
  try { fs.mkdirSync(uploadDir, { recursive: true }); } catch (_) {}
  // Server-i lexon TURSO_URL/TOKEN etj. nga process.env — vendosi para require.
  for (const [k, v] of Object.entries(envLoaded)) {
    if (process.env[k] == null) process.env[k] = v;
  }
  process.env.PORT = String(PORT);
  process.env.NODE_ENV = 'production';
  process.env.UPLOAD_DIR = uploadDir;

  serverOutput = `[env keys]: ${Object.keys(envLoaded).join(', ') || '(none)'}\n`;
  serverOutput += `[env source]: ${envPathUsed || `NOT FOUND. tried: ${(envMissingList || []).join(' | ')}`}\n`;
  serverOutput += `[mode]: in-process (no subprocess)\n`;
  serverOutput += `[exec path]: ${process.execPath}\n`;
  serverOutput += `[portable]: ${portableDir ? `yes (${portableDir})` : 'no'}\n\n`;

  setupServerLogging();

  // Kap unhandled errors nga server-i që të mos crash-onin Electron-in tërësisht.
  process.on('uncaughtException', (err) => {
    const msg = `[uncaughtException]: ${err?.stack || err?.message || err}\n`;
    serverOutput += msg;
    if (logStreamGlobal) { try { logStreamGlobal.write(msg); } catch (_) {} }
    console.error(msg);
  });
  process.on('unhandledRejection', (reason) => {
    const msg = `[unhandledRejection]: ${reason?.stack || reason?.message || reason}\n`;
    serverOutput += msg;
    if (logStreamGlobal) { try { logStreamGlobal.write(msg); } catch (_) {} }
    console.error(msg);
  });

  // server/index.js është ESM — ngarko me dynamic import në CJS main.
  // Kur ngarkohet, ekzekuton `httpServer.listen(PORT)` automatikisht.
  const { pathToFileURL } = require('url');
  const serverPath = path.join(__dirname, '..', 'server', 'index.js');
  try {
    await import(pathToFileURL(serverPath).href);
    serverStarted = true;
    serverOutput += `[server] loaded and listening on ${PORT}\n`;
  } catch (err) {
    serverExitCode = 1;
    const msg = `[server] import failed: ${err?.stack || err?.message || err}\n`;
    serverOutput += msg;
    if (logStreamGlobal) { try { logStreamGlobal.write(msg); } catch (_) {} }
    throw err;
  }
}

// Prit vetëm që port-i të hapet — server-i tani listen-on menjëherë dhe
// bën DB init në sfond. /healthz nuk kërkon DB, kështu që kalon menjëherë
// pavarësisht sa e ngadalshme është lidhja me Turso. Frontend-i shfaq
// "connecting..." nëse /api/* dorëzojnë me vonesë nga middleware-i që i
// mban në pritje derisa DB të jetë gati.
function waitForServer(timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`${PROD_URL}/healthz`, (res) => {
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

// ─── Custom Mac updater ────────────────────────────────────────────────────
// electron-updater refuzon të bëjë auto-update në Mac për aplikacione të pafirmosura
// (verifikon signature-in e Developer ID). Meqë s'kemi Apple Developer cert,
// implementojmë vetë flow-un: fetch nga GitHub API → download DMG → mount me
// hdiutil → kopjo .app te /Applications → run xattr për të hequr quarantine →
// relaunch.

// Krahaso versione X.Y.Z si numra (mjafton për 1.0.NN formatin tonë).
function compareVersions(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n) || 0);
  const pb = String(b).split('.').map(n => parseInt(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

// Shkarko një URL në file me streaming (evitohet mbajtja 100+MB në RAM).
// Ndjek redirect-e (GitHub asset URLs redirect-ojnë te S3).
function downloadFile(url, destPath, onProgress) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const doRequest = (u, redirectCount = 0) => {
      if (redirectCount > 5) return reject(new Error('too many redirects'));
      https.get(u, { headers: { 'User-Agent': 'ChamShopUpdater/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return doRequest(res.headers.location, redirectCount + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const total = parseInt(res.headers['content-length']) || 0;
        let downloaded = 0;
        const file = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (onProgress) onProgress(downloaded, total);
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      }).on('error', reject);
    };
    doRequest(url);
  });
}

let macUpdateInProgress = false;
async function checkForUpdateMac(manual = false) {
  if (process.platform !== 'darwin') return;
  if (macUpdateInProgress) { updaterLog('Mac updater: already in progress'); return; }
  macUpdateInProgress = true;
  try {
    updaterLog('Mac updater: checking GitHub...');
    const apiUrl = 'https://api.github.com/repos/vasilirigels/inventory-app-releases/releases/latest';
    const res = await fetch(apiUrl, { headers: { 'User-Agent': 'ChamShopUpdater/1.0' } });
    if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
    const data = await res.json();
    const latestVersion = String(data.tag_name || '').replace(/^v/, '');
    const currentVersion = app.getVersion();
    updaterLog(`Mac updater: current=v${currentVersion}, latest=v${latestVersion}`);

    if (compareVersions(latestVersion, currentVersion) <= 0) {
      if (manual) {
        dialog.showMessageBox(mainWindow, {
          type: 'info', title: 'Nuk ka update',
          message: `Je te versioni më i fundit (v${currentVersion}).`,
        });
      }
      return;
    }

    // Zgjidh DMG-në për arch-un aktual (arm64 për Apple Silicon, x64 për Intel).
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const dmgName = `ChamShop-${latestVersion}-${arch}.dmg`;
    const dmgAsset = (data.assets || []).find(a => a.name === dmgName);
    if (!dmgAsset) {
      updaterLog(`Mac updater: DMG not found for ${arch} (kërkohej ${dmgName})`);
      if (manual) {
        dialog.showMessageBox(mainWindow, {
          type: 'warning', title: 'DMG nuk u gjet',
          message: `Nuk u gjet DMG për arkitekturën ${arch}.`,
          detail: `Kërkoj: ${dmgName}\nAsete: ${(data.assets || []).map(a => a.name).join(', ')}`,
        });
      }
      return;
    }

    const sizeMB = Math.round(dmgAsset.size / 1024 / 1024);
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Version i ri i disponueshëm',
      message: `Version i ri: v${latestVersion}`,
      detail: `Version-i aktual: v${currentVersion}\n\nDo të shkarkohet ~${sizeMB} MB dhe do të instalohet automatikisht kur ta pranosh.`,
      buttons: ['Shkarko dhe instalo', 'Më vonë'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) { updaterLog('Mac updater: user cancelled'); return; }

    const dmgPath = path.join(app.getPath('temp'), dmgName);
    updaterLog(`Mac updater: downloading ${dmgAsset.browser_download_url} → ${dmgPath}`);
    let lastLogged = 0;
    await downloadFile(dmgAsset.browser_download_url, dmgPath, (done, total) => {
      const pct = total ? Math.round(done / total * 100) : 0;
      if (pct >= lastLogged + 10) { updaterLog(`Mac updater: download ${pct}%`); lastLogged = pct; }
    });
    updaterLog('Mac updater: download complete');

    // Përcakto path-in e .app-it që po ekzekuton: process.execPath =
    // /Applications/Cham Shop.app/Contents/MacOS/Cham Shop → 3 nivele lart.
    const appBundlePath = path.dirname(path.dirname(path.dirname(process.execPath)));
    const appParentDir = path.dirname(appBundlePath);
    updaterLog(`Mac updater: current bundle=${appBundlePath}`);

    const { response: r2 } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Shkarkimi u plotësua',
      message: `Version v${latestVersion} u shkarkua.`,
      detail: `Aplikacioni do të mbyllet, të instalohet update-i, dhe të rihapet automatikisht.\n\n(vendndodhja: ${appBundlePath})`,
      buttons: ['Rinis dhe instalo', 'Më vonë'],
      defaultId: 0,
      cancelId: 1,
    });
    if (r2 !== 0) { updaterLog('Mac updater: user postponed install'); return; }

    // Instalimi bëhet TE VETË procesi Electron pa spawn detached — kështu nuk
    // varemi nga launchd që të mos vrasë child bash process-in. macOS lejon
    // rm/cp mbi një .app që është duke ekzekutuar (unlike Windows).
    // Sekuenca: mount → replace .app → xattr → detach → app.relaunch() + quit
    const { execSync } = require('child_process');
    const mountPoint = path.join(app.getPath('temp'), `chamshop-mount-${Date.now()}`);
    try {
      fs.mkdirSync(mountPoint, { recursive: true });
      updaterLog(`Mac updater: mounting ${dmgPath} at ${mountPoint}`);
      execSync(`hdiutil attach "${dmgPath}" -nobrowse -noautoopen -mountpoint "${mountPoint}"`, {
        stdio: 'pipe', timeout: 30000,
      });
      updaterLog('Mac updater: mount OK');

      // Gjej .app-in brenda mount-it.
      let newAppPath = path.join(mountPoint, 'Cham Shop.app');
      if (!fs.existsSync(newAppPath)) {
        const entries = fs.readdirSync(mountPoint);
        const appEntry = entries.find(e => e.endsWith('.app'));
        if (!appEntry) throw new Error(`no .app found in DMG (entries: ${entries.join(', ')})`);
        newAppPath = path.join(mountPoint, appEntry);
      }
      updaterLog(`Mac updater: found new .app at ${newAppPath}`);

      // Zëvendëso .app-in ekzistues. macOS lejon rm mbi running .app.
      updaterLog(`Mac updater: removing old ${appBundlePath}`);
      execSync(`rm -rf "${appBundlePath}"`, { stdio: 'pipe' });

      updaterLog(`Mac updater: copying to ${appBundlePath}`);
      execSync(`cp -R "${newAppPath}" "${appParentDir}/"`, { stdio: 'pipe', timeout: 60000 });

      updaterLog('Mac updater: removing quarantine');
      try { execSync(`xattr -cr "${appBundlePath}"`, { stdio: 'pipe' }); }
      catch (e) { updaterLog(`xattr warning: ${e.message}`); }

      updaterLog('Mac updater: detaching DMG');
      try { execSync(`hdiutil detach "${mountPoint}" -force`, { stdio: 'pipe' }); }
      catch (e) { updaterLog(`detach warning: ${e.message}`); }

      try { fs.rmSync(mountPoint, { recursive: true, force: true }); } catch (_) {}
      try { fs.unlinkSync(dmgPath); } catch (_) {}

      updaterLog('Mac updater: install complete, relaunching');
      // KRITIKE: app.exit(0) nuk fajron before-quit → server subprocess mbetet
      // gjallë, mban portin 3001, dhe pas relaunch-it Electron-i i ri
      // hyn te SERVERI I VJETËR që serve-on JS bundle-in e vjetër. Vrisim
      // server-in dhe presim që të dalë vërtet.
      await killServerAndWait();
      app.relaunch();
      app.exit(0);
    } catch (installErr) {
      updaterLog(`Mac updater INSTALL ERROR: ${installErr?.message || installErr}`);
      // Pastro mount-in nëse mbetur.
      try { execSync(`hdiutil detach "${mountPoint}" -force`, { stdio: 'pipe' }); } catch (_) {}
      dialog.showMessageBox(mainWindow, {
        type: 'error', title: 'Gabim gjatë instalimit',
        message: 'Instalimi i update-it dështoi.',
        detail: `${installErr?.message || installErr}\n\nMund të provosh nga menu Ndihmë → Kontrollo për Update, ose të shkarkosh manualisht nga faqja e release-it.`,
      });
    }
  } catch (err) {
    updaterLog(`Mac updater ERROR: ${err?.message || err}`);
    if (manual) {
      dialog.showMessageBox(mainWindow, {
        type: 'error', title: 'Gabim update',
        message: 'Nuk u kontrollua dot për update.',
        detail: String(err?.message || err),
      });
    }
  } finally {
    macUpdateInProgress = false;
  }
}

// ─── Custom Portable (Windows) updater ─────────────────────────────────────
// Portable .exe s'mund të mbivendoset ndërsa është duke ekzekutuar. Për të
// mbështetur auto-update:
//   1. Fetch nga GitHub API → gjej ChamShop-Portable-{version}.exe të fundit
//   2. Shkarko .exe-në e re me emër temporar në të njëjtën direktori
//   3. Shkruaj një .bat script në temp që:
//      - pret 3s që procesi aktual të mbyllet plotësisht (unlock file)
//      - fshin .exe-në origjinale
//      - riemërton .exe-në e re me emrin origjinal (ruan shortcuts)
//      - nis .exe-në me emrin origjinal
//      - fshin veten
//   4. Spawn .bat detached + quit
let portableUpdateInProgress = false;
async function checkForUpdatePortable(manual = false) {
  if (process.platform !== 'win32') return;
  if (portableUpdateInProgress) { updaterLog('Portable updater: already in progress'); return; }
  portableUpdateInProgress = true;
  try {
    updaterLog('Portable updater: checking GitHub...');
    const apiUrl = 'https://api.github.com/repos/vasilirigels/inventory-app-releases/releases/latest';
    const res = await fetch(apiUrl, { headers: { 'User-Agent': 'ChamShopUpdater/1.0' } });
    if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
    const data = await res.json();
    const latestVersion = String(data.tag_name || '').replace(/^v/, '');
    const currentVersion = app.getVersion();
    updaterLog(`Portable updater: current=v${currentVersion}, latest=v${latestVersion}`);

    if (compareVersions(latestVersion, currentVersion) <= 0) {
      if (manual) {
        dialog.showMessageBox(mainWindow, {
          type: 'info', title: 'Nuk ka update',
          message: `Je te versioni më i fundit (v${currentVersion}).`,
        });
      }
      return;
    }

    const exeName = `ChamShop-Portable-${latestVersion}.exe`;
    const exeAsset = (data.assets || []).find(a => a.name === exeName);
    if (!exeAsset) {
      updaterLog(`Portable updater: asset not found (${exeName})`);
      if (manual) {
        dialog.showMessageBox(mainWindow, {
          type: 'warning', title: 'Update jo i disponueshëm',
          message: `Nuk u gjet ChamShop-Portable-${latestVersion}.exe`,
          detail: `Asete: ${(data.assets || []).map(a => a.name).join(', ')}`,
        });
      }
      return;
    }

    const sizeMB = Math.round(exeAsset.size / 1024 / 1024);
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Version i ri i disponueshëm',
      message: `Version i ri: v${latestVersion}`,
      detail: `Version-i aktual: v${currentVersion}\n\nDo të shkarkohet ~${sizeMB} MB dhe do të zëvendësohet automatikisht .exe-në e vjetër. Aplikacioni do të mbyllet dhe të rihapet me versionin e ri.`,
      buttons: ['Shkarko dhe instalo', 'Më vonë'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) { updaterLog('Portable updater: user cancelled'); return; }

    // Shkarko në të njëjtën direktori ku ndodhet .exe-ja aktuale (te USB-ja),
    // por me një emër temporar (`{orig}.new-{version}.exe`). Batch-i pastaj do
    // ta riemërtojë me emrin origjinal, që shkurtoret e user-it (që tregojnë
    // te emri i vjetër, p.sh. ChamShop-Portable-1.2.0.exe) të vazhdojnë të
    // punojnë pas update-it.
    const currentExePath = process.execPath;
    const currentExeDir = path.dirname(currentExePath);
    const currentExeBase = path.basename(currentExePath, '.exe');
    const tmpExeName = `${currentExeBase}.new-${latestVersion}.exe`;
    const newExePath = path.join(currentExeDir, tmpExeName);
    updaterLog(`Portable updater: downloading to ${newExePath}`);
    let lastLogged = 0;
    await downloadFile(exeAsset.browser_download_url, newExePath, (done, total) => {
      const pct = total ? Math.round(done / total * 100) : 0;
      if (pct >= lastLogged + 10) { updaterLog(`Portable updater: download ${pct}%`); lastLogged = pct; }
    });
    updaterLog('Portable updater: download complete');

    const { response: r2 } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Shkarkimi u plotësua',
      message: `Version v${latestVersion} u shkarkua.`,
      detail: `Aplikacioni do të mbyllet, .exe-ja e vjetër do të fshihet, dhe versioni i ri do të hapet automatikisht.\n\nVendndodhja: ${currentExeDir}`,
      buttons: ['Rinis dhe instalo', 'Më vonë'],
      defaultId: 0,
      cancelId: 1,
    });
    if (r2 !== 0) { updaterLog('Portable updater: user postponed install'); return; }

    // Shkruaj batch script-in që do të bëjë replace + relaunch pas mbylljes.
    // Ruan emrin origjinal të .exe-së që shkurtoret e user-it të vazhdojnë të
    // punojnë. Nëse riemërtimi dështon (locked/perms), fallback: nis .exe-në e
    // re me emër temporar (user-i s'mbetet pa asgjë).
    const batchPath = path.join(app.getPath('temp'), `chamshop-update-${Date.now()}.bat`);
    const batchContent = [
      '@echo off',
      'timeout /t 3 /nobreak >nul',
      `del /f /q "${currentExePath}"`,
      `move /y "${newExePath}" "${currentExePath}"`,
      'if errorlevel 1 goto fallback',
      `start "" "${currentExePath}"`,
      'goto end',
      ':fallback',
      `start "" "${newExePath}"`,
      ':end',
      'del "%~f0"',
      '',
    ].join('\r\n');
    fs.writeFileSync(batchPath, batchContent);
    updaterLog(`Portable updater: wrote batch ${batchPath}`);

    // Spawn detached — batch vazhdon të ekzekutohet edhe pasi Electron të mbyllet.
    const child = spawn('cmd.exe', ['/c', batchPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();

    // Vrit server-in dhe prit që të dalë vërtet — nëse mbetet gjallë, batch-i
    // do të dështojë të fshijë .exe-në e vjetër (Windows locking).
    updaterLog('Portable updater: killing server subprocess before quit');
    await killServerAndWait();
    updaterLog('Portable updater: server dead, exiting');
    app.exit(0);
  } catch (err) {
    updaterLog(`Portable updater ERROR: ${err?.message || err}`);
    if (manual) {
      dialog.showMessageBox(mainWindow, {
        type: 'error', title: 'Gabim update',
        message: 'Nuk u kontrollua dot për update.',
        detail: String(err?.message || err),
      });
    }
  } finally {
    portableUpdateInProgress = false;
  }
}

// Server-i tani ekzekuton brenda process-it kryesor (jo më si subprocess).
// Kjo funksion mbetet për backward-compat në pikat e vjetra që e thërrasin;
// tani thjesht mbyll port-in HTTP nëse është hapur ende (rrallë e nevojshme
// sepse app.exit()/quit() e mbyllin gjithsesi kur procesi vdes).
async function killServerAndWait() {
  serverProcess = null;
}

let manualUpdateCheck = false;
function setupAutoUpdate() {
  // Mac s'mbështetet nga electron-updater pa Developer ID signing. Përdorim
  // custom flow-in tonë (checkForUpdateMac) që manaxhon DMG download + install
  // me hdiutil pa kërkuar signature validation.
  if (process.platform === 'darwin') {
    updaterLog(`Mac custom updater init — aktuali: v${app.getVersion()}, arch: ${process.arch}`);
    checkForUpdateMac(false);
    setInterval(() => checkForUpdateMac(false), 60 * 60 * 1000);
    return;
  }
  // Portable — përdor custom flow (checkForUpdatePortable) që shkarkon .exe-në
  // e re, e zëvendëson me batch script-in, dhe rihap versionin e ri.
  // electron-updater nuk mbështet natyrisht portable, ndaj për këtë rast e
  // dezaktivizojmë tërësisht dhe përdorim vetëm updater-in tonë (si te macOS).
  const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;
  if (isPortable) {
    updaterLog(`Portable mode — përdor custom updater; aktuali: v${app.getVersion()}`);
    checkForUpdatePortable(false);
    setInterval(() => checkForUpdatePortable(false), 60 * 60 * 1000);
    return;
  }
  autoUpdater.logger = { info: updaterLog, warn: updaterLog, error: updaterLog, debug: () => {} };
  updaterLog('mode: installer (auto-download)');

  autoUpdater.on('checking-for-update', () => updaterLog('checking-for-update'));
  autoUpdater.on('update-available', async (info) => {
    updaterLog(`update-available: v${info?.version}`);
    // NSIS installed — dialog informues; shkarkimi vazhdon në sfond automatikisht.
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
    updaterLog(`update-downloaded: v${info?.version} at ${info?.downloadedFile || '(no path)'}`);
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Përditësim i ri',
      message: `Versioni v${info?.version} u shkarkua. Rinis tani për ta instaluar?`,
      buttons: ['Rinis dhe instalo', 'Më vonë'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      // Hiq Mark-of-the-Web (Zone.Identifier ADS) nga installer-i i shkarkuar.
      // Pa këtë, kur autoUpdater e nis .exe-në programatikisht, SmartScreen e
      // vret në heshtje ("Windows protected your PC" nuk shfaqet fare sepse
      // procesi s'u nis nga user-i drejtpërdrejt) → install-i s'ndodh dhe
      // user-i s'e kupton pse. Unblock-File e bën "trusted" këtë file specifik.
      if (process.platform === 'win32' && info?.downloadedFile) {
        try {
          execFileSync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command',
            `Unblock-File -Path "${info.downloadedFile}"`,
          ], { timeout: 10000 });
          updaterLog(`installer: Unblock-File OK on ${info.downloadedFile}`);
        } catch (e) {
          updaterLog(`installer: Unblock-File failed: ${e?.message || e}`);
        }
      }
      updaterLog('installer: killing server subprocess before quitAndInstall');
      await killServerAndWait();
      updaterLog('installer: server dead, calling quitAndInstall');
      autoUpdater.quitAndInstall();
    }
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
// Në macOS përfshihet edhe `role: 'appMenu'` që të shfaqet "Cham Shop" menu me
// standardet Quit / Hide / About — pa këtë Cmd+Q nuk funksionon.
function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const helpMenu = {
    label: 'Ndihmë',
    role: 'help',
    submenu: [
      {
        label: 'Kontrollo për Update',
        click: () => {
          updaterLog('manual check triggered from menu');
          if (isMac) {
            checkForUpdateMac(true);
          } else if (process.env.PORTABLE_EXECUTABLE_DIR) {
            checkForUpdatePortable(true);
          } else {
            manualUpdateCheck = true;
            autoUpdater.checkForUpdates().catch(err => {
              updaterLog(`manual check failed: ${err?.message || err}`);
              dialog.showMessageBox(mainWindow, {
                type: 'error', title: 'Gabim',
                message: 'Nuk u kontrollua dot për update.',
                detail: String(err?.message || err),
              });
            });
          }
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
  };
  const template = [
    // Në macOS: appMenu domosdoshme për Quit/Hide/About. Në Windows/Linux
    // s'ekziston dhe fileMenu mban Quit-in.
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    helpMenu,
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
  .update-banner { margin-top: 16px; padding: 14px 16px; background: #1e40af; border-left: 4px solid #60a5fa; border-radius: 6px; font-size: 14px; color: #e0e7ff; }
  .update-banner b { color: #ffffff; }
</style></head>
<body>
  <h1>⚠️ Server-i i brendshëm nuk u nis</h1>
  <div class="meta">Gabim: ${err.message.replace(/</g, '&lt;')} · Exit code: ${serverExitCode ?? 'ende po funksionon'}</div>
  <div class="update-banner">🔍 <b>Duke kontrolluar për version të ri...</b><br><span style="font-size:12px;opacity:0.85">Nëse ka një version më të ri që rregullon këtë problem, do të shfaqet automatikisht një dialog për ta shkarkuar dhe instaluar.</span></div>
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
  // Edhe kur server-i dështon, sill auto-updater-in aty — kështu nëse ka një
  // version i ri që rregullon problemin, user-i e sheh dialog-un për ta
  // instaluar direkt nga këtu, pa iu dashur të shkojë manualisht te GitHub.
  // Mac përdor custom updater (checkForUpdateMac); Windows electron-updater.
  try { setupAutoUpdate(); }
  catch (e) { updaterLog(`setupAutoUpdate në error-window dështoi: ${e?.message || e}`); }
}

app.whenReady().then(async () => {
  if (!isDev) {
    // Kontrollo portin para se të spawn-ojmë — nëse është i zënë nga një
    // proces tjetër jo-Cham Shop, s'ka kuptim të provojmë (thjesht do dështojë).
    // Nëse është i zënë nga një Cham Shop tjetër (p.sh. instancë e vjetër që
    // s'u mbyll), përdorim atë server dhe hapim vetëm dritaren.
    const state = await probePort();
    if (state === 'other') {
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'Cham Shop — Porti është i zënë',
        message: `Porti ${PORT} është i zënë nga një aplikacion tjetër.`,
        detail: 'Mbylle aplikacionin që përdor portin 3001 (mund të jetë një instancë tjetër e Cham Shop që s\'u mbyll siç duhet, ose një program tjetër) dhe provo sërish.\n\nKëshillë: Rihap kompjuterin nëse s\'ke siguri cili proces e ka zënë.',
      });
      app.quit();
      return;
    }
    if (state === 'free') {
      try {
        await startServer();
        await waitForServer();
      } catch (err) {
        showServerErrorInWindow(err);
        return;
      }
    }
    // state === 'chamshop' → server-i i një instance tjetër Cham Shop po
    // punon; hap thjesht dritaren që të lidhet me atë.
  }
  createWindow();
  if (!isDev) {
    buildAppMenu();
    setupAutoUpdate();
    // Detekto update duke krahasuar versionin aktual me atë të fundit që u lançua.
    // Punon uniformisht për Mac (custom updater), Windows installer (electron-updater),
    // dhe portable (user zëvendëson .exe manualisht) — çdo herë që versioni ndryshon
    // nga run-i i mëparshëm, shfaq popup konfirmimi.
    try {
      const current = app.getVersion();
      const versionFile = path.join(app.getPath('userData'), 'last-launched-version');
      let previous = null;
      if (fs.existsSync(versionFile)) {
        previous = fs.readFileSync(versionFile, 'utf8').trim();
      }
      fs.writeFileSync(versionFile, current);
      if (previous && previous !== current) {
        // Pastro Chromium HTTP cache dhe storage-in — kështu s'ka mundësi që
        // JS bundle-i ose index.html i vjetër të mbetet i cache-uar pas update-it.
        // No-cache header-at te index.html duhet ta pengojnë këtë, por bëjmë
        // edhe belt-and-suspenders për të gjitha platformat.
        session.defaultSession.clearCache().catch(() => {});
        session.defaultSession.clearStorageData({
          storages: ['shadercache', 'cachestorage', 'serviceworkers'],
        }).catch(() => {});
        setTimeout(() => {
          dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update i suksesshëm',
            message: 'App-i u përditësua me sukses',
            detail: `Nga v${previous} → v${current}`,
          });
        }, 1500);
      }
    } catch (_) {}
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // Server-i tani punon brenda main-it — vdes automatikisht kur mbyllet Electron.
  // Vetëm mbyll log stream-in që të mos humbet output i fundit.
  if (logStreamGlobal) {
    try { logStreamGlobal.end(); } catch (_) {}
    logStreamGlobal = null;
  }
});
