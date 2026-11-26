"use strict";

/* ---------------- constants & helpers ---------------- */

// School-grade scale (like in Slovakia): 1 = best, 5 = worst
const MOODS = [
  { v: 1, emoji: "😄", label: "Great" },
  { v: 2, emoji: "🙂", label: "Good" },
  { v: 3, emoji: "😐", label: "Okay" },
  { v: 4, emoji: "🙁", label: "Bad" },
  { v: 5, emoji: "😞", label: "Awful" },
];
const SLOT_COUNT = 8;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const fmtShort = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const fmt1 = (n) => (n == null ? "—" : n.toFixed(1));
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const actColor = (a) => (a.color >= 0 && a.color < SLOT_COUNT ? `var(--s${a.color + 1})` : "var(--s-other)");
const moodBg = (v) => `var(--m${v})`;
const moodInk = (v) => `var(--m-ink-${v})`;

/* ---------------- state ---------------- */

const state = {
  data: { activities: [], entries: {} },
  view: "log",
  logDate: ymd(new Date()),
  calMonth: (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })(),
  filter: { selected: new Set(), mode: "any", range: "90" },
};

/* ---------------- persistence ---------------- */

// Everything is stored on this device only (browser storage). Nothing is sent anywhere.
const STORAGE_KEY = "daily-tracker-data";

// Neutral starter list for a brand-new install; everyone edits their own.
const STARTER_DATA = {
  activities: [
    { id: "a1", name: "Exercise", color: 0 },
    { id: "a2", name: "Reading", color: 1 },
    { id: "a3", name: "Time outside", color: 2 },
    { id: "a4", name: "Friends", color: 3 },
    { id: "a5", name: "Good sleep", color: 4 },
  ],
  scale: "grade",
  entries: {},
};

let saveTimer = null;
function save() {
  $("save-status").textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
      $("save-status").textContent = "Saved on this device";
    } catch (e) {
      $("save-status").textContent = "Couldn't save on this device — download a backup to be safe.";
      console.error(e);
    }
  }, 300);
}
// Save right away if the app is closed or sent to the background mid-edit.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && saveTimer) {
    clearTimeout(saveTimer);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data)); } catch {}
  }
});

/**
 * Upgrades older data:
 * - one daily `mood` becomes the evening mood;
 * - the old scale (1 = awful … 5 = great) is flipped to school grades (1 = great … 5 = awful).
 *   The `scale: "grade"` marker makes sure this happens only once.
 */
function normalizeData(data) {
  const flip = data.scale !== "grade";
  Object.values(data.entries || {}).forEach((e) => {
    if ("mood" in e) {
      if (e.moodPM == null) e.moodPM = e.mood;
      delete e.mood;
    }
    if (e.moodAM === undefined) e.moodAM = null;
    if (e.moodPM === undefined) e.moodPM = null;
    if (flip) ["moodAM", "moodPM", "relMood"].forEach((k) => { if (e[k] != null) e[k] = 6 - e[k]; });
  });
  data.scale = "grade";
  return data;
}

async function load() {
  let stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch {}
  if (stored) {
    state.data = normalizeData(JSON.parse(stored));
  } else {
    // First run. When opened from the old local server (npm start), take over its data once;
    // on the hosted app there is no server, so start from the neutral list.
    let fromServer = null;
    try {
      const res = await fetch("api/data");
      if (res.ok) fromServer = await res.json();
    } catch {}
    const valid = fromServer && Array.isArray(fromServer.activities) && typeof fromServer.entries === "object";
    state.data = normalizeData(valid ? fromServer : structuredClone(STARTER_DATA));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data)); } catch {}
  }
  // Ask the browser not to clear this data when the phone runs low on space.
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
}

function getEntry(date) { return state.data.entries[date]; }
function ensureEntry(date) {
  if (!state.data.entries[date]) state.data.entries[date] = { moodAM: null, moodPM: null, relMood: null, activities: [], note: "" };
  return state.data.entries[date];
}
function pruneEntry(date) {
  const e = state.data.entries[date];
  if (e && e.moodAM == null && e.moodPM == null && e.relMood == null && !e.activities.length && !e.note.trim()) delete state.data.entries[date];
}
/** Daily mood = average of morning and evening (whichever are logged). */
function dayMood(e) { return avg([e.moodAM, e.moodPM].filter((v) => v != null)); }
/** How much mood improved over the day (positive = better in the evening); only when both are logged.
 *  Grades: lower is better, so improvement = morning − evening. */
function moodLift(e) { return e.moodAM != null && e.moodPM != null ? e.moodAM - e.moodPM : null; }
const fmtSigned = (n) => {
  if (n == null) return "—";
  const r = Math.round(n * 10) / 10;
  return (r > 0 ? "+" : r < 0 ? "−" : "") + Math.abs(r).toFixed(1);
};

/* ---------------- filtering ---------------- */

function entryMatches(entry) {
  const sel = state.filter.selected;
  if (!sel.size) return true;
  if (!entry) return false;
  const acts = new Set(entry.activities);
  const ids = [...sel];
  return state.filter.mode === "all" ? ids.every((id) => acts.has(id)) : ids.some((id) => acts.has(id));
}

function rangeBounds() {
  const end = new Date(); end.setHours(0, 0, 0, 0);
  let start;
  if (state.filter.range === "all") {
    const keys = Object.keys(state.data.entries).sort();
    start = keys.length ? parseYmd(keys[0]) : addDays(end, -29);
    if (start > end) start = addDays(end, -29);
  } else {
    start = addDays(end, -(Number(state.filter.range) - 1));
  }
  return { start, end };
}

/** Days in range that have an entry AND match the activity filter. */
function filteredDays() {
  const { start, end } = rangeBounds();
  const out = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const key = ymd(d);
    const e = getEntry(key);
    if (e && entryMatches(e)) out.push({ date: new Date(d), key, entry: e });
  }
  return out;
}

/* ---------------- tabs ---------------- */

function setView(view) {
  state.view = view;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  const showFilters = view === "calendar" || view === "graphs";
  $("filters").hidden = !showFilters;
  $("range-group").style.display = view === "graphs" ? "" : "none";
  // keep the filter bar directly above the active view
  if (showFilters) $(`view-${view}`).before($("filters"));
  render();
}

/* ---------------- LOG view ---------------- */

function renderMoodPicker(el, field, value) {
  el.innerHTML = MOODS.map((m) => `
    <button class="mood-btn ${value === m.v ? "selected" : ""}" data-v="${m.v}"
      style="background:${value === m.v ? moodBg(m.v) : ""}; color:${value === m.v ? moodInk(m.v) : ""}"
      aria-pressed="${value === m.v}" aria-label="${m.label}">
      <span class="emoji">${m.emoji}</span><span class="lbl" style="color:inherit">${m.label}</span>
    </button>`).join("");
  el.querySelectorAll(".mood-btn").forEach((b) => b.addEventListener("click", () => {
    const e = ensureEntry(state.logDate);
    const v = Number(b.dataset.v);
    e[field] = e[field] === v ? null : v; // click again to unset
    pruneEntry(state.logDate);
    save(); renderLog();
  }));
}

function renderLog() {
  $("log-date").value = state.logDate;
  const e = getEntry(state.logDate) || { moodAM: null, moodPM: null, relMood: null, activities: [], note: "" };
  renderMoodPicker($("mood-am-picker"), "moodAM", e.moodAM);
  renderMoodPicker($("mood-pm-picker"), "moodPM", e.moodPM);
  renderMoodPicker($("rel-picker"), "relMood", e.relMood);

  const picker = $("activity-picker");
  if (!state.data.activities.length) {
    picker.innerHTML = `<span class="hint">No activities yet — add some in the Activities tab.</span>`;
  } else {
    picker.innerHTML = state.data.activities.map((a) => `
      <button class="chip ${e.activities.includes(a.id) ? "selected" : ""}" data-id="${a.id}" aria-pressed="${e.activities.includes(a.id)}">
        <span class="dot" style="background:${actColor(a)}"></span>${esc(a.name)}
      </button>`).join("");
    picker.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => {
      const entry = ensureEntry(state.logDate);
      const id = c.dataset.id;
      entry.activities = entry.activities.includes(id) ? entry.activities.filter((x) => x !== id) : [...entry.activities, id];
      pruneEntry(state.logDate);
      save(); renderLog();
    }));
  }
  if (document.activeElement !== $("note")) $("note").value = e.note || "";
}

/* ---------------- filter bar ---------------- */

function renderFilters() {
  $("filter-chips").innerHTML = state.data.activities.map((a) => `
    <button class="chip ${state.filter.selected.has(a.id) ? "selected" : ""}" data-id="${a.id}" aria-pressed="${state.filter.selected.has(a.id)}">
      <span class="dot" style="background:${actColor(a)}"></span>${esc(a.name)}
    </button>`).join("") +
    (state.filter.selected.size ? `<button class="ghost-btn" id="clear-filter">Clear</button>` : "");
  $("filter-chips").querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => {
    const id = c.dataset.id;
    state.filter.selected.has(id) ? state.filter.selected.delete(id) : state.filter.selected.add(id);
    render();
  }));
  const clr = $("clear-filter");
  if (clr) clr.addEventListener("click", () => { state.filter.selected.clear(); render(); });
  $("filter-mode").value = state.filter.mode;
  $("filter-range").value = state.filter.range;
}

/* ---------------- CALENDAR view ---------------- */

function moodLegendHtml() {
  const neutral = `style="background:var(--m3);color:var(--m-ink-3)"`;
  return `<span><span class="mood-split"><span class="half" ${neutral}>☀︎</span><span class="half" ${neutral}>☾</span></span> morning | evening</span>
    <span><span class="mood-pill" ${neutral}>R</span> relationship</span>` +
    MOODS.map((m) => `<span><span class="swatch" style="background:${moodBg(m.v)}"></span>${m.v} ${m.label}</span>`).join("");
}

function renderCalendar() {
  const first = state.calMonth;
  $("month-label").textContent = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  $("cal-legend").innerHTML = moodLegendHtml();

  const actsById = Object.fromEntries(state.data.activities.map((a) => [a.id, a]));
  const offset = (first.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const todayKey = ymd(new Date());

  let html = WEEKDAYS.map((w) => `<div class="cal-head">${w}</div>`).join("");
  for (let i = 0; i < offset; i++) html += `<div class="cal-day empty"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(first.getFullYear(), first.getMonth(), day);
    const key = ymd(d);
    const e = getEntry(key);
    const faded = state.filter.selected.size && !entryMatches(e);
    // one split tag: left half = morning, right half = evening; then the relationship tag
    const half = (v) => (v == null ? `<span class="half empty">–</span>`
      : `<span class="half" style="background:${moodBg(v)};color:${moodInk(v)}">${v}</span>`);
    const split = e && (e.moodAM != null || e.moodPM != null) ? `<span class="mood-split">${half(e.moodAM)}${half(e.moodPM)}</span>` : "";
    const rel = e && e.relMood != null ? `<span class="mood-pill" style="background:${moodBg(e.relMood)};color:${moodInk(e.relMood)}">R ${e.relMood}</span>` : "";
    const pills = split + rel;
    const dots = e ? e.activities.filter((id) => actsById[id])
      .map((id) => `<span class="dot" style="background:${actColor(actsById[id])}"></span>`).join("") : "";
    html += `<button class="cal-day ${key === todayKey ? "today" : ""} ${faded ? "faded" : ""}" data-key="${key}">
      <span class="num">${day}</span><div class="mood-pills">${pills}</div><div class="cal-dots">${dots}</div></button>`;
  }
  const cal = $("calendar");
  cal.innerHTML = html;
  cal.querySelectorAll(".cal-day[data-key]").forEach((cell) => {
    cell.addEventListener("click", () => { state.logDate = cell.dataset.key; setView("log"); });
    cell.addEventListener("mousemove", (ev) => showTooltip(ev, dayTooltip(cell.dataset.key)));
    cell.addEventListener("mouseleave", hideTooltip);
  });
}

function dayTooltip(key) {
  const e = getEntry(key);
  const title = `<div class="t-title">${fmtDay(parseYmd(key))}</div>`;
  if (!e) return title + `<div class="t-row" style="color:var(--muted)">Nothing logged</div>`;
  const actsById = Object.fromEntries(state.data.activities.map((a) => [a.id, a]));
  const moodTxt = (v) => (v == null ? "—" : `${v} · ${MOODS[v - 1].label}`);
  return title +
    `<div class="t-row">Morning: ${moodTxt(e.moodAM)}</div><div class="t-row">Evening: ${moodTxt(e.moodPM)}</div>` +
    (moodLift(e) != null ? `<div class="t-row">Change over the day: ${fmtSigned(moodLift(e))}</div>` : "") +
    `<div class="t-row">Relationship: ${moodTxt(e.relMood)}</div>` +
    e.activities.filter((id) => actsById[id]).map((id) =>
      `<div class="t-row"><span class="swatch" style="background:${actColor(actsById[id])}"></span>${esc(actsById[id].name)}</div>`).join("") +
    (e.note ? `<div class="t-row" style="color:var(--text-2);margin-top:4px">${esc(e.note.slice(0, 140))}</div>` : "");
}

/* ---------------- tooltip ---------------- */

function showTooltip(ev, html) {
  const t = $("tooltip");
  t.innerHTML = html;
  t.hidden = false;
  const r = t.getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - 14;
  if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - 14;
  t.style.left = Math.max(8, x) + "px";
  t.style.top = Math.max(8, y) + "px";
}
function hideTooltip() { $("tooltip").hidden = true; }

/* ---------------- GRAPHS view ---------------- */

const SVG_NS = "http://www.w3.org/2000/svg";

function renderStats(days) {
  const moods = days.map((d) => dayMood(d.entry)).filter((v) => v != null);
  const ams = days.map((d) => d.entry.moodAM).filter((v) => v != null);
  const pms = days.map((d) => d.entry.moodPM).filter((v) => v != null);
  const rels = days.map((d) => d.entry.relMood).filter((v) => v != null);
  const counts = {};
  days.forEach((d) => d.entry.activities.forEach((id) => (counts[id] = (counts[id] || 0) + 1)));
  const topId = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const top = state.data.activities.find((a) => a.id === topId);
  const { start, end } = rangeBounds();
  const span = Math.round((end - start) / 864e5) + 1;
  $("stats").innerHTML = `
    <div class="stat"><div class="k">Days logged</div><div class="v">${days.length}</div><div class="s">of ${span} days in range</div></div>
    <div class="stat"><div class="k">Avg. my mood</div><div class="v">${fmt1(avg(moods))}</div><div class="s">☀︎ ${fmt1(avg(ams))} · ☾ ${fmt1(avg(pms))}</div></div>
    <div class="stat"><div class="k">Avg. relationship</div><div class="v">${fmt1(avg(rels))}</div><div class="s">1 great · 5 awful</div></div>
    <div class="stat"><div class="k">Most frequent</div><div class="v" style="font-size:20px">${top ? esc(top.name) : "—"}</div><div class="s">${top ? counts[topId] + " days" : ""}</div></div>`;
}

function renderMoodChart(days) {
  const el = $("mood-chart");
  const series = [
    { key: "moodAM", name: "Morning mood", color: "var(--s4)" },
    { key: "moodPM", name: "Evening mood", color: "var(--s7)" },
    { key: "relMood", name: "Relationship mood", color: "var(--s2)" },
  ];
  const hasMood = (e) => series.some((s) => e[s.key] != null);
  $("mood-legend").innerHTML = series.map((s) => `<span><span class="swatch line" style="background:${s.color}"></span>${s.name}</span>`).join("") +
    `<span><span class="swatch" style="background:var(--m1);opacity:.45"></span>Mood got better during the day</span>
     <span><span class="swatch" style="background:var(--m5);opacity:.45"></span>Mood got worse</span>`;
  if (!days.some((d) => hasMood(d.entry))) {
    el.innerHTML = `<div class="empty-msg">No mood data for this range and filter yet.</div>`;
    return;
  }

  const W = Math.max(el.clientWidth, 320), H = 240;
  const m = { t: 12, r: 16, b: 28, l: 28 };
  const { start, end } = rangeBounds();
  const spanMs = Math.max(end - start, 864e5);
  const x = (d) => m.l + ((d - start) / spanMs) * (W - m.l - m.r);
  const y = (v) => m.t + ((v - 1) / 4) * (H - m.t - m.b); // 1 (great) at the top

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Mood over time line chart">`;
  for (let v = 1; v <= 5; v++) {
    svg += `<line class="grid-line" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  // x ticks: ~6 evenly spaced dates
  const ticks = 6;
  for (let i = 0; i <= ticks; i++) {
    const d = new Date(start.getTime() + (spanMs * i) / ticks);
    const anchor = i === 0 ? "start" : i === ticks ? "end" : "middle";
    svg += `<text x="${x(d)}" y="${H - 8}" text-anchor="${anchor}">${fmtShort(d)}</text>`;
  }
  // shade between morning and evening: green where evening > morning, red where it's lower
  const both = days.filter((d) => moodLift(d.entry) != null);
  const poly = (pts, up) => `<polygon points="${pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ")}" fill="var(${up ? "--m1" : "--m5"})" fill-opacity="0.3"/>`;
  both.forEach((p, i) => {
    const q = both[i + 1], prev = both[i - 1];
    const linkedNext = q && (q.date - p.date) / 864e5 <= 3;
    const linkedPrev = prev && (p.date - prev.date) / 864e5 <= 3;
    const d1 = moodLift(p.entry);
    if (!linkedNext) {
      // a lone day with both ratings: draw a small bar so it still shows
      if (!linkedPrev && d1 !== 0) {
        const xx = x(p.date), y1 = y(p.entry.moodAM), y2 = y(p.entry.moodPM);
        svg += `<rect x="${xx - 4}" y="${Math.min(y1, y2)}" width="8" height="${Math.abs(y2 - y1)}" fill="var(${d1 > 0 ? "--m1" : "--m5"})" fill-opacity="0.3"/>`;
      }
      return;
    }
    const x1 = x(p.date), x2 = x(q.date);
    const a1 = p.entry.moodAM, b1 = p.entry.moodPM, a2 = q.entry.moodAM, b2 = q.entry.moodPM;
    const d2 = b2 - a2;
    if (d1 * d2 >= 0) {
      if (d1 + d2 !== 0) svg += poly([[x1, y(a1)], [x2, y(a2)], [x2, y(b2)], [x1, y(b1)]], d1 + d2 > 0);
    } else {
      // the lines cross between these two days: split into two triangles at the crossing
      const t = d1 / (d1 - d2);
      const xc = x1 + t * (x2 - x1), yc = y(a1 + t * (a2 - a1));
      svg += poly([[x1, y(a1)], [xc, yc], [x1, y(b1)]], d1 > 0);
      svg += poly([[xc, yc], [x2, y(a2)], [x2, y(b2)]], d2 > 0);
    }
  });

  // gaps longer than 3 days break the line so it doesn't imply data that wasn't logged
  series.forEach((s) => {
    const pts = days.filter((d) => d.entry[s.key] != null);
    let path = "", prev = null;
    pts.forEach((p) => {
      const gap = prev && (p.date - prev.date) / 864e5 > 3;
      path += `${!prev || gap ? "M" : "L"}${x(p.date).toFixed(1)},${y(p.entry[s.key]).toFixed(1)}`;
      prev = p;
    });
    svg += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (pts.length <= 120) {
      pts.forEach((p) => {
        svg += `<circle cx="${x(p.date)}" cy="${y(p.entry[s.key])}" r="3" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
      });
    }
  });
  svg += `<line id="mood-cross" class="axis-line" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>`;
  svg += `<rect id="mood-hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/>`;
  svg += `</svg>`;
  el.innerHTML = svg;

  const hit = el.querySelector("#mood-hit"), cross = el.querySelector("#mood-cross");
  const svgEl = el.querySelector("svg");
  let hovered = null;
  hit.style.cursor = "pointer";
  hit.addEventListener("click", () => { if (hovered) { state.logDate = hovered.key; setView("log"); } });
  hit.addEventListener("mousemove", (ev) => {
    const r = svgEl.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let best = null, bestDist = Infinity;
    days.forEach((d) => {
      if (!hasMood(d.entry)) return;
      const dist = Math.abs(x(d.date) - px);
      if (dist < bestDist) { bestDist = dist; best = d; }
    });
    if (!best) return;
    hovered = best;
    cross.setAttribute("x1", x(best.date)); cross.setAttribute("x2", x(best.date));
    cross.setAttribute("visibility", "visible");
    showTooltip(ev, dayTooltip(best.key));
  });
  hit.addEventListener("mouseleave", () => { hovered = null; cross.setAttribute("visibility", "hidden"); hideTooltip(); });
}

function bucketKey(date, unit) {
  if (unit === "day") return ymd(date);
  if (unit === "month") return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  const monday = addDays(date, -((date.getDay() + 6) % 7));
  return ymd(monday);
}

function renderActivityChart(days) {
  const el = $("activity-chart");
  const acts = state.filter.selected.size
    ? state.data.activities.filter((a) => state.filter.selected.has(a.id))
    : state.data.activities;
  $("act-legend").innerHTML = acts.map((a) => `<span><span class="swatch" style="background:${actColor(a)}"></span>${esc(a.name)}</span>`).join("");
  if (!acts.length) { el.innerHTML = `<div class="empty-msg">Add some activities first.</div>`; return; }

  const { start, end } = rangeBounds();
  const spanDays = Math.round((end - start) / 864e5) + 1;
  // short ranges show days, medium ranges weeks, long ranges months
  const unit = spanDays <= 31 ? "day" : spanDays <= 120 ? "week" : "month";
  $("act-chart-title").textContent = `Activities per ${unit}`;
  const bucketLabel = (d, k) =>
    unit === "month" ? d.toLocaleDateString(undefined, { month: "short", year: "2-digit" })
    : unit === "day" && spanDays <= 7 ? d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })
    : fmtShort(parseYmd(k));

  // build ordered buckets covering the whole range (including empty ones)
  const buckets = new Map();
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const k = bucketKey(d, unit);
    if (!buckets.has(k)) buckets.set(k, { key: k, label: bucketLabel(d, k), counts: {} });
  }
  days.forEach((d) => {
    const b = buckets.get(bucketKey(d.date, unit));
    d.entry.activities.forEach((id) => { if (b) b.counts[id] = (b.counts[id] || 0) + 1; });
  });
  const list = [...buckets.values()];
  const totals = list.map((b) => acts.reduce((s, a) => s + (b.counts[a.id] || 0), 0));
  const maxTotal = Math.max(1, ...totals);
  if (totals.every((t) => t === 0)) { el.innerHTML = `<div class="empty-msg">No activities logged in this range yet.</div>`; return; }

  const W = Math.max(el.clientWidth, 320), H = 240;
  const m = { t: 12, r: 16, b: 28, l: 28 };
  const plotW = W - m.l - m.r, plotH = H - m.t - m.b;
  const band = plotW / list.length;
  const barW = Math.max(4, Math.min(36, band * 0.7));
  const yScale = (v) => (v / maxTotal) * plotH;
  const niceStep = maxTotal <= 6 ? 1 : Math.ceil(maxTotal / 5);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Activities per ${unit} stacked bar chart">`;
  for (let v = 0; v <= maxTotal; v += niceStep) {
    const yy = m.t + plotH - yScale(v);
    svg += `<line class="${v === 0 ? "axis-line" : "grid-line"}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
    svg += `<text x="${m.l - 8}" y="${yy + 4}" text-anchor="end">${v}</text>`;
  }
  const labelEvery = Math.ceil(list.length / Math.floor(plotW / 60));
  list.forEach((b, i) => {
    const cx = m.l + band * i + band / 2;
    let yTop = m.t + plotH;
    const segs = acts.filter((a) => b.counts[a.id]);
    segs.forEach((a, si) => {
      const h = yScale(b.counts[a.id]);
      const isTop = si === segs.length - 1;
      const gap = si > 0 ? 2 : 0; // 2px surface gap between stacked segments
      const segH = Math.max(1, h - gap);
      const yy = yTop - h;
      if (isTop) {
        // rounded data-end on top segment only
        const r = Math.min(4, segH, barW / 2);
        svg += `<path d="M${cx - barW / 2},${yy + segH} V${yy + r} Q${cx - barW / 2},${yy} ${cx - barW / 2 + r},${yy} H${cx + barW / 2 - r} Q${cx + barW / 2},${yy} ${cx + barW / 2},${yy + r} V${yy + segH} Z" fill="${actColor(a)}"/>`;
      } else {
        svg += `<rect x="${cx - barW / 2}" y="${yy}" width="${barW}" height="${segH}" fill="${actColor(a)}"/>`;
      }
      yTop -= h;
    });
    if (i % labelEvery === 0) svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${esc(b.label)}</text>`;
    svg += `<rect class="hit" data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${plotH}" fill="transparent"/>`;
  });
  svg += `</svg>`;
  el.innerHTML = svg;

  el.querySelectorAll(".hit").forEach((r) => {
    r.addEventListener("mousemove", (ev) => {
      const b = list[Number(r.dataset.i)];
      const rows = acts.filter((a) => b.counts[a.id]).map((a) =>
        `<div class="t-row"><span class="swatch" style="background:${actColor(a)}"></span>${esc(a.name)}: <b>${b.counts[a.id]}</b></div>`).join("");
      const title = unit === "week" ? `Week of ${b.label}` : unit === "day" ? fmtDay(parseYmd(b.key)) : b.label;
      showTooltip(ev, `<div class="t-title">${esc(title)}</div>${rows || '<div class="t-row" style="color:var(--muted)">Nothing logged</div>'}`);
      r.setAttribute("fill", "rgba(127,127,127,0.08)");
    });
    r.addEventListener("mouseleave", () => { hideTooltip(); r.setAttribute("fill", "transparent"); });
  });
}

/** One row per activity; a mark on every day it was done, on the same time axis as the mood chart. */
function renderActivityTimeline() {
  const el = $("timeline-chart");
  const acts = state.filter.selected.size
    ? state.data.activities.filter((a) => state.filter.selected.has(a.id))
    : state.data.activities;
  if (!acts.length) { el.innerHTML = `<div class="empty-msg">Add some activities first.</div>`; return; }

  const { start, end } = rangeBounds();
  const dayList = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) dayList.push({ date: new Date(d), key: ymd(d), entry: getEntry(ymd(d)) });
  const did = (day, a) => !!day.entry && day.entry.activities.includes(a.id);
  if (!dayList.some((day) => acts.some((a) => did(day, a)))) {
    el.innerHTML = `<div class="empty-msg">None of these activities were logged in this range yet.</div>`;
    return;
  }

  const W = Math.max(el.clientWidth, 320);
  const rowH = 28;
  const labelW = Math.min(160, Math.round(W * 0.32));
  const m = { t: 6, r: 40, b: 28, l: labelW };
  const H = m.t + acts.length * rowH + m.b;
  const plotW = W - m.l - m.r;
  const band = plotW / dayList.length;
  const markW = Math.max(2, Math.min(18, band * 0.75));
  const maxChars = Math.max(6, Math.floor(labelW / 7.5));
  const trunc = (s) => (s.length > maxChars ? s.slice(0, maxChars - 1) + "…" : s);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Activity over time">`;
  acts.forEach((a, r) => {
    const cy = m.t + r * rowH + rowH / 2;
    svg += `<line class="grid-line" x1="${m.l}" x2="${W - m.r}" y1="${cy}" y2="${cy}"/>`;
    svg += `<text x="0" y="${cy + 4}" style="fill:var(--text-2);font-size:12px"><title>${esc(a.name)}</title>${esc(trunc(a.name))}</text>`;
    let count = 0;
    dayList.forEach((day, i) => {
      if (!did(day, a)) return;
      count++;
      const cx = m.l + band * i + band / 2;
      svg += `<rect x="${(cx - markW / 2).toFixed(1)}" y="${cy - 7}" width="${markW.toFixed(1)}" height="14" rx="${Math.min(3, markW / 2).toFixed(1)}" fill="${actColor(a)}"/>`;
    });
    svg += `<text x="${W}" y="${cy + 4}" text-anchor="end">${count}×</text>`;
  });
  // x-axis labels: every day for a week, otherwise ~6 evenly spaced dates
  const plotBottom = m.t + acts.length * rowH;
  const labelIdx = dayList.length <= 7 ? dayList.map((_, i) => i)
    : Array.from({ length: 7 }, (_, i) => Math.round((i * (dayList.length - 1)) / 6));
  labelIdx.forEach((i) => {
    const d = dayList[i].date;
    const cx = m.l + band * i + band / 2;
    const txt = dayList.length <= 7 ? d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }) : fmtShort(d);
    svg += `<text x="${cx}" y="${plotBottom + 18}" text-anchor="middle">${txt}</text>`;
  });
  dayList.forEach((day, i) => {
    svg += `<rect class="hit" data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${plotBottom - m.t}" fill="transparent" style="cursor:pointer"/>`;
  });
  svg += `</svg>`;
  el.innerHTML = svg;

  el.querySelectorAll(".hit").forEach((r) => {
    const day = dayList[Number(r.dataset.i)];
    r.addEventListener("mousemove", (ev) => { showTooltip(ev, dayTooltip(day.key)); r.setAttribute("fill", "rgba(127,127,127,0.10)"); });
    r.addEventListener("mouseleave", () => { hideTooltip(); r.setAttribute("fill", "transparent"); });
    r.addEventListener("click", () => { state.logDate = day.key; setView("log"); });
  });
}

function renderImpactTable() {
  // Uses all logged days in range (ignores the activity filter) so the comparison is fair.
  const { start, end } = rangeBounds();
  const days = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const e = getEntry(ymd(d));
    if (e) days.push(e);
  }
  const el = $("impact-table");
  if (!days.length || !state.data.activities.length) {
    el.innerHTML = `<div class="empty-msg">Log a few days to see how activities relate to your mood.</div>`;
    return;
  }
  // "those days" cell gets ▲ green / ▼ red when it's clearly above / below the other days
  // lowerIsBetter: for grades (relationship avg.), a lower number on "those days" is the good direction
  const pair = (w, o, fmt, lowerIsBetter = false) => {
    const d = w != null && o != null ? (lowerIsBetter ? o - w : w - o) : 0;
    const cls = d > 0.05 ? "delta-up" : d < -0.05 ? "delta-down" : "";
    const arrow = d > 0.05 ? "▲ " : d < -0.05 ? "▼ " : "";
    return `<td class="num ${cls}"><b>${arrow}${fmt(w)}</b></td><td class="num muted">${fmt(o)}</td>`;
  };
  const vals = (list, f) => list.map(f).filter((v) => v != null);
  const rows = state.data.activities.map((a) => {
    const withA = days.filter((e) => e.activities.includes(a.id));
    const without = days.filter((e) => !e.activities.includes(a.id));
    const lW = avg(vals(withA, moodLift)), lO = avg(vals(without, moodLift));
    const rW = avg(vals(withA, (e) => e.relMood)), rO = avg(vals(without, (e) => e.relMood));
    return `<tr>
      <td><span class="swatch" style="background:${actColor(a)};margin-right:8px"></span>${esc(a.name)}</td>
      <td class="num">${withA.length}</td>
      ${pair(lW, lO, fmtSigned)}
      ${pair(rW, rO, fmt1, true)}
    </tr>`;
  }).join("");
  el.innerHTML = `<table class="impact">
    <thead>
      <tr><th rowspan="2">Activity</th><th rowspan="2" class="num">Days</th>
        <th colspan="2" class="grp">Mood change ☀︎ → ☾</th><th colspan="2" class="grp">Relationship mood avg.</th></tr>
      <tr><th class="num">Those days</th><th class="num">Other days</th><th class="num">Those days</th><th class="num">Other days</th></tr>
    </thead>
    <tbody>${rows}</tbody></table>`;
}

function renderGraphs() {
  const days = filteredDays();
  renderActivityChart(days);
  renderActivityTimeline();
  renderStats(days);
  renderMoodChart(days);
  renderImpactTable();
}

/* ---------------- SETTINGS view ---------------- */

function nextFreeSlot() {
  const used = new Set(state.data.activities.map((a) => a.color));
  for (let i = 0; i < SLOT_COUNT; i++) if (!used.has(i)) return i;
  return -1; // beyond 8 activities: neutral gray (no generated hues)
}

function renderSettings() {
  const counts = {};
  Object.values(state.data.entries).forEach((e) => e.activities.forEach((id) => (counts[id] = (counts[id] || 0) + 1)));
  $("activity-list").innerHTML = state.data.activities.map((a) => `
    <li data-id="${a.id}">
      <span class="swatch" style="background:${actColor(a)}"></span>
      <input type="text" value="${esc(a.name)}" maxlength="40" aria-label="Activity name" />
      <span class="count">${counts[a.id] || 0} days</span>
      <button class="bin-btn" data-del="${a.id}" aria-label="Delete ${esc(a.name)}" title="Delete">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
    </li>`).join("") || `<li class="hint">No activities yet.</li>`;

  $("activity-list").querySelectorAll("li[data-id] input").forEach((inp) => inp.addEventListener("change", () => {
    const a = state.data.activities.find((x) => x.id === inp.closest("li").dataset.id);
    const name = inp.value.trim();
    if (a && name) { a.name = name; save(); }
  }));
  $("activity-list").querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.del;
    const a = state.data.activities.find((x) => x.id === id);
    const n = counts[id] || 0;
    if (!confirm(`Delete "${a.name}"?${n ? ` It will be removed from ${n} logged day(s).` : ""}`)) return;
    state.data.activities = state.data.activities.filter((x) => x.id !== id);
    Object.keys(state.data.entries).forEach((k) => {
      const e = state.data.entries[k];
      e.activities = e.activities.filter((x) => x !== id);
      pruneEntry(k);
    });
    state.filter.selected.delete(id);
    save(); render();
  }));
}

/* ---------------- render & events ---------------- */

function render() {
  if (state.view === "log") renderLog();
  if (state.view === "calendar" || state.view === "graphs") renderFilters();
  if (state.view === "calendar") renderCalendar();
  if (state.view === "graphs") renderGraphs();
  if (state.view === "settings") renderSettings();
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setView(t.dataset.view)));
  $("home-link").addEventListener("click", () => {
    const d = new Date();
    state.calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    setView("calendar");
  });

  $("log-date").addEventListener("change", (e) => { if (e.target.value) { state.logDate = e.target.value; renderLog(); } });
  $("prev-day").addEventListener("click", () => { state.logDate = ymd(addDays(parseYmd(state.logDate), -1)); renderLog(); });
  $("next-day").addEventListener("click", () => { state.logDate = ymd(addDays(parseYmd(state.logDate), 1)); renderLog(); });
  $("today-btn").addEventListener("click", () => { state.logDate = ymd(new Date()); renderLog(); });
  $("note").addEventListener("input", (e) => {
    ensureEntry(state.logDate).note = e.target.value;
    pruneEntry(state.logDate);
    save();
  });
  $("clear-day").addEventListener("click", () => {
    if (!getEntry(state.logDate) || !confirm("Clear everything logged for this day?")) return;
    delete state.data.entries[state.logDate];
    save(); renderLog();
  });

  $("prev-month").addEventListener("click", () => { const d = state.calMonth; state.calMonth = new Date(d.getFullYear(), d.getMonth() - 1, 1); renderCalendar(); });
  $("next-month").addEventListener("click", () => { const d = state.calMonth; state.calMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1); renderCalendar(); });
  $("this-month").addEventListener("click", () => { const d = new Date(); state.calMonth = new Date(d.getFullYear(), d.getMonth(), 1); renderCalendar(); });

  $("filter-mode").addEventListener("change", (e) => { state.filter.mode = e.target.value; render(); });
  $("filter-range").addEventListener("change", (e) => { state.filter.range = e.target.value; render(); });

  $("add-activity").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("new-activity").value.trim();
    if (!name) return;
    state.data.activities.push({ id: "a" + Date.now().toString(36), name, color: nextFreeSlot() });
    $("new-activity").value = "";
    save(); renderSettings();
  });

  $("export-btn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tracker-backup-${ymd(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.activities) || typeof data.entries !== "object") throw new Error("Not a tracker backup");
      if (!confirm("Replace all current data with this backup?")) return;
      state.data = normalizeData(data);
      save(); render();
    } catch (err) {
      alert("Couldn't read that file: " + err.message);
    } finally {
      e.target.value = "";
    }
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.view === "graphs") renderGraphs(); }, 150);
  });
}

(async function init() {
  bindEvents();
  try {
    await load();
  } catch (e) {
    console.error(e);
    state.data = normalizeData(structuredClone(STARTER_DATA));
    $("save-status").textContent = "Couldn't read saved data on this device.";
  }
  setView("log");
})();

// Offline support + "Add to Home Screen" (needs https or localhost).
if ("serviceWorker" in navigator) {
  // When an update takes over, reload once so the new version shows right away
  // (only if an older version was running — not on the very first install).
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    // flush any pending save first, then reload
    if (saveTimer) { clearTimeout(saveTimer); try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data)); } catch {} }
    location.reload();
  });
  const check = () => navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
  });
  // A home-screen app is often resumed, not restarted, so also check when it comes back to the front.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
}
