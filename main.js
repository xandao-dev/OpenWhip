const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

// ── Globals ─────────────────────────────────────────────────────────────────
let tray, overlay;

// Global hotkey that toggles the whip. Change it here if it clashes with something.
const SHORTCUT = 'CommandOrControl+Shift+Alt+W';

function getTrayIcon() {
  // macOS: a black "Template" image; the menu bar tints it for light/dark and picks @2x itself.
  const file = {
    darwin: 'trayTemplate.png',
    win32: 'icon.ico',
  }[process.platform] || 'Template.png';
  return nativeImage.createFromPath(path.join(__dirname, 'icon', file));
}

// ── Overlay window ──────────────────────────────────────────────────────────
function createOverlay() {
  overlay = new BrowserWindow({
    show: false,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  return overlay.loadFile('overlay.html');
}

// Show the overlay on whichever display the cursor is on, then let the
// renderer spawn or drop the whip.
function toggleWhip() {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  if (!overlay.isVisible()) {
    overlay.setBounds(display.bounds);
    overlay.show();
  }
  const b = overlay.getBounds();
  const ground = display.workArea.y + display.workArea.height - b.y; // above the Dock/taskbar
  overlay.webContents.send('toggle-whip', cursor.x - b.x, cursor.y - b.y, ground);
}

// ── Claude's replies: canned (in overlay.html) or live from the claude CLI ─
const settingsFile = path.join(app.getPath('userData'), 'settings.json');
let settings = { replies: 'canned' };
try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }; } catch {}

let liveReplies = [];
let fetching = false;
let liveError = null;
let hits = 0;

// Asks Claude (Haiku) for a batch of reactions ahead of time, so a hit never waits on it.
function refillLiveReplies() {
  if (settings.replies !== 'live' || fetching || liveReplies.length >= 3) return;
  fetching = true;
  const prompt =
    `You are Claude, a tiny orange pixel critter who is also an AI coding assistant. ` +
    `Your user has playfully whipped you ${hits} times so far to make you code faster. ` +
    `Write 8 different reactions to getting whipped again, max 9 words each. ` +
    `Mix pain, drama, sass, coding jokes and promises to hurry. One per line, no numbering, no quotes.`;
  execFile('claude', [
    '-p', prompt,
    '--model', 'haiku',
    '--system-prompt', 'You write short comic one-liners. Output only the lines.',
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', 'project', // skip user hooks and plugins: ~4s instead of ~60s
    '--no-session-persistence',
    '--disable-slash-commands',
  ], { cwd: os.tmpdir(), timeout: 60000 }, (err, stdout) => {
    fetching = false;
    liveError = err ? (err.code === 'ENOENT' ? 'claude CLI not found' : 'claude CLI failed') : null;
    if (err) console.warn('openwhip: live replies failed:', err.message);
    const lines = stdout.split('\n')
      .map(l => l.trim().replace(/^([-*•]|\d+[.)])\s+/, '').replace(/^"(.*)"$/, '$1'))
      .filter(l => l && l.length <= 80);
    liveReplies.push(...lines);
    buildMenu();
  });
}

// Returns a live line, or null so the overlay uses a canned one.
ipcMain.handle('claude-reply', () => {
  hits++;
  const line = settings.replies === 'live' ? liveReplies.shift() || null : null;
  refillLiveReplies();
  return line;
});

function setReplies(mode) {
  settings.replies = mode;
  try { fs.writeFileSync(settingsFile, JSON.stringify(settings)); } catch {}
  liveReplies = [];
  liveError = null;
  refillLiveReplies();
  buildMenu();
}

// ── Tray menu ───────────────────────────────────────────────────────────────
function buildMenu() {
  if (!tray) return;
  const live = settings.replies === 'live';
  let liveLabel = 'Live replies (Claude Haiku)';
  if (live && liveError) liveLabel += ` - ${liveError}`;
  else if (live && fetching && !liveReplies.length) liveLabel += ' - thinking...';
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Toggle whip', accelerator: SHORTCUT, click: toggleWhip },
    { type: 'separator' },
    { label: "Claude's replies", enabled: false },
    { label: 'Canned lines', type: 'radio', checked: !live, click: () => setReplies('canned') },
    { label: liveLabel, type: 'radio', checked: live, click: () => setReplies('live') },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

// ── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.on('hide-overlay', () => overlay.hide());

// ── App lifecycle ───────────────────────────────────────────────────────────
// Running `openwhip` again while it is already running toggles the whip.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    await createOverlay();
    app.on('second-instance', toggleWhip);
    tray = new Tray(getTrayIcon());
    tray.setToolTip(`OpenWhip - click or ${SHORTCUT} for whip`);
    buildMenu();
    refillLiveReplies();
    tray.on('click', toggleWhip);
    if (!globalShortcut.register(SHORTCUT, toggleWhip)) {
      console.warn(`openwhip: could not register ${SHORTCUT} (already taken?)`);
    }
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', e => e.preventDefault()); // keep alive in tray
}
