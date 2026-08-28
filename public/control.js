const socket = io();
let state = null;
let editingItemId = null;
let dragSrcId = null;

const el = (id) => document.getElementById(id);

// If this page is being viewed via "localhost" or "127.0.0.1", other devices on the
// Wi-Fi (phones, other laptops) can't reach it at that address — show them the LAN address instead.
(function showLanBannerIfNeeded() {
  const host = window.location.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') return;
  fetch('/api/network-info').then(r => r.json()).then(info => {
    if (!info.lanIPs || !info.lanIPs.length) return;
    const banner = el('lanBanner');
    const url = `http://${info.lanIPs[0]}:${info.port}/`;
    banner.innerHTML = `To view output pages on phones/tablets on this Wi-Fi, use <b>${url}</b> on those devices instead of localhost. <a href="/qr.html" style="color:#9adcff;" target="_blank">Get QR codes →</a>`;
    banner.classList.remove('hidden');
  }).catch(() => {});
})();

function fmtTime(sec) {
  const neg = sec < 0;
  sec = Math.abs(Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return (neg ? '-' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

// For editable time fields we use "." as the divider (e.g. 5.30 = 5 min 30 sec)
function fmtTimeDot(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, '0') + '.' + String(s).padStart(2, '0');
}

function fmtClock(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function computeEndTime() {
  if (!state) return '';

  // Once the show is live, project the end time from right now: whatever's left of the
  // current item, plus every item still to come. This drifts automatically if the show
  // runs ahead or behind schedule.
  if (state.currentIndex !== null) {
    const remainingCurrent = state.timer.remainingSec; // can be negative if overrunning
    const remainingFuture = state.items
      .slice(state.currentIndex + 1)
      .reduce((sum, it) => sum + (it.durationSec || 0), 0);
    const end = new Date(Date.now() + (remainingCurrent + remainingFuture) * 1000);
    return 'End time ' + fmtClock(end) + (remainingCurrent < 0 ? ' (running late)' : '');
  }

  // Before the show starts, fall back to the static schedule: start time + full planned duration.
  if (!state.event.startTime) return '';
  const totalSec = state.items.reduce((sum, it) => sum + (it.durationSec || 0), 0);
  const [h, m] = state.event.startTime.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return '';
  const start = new Date();
  start.setHours(h, m, 0, 0);
  const end = new Date(start.getTime() + totalSec * 1000);
  return 'End time ' + fmtClock(end);
}

function render() {
  if (!state) return;
  el('eventName').textContent = state.event.name;
  el('endTime').textContent = computeEndTime();

  // Default the editing selection to the live item the first time we have data
  if (editingItemId === null && state.currentIndex !== null) {
    editingItemId = state.items[state.currentIndex].id;
  }

  const body = el('rundownBody');
  body.innerHTML = '';
  state.items.forEach((it, idx) => {
    const tr = document.createElement('tr');
    tr.draggable = true;
    tr.dataset.id = it.id;
    if (it.status === 'current') tr.classList.add('current');
    if (it.status === 'done') tr.classList.add('done');
    if (it.id === editingItemId) tr.classList.add('editing');

    tr.innerHTML = `
      <td class="dragHandle">⠿</td>
      <td>${idx + 1}</td>
      <td><input value="${escapeHtml(it.item)}" data-edit="item" data-id="${it.id}"></td>
      <td><input value="${escapeHtml(it.presenter)}" data-edit="presenter" data-id="${it.id}"></td>
      <td><input style="width:70px" value="${fmtTimeDot(it.durationSec)}" data-edit="duration" data-id="${it.id}"></td>
      <td><input value="${escapeHtml(it.notes.general)}" data-note="general" data-id="${it.id}"></td>
      <td>
        <button class="selectBtn" data-update="${it.id}">Update</button>
        <button class="delBtn" data-del="${it.id}">✕</button>
      </td>
    `;
    body.appendChild(tr);
  });

  // Click anywhere on a row (not on its inputs/buttons) to select it for editing —
  // this only changes what shows in the EDITING panel, it does NOT touch the live show.
  body.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('input, button, select, textarea')) return;
      editingItemId = tr.dataset.id;
      render();
    });
  });

  // Drag & drop reorder
  body.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('dragstart', () => dragSrcId = tr.dataset.id);
    tr.addEventListener('dragover', (e) => e.preventDefault());
    tr.addEventListener('drop', () => {
      if (!dragSrcId || dragSrcId === tr.dataset.id) return;
      const ids = state.items.map(i => i.id);
      const from = ids.indexOf(dragSrcId);
      const to = ids.indexOf(tr.dataset.id);
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      fetch('/api/items/reorder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: ids })
      });
    });
  });

  // "Update" button = explicitly make this item the LIVE item (jumps the show timer to it).
  // This is the only thing that changes what's playing — browsing/editing rows no longer does.
  body.querySelectorAll('[data-update]').forEach(b =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      editingItemId = b.dataset.update;
      fetch('/api/control/select', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: b.dataset.update })
      });
    }));

  body.querySelectorAll('[data-del]').forEach(b =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('Delete this item?')) fetch('/api/items/' + b.dataset.del, { method: 'DELETE' });
    }));

  body.querySelectorAll('[data-edit]').forEach(inp =>
    inp.addEventListener('change', () => {
      const id = inp.dataset.id, field = inp.dataset.edit;
      const body = {};
      if (field === 'duration') body.durationSec = parseDur(inp.value);
      else if (field === 'item') body.item = inp.value;
      else if (field === 'presenter') body.presenter = inp.value;
      fetch('/api/items/' + id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
    }));

  body.querySelectorAll('[data-note]').forEach(inp =>
    inp.addEventListener('change', () => fetch(`/api/items/${inp.dataset.id}/note`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field: inp.dataset.note, value: inp.value })
    })));

  // Editing panel — reflects whichever item was clicked in the table (editingItemId),
  // completely independent from the live/playing item.
  const editingItem = state.items.find(i => i.id === editingItemId) || null;
  el('editingItemName').textContent = editingItem ? editingItem.item : 'Click a row to view/edit its notes & cues';

  if (editingItem && document.activeElement.tagName !== 'TEXTAREA') {
    const notesEditor = el('notesEditor');
    notesEditor.querySelectorAll('textarea').forEach(ta => {
      if (document.activeElement !== ta) ta.value = editingItem.notes[ta.dataset.field] || '';
      ta.dataset.id = editingItem.id;
    });
  }

  // Live bar — always reflects the item actually playing (state.currentIndex), regardless of editingItemId
  const live = state.currentIndex !== null ? state.items[state.currentIndex] : null;
  el('liveItemName').textContent = live ? live.item : 'No item live';

  renderCues(editingItem);
  renderTimer();
  renderMainBottomTimeline();
  el('toggleTimerBtn').textContent = state.timerVisible ? '👁 Hide Timer on Outputs' : '🚫 Show Timer on Outputs';
}

function fmtCueTime(sec) {
  return fmtTimeDot(sec);
}

function tickIntervalFor(duration) {
  if (duration <= 60) return 5;
  if (duration <= 300) return 15;
  if (duration <= 900) return 30;
  return 60;
}

const PX_PER_SEC = 40;

// Shared ruler + colored-segment timeline builder, used by both the per-item
// cue editor and the persistent bottom bar. `mode` is 'fit' or 'scroll'.
function buildTimeline(rulerEl, trackEl, playheadEl, duration, cues, mode, onSegmentClick, onEmptyClick) {
  duration = duration || 1;
  const interval = tickIntervalFor(duration);
  const widthFor = (t) => mode === 'scroll' ? (t * PX_PER_SEC) + 'px' : Math.min(100, (t / duration) * 100) + '%';

  if (mode === 'scroll') {
    const trackWidth = Math.max(duration * PX_PER_SEC, 400) + 'px';
    rulerEl.style.setProperty('--track-width', trackWidth);
    trackEl.style.setProperty('--track-width', trackWidth);
    rulerEl.classList.add('scrollMode');
    trackEl.classList.add('scrollMode');
  } else {
    rulerEl.classList.remove('scrollMode');
    trackEl.classList.remove('scrollMode');
  }

  // Ruler ticks
  rulerEl.innerHTML = '';
  for (let t = 0; t <= duration; t += interval) {
    const left = widthFor(t);
    const tick = document.createElement('div');
    tick.className = 'rulerTick major';
    tick.style.left = left;
    rulerEl.appendChild(tick);
    const label = document.createElement('div');
    label.className = 'rulerLabel';
    label.style.left = left;
    label.textContent = fmtTime(t);
    rulerEl.appendChild(label);
  }

  // Segments
  trackEl.querySelectorAll('.cueSegment').forEach(s => s.remove());
  const sorted = [...cues].sort((a, b) => a.timeSec - b.timeSec);
  const segments = [];
  if (!sorted.length) {
    segments.push({ start: 0, end: duration, cue: null });
  } else {
    if (sorted[0].timeSec > 0) segments.push({ start: 0, end: sorted[0].timeSec, cue: null });
    sorted.forEach((c, i) => {
      const end = i + 1 < sorted.length ? sorted[i + 1].timeSec : duration;
      segments.push({ start: c.timeSec, end, cue: c, index: i + 1 });
    });
  }

  segments.forEach(seg => {
    const div = document.createElement('div');
    const cls = seg.cue ? seg.cue.target : 'pre';
    div.className = `cueSegment ${cls}`;
    div.style.left = widthFor(seg.start);
    div.style.width = mode === 'scroll'
      ? ((seg.end - seg.start) * PX_PER_SEC) + 'px'
      : Math.max(0, ((seg.end - seg.start) / duration) * 100) + '%';
    if (seg.cue) {
      div.innerHTML = `<div class="segIdx">${seg.index}</div><div class="segLabel">${escapeHtml(seg.cue.label)}</div><div class="segSub">${seg.cue.target}</div>`;
      div.title = `${fmtTimeDot(seg.cue.timeSec)} — ${seg.cue.label} (${seg.cue.target})`;
      if (onSegmentClick) div.addEventListener('click', (e) => { e.stopPropagation(); onSegmentClick(seg.cue); });
    } else if (onEmptyClick) {
      div.addEventListener('click', (e) => {
        const rect = trackEl.getBoundingClientRect();
        const relX = e.clientX - rect.left;
        const t = mode === 'scroll' ? relX / PX_PER_SEC : (relX / rect.width) * duration;
        onEmptyClick(Math.max(0, Math.round(t)));
      });
    }
    trackEl.appendChild(div);
  });

  if (playheadEl) trackEl.appendChild(playheadEl);
}

function renderCues(current) {
  const list = el('cuesList');
  const ruler = el('cueRuler');
  const track = el('cueTimelineBar');
  const playhead = el('cuePlayhead');

  if (!current) {
    list.innerHTML = '<div style="color:#666;font-size:12px;">Select an item to add cues</div>';
    ruler.innerHTML = '';
    track.querySelectorAll('.cueSegment').forEach(s => s.remove());
    return;
  }

  const cues = current.cues || [];
  buildTimeline(ruler, track, playhead, current.durationSec, cues, 'fit',
    (cue) => {
      if (confirm(`Delete cue "${cue.label}" at ${fmtTimeDot(cue.timeSec)}?`)) {
        fetch(`/api/items/${current.id}/cues/${cue.id}`, { method: 'DELETE' });
      }
    },
    (timeSec) => { el('cueTime').value = fmtTimeDot(timeSec); }
  );

  if (!cues.length) {
    list.innerHTML = '<div style="color:#666;font-size:12px;">No cues yet for this item — click the timeline bar above or use the fields below</div>';
  } else {
    list.innerHTML = '';
    cues.forEach(c => {
      const row = document.createElement('div');
      row.className = 'cueRow';
      row.innerHTML = `
        <span class="cueTime">${fmtCueTime(c.timeSec)}</span>
        <span class="cueTarget">${c.target}</span>
        <span class="cueLabel">${escapeHtml(c.label)}</span>
        <button class="cueDel" data-item="${current.id}" data-cue="${c.id}">✕</button>
      `;
      list.appendChild(row);
    });
    list.querySelectorAll('.cueDel').forEach(b => b.addEventListener('click', () =>
      fetch(`/api/items/${b.dataset.item}/cues/${b.dataset.cue}`, { method: 'DELETE' })));
  }

  renderPlayhead(current);
}

function renderPlayhead(current) {
  const playhead = el('cuePlayhead');
  if (!current || !state || state.currentIndex === null || state.items[state.currentIndex].id !== current.id) {
    playhead.style.display = 'none';
    return;
  }
  const dur = current.durationSec || 1;
  const elapsed = state.timer.totalSec - state.timer.remainingSec;
  const pct = Math.min(100, Math.max(0, (elapsed / dur) * 100));
  playhead.style.display = 'block';
  playhead.style.left = pct + '%';
}

function parseDur(str) {
  str = str.trim();
  if (/^\d+\.\d{2}$/.test(str)) str = str.replace('.', ':');
  if (/^\d+:\d{2}$/.test(str)) {
    const [m, s] = str.split(':').map(Number);
    return m * 60 + s;
  }
  const n = parseFloat(str);
  return isNaN(n) ? 0 : Math.round(n * 60);
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderTimer() {
  if (!state) return;
  const t = state.timer;
  const disp = el('timerDisplay');
  const isOverrun = t.remainingSec < 0;
  disp.textContent = fmtTime(t.remainingSec);
  disp.classList.toggle('overrun', isOverrun);
  document.querySelector('.liveBar').classList.toggle('overrun', isOverrun && state.currentIndex !== null);
  const elapsed = Math.max(0, t.totalSec - t.remainingSec);
  el('elapsedDisplay').textContent = fmtTime(elapsed);
  el('durationDisplay').textContent = fmtTime(t.totalSec);
  updateNextCueCountdowns();
  el('endTime').textContent = computeEndTime();
}

// Shows "Next cue in mm:ss" in the top-left corner of a timeline, for whichever
// item is live (only meaningful while that item is actually playing).
function nextCueCountdownText(item) {
  if (!state || !item || state.currentIndex === null || state.items[state.currentIndex].id !== item.id) return null;
  const cues = (item.cues || []).slice().sort((a, b) => a.timeSec - b.timeSec);
  const elapsed = state.timer.totalSec - state.timer.remainingSec;
  const upcoming = cues.find(c => c.timeSec > elapsed);
  if (!upcoming) return null;
  return `Next cue in ${fmtTime(upcoming.timeSec - elapsed)} — ${upcoming.label}`;
}

function updateNextCueCountdowns() {
  const editingItem = state.items.find(i => i.id === editingItemId) || null;
  const editBadge = el('cueNextCountdown');
  const editText = nextCueCountdownText(editingItem);
  editBadge.classList.toggle('hidden', !editText);
  if (editText) editBadge.textContent = editText;

  const liveItem = state.currentIndex !== null ? state.items[state.currentIndex] : null;
  const mainBadge = el('mainNextCueCountdown');
  const mainText = nextCueCountdownText(liveItem);
  mainBadge.classList.toggle('hidden', !mainText);
  if (mainText) mainBadge.textContent = mainText;
}

// ---------- Persistent bottom cue timeline (main control page) ----------
// Always reflects the item that is actually LIVE (state.currentIndex), not just the one selected for editing.
let mainTimelineMode = localStorage.getItem('rundown_main_timeline_mode') || 'fit';

function setMainTimelineMode(mode) {
  mainTimelineMode = mode;
  localStorage.setItem('rundown_main_timeline_mode', mode);
  el('mainFitModeBtn').classList.toggle('active', mode === 'fit');
  el('mainScrollModeBtn').classList.toggle('active', mode === 'scroll');
  renderMainBottomTimeline();
}
el('mainFitModeBtn').addEventListener('click', () => setMainTimelineMode('fit'));
el('mainScrollModeBtn').addEventListener('click', () => setMainTimelineMode('scroll'));
el('mainFitModeBtn').classList.toggle('active', mainTimelineMode === 'fit');
el('mainScrollModeBtn').classList.toggle('active', mainTimelineMode === 'scroll');

function renderMainBottomTimeline() {
  if (!state) return;
  const current = state.currentIndex !== null ? state.items[state.currentIndex] : null;
  const ruler = el('mainBottomRuler');
  const track = el('mainBottomTrack');
  const playhead = el('mainBottomPlayhead');
  const title = el('mainBottomTimelineTitle');
  const scroller = el('mainBottomScroller');

  title.textContent = current ? `CUE TIMELINE — ${current.item.toUpperCase()}` : 'CUE TIMELINE — no item selected';

  if (!current) {
    ruler.innerHTML = '';
    track.querySelectorAll('.cueSegment').forEach(s => s.remove());
    playhead.style.display = 'none';
    return;
  }

  buildTimeline(ruler, track, playhead, current.durationSec, current.cues || [], mainTimelineMode);

  const dur = current.durationSec || 1;
  const elapsed = state.timer.totalSec - state.timer.remainingSec;
  playhead.style.display = 'block';
  if (mainTimelineMode === 'scroll') {
    playhead.style.left = (elapsed * PX_PER_SEC) + 'px';
    scroller.scrollLeft = Math.max(0, elapsed * PX_PER_SEC - scroller.clientWidth / 2);
  } else {
    playhead.style.left = Math.min(100, Math.max(0, (elapsed / dur) * 100)) + '%';
  }
}

socket.on('state', (s) => { state = s; render(); });
socket.on('tick', (data) => {
  if (state) {
    state.timer = data.timer;
    renderTimer();
    const current = state.currentIndex !== null ? state.items[state.currentIndex] : null;
    renderPlayhead(current);
    renderMainBottomTimeline();
  }
});

// Notes editor save on change
el('notesEditor').querySelectorAll('textarea').forEach(ta => {
  ta.addEventListener('change', () => {
    const id = ta.dataset.id;
    if (!id) return;
    fetch(`/api/items/${id}/note`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field: ta.dataset.field, value: ta.value })
    });
  });
});

// Toolbar
el('fileInput').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append('file', f);
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  const data = await res.json();
  if (!data.ok) alert('Import failed: ' + data.error);
  e.target.value = '';
});

el('addItemBtn').addEventListener('click', () => fetch('/api/items', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ item: 'New Item', presenter: '', durationSec: 300 })
}));

el('startBtn').addEventListener('click', () => fetch('/api/timer/start', { method: 'POST' }));
el('makeLiveBtn').addEventListener('click', () => {
  if (!editingItemId) { alert('Click a rundown row first to pick which item to make live.'); return; }
  fetch('/api/control/select', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: editingItemId })
  });
});
el('pauseBtn').addEventListener('click', () => fetch('/api/timer/pause', { method: 'POST' }));
el('resetBtn').addEventListener('click', () => fetch('/api/timer/reset', { method: 'POST' }));
el('minus1').addEventListener('click', () => fetch('/api/timer/adjust', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deltaSec: -60 })
}));
el('plus1').addEventListener('click', () => fetch('/api/timer/adjust', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deltaSec: 60 })
}));
el('prevBtn').addEventListener('click', () => fetch('/api/control/prev', { method: 'POST' }));
el('nextBtn').addEventListener('click', () => fetch('/api/control/next', { method: 'POST' }));
el('toggleTimerBtn').addEventListener('click', () => {
  const nowVisible = state ? state.timerVisible : true;
  fetch('/api/timer/visibility', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visible: !nowVisible })
  });
});

el('msgShowBtn').addEventListener('click', () => fetch('/api/message', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: el('messageText').value, visible: true, target: el('messageTarget').value })
}));
el('msgHideBtn').addEventListener('click', () => fetch('/api/message', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: el('messageText').value, visible: false, target: el('messageTarget').value })
}));

// live clock
setInterval(() => {
  el('clock').textContent = new Date().toLocaleTimeString();
}, 1000);

// Cue add
el('cueAddBtn').addEventListener('click', () => {
  if (!editingItemId) { alert('Click on a rundown row first to select an item to edit.'); return; }
  const timeStr = el('cueTime').value.trim();
  const label = el('cueLabel').value.trim();
  const target = el('cueTarget').value;
  if (!label) { alert('Enter a cue label.'); return; }
  let timeSec = 0;
  if (/^\d+\.\d{2}$/.test(timeStr)) {
    const [m, s] = timeStr.split('.').map(Number);
    timeSec = m * 60 + s;
  } else if (/^\d+:\d{2}$/.test(timeStr)) {
    const [m, s] = timeStr.split(':').map(Number);
    timeSec = m * 60 + s;
  } else {
    timeSec = parseFloat(timeStr) || 0;
  }
  fetch(`/api/items/${editingItemId}/cues`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeSec, label, target })
  }).then(() => {
    el('cueTime').value = ''; el('cueLabel').value = ''; el('cueTarget').value = 'all';
  });
});

// Project settings modal
el('projectBtn').addEventListener('click', () => {
  if (!state) return;
  el('projEventName').value = state.event.name || '';
  el('projEventDate').value = state.event.date || '';
  el('projStartTime').value = state.event.startTime || '';
  el('projAutoSave').value = (state.settings && state.settings.autoSaveIntervalSec) || 30;
  el('projectModal').classList.remove('hidden');
});
el('projectCancelBtn').addEventListener('click', () => el('projectModal').classList.add('hidden'));
el('projectSaveBtn').addEventListener('click', async () => {
  await fetch('/api/event', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: el('projEventName').value,
      date: el('projEventDate').value,
      startTime: el('projStartTime').value
    })
  });
  await fetch('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoSaveIntervalSec: Number(el('projAutoSave').value) || 30 })
  });
  el('projectModal').classList.add('hidden');
});
