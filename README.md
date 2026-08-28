# Event Rundown App

A local rundown control system for live events — load your rundown from Excel, run it from one control screen, and display synced output pages for each department.

## Setup

Requires Node.js (v18+).

```bash
cd rundown-app
npm install
npm start
```

Then open:
- **Control panel:** http://localhost:3000/
- **Output pages** (open each on its own screen/laptop on the same network):
  - http://localhost:3000/output.html?role=sound
  - http://localhost:3000/output.html?role=lights
  - http://localhost:3000/output.html?role=video
  - http://localhost:3000/output.html?role=backstage
  - http://localhost:3000/output.html?role=compere
  - http://localhost:3000/output.html?role=client
  - http://localhost:3000/output.html?role=master
  - http://localhost:3000/output.html?role=controller
  - http://localhost:3000/output.html?role=public — clean audience-facing display (event name, current item, timer, up next — no technical notes)

To view output pages on other devices on your Wi-Fi/LAN, replace `localhost` with your computer's local IP address (e.g. `http://192.168.1.20:3000/output.html?role=sound`). You don't need to hunt this down yourself — the app finds it for you:

- **When the server starts**, the terminal prints the exact address other devices should use, e.g. `http://192.168.1.20:3000/`.
- **On the control panel**, if you're viewing it via `localhost`, a blue banner appears at the very top showing the correct address for phones/tablets, with a link to the QR code page.
- **The QR code page** (`/qr.html`, linked from the toolbar) shows a scannable QR code for every output page. Even if you open this page via `localhost` on the computer running the server, the codes themselves are automatically generated using the LAN address — so scanning them on a phone always works correctly.

All devices just need to be on the **same Wi-Fi network** as the computer running the server — no extra setup or app install needed on phones/tablets, since it's all just a web page in their browser.

## Preparing your Excel rundown

Create an `.xlsx` with one row per rundown item on a sheet (any name is fine, first sheet is used). Recommended column headers (case-insensitive, flexible naming):

| Item | Presenter | Duration | Notes_General | Notes_Sound | Notes_Lights | Notes_Video | Notes_Backstage |
|---|---|---|---|---|---|---|---|
| Welcome & Opening | Compere | 5.00 | Keep energy high | 2x handheld mics, FM | Stage wash up | Cue opening title | Compere to stage L |

- **Duration** accepts `mm.ss` (e.g. `5.30` = 5 min 30 sec), `mm:ss`, a plain number of minutes (e.g. `5`), or `90s`.
- A sample file `sample-rundown.xlsx` is included — use it as a template.
- Uploading a new file **replaces** the whole rundown.

**Cue Timeline template** — add a second sheet named `Cues` (or `Cue Timeline`) to the same workbook to pre-load cues for items:

| Item | CueTime | Label | Target |
|---|---|---|---|
| Welcome & Opening | 0.10 | Switch to wide camera | video |
| Award Presentation | 0.45 | Confetti + haze | all |

- `Item` must match the item's name exactly (case-insensitive) from the main rundown sheet.
- `CueTime` uses the same `mm.ss` format as Duration — it's the offset **within that item**, not a clock time.
- `Target` is `all`, `sound`, `lights`, `video`, or `backstage`.
- The included `sample-rundown.xlsx` already has a `Cues` sheet as a working example — open it in Excel to see the format.

In the control panel, click **"Load Rundown (Excel)"** and select your file.

## Using the control panel

**One toolbar at the top** now holds everything: Event Name — Load Rundown / + Add Item / ⚙ Project — links to every output page (Sound, Lights, Video, Backstage, Compere, Client, Master, Controller, Public Display) — End time — Local clock, all in a single row.

**Editing an item vs. making it live are two separate actions:**
- **Click anywhere on a row** to select it for editing — this loads its notes and cue timeline into the panel on the right. It does **not** touch whatever is currently playing.
- **Click "Update" on a row** (or "⏵ Make This Item Live" in the editing panel) to actually jump the live show to that item — this is the only thing that changes what's playing and resets the timer.

This means you can freely click around the table to review or edit notes/cues on upcoming items without interrupting whatever is currently live and counting down.

- **NOW LIVE bar** (green, under the toolbar) — always shows whichever item is actually live. Laid out as: item name on the left — **Duration / Remaining / Elapsed** centered together — all playback controls (Prev, Start, Pause, Reset, ±1 min, Next, Hide Timer) in one row on the right. This stays put no matter what you're browsing in the table.
- **Rundown table** — drag rows (⠿ handle) to reorder; click into Item/Presenter/Duration/Notes cells to edit inline; click elsewhere on a row to load it into the editing panel; ✕ deletes a row. Duration is entered as `mm.ss` (period divides minutes and seconds, e.g. `5.30`).
- **End time** — shown in the toolbar's clock section, calculated from the Scheduled Start Time (set under ⚙ Project) plus the total duration of every item in the rundown. Updates automatically as you edit durations or add/remove items.
- **Editing panel** (right side) — shows Item Notes and the Cue Timeline for whichever row you last clicked. A ruler with tick marks sits above colored blocks spanning cue-to-cue (numbered, labeled, color-coded by department). Click an empty stretch of the bar to prefill the time field below; click an existing block to delete that cue. A red playhead appears here too, but only when the item you're editing happens to also be the live one.
- **⚙ Project** — set the Event Name, Date, Scheduled Start Time, and the auto-save interval (how often the rundown is saved to disk in the background, separate from the instant save that happens on every change).
- **Send Message to Output Screens** — pushes a full-screen message (e.g. "STAND BY", "RUNNING 5 MIN LATE") to all outputs or a specific department, until you hit Hide.
- **Bottom cue timeline (always visible)** — a persistent bar fixed to the bottom of the control page shows the cue timeline for whichever item is currently **live**, with the same ruler + colored-block style, live playhead, and a **Fit / Scroll** toggle (see below).

### Next cue countdown

Both the editing-panel timeline and the persistent bottom bar (and every output page's bottom timeline) show a small badge in the top-left corner — **"Next cue in mm:ss — [cue label]"** — counting down to whatever cue is coming up next in the live item. It only appears while that item is actually playing, and updates every second along with the rest of the timers.

### Fit vs. Scroll modes

Both the editing-panel cue timeline and the persistent bottom bar support two display modes:
- **Fit** — compresses the whole item duration to fit the visible width.
- **Scroll** — fixed pixels-per-second (Premiere-Pro style), horizontally scrollable, auto-scrolling to keep the playhead centered as time passes.

The bottom bar remembers your mode choice per-browser.

## Output pages

Each standard output page shows, live and in real time via WebSocket:
- **Last item** (just finished)
- **Current item** + big countdown timer + the note relevant to that department (e.g. Sound page shows the Sound note: "2x handheld mics, FM") + any cues due for that item
- **Next item** + its department note, so crews can prep ahead

Three pages behave differently from the rest:
- **Master** shows the full rundown lineup (all items), with the current item strongly highlighted, the item right after it highlighted more lightly, and completed items dimmed/struck through — a whole-of-show overview rather than just last/current/next.
- **Controller** is the most detailed view, meant for whoever's actually running the show from a second screen: last/current item, the next 5 items, **every** department's note for the current item side by side, and the full cue timeline for the current item (all targets, not filtered to one department).
- **Backstage** shows the next **5** upcoming items instead of just one, so runners/talent know what's coming well ahead of time.
- **Public** is a stripped-down, audience-facing screen — event name, current item title, big timer, and "Up Next" — no technical notes or cues, safe to put on a lobby screen or livestream overlay.

The **Compere** and **Client** pages currently see the general note (same as Master's item note) — happy to split these differently if you want compere to see different info than client.

### Overrunning items

If an item's timer goes past zero, the countdown turns bright red and pulses — on the control panel's NOW LIVE bar (the whole bar tints red) and on every output page (the current-item block and its timer both pulse red). This is meant to be impossible to miss from across a room.

The **Public Display** page is the one exception — it turns solid bright red without pulsing, since a blinking timer on an audience-facing screen reads as broken rather than informative.

### QR code page

Open **📱 QR Codes** in the toolbar (`/qr.html`) for a page of scannable QR codes, one for each output page (Sound, Lights, Video, Backstage, Compere, Client, Master, Controller, Public Display). Point a phone camera at one to open that exact output page instantly — handy for handing a crew member their department's screen without typing a URL. The codes encode whatever address you're currently using to reach the app, so if you open `/qr.html` via your computer's LAN IP, the codes will point other devices to that same LAN address.

### Bottom cue timeline (on every output page except Master and Public)

Every department, compere, client, and controller output page now has a persistent horizontal cue timeline bar fixed to the bottom of the screen, showing the cues for whichever item is current — filtered to that department (e.g. the Sound page only shows Sound + All cues; Controller shows every cue regardless of target). A red playhead line tracks progress through the item in real time.

Two display modes, toggled with buttons in the timeline bar's header:
- **Fit** — compresses the whole item duration to fit the visible width, like a fixed timeline.
- **Scroll** — fixed pixels-per-second (Premiere-Pro style), horizontally scrollable, and auto-scrolls to keep the playhead centered as time passes.

Each output page remembers its own mode choice (stored per-browser).

### Elapsed & remaining time

Every timer display (control panel, and all output pages except Public, which just shows the countdown for simplicity) now shows both **Elapsed** and **Remaining** time for the current item, not just the countdown.

### End time updates live

The "End time" shown in the toolbar isn't just a static schedule calculation — once the show is live, it recalculates every second from **right now**: whatever time is left on the current item (even if negative, i.e. overrunning) plus the full duration of every item still to come. So if you're running behind, the projected end time drifts later automatically, and if you catch up, it drifts back earlier. It also appends "(running late)" while the current item is overrunning. Before the show starts, it falls back to the static Scheduled Start Time + total planned duration from ⚙ Project.

## Public API for external applications

If you want another application (a lighting console, a companion app, a custom dashboard, etc.) to read the rundown, it can fetch:

```
GET http://localhost:3000/api/public/rundown
```

This returns the full item list (with notes and cues), the event details, current item, and timer state as JSON. CORS is enabled on all endpoints, so browser-based tools on other origins can fetch it directly too. This is read-only — it won't let another app control the show.

## Notes on architecture (for future web hosting)

- Backend: Node.js + Express + Socket.io (`server.js`). All state changes broadcast instantly to every connected control/output page.
- State currently persists to `data/rundown.json` — swapping this for a real database (Postgres/SQLite) later just means replacing `loadState()`/`saveState()` with DB calls; the rest of the app is unaffected.
- To host on the web later: deploy as-is to any Node host (Render, Railway, Fly.io, a VPS), add authentication in front of the control panel (currently open/local-only), and consider per-event rundown storage if running multiple events.

## Known limitations (v1)

- No login/auth yet — anyone with the control URL can control the show. Fine for local same-network use; add auth before exposing on the internet.
- Single rundown/event at a time (no multi-event switching yet).
- Timer is a single countdown tied to the current item; there's no independent "show clock" separate from item timing yet — ask if you want that added.
- If a phone/tablet can't reach the LAN address even though it's on the same Wi-Fi, the most common cause is the computer's firewall blocking incoming connections on port 3000 (common on Windows, and on Mac if "Block all incoming connections" is on) — you may need to allow Node.js through it once.
