const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const multer = require('multer');
const XLSX = require('xlsx');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, 'data', 'rundown.json');
const upload = multer({ dest: path.join(__dirname, 'uploads') });

const DEPARTMENTS = ['sound', 'lights', 'video', 'backstage'];

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// index.html lives at the project root (not inside public/) so it's easy to find,
// but we serve it via an explicit route rather than statically serving the whole
// root directory — that would also expose server.js, data/rundown.json, etc.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ---------- State ----------
function defaultState() {
  return {
    event: { name: 'Untitled Event', startTime: '', date: '' },
    items: [],
    currentIndex: null,
    timer: {
      running: false,
      remainingSec: 0,
      totalSec: 0,
      lastTick: null,
      overrun: false
    },
    message: { text: '', visible: false, target: 'all' },
    timerVisible: true,
    settings: { autoSaveIntervalSec: 30 }
  };
}

let state = defaultState();

function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      const def = defaultState();
      state = {
        ...def, ...loaded,
        event: { ...def.event, ...(loaded.event || {}) },
        timer: { ...def.timer, ...(loaded.timer || {}) },
        message: { ...def.message, ...(loaded.message || {}) },
        settings: { ...def.settings, ...(loaded.settings || {}) },
        items: (loaded.items || []).map(it => ({ cues: [], ...it }))
      };
    }
  } catch (e) {
    console.error('Failed to load state, starting fresh:', e.message);
    state = defaultState();
  }
}

function saveState() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function broadcast() {
  io.emit('state', state);
}

function makeId() {
  return 'i_' + Math.random().toString(36).slice(2, 10);
}

function parseDurationToSec(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') {
    // Excel may give fraction-of-day for time cells, or plain minutes
    if (val < 1) return Math.round(val * 24 * 60 * 60); // excel time fraction
    return Math.round(val * 60); // treat plain number as minutes
  }
  let str = String(val).trim();
  // Allow "." as a time divider (e.g. 5.30 == 5:30). Normalize to colon form first.
  if (/^\d+\.\d{2}(\.\d{2})?$/.test(str)) {
    str = str.replace(/\./g, ':');
  }
  // formats: mm:ss , h:mm:ss , "5" (minutes), "5m", "90s"
  if (/^\d+:\d{2}(:\d{2})?$/.test(str)) {
    const parts = str.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  const mMatch = str.match(/^(\d+(\.\d+)?)\s*m$/i);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 60);
  const sMatch = str.match(/^(\d+)\s*s$/i);
  if (sMatch) return parseInt(sMatch[1], 10);
  const num = parseFloat(str);
  if (!isNaN(num)) return Math.round(num * 60);
  return 0;
}

loadState();

// ---------- Auto-save loop (separate from the immediate save-on-change) ----------
let autoSaveHandle = null;
function restartAutoSave() {
  if (autoSaveHandle) clearInterval(autoSaveHandle);
  const sec = (state.settings && state.settings.autoSaveIntervalSec) || 30;
  autoSaveHandle = setInterval(() => {
    saveState();
    console.log(`[autosave] rundown saved at ${new Date().toLocaleTimeString()}`);
  }, sec * 1000);
}
restartAutoSave();

// ---------- REST API ----------

function getLanIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip internal (127.0.0.1) and non-IPv4 addresses
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

app.get('/api/state', (req, res) => res.json(state));

// Public, read-only feed for external applications to consume (full item list + status).
// CORS-enabled above so other apps/domains can fetch this directly.
app.get('/api/public/rundown', (req, res) => {
  res.json({
    event: state.event,
    currentIndex: state.currentIndex,
    currentItemId: state.currentIndex !== null ? state.items[state.currentIndex].id : null,
    timer: {
      running: state.timer.running,
      remainingSec: state.timer.remainingSec,
      totalSec: state.timer.totalSec,
      elapsedSec: state.timer.totalSec - state.timer.remainingSec,
      overrun: state.timer.overrun
    },
    items: state.items.map(it => ({
      id: it.id,
      order: it.order,
      item: it.item,
      presenter: it.presenter,
      durationSec: it.durationSec,
      status: it.status,
      notes: it.notes,
      cues: it.cues
    }))
  });
});

// Generate a QR code PNG for any text/URL, e.g. /api/qr?text=http://192.168.1.20:3000/output.html?role=sound
app.get('/api/qr', async (req, res) => {
  const text = req.query.text;
  if (!text) return res.status(400).send('Missing text parameter');
  try {
    const buffer = await QRCode.toBuffer(text, { width: 300, margin: 1, color: { dark: '#000000', light: '#ffffff' } });
    res.set('Content-Type', 'image/png');
    res.send(buffer);
  } catch (e) {
    res.status(500).send('QR generation failed: ' + e.message);
  }
});

// Lets the frontend detect the LAN address(es) other devices should use instead of localhost.
app.get('/api/network-info', (req, res) => {
  res.json({ port: PORT, lanIPs: getLanIPs() });
});

app.post('/api/event', (req, res) => {
  const { name, startTime, date } = req.body;
  if (name !== undefined) state.event.name = name;
  if (startTime !== undefined) state.event.startTime = startTime;
  if (date !== undefined) state.event.date = date;
  saveState(); broadcast();
  res.json(state.event);
});

app.post('/api/settings', (req, res) => {
  const { autoSaveIntervalSec } = req.body;
  if (autoSaveIntervalSec !== undefined) {
    state.settings.autoSaveIntervalSec = Math.max(5, Number(autoSaveIntervalSec) || 30);
    restartAutoSave();
  }
  saveState(); broadcast();
  res.json(state.settings);
});

// Import rundown from Excel
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    const wb = XLSX.readFile(req.file.path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    const items = rows.map((row, idx) => {
      // Flexible column name matching (case-insensitive)
      const get = (...names) => {
        for (const key of Object.keys(row)) {
          if (names.some(n => n.toLowerCase() === key.toLowerCase())) return row[key];
        }
        return '';
      };
      const durationRaw = get('Duration', 'Length', 'Time');
      return {
        id: makeId(),
        order: idx,
        item: String(get('Item', 'Segment', 'Title') || `Item ${idx + 1}`),
        presenter: String(get('Presenter', 'Compere', 'Host') || ''),
        durationSec: parseDurationToSec(durationRaw),
        notes: {
          general: String(get('Notes', 'Notes_General', 'General Notes') || ''),
          sound: String(get('Notes_Sound', 'Sound', 'Sound Notes') || ''),
          lights: String(get('Notes_Lights', 'Lights', 'Lights Notes') || ''),
          video: String(get('Notes_Video', 'Video', 'Video Notes') || ''),
          backstage: String(get('Notes_Backstage', 'Backstage', 'Backstage Notes') || '')
        },
        status: 'pending',
        cues: []
      };
    }).filter(it => it.item && it.item.trim() !== '');

    // Optional second sheet named "Cues" (or "Cue Timeline") to pre-populate cue timelines.
    // Columns: Item, CueTime, Label, Target
    const cueSheetName = wb.SheetNames.find(n => /^cues?$|cue.?timeline/i.test(n.trim()));
    if (cueSheetName) {
      const cueRows = XLSX.utils.sheet_to_json(wb.Sheets[cueSheetName], { defval: '' });
      const byName = new Map(items.map(it => [it.item.trim().toLowerCase(), it]));
      cueRows.forEach(row => {
        const get = (...names) => {
          for (const key of Object.keys(row)) {
            if (names.some(n => n.toLowerCase() === key.toLowerCase())) return row[key];
          }
          return '';
        };
        const itemName = String(get('Item', 'Segment', 'Title') || '').trim();
        const it = byName.get(itemName.toLowerCase());
        if (!it) return;
        const timeSec = parseDurationToSec(get('CueTime', 'Cue Time', 'Time', 'Offset'));
        const label = String(get('Label', 'Cue', 'Description') || '').trim();
        const cueTarget = String(get('Target', 'Department') || 'all').trim().toLowerCase() || 'all';
        if (!label) return;
        it.cues.push({ id: makeId(), timeSec, label, target: cueTarget });
      });
      items.forEach(it => it.cues.sort((a, b) => a.timeSec - b.timeSec));
    }

    state.items = items;
    state.currentIndex = null;
    state.timer = { running: false, remainingSec: 0, totalSec: 0, lastTick: null, overrun: false };
    fs.unlinkSync(req.file.path);
    saveState(); broadcast();
    res.json({ ok: true, count: items.length });
  } catch (e) {
    console.error(e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Reorder items: body { order: [id1, id2, ...] }
app.post('/api/items/reorder', (req, res) => {
  const orderIds = req.body.order;
  const byId = Object.fromEntries(state.items.map(i => [i.id, i]));
  const currentId = state.currentIndex !== null ? state.items[state.currentIndex]?.id : null;
  state.items = orderIds.map((id, idx) => ({ ...byId[id], order: idx })).filter(Boolean);
  if (currentId) {
    state.currentIndex = state.items.findIndex(i => i.id === currentId);
  }
  saveState(); broadcast();
  res.json({ ok: true });
});

// Add item
app.post('/api/items', (req, res) => {
  const { item = 'New Item', presenter = '', durationSec = 300 } = req.body;
  const newItem = {
    id: makeId(), order: state.items.length, item, presenter, durationSec,
    notes: { general: '', sound: '', lights: '', video: '', backstage: '' },
    status: 'pending',
    cues: []
  };
  state.items.push(newItem);
  saveState(); broadcast();
  res.json(newItem);
});

// Edit item fields (item name, presenter, duration)
app.patch('/api/items/:id', (req, res) => {
  const it = state.items.find(i => i.id === req.params.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  const { item, presenter, durationSec } = req.body;
  if (item !== undefined) it.item = item;
  if (presenter !== undefined) it.presenter = presenter;
  if (durationSec !== undefined) it.durationSec = durationSec;
  saveState(); broadcast();
  res.json(it);
});

// Update a note field for an item: body { field: 'sound'|'lights'|'video'|'backstage'|'general', value }
app.post('/api/items/:id/note', (req, res) => {
  const it = state.items.find(i => i.id === req.params.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  const { field, value } = req.body;
  if (!['general', ...DEPARTMENTS].includes(field)) return res.status(400).json({ error: 'bad field' });
  it.notes[field] = value;
  saveState(); broadcast();
  res.json(it);
});

// ---------- Cue timeline (per item) ----------
// A cue is a moment inside an item's duration, e.g. { timeSec: 45, label: 'Switch to wide cam', target: 'video' }
app.post('/api/items/:id/cues', (req, res) => {
  const it = state.items.find(i => i.id === req.params.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  const { timeSec = 0, label = '', target = 'all' } = req.body;
  if (!it.cues) it.cues = [];
  const cue = { id: makeId(), timeSec: Number(timeSec) || 0, label, target };
  it.cues.push(cue);
  it.cues.sort((a, b) => a.timeSec - b.timeSec);
  saveState(); broadcast();
  res.json(cue);
});

app.patch('/api/items/:itemId/cues/:cueId', (req, res) => {
  const it = state.items.find(i => i.id === req.params.itemId);
  if (!it) return res.status(404).json({ error: 'item not found' });
  const cue = (it.cues || []).find(c => c.id === req.params.cueId);
  if (!cue) return res.status(404).json({ error: 'cue not found' });
  const { timeSec, label, target } = req.body;
  if (timeSec !== undefined) cue.timeSec = Number(timeSec) || 0;
  if (label !== undefined) cue.label = label;
  if (target !== undefined) cue.target = target;
  it.cues.sort((a, b) => a.timeSec - b.timeSec);
  saveState(); broadcast();
  res.json(cue);
});

app.delete('/api/items/:itemId/cues/:cueId', (req, res) => {
  const it = state.items.find(i => i.id === req.params.itemId);
  if (!it) return res.status(404).json({ error: 'item not found' });
  it.cues = (it.cues || []).filter(c => c.id !== req.params.cueId);
  saveState(); broadcast();
  res.json({ ok: true });
});

app.delete('/api/items/:id', (req, res) => {
  const idx = state.items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  state.items.splice(idx, 1);
  state.items.forEach((it, i) => it.order = i);
  if (state.currentIndex !== null) {
    if (idx === state.currentIndex) { state.currentIndex = null; }
    else if (idx < state.currentIndex) { state.currentIndex -= 1; }
  }
  saveState(); broadcast();
  res.json({ ok: true });
});

// ---------- Control: selecting item & timer ----------

function selectIndex(idx) {
  state.items.forEach((it, i) => {
    it.status = i < idx ? 'done' : (i === idx ? 'current' : 'pending');
  });
  state.currentIndex = idx;
  const dur = state.items[idx] ? state.items[idx].durationSec : 0;
  state.timer = { running: false, remainingSec: dur, totalSec: dur, lastTick: null, overrun: false };
}

app.post('/api/control/select', (req, res) => {
  const idx = state.items.findIndex(i => i.id === req.body.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  selectIndex(idx);
  saveState(); broadcast();
  res.json({ ok: true });
});

app.post('/api/control/next', (req, res) => {
  const nextIdx = state.currentIndex === null ? 0 : state.currentIndex + 1;
  if (nextIdx >= state.items.length) return res.status(400).json({ error: 'no more items' });
  selectIndex(nextIdx);
  saveState(); broadcast();
  res.json({ ok: true });
});

app.post('/api/control/prev', (req, res) => {
  const prevIdx = state.currentIndex === null ? -1 : state.currentIndex - 1;
  if (prevIdx < 0) return res.status(400).json({ error: 'no previous item' });
  selectIndex(prevIdx);
  saveState(); broadcast();
  res.json({ ok: true });
});

app.post('/api/timer/start', (req, res) => {
  if (state.currentIndex === null) return res.status(400).json({ error: 'no current item selected' });
  state.timer.running = true;
  state.timer.lastTick = Date.now();
  saveState(); broadcast();
  res.json({ ok: true });
});

app.post('/api/timer/pause', (req, res) => {
  state.timer.running = false;
  state.timer.lastTick = null;
  saveState(); broadcast();
  res.json({ ok: true });
});

app.post('/api/timer/reset', (req, res) => {
  const dur = state.currentIndex !== null ? state.items[state.currentIndex].durationSec : 0;
  state.timer = { running: false, remainingSec: dur, totalSec: dur, lastTick: null, overrun: false };
  saveState(); broadcast();
  res.json({ ok: true });
});

app.post('/api/timer/adjust', (req, res) => {
  const delta = Number(req.body.deltaSec) || 0;
  state.timer.remainingSec += delta;
  saveState(); broadcast();
  res.json({ ok: true });
});

app.post('/api/timer/visibility', (req, res) => {
  state.timerVisible = !!req.body.visible;
  saveState(); broadcast();
  res.json({ ok: true });
});

// Message overlay for output pages: { text, visible, target }
app.post('/api/message', (req, res) => {
  state.message = {
    text: req.body.text ?? state.message.text,
    visible: !!req.body.visible,
    target: req.body.target || 'all'
  };
  saveState(); broadcast();
  res.json({ ok: true });
});

// ---------- Timer tick loop ----------
setInterval(() => {
  if (state.timer.running) {
    const now = Date.now();
    const elapsed = (now - (state.timer.lastTick || now)) / 1000;
    state.timer.lastTick = now;
    state.timer.remainingSec -= elapsed;
    if (state.timer.remainingSec <= 0 && !state.timer.overrun) {
      state.timer.overrun = true;
    }
  }
  io.emit('tick', { timer: state.timer, clock: new Date().toISOString() });
}, 500);

io.on('connection', (socket) => {
  socket.emit('state', state);
});

server.listen(PORT, '0.0.0.0', () => {
  const lanIPs = getLanIPs();
  console.log(`Rundown app running at http://localhost:${PORT}`);
  console.log(`Control panel:  http://localhost:${PORT}/`);
  if (lanIPs.length) {
    console.log(`\nOther devices on the same Wi-Fi/network can connect using:`);
    lanIPs.forEach(ip => console.log(`  http://${ip}:${PORT}/`));
    console.log(`\n(Open http://${lanIPs[0]}:${PORT}/qr.html on the computer running the server to get scannable QR codes for every output page.)`);
  } else {
    console.log(`\nCouldn't detect a LAN IP address automatically — check your network settings if you need to reach this from another device.`);
  }
});
