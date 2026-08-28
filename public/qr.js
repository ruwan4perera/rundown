const roles = [
  { role: 'sound', label: 'Sound' },
  { role: 'lights', label: 'Lights' },
  { role: 'video', label: 'Video' },
  { role: 'backstage', label: 'Backstage' },
  { role: 'compere', label: 'Compere' },
  { role: 'client', label: 'Client' },
  { role: 'master', label: 'Master' },
  { role: 'controller', label: 'Controller' },
  { role: 'public', label: 'Public Display' }
];

const grid = document.getElementById('qrGrid');
const hint = document.querySelector('.hint');

async function resolveBaseOrigin() {
  const host = window.location.hostname;
  // If this page was opened via localhost/127.0.0.1, the QR codes would encode an
  // address other devices can't reach. Swap in the server's detected LAN IP instead.
  if (host === 'localhost' || host === '127.0.0.1') {
    try {
      const info = await fetch('/api/network-info').then(r => r.json());
      if (info.lanIPs && info.lanIPs.length) {
        return `http://${info.lanIPs[0]}:${info.port}`;
      }
    } catch (e) { /* fall through to origin below */ }
  }
  return window.location.origin;
}

resolveBaseOrigin().then(origin => {
  if (window.location.hostname !== new URL(origin).hostname) {
    hint.innerHTML = `Codes point to <b>${origin}</b> so other devices on this Wi-Fi can reach them.`;
  }

  roles.forEach(({ role, label }) => {
    const url = `${origin}/output.html?role=${role}`;
    const qrImgSrc = `/api/qr?text=${encodeURIComponent(url)}`;

    const card = document.createElement('div');
    card.className = 'qrCard';
    card.innerHTML = `
      <div class="roleLabel">${label}</div>
      <img src="${qrImgSrc}" alt="QR code for ${label} output" loading="lazy">
      <div class="roleUrl">${url}</div>
      <a class="openLink" href="${url}" target="_blank">Open directly</a>
    `;
    grid.appendChild(card);
  });
});

// Pull the event name for the header, if available
fetch('/api/state').then(r => r.json()).then(s => {
  if (s.event && s.event.name) {
    document.getElementById('eventName').textContent = `${s.event.name} — Output Links`;
  }
}).catch(() => {});
