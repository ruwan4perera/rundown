const socket = io();
let state = null;

const params = new URLSearchParams(location.search);
const role = (params.get('role') || 'master').toLowerCase(); // sound, lights, video, backstage, compere, client, master, controller, public

const el = (id) => document.getElementById(id);
el('roleLabel').textContent = role.toUpperCase();

const isLineupRole = role === 'master';
const isControllerRole = role === 'controller';
const isPublicRole = role === 'public';
const showBottomTimeline = !isLineupRole && !isPublicRole; // master has full lineup already; public is audience-facing
const NEXT_COUNT = (role === 'backstage' || isControllerRole) ? 5 : 1;

if (isLineupRole) {
  el('standardView').classList.add('hidden');
  el('lineupView').classList.remove('hidden');
} else if (isControllerRole) {
  el('standardView').classList.add('hidden');
  el('controllerView').classList.remove('hidden');
} else if (isPublicRole) {
  el('standardView').classList.add('hidden');
  el('publicView').classList.remove('hidden');
  el('roleLabel').classList.add('hidden');
  el('eventNamePublic').classList.remove('hidden');
} else {
  el('nextTag').textContent = NEXT_COUNT > 1 ? `NEXT ${NEXT_COUNT}` : 'NEXT';
}

if (!showBottomTimeline) {
  el('bottomTimelineBar').classList.add('hidden');
  document.documentElement.style.setProperty('--bottom-h', '0px');
}

function fmtTime(sec) {
  const neg = sec < 0;
  sec = Math.abs(Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return (neg ? '-' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function noteFor(item) {
  if (!item) return '';
  if (['sound', 'lights', 'video', 'backstage'].includes(role)) {
    return item.notes[role] || item.notes.general || '';
  }
  return item.notes.general || '';
}

function cuesFor(item) {
  if (!item || !item.cues) return [];
  if (isControllerRole) return item.cues; // controller sees everything
  return item.cues.filter(c => c.target === 'all' || c.target === role);
}

function elapsedSec() {
  if (!state || state.currentIndex === null) return 0;
  const t = state.timer;
  return t.totalSec - t.remainingSec;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setElapsedRemaining(prefix) {
  const t = state.timer;
  const elapsed = Math.max(0, t.totalSec - t.remainingSec);
  const remaining = t.remainingSec;
  const elEl = el(prefix + 'Elapsed') || el('elapsedTime');
  const reEl = el(prefix + 'Remaining') || el('remainingTime');
  if (elEl) elEl.textContent = fmtTime(elapsed);
  if (reEl) reEl.textContent = fmtTime(remaining);
}

function render() {
  if (!state) return;
  if (isLineupRole) { renderLineup(); return; }
  if (isControllerRole) { renderController(); return; }
  if (isPublicRole) { renderPublic(); return; }

  const idx = state.currentIndex;
  const items = state.items;
  const current = idx !== null ? items[idx] : null;
  const last = idx !== null && idx > 0 ? items[idx - 1] : null;

  el('lastItem').textContent = last ? last.item : '-';
  el('currentItem').textContent = current ? current.item : (items.length ? 'Not started' : 'No rundown loaded');

  const nextItems = [];
  if (idx === null && items.length) {
    nextItems.push(items[0]);
  } else if (idx !== null) {
    for (let i = idx + 1; i < items.length && nextItems.length < NEXT_COUNT; i++) nextItems.push(items[i]);
  }

  if (NEXT_COUNT === 1) {
    const next = nextItems[0] || null;
    el('nextItem').textContent = next ? next.item : '-';
    el('nextNote').textContent = noteFor(next);
    el('nextList').innerHTML = '';
  } else {
    el('nextItem').textContent = '';
    el('nextNote').textContent = '';
    el('nextList').innerHTML = nextItems.map((it, i) =>
      `<div class="nextRow"><span class="idx">${i + 1}.</span><span>${escapeHtml(it.item)}</span></div>`
    ).join('') || '<div class="nextRow">-</div>';
  }

  el('currentNote').textContent = noteFor(current);
  renderTimer();
  setElapsedRemaining('');
  renderMessage();
  renderBottomTimeline(current);
}

function renderController() {
  const idx = state.currentIndex;
  const items = state.items;
  const current = idx !== null ? items[idx] : null;
  const last = idx !== null && idx > 0 ? items[idx - 1] : null;

  el('ctrlLastItem').textContent = last ? last.item : '-';
  el('ctrlCurrentItem').textContent = current ? current.item : (items.length ? 'Not started' : 'No rundown loaded');

  const nextItems = [];
  if (idx === null && items.length) nextItems.push(items[0]);
  else if (idx !== null) {
    for (let i = idx + 1; i < items.length && nextItems.length < NEXT_COUNT; i++) nextItems.push(items[i]);
  }
  el('ctrlNextList').innerHTML = nextItems.map((it, i) =>
    `<div class="nextRow"><span class="idx">${i + 1}.</span><span>${escapeHtml(it.item)}</span></div>`
  ).join('') || '<div class="nextRow">-</div>';

  const notes = current ? current.notes : { sound: '', lights: '', video: '', backstage: '', general: '' };
  el('ctrlNoteSound').textContent = notes.sound || '—';
  el('ctrlNoteLights').textContent = notes.lights || '—';
  el('ctrlNoteVideo').textContent = notes.video || '—';
  el('ctrlNoteBackstage').textContent = notes.backstage || '—';
  el('ctrlNoteGeneral').textContent = notes.general || '—';

  renderTimerInto('ctrlTimer');
  setElapsedRemaining('ctrl');
  renderMessage();
  renderBottomTimeline(current);
}

function renderLineup() {
  const idx = state.currentIndex;
  const items = state.items;
  const current = idx !== null ? items[idx] : null;

  el('lineupCurrentItem').textContent = current ? current.item : (items.length ? 'Not started' : 'No rundown loaded');

  const list = el('lineupList');
  list.innerHTML = items.map((it, i) => {
    let cls = 'lineupRow';
    if (idx !== null && i === idx) cls += ' current';
    else if (idx !== null && i === idx + 1) cls += ' next';
    else if (idx !== null && i < idx) cls += ' done';
    return `<div class="${cls}"><span class="lineupIdx">${i + 1}</span><span>${escapeHtml(it.item)}</span><span class="lineupDur">${fmtTime(it.durationSec)}</span></div>`;
  }).join('') || '<div class="lineupRow">No rundown loaded</div>';

  renderTimerInto('lineupTimer');
  setElapsedRemaining('lineup');
  renderMessage();
}

function renderPublic() {
  const idx = state.currentIndex;
  const items = state.items;
  const current = idx !== null ? items[idx] : null;
  const next = idx !== null && idx < items.length - 1 ? items[idx + 1] : (idx === null && items.length ? items[0] : null);

  el('eventNamePublic').textContent = state.event.name || 'Event';
  el('publicItem').textContent = current ? current.item : (items.length ? 'Starting soon' : '');
  el('publicNextItem').textContent = next ? next.item : '-';
  renderTimerInto('publicTimer');
  renderMessage();
}

function renderTimer() { renderTimerInto('timer'); }

function renderTimerInto(id) {
  const disp = el(id);
  const t = state.timer;
  const showTimer = state.timerVisible !== false;
  disp.classList.toggle('hidden', !showTimer);
  const isOverrun = t.remainingSec < 0 && state.currentIndex !== null;
  disp.classList.toggle('overrun', isOverrun);
  if (!showTimer) return;
  disp.textContent = fmtTime(t.remainingSec);
  const currentBlock = document.querySelector('.block.current');
  if (currentBlock) currentBlock.classList.toggle('overrun', isOverrun);
}

function renderMessage() {
  const m = state.message;
  const overlay = el('messageOverlay');
  const applies = m.target === 'all' || m.target === role;
  if (m.visible && applies) {
    overlay.classList.remove('hidden');
    el('messageText').textContent = m.text;
  } else {
    overlay.classList.add('hidden');
  }
}

// ---------- Bottom persistent cue timeline ----------
const PX_PER_SEC = 40; // used in scroll mode
let timelineMode = localStorage.getItem('rundown_timeline_mode_' + role) || 'fit';
let lastRenderedItemId = null;

function setTimelineMode(mode) {
  timelineMode = mode;
  localStorage.setItem('rundown_timeline_mode_' + role, mode);
  el('fitModeBtn').classList.toggle('active', mode === 'fit');
  el('scrollModeBtn').classList.toggle('active', mode === 'scroll');
  const current = state && state.currentIndex !== null ? state.items[state.currentIndex] : null;
  renderBottomTimeline(current, true);
}

if (showBottomTimeline) {
  el('fitModeBtn').addEventListener('click', () => setTimelineMode('fit'));
  el('scrollModeBtn').addEventListener('click', () => setTimelineMode('scroll'));
  el('fitModeBtn').classList.toggle('active', timelineMode === 'fit');
  el('scrollModeBtn').classList.toggle('active', timelineMode === 'scroll');
}

function renderBottomTimeline(current, force) {
  if (!showBottomTimeline) return;
  const track = el('bottomTimelineTrack');
  const scroller = el('bottomTimelineScroller');
  const titleEl = el('bottomTimelineTitle');
  const countdownEl = el('nextCueCountdown');

  if (!current) {
    titleEl.textContent = 'CUE TIMELINE';
    track.innerHTML = '<div class="bottomTimelineEmpty">No item selected</div><div id="bottomPlayhead" class="bottomPlayhead"></div>';
    countdownEl.classList.add('hidden');
    return;
  }

  titleEl.textContent = `CUE TIMELINE — ${current.item.toUpperCase()}`;
  const dur = current.durationSec || 1;
  const cues = cuesFor(current);

  const elapsedNow = elapsedSec();
  const upcoming = [...cues].sort((a, b) => a.timeSec - b.timeSec).find(c => c.timeSec > elapsedNow);
  if (upcoming) {
    countdownEl.classList.remove('hidden');
    countdownEl.textContent = `Next cue in ${fmtTime(upcoming.timeSec - elapsedNow)} — ${upcoming.label}`;
  } else {
    countdownEl.classList.add('hidden');
  }

  const rebuildMarkers = force || current.id !== lastRenderedItemId;

  if (rebuildMarkers) {
    lastRenderedItemId = current.id;
    if (timelineMode === 'scroll') {
      track.classList.add('scrollMode');
      track.style.setProperty('--track-width', Math.max(scroller.clientWidth, dur * PX_PER_SEC) + 'px');
    } else {
      track.classList.remove('scrollMode');
      track.style.removeProperty('--track-width');
    }

    track.innerHTML = '<div id="bottomPlayhead" class="bottomPlayhead"></div>';
    if (!cues.length) {
      const empty = document.createElement('div');
      empty.className = 'bottomTimelineEmpty';
      empty.textContent = 'No cues for this item';
      track.appendChild(empty);
    } else {
      cues.forEach(c => {
        const pctOrPx = timelineMode === 'scroll' ? (c.timeSec * PX_PER_SEC) + 'px' : Math.min(100, (c.timeSec / dur) * 100) + '%';
        const marker = document.createElement('div');
        marker.className = `bottomCueMarker ${c.target}`;
        marker.style.left = pctOrPx;
        marker.title = `${fmtTime(c.timeSec)} — ${c.label} (${c.target})`;

        const timeLabel = document.createElement('div');
        timeLabel.className = 'bottomCueTimeLabel';
        timeLabel.style.left = pctOrPx;
        timeLabel.textContent = fmtTime(c.timeSec);

        const label = document.createElement('div');
        label.className = 'bottomCueLabel';
        label.style.left = pctOrPx;
        label.textContent = c.label;

        track.appendChild(marker);
        track.appendChild(timeLabel);
        track.appendChild(label);
      });
    }
  }

  // Update done/active state + playhead position without rebuilding markers every tick
  const elapsed = elapsedSec();
  track.querySelectorAll('.bottomCueMarker').forEach((m, i) => {
    const c = cues[i];
    if (!c) return;
    m.classList.toggle('done', elapsed >= c.timeSec);
  });

  const playhead = el('bottomPlayhead');
  if (playhead) {
    const pctOrPx = timelineMode === 'scroll' ? (elapsed * PX_PER_SEC) + 'px' : Math.min(100, Math.max(0, (elapsed / dur) * 100)) + '%';
    playhead.style.left = pctOrPx;
    if (timelineMode === 'scroll') {
      const targetScroll = Math.max(0, elapsed * PX_PER_SEC - scroller.clientWidth / 2);
      scroller.scrollLeft = targetScroll;
    }
  }
}

socket.on('state', (s) => { state = s; render(); });
socket.on('tick', (data) => {
  if (!state) return;
  state.timer = data.timer;
  if (isLineupRole) {
    renderTimerInto('lineupTimer');
    setElapsedRemaining('lineup');
  } else if (isControllerRole) {
    renderTimerInto('ctrlTimer');
    setElapsedRemaining('ctrl');
    renderBottomTimeline(state.currentIndex !== null ? state.items[state.currentIndex] : null);
  } else if (isPublicRole) {
    renderTimerInto('publicTimer');
  } else {
    renderTimer();
    setElapsedRemaining('');
    renderBottomTimeline(state.currentIndex !== null ? state.items[state.currentIndex] : null);
  }
});

setInterval(() => {
  el('clock').textContent = new Date().toLocaleTimeString();
}, 1000);
