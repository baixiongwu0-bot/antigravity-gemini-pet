'use strict';

let electronApi;
try {
  electronApi = require('electron');
} catch (err) {
  process.stderr.write(
    '[antigravity-gemini-pet helper] Failed to load electron module (ELECTRON_RUN_AS_NODE=' +
      JSON.stringify(process.env.ELECTRON_RUN_AS_NODE ?? null) +
      '): ' +
      (err instanceof Error ? err.message : String(err)) +
      '\n',
  );
  process.exit(3);
}

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, powerMonitor } = electronApi;
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { HOST_POLL_MS, parseHostPid, hostIsGone, isBrokenPipeError } = require('./host-liveness.js');
const { POINTER_POLL_MS, pointerZone, decideWindowIgnore, leavesBody } = require('./pointer-target.js');

// 1. Force Electron caches / userData / temp off the Windows C: system drive BEFORE whenReady()
function isOnCDriveWindows(dirPath) {
  if (process.platform !== 'win32') return false;
  return /^[cC]:[\\/]/.test(path.resolve(dirPath));
}

function resolveDDriveUserData() {
  const candidates = [
    process.env.GEMINI_PET_USER_DATA,
    path.resolve(__dirname, '..', '..', '.runtime', 'electron-userdata'),
  ].filter(Boolean);

  const osTemp = process.env.TEMP || process.env.TMP;
  if (osTemp && !isOnCDriveWindows(osTemp)) {
    candidates.push(path.join(osTemp, 'antigravity-gemini-pet-userdata'));
  }
  // Generic non-C fallback (not a machine-specific project path).
  candidates.push(path.join('D:', 'Temp', 'antigravity-gemini-pet-userdata'));

  for (const dir of candidates) {
    if (isOnCDriveWindows(dir)) continue;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const testFile = path.join(dir, '.write-probe');
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      return dir;
    } catch {
      // try next candidate
    }
  }
  return candidates[candidates.length - 1];
}

const USER_DATA_DIR = resolveDDriveUserData();
const SESSION_DIR = path.join(USER_DATA_DIR, 'session');
const CACHE_DIR = path.join(USER_DATA_DIR, 'cache');
const TEMP_DIR = path.join(USER_DATA_DIR, 'temp');
const LOGS_DIR = path.join(USER_DATA_DIR, 'logs');
for (const d of [SESSION_DIR, CACHE_DIR, TEMP_DIR, LOGS_DIR]) {
  try {
    fs.mkdirSync(d, { recursive: true });
  } catch {
    /* ignore */
  }
}

app.setName('antigravity-gemini-pet-helper');
app.setPath('userData', USER_DATA_DIR);
app.setPath('sessionData', SESSION_DIR);
app.setPath('cache', CACHE_DIR);
app.setPath('temp', TEMP_DIR);
app.setPath('logs', LOGS_DIR);

if (process.platform === 'win32') {
  app.setAppUserModelId('com.antigravity.gemini-pet.helper');
  // CRITICAL Windows anti-black-border & DWM transparent layered window stability:
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 2. Broken pipe & Host PID watchdog (zero zombie process guarantee)
let hostGone = false;
function exitForDeadHost() {
  if (hostGone) return;
  hostGone = true;
  app.exit(0);
}

for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err) => {
    if (isBrokenPipeError(err)) exitForDeadHost();
  });
}

const HOST_PID = parseHostPid(process.env.GEMINI_PET_HOST_PID);
if (HOST_PID > 0) {
  setInterval(() => {
    if (hostIsGone(HOST_PID)) exitForDeadHost();
  }, HOST_POLL_MS).unref?.();
}

const SERVER_URL = (process.env.GEMINI_PET_SERVER_URL || 'http://127.0.0.1:47821').replace(/\/$/, '');
const ENABLE_TRAY = process.env.GEMINI_PET_TRAY !== '0';
const SMOKE_MODE = process.env.GEMINI_PET_SMOKE === '1';
const SMOKE_OUT = process.env.GEMINI_PET_SMOKE_OUT || '';

function parsePetsEnv() {
  try {
    const parsed = JSON.parse(process.env.GEMINI_PET_PETS || '[]');
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    /* fallback below */
  }
  return [{ id: 'main', name: '星芒喵', size: 240, index: 0 }];
}

const windows = new Map(); // petId -> BrowserWindow
const windowMeta = new Map(); // win.id -> { petId, margins, ignoring, busy, input, offBodyMs, lastZone, lastBoundsKey }
const flightStates = new Map(); // petId -> { id, x, y, vx, vy, size }
let flightBroadcastTimer = null;
let tray = null;

function setWindowIgnore(win, ignore) {
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(ignore, { forward: true });
  const meta = windowMeta.get(win.id);
  if (meta) meta.ignoring = ignore;
}

function keepOffTaskbar(win) {
  if (!win || win.isDestroyed()) return;
  win.setSkipTaskbar(true);
  setTimeout(() => {
    if (!win.isDestroyed()) win.setSkipTaskbar(true);
  }, 0);
}

function topmostLevel() {
  return process.platform === 'darwin' ? 'floating' : 'screen-saver';
}

function computeMargins(size) {
  const l = Math.max(110, Math.round(size * 0.52));
  const r = l;
  const t = Math.max(150, Math.round(size * 0.7));
  const b = 36;
  return { l, r, t, b };
}

function computeCornerWindowPosition(pet, winW, winH, margins, workArea) {
  const pos = pet.position || {};
  const mx = Number.isFinite(pos.marginX) ? pos.marginX : 28 + (pet.index || 0) * 110;
  const my = Number.isFinite(pos.marginY) ? pos.marginY : 24;
  const corner = pos.corner || 'bottom-right';
  const size = pet.size || 240;

  let bodyX = workArea.x + workArea.width - size - mx;
  let bodyY = workArea.y + workArea.height - size - my;
  if (corner === 'bottom-left') {
    bodyX = workArea.x + mx;
  } else if (corner === 'top-left') {
    bodyX = workArea.x + mx;
    bodyY = workArea.y + my;
  } else if (corner === 'top-right') {
    bodyY = workArea.y + my;
  }

  return {
    x: Math.round(bodyX - margins.l),
    y: Math.round(bodyY - margins.t),
    width: winW,
    height: winH,
  };
}

function broadcastFlightStates() {
  if (flightBroadcastTimer) {
    clearTimeout(flightBroadcastTimer);
    flightBroadcastTimer = null;
  }
  const list = Array.from(flightStates.values());
  for (const win of windows.values()) {
    if (!win.isDestroyed()) {
      win.webContents.send('pet:flight-states', list);
    }
  }
}

function startPointerPump(win) {
  let lastPt = null;
  let lastPtAt = Date.now();
  let wasNear = false;

  const timer = setInterval(() => {
    if (win.isDestroyed()) return;
    const meta = windowMeta.get(win.id);
    if (!meta) return;
    const bounds = win.getBounds();
    if (bounds.width < 8 || bounds.height < 8) return;

    const nowMs = Date.now();
    const point = screen.getCursorScreenPoint();
    const dtSec = Math.max(0.016, (nowMs - lastPtAt) / 1000);
    const speedPxSec = lastPt ? Math.hypot(point.x - lastPt.x, point.y - lastPt.y) / dtSec : 0;
    lastPt = point;
    lastPtAt = nowMs;

    const stageSize = Math.max(80, bounds.width - meta.margins.l - meta.margins.r);
    const bodyCx = bounds.x + meta.margins.l + stageSize * 0.5;
    const bodyCy = bounds.y + meta.margins.t + stageSize * 0.44;
    const distPx = Math.hypot(point.x - bodyCx, point.y - bodyCy);
    const near = distPx <= 220;
    if (near || wasNear) {
      win.webContents.send('pet:cursor-proximity', {
        distPx,
        dirX: Math.max(-1, Math.min(1, (point.x - bodyCx) / 160)),
        dirY: Math.max(-1, Math.min(1, (point.y - bodyCy) / 160)),
        speedPxSec,
      });
    }
    wasNear = near;

    const zone = pointerZone(bounds, point, meta.margins);
    if (!meta.busy && leavesBody(meta.lastZone, zone)) {
      win.webContents.send('pet:pointer-left');
    }
    meta.lastZone = zone;

    // 400ms margin hysteresis prevents rapid flicker at body edge
    meta.offBodyMs = !meta.busy && zone === 'margin' ? meta.offBodyMs + POINTER_POLL_MS : 0;
    const nextIgnore = decideWindowIgnore(
      bounds,
      point,
      meta.ignoring,
      meta.busy,
      meta.offBodyMs,
      meta.input,
      meta.margins,
    );
    if (nextIgnore !== meta.ignoring) {
      setWindowIgnore(win, nextIgnore);
    }
  }, POINTER_POLL_MS);

  return () => clearInterval(timer);
}

function createPetWindow(pet, index) {
  const primary = screen.getPrimaryDisplay();
  const workArea = primary.workArea;
  const size = Number(pet.size) > 0 ? Number(pet.size) : 240;
  const margins = computeMargins(size);
  const winW = Math.round(size + margins.l + margins.r);
  const winH = Math.round(size + margins.t + margins.b);
  const initialRect = computeCornerWindowPosition({ ...pet, size, index }, winW, winH, margins, workArea);
  const iconPath = path.resolve(__dirname, '..', '..', 'assets', 'icon.png');

  const win = new BrowserWindow({
    x: initialRect.x,
    y: initialRect.y,
    width: initialRect.width,
    height: initialRect.height,
    show: false,
    useContentSize: true,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    focusable: true,
    enableLargerThanScreen: true,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      paintWhenInitiallyHidden: true,
      spellcheck: false,
    },
  });

  windowMeta.set(win.id, {
    petId: pet.id,
    margins,
    ignoring: true,
    busy: false,
    input: { dragging: false, rects: [] },
    offBodyMs: 0,
    lastZone: 'outside',
    lastBoundsKey: `${initialRect.x},${initialRect.y},${initialRect.width},${initialRect.height}`,
  });

  win.setAlwaysOnTop(true, topmostLevel());
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('context-menu', (e) => e.preventDefault());
  setWindowIgnore(win, true);

  win.on('show', () => keepOffTaskbar(win));
  win.once('ready-to-show', () => {
    keepOffTaskbar(win);
    // CRITICAL: showInactive avoids stealing Antigravity IDE editor keyboard focus!
    win.showInactive();
  });

  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible()) {
        keepOffTaskbar(win);
        win.showInactive();
      }
    }, 350);
  });

  const stopPump = startPointerPump(win);

  win.on('closed', () => {
    stopPump();
    windowMeta.delete(win.id);
    windows.delete(pet.id);
    flightStates.delete(pet.id);
    broadcastFlightStates();
  });

  const displaysPayload = screen.getAllDisplays().map((d) => ({
    id: d.id,
    bounds: d.bounds,
    workArea: d.workArea,
    scaleFactor: d.scaleFactor,
  }));

  win.loadFile(path.join(__dirname, 'index.html'), {
    query: {
      serverUrl: SERVER_URL,
      petId: String(pet.id),
      petIndex: String(index),
      margins: JSON.stringify(margins),
      displays: JSON.stringify(displaysPayload),
      smoke: SMOKE_MODE ? '1' : '0',
    },
  }).catch((err) => {
    console.error(`[gemini-pet-helper] loadFile error (${pet.id}):`, err);
    win.destroy();
  });

  windows.set(pet.id, win);
  return win;
}

function postServer(pathname, body) {
  return fetch(`${SERVER_URL}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).catch(() => {});
}

function createSystemTray() {
  if (!ENABLE_TRAY || SMOKE_MODE) return;
  const iconPath = path.resolve(__dirname, '..', '..', 'assets', 'icon.png');
  if (!fs.existsSync(iconPath)) return;
  try {
    const img = nativeImage.createFromPath(iconPath);
    tray = new Tray(img.resize({ width: 16, height: 16 }));
    tray.setToolTip('Gemini 星芒异色瞳猫娘桌宠');
    const triggerTrayAnim = (anim) =>
      void postServer('/action', { action: 'anim', anim, force: true, lockMs: 5000 });
    const menu = Menu.buildFromTemplate([
      { label: '🐟 投喂小鱼干', click: () => triggerTrayAnim('eat_fish') },
      { label: '🍪 投喂星形曲奇', click: () => triggerTrayAnim('eat_cookie') },
      { label: '💖 打招呼 / 卖萌', click: () => triggerTrayAnim('click_wave') },
      { label: '🎉 开心欢呼', click: () => triggerTrayAnim('click_happy') },
      { label: '😤 傲娇生闷气', click: () => triggerTrayAnim('click_tsundere') },
      { label: '👀 暗中观察', click: () => triggerTrayAnim('peek') },
      { label: '✦ 抛玩悬浮四角星', click: () => triggerTrayAnim('toss_star') },
      {
        label: '✨ 更多可爱动作',
        submenu: [
          { label: '伸个大懒腰', click: () => triggerTrayAnim('stretch') },
          { label: '晃耳哼歌 ♪', click: () => triggerTrayAnim('hum') },
          { label: '整理呆毛与裙摆', click: () => triggerTrayAnim('groom') },
          { label: '凝聚星芒魔法', click: () => triggerTrayAnim('star_magic') },
          { label: '转圈展示星空裙', click: () => triggerTrayAnim('spin_show') },
          { label: '害羞捂脸 >///<', click: () => triggerTrayAnim('click_shy') },
          { label: '挠痒咯咯笑', click: () => triggerTrayAnim('click_tickle') },
        ],
      },
      { type: 'separator' },
      { label: '💤 抱星打盹', click: () => triggerTrayAnim('sleep_start') },
      { label: '☀️ 叫醒猫娘', click: () => triggerTrayAnim('sleep_end') },
      { type: 'separator' },
      { label: '🐾 召唤新猫娘（多开）', click: () => void postServer('/config', { op: 'add-pet' }) },
      { label: '🏠 猫娘回到右下角', click: () => void postServer('/action', { action: 'reset-pos' }) },
      {
        label: '🎨 形象风格切换',
        submenu: [
          { label: 'Q版萌系全动作（默认）', click: () => void postServer('/config', { avatarStyle: 'chibi' }) },
          { label: '精致立绘全动作', click: () => void postServer('/config', { avatarStyle: 'illust' }) },
          { label: '双画风混搭', click: () => void postServer('/config', { avatarStyle: 'mixed' }) },
        ],
      },
      { type: 'separator' },
      { label: '📌 切回仅 IDE 内嵌模式', click: () => void postServer('/config', { displayMode: 'ide' }) },
      { label: '🙈 隐藏全部猫娘', click: () => void postServer('/config', { displayMode: 'none' }) },
    ]);
    tray.setContextMenu(menu);
  } catch (err) {
    console.warn('[gemini-pet-helper] Tray init failed:', err?.message || err);
  }
}

function registerIpc() {
  ipcMain.handle('pet:cursor-point', () => screen.getCursorScreenPoint());

  ipcMain.on('pet:set-bounds', (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || !payload) return;
    const meta = windowMeta.get(win.id);
    const x = Math.round(payload.x);
    const y = Math.round(payload.y);
    const width = Math.round(payload.width);
    const height = Math.round(payload.height);
    if (meta && payload.margins) {
      meta.margins = payload.margins;
    }
    const key = `${x},${y},${width},${height}`;
    if (meta && meta.lastBoundsKey === key) return;
    if (meta) meta.lastBoundsKey = key;
    win.setBounds({ x, y, width, height }, false);
  });

  ipcMain.on('pet:input-busy', (event, busy) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const meta = windowMeta.get(win.id);
    if (!meta) return;
    meta.busy = Boolean(busy);
    if (meta.busy) setWindowIgnore(win, false);
  });

  ipcMain.on('pet:input-state', (event, input) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || !input) return;
    const meta = windowMeta.get(win.id);
    if (!meta) return;
    meta.input = {
      dragging: Boolean(input.dragging),
      rects: Array.isArray(input.rects) ? input.rects : [],
    };
    if (meta.input.dragging) {
      setWindowIgnore(win, false);
    }
  });

  ipcMain.on('pet:focus-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.focus();
    }
  });

  ipcMain.on('pet:flight-update', (_event, st) => {
    if (!st || !st.id) return;
    flightStates.set(st.id, st);
    if (windows.size < 2 || flightBroadcastTimer) return;
    flightBroadcastTimer = setTimeout(broadcastFlightStates, 16);
    flightBroadcastTimer.unref?.();
  });

  ipcMain.handle('pet:server-post', async (_event, pathname, body) => {
    const res = await fetch(`${SERVER_URL}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return { ok: res.ok, status: res.status };
  });
}

let activeWindowProbeChild = null;
let activeWindowPollTimer = null;

function startActiveWindowProbe() {
  if (process.platform !== 'win32' || SMOKE_MODE || activeWindowProbeChild) return;

  // Pure in-memory Reflection.Emit P/Invoke worker: zero disk writes on C:\ or D:\
  const psScript = [
    "$asm = [AppDomain]::CurrentDomain.DefineDynamicAssembly((New-Object Reflection.AssemblyName 'GeminiPetWinProbe'), [Reflection.Emit.AssemblyBuilderAccess]::Run)",
    "$mod = $asm.DefineDynamicModule('M')",
    "$sigRect = $mod.DefineType('RECT', 'Public, SequentialLayout, Sealed', [ValueType])",
    "@('Left','Top','Right','Bottom') | ForEach-Object { [void]$sigRect.DefineField($_, [int], 'Public') }",
    "$RType = $sigRect.CreateType()",
    "$tb = $mod.DefineType('U32', 'Public, Abstract, Sealed')",
    "foreach ($def in @(@('GetForegroundWindow',[IntPtr],@()), @('GetWindowRect',[bool],@([IntPtr],$RType.MakeByRefType())), @('IsIconic',[bool],@([IntPtr])), @('GetWindowThreadProcessId',[uint32],@([IntPtr],[uint32].MakeByRefType())))) {",
    "  $m = $tb.DefinePInvokeMethod($def[0], 'user32.dll', 'Public, Static, PinvokeImpl', 'Standard', $def[1], $def[2], 'Winapi', 'Auto')",
    "  $m.SetImplementationFlags($m.GetMethodImplementationFlags() -bor [Reflection.MethodImplAttributes]::PreserveSig)",
    "}",
    "$U = $tb.CreateType()",
    "$r = [Activator]::CreateInstance($RType)",
    "while (($line = [Console]::In.ReadLine()) -ne $null) {",
    "  $h = $U::GetForegroundWindow()",
    "  $p = [uint32]0",
    "  if ($h -ne [IntPtr]::Zero -and -not $U::IsIconic($h) -and $U::GetWindowRect($h, [ref]$r)) {",
    "    $null = $U::GetWindowThreadProcessId($h, [ref]$p)",
    "    [Console]::Out.WriteLine(('{\"ok\":true,\"pid\":' + $p + ',\"x\":' + $r.Left + ',\"y\":' + $r.Top + ',\"w\":' + ($r.Right-$r.Left) + ',\"h\":' + ($r.Bottom-$r.Top) + '}'))",
    "  } else {",
    "    [Console]::Out.WriteLine('{\"ok\":false}')",
    "  }",
    "  [Console]::Out.Flush()",
    "}",
  ].join('\n');

  try {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      cwd: TEMP_DIR,
      env: { ...process.env, TEMP: TEMP_DIR, TMP: TEMP_DIR },
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    activeWindowProbeChild = child;

    let buf = '';
    child.stdout?.on('data', (chunk) => {
      buf += String(chunk);
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          let payload = null;
          if (parsed && parsed.ok && parsed.pid !== process.pid && parsed.w >= 360 && parsed.h >= 220) {
            payload = { x: parsed.x, y: parsed.y, width: parsed.w, height: parsed.h };
          }
          for (const win of windows.values()) {
            if (!win.isDestroyed()) win.webContents.send('pet:active-window', payload);
          }
        } catch {
          /* ignore malformed probe line */
        }
      }
    });

    child.once('exit', () => {
      if (activeWindowProbeChild === child) activeWindowProbeChild = null;
      if (activeWindowPollTimer) {
        clearInterval(activeWindowPollTimer);
        activeWindowPollTimer = null;
      }
    });

    activeWindowPollTimer = setInterval(() => {
      if (child.stdin && !child.stdin.destroyed) {
        try {
          child.stdin.write('\n');
        } catch {
          /* ignore */
        }
      }
    }, 1600);
    activeWindowPollTimer.unref?.();
  } catch {
    /* non-fatal: desktop pet still runs cleanly without active window perch */
  }
}

function stopActiveWindowProbe() {
  if (activeWindowPollTimer) {
    clearInterval(activeWindowPollTimer);
    activeWindowPollTimer = null;
  }
  if (activeWindowProbeChild) {
    try {
      activeWindowProbeChild.stdin?.end();
      activeWindowProbeChild.kill();
    } catch {
      /* ignore */
    }
    activeWindowProbeChild = null;
  }
}

app.whenReady().then(() => {
  registerIpc();
  createSystemTray();

  const pets = parsePetsEnv();
  const created = pets.map((pet, idx) => createPetWindow(pet, idx));
  startActiveWindowProbe();

  const reassertTaskbar = () => {
    for (const win of windows.values()) keepOffTaskbar(win);
  };
  powerMonitor.on('resume', reassertTaskbar);
  powerMonitor.on('unlock-screen', reassertTaskbar);

  const pushDisplays = () => {
    const displays = screen.getAllDisplays().map((d) => ({
      id: d.id,
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
    }));
    for (const win of windows.values()) {
      if (!win.isDestroyed()) win.webContents.send('pet:displays', displays);
    }
  };
  screen.on('display-added', pushDisplays);
  screen.on('display-removed', pushDisplays);
  screen.on('display-metrics-changed', pushDisplays);

  if (SMOKE_MODE && created[0]) {
    const first = created[0];
    first.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (!first.isDestroyed() && SMOKE_OUT) {
            fs.mkdirSync(path.dirname(SMOKE_OUT), { recursive: true });
            const image = await first.webContents.capturePage();
            fs.writeFileSync(SMOKE_OUT, image.toPNG());
            process.stdout.write(`[smoke] captured ${SMOKE_OUT}\n`);
          }
        } catch (err) {
          process.stderr.write(`[smoke] capture error: ${err?.message || err}\n`);
        } finally {
          app.exit(0);
        }
      }, 1200);
    });
  }
});

app.on('before-quit', () => {
  stopActiveWindowProbe();
  if (tray) {
    try {
      tray.destroy();
    } catch {
      /* ignore */
    }
    tray = null;
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
