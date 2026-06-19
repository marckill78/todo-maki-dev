/* app.js — UI-Rendering, Views & Events für ToDo Maki */

(() => {
  const $  = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const content   = $("#content");
  const navAreas  = $("#nav-areas");
  const panel     = $("#task-panel");
  const panelOv   = $("#panel-overlay");
  const modal     = $("#modal");
  const modalOv   = $("#modal-overlay");

  let view = { name: "myday", areaId: null };
  let sortMode = localStorage.getItem("maki-sort") || "manual"; // manual | priority | due

  // Sortierung auf eine (bereits gefilterte) Liste anwenden.
  // "manual" = Reihenfolge wie aus dem Store (order); sonst neu sortieren.
  function cmpDue(a, b) {
    if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
    if (a.due) return -1; if (b.due) return 1; return 0;
  }
  function applySort(list) {
    if (sortMode === "manual") return list;
    const arr = [...list];
    if (sortMode === "priority") arr.sort((a, b) => ((b.priority || 0) - (a.priority || 0)) || ((a.order || 0) - (b.order || 0)));
    if (sortMode === "due")      arr.sort((a, b) => cmpDue(a, b) || ((a.order || 0) - (b.order || 0)));
    return arr;
  }
  // Filter-Zustand (sitzungsweit, nicht persistiert)
  let filters = { priority: 0, due: "all", area: "all" };
  function applyFilters(list, opts = {}) {
    const today = Store.todayStr();
    const weekEnd = Store.addToDate(today, { type: "daily", interval: 7 });
    return list.filter(t => {
      if (filters.priority && (t.priority || 0) !== filters.priority) return false;
      if (opts.area !== false && filters.area !== "all" && t.areaId !== filters.area) return false;
      if (filters.due === "today"   && t.due !== today) return false;
      if (filters.due === "overdue" && !Store.isOverdue(t)) return false;
      if (filters.due === "none"    && t.due) return false;
      if (filters.due === "week"    && (!t.due || t.due < today || t.due > weekEnd)) return false;
      return true;
    });
  }
  const filtersActive = () => filters.priority || filters.due !== "all" || filters.area !== "all";

  // Steuerleiste: Sortierung + Filter
  function controlsBar({ area = true } = {}) {
    const sortOpts = { manual: "Manuell ↕", priority: "Priorität", due: "Fälligkeit" };
    const dueOpts = { all: "Alle Termine", today: "Heute", week: "Diese Woche", overdue: "Überfällig", none: "Ohne Datum" };
    const sel = (id, html) => `<select id="${id}">${html}</select>`;
    const areaOpts = `<option value="all" ${filters.area === "all" ? "selected" : ""}>Alle Themen</option>` +
      Store.state.areas.map(a => `<option value="${a.id}" ${filters.area === a.id ? "selected" : ""}>${esc(a.emoji + " " + a.name)}</option>`).join("");
    return `<div class="controls-bar">
      <div class="ctrl"><span class="ctrl-label">Sortieren</span>
        ${sel("sort-mode", Object.entries(sortOpts).map(([k, v]) => `<option value="${k}" ${k === sortMode ? "selected" : ""}>${v}</option>`).join(""))}</div>
      <div class="ctrl"><span class="ctrl-label">Priorität</span>
        ${sel("f-prio", [0,1,2,3,4,5].map(p => `<option value="${p}" ${filters.priority === p ? "selected" : ""}>${p ? "P" + p : "Alle"}</option>`).join(""))}</div>
      <div class="ctrl"><span class="ctrl-label">Fälligkeit</span>
        ${sel("f-due", Object.entries(dueOpts).map(([k, v]) => `<option value="${k}" ${filters.due === k ? "selected" : ""}>${v}</option>`).join(""))}</div>
      ${area ? `<div class="ctrl"><span class="ctrl-label">Thema</span>${sel("f-area", areaOpts)}</div>` : ""}
      ${filtersActive() ? `<button class="link-btn" id="f-reset">Filter zurücksetzen</button>` : ""}
    </div>`;
  }
  const canDrag = () => sortMode === "manual" && !filtersActive() && ["myday", "area", "all"].includes(view.name);

  const PRIO_LABEL = { 0: "Keine", 1: "Sehr niedrig", 2: "Niedrig", 3: "Mittel", 4: "Hoch", 5: "Dringend" };
  const PRIO_COLOR = { 1: "#74b9ff", 2: "#0984e3", 3: "#fdcb6e", 4: "#e67e22", 5: "#e74c3c" };
  const REPEAT_LABEL = { daily: "Täglich", weekly: "Wöchentlich", monthly: "Monatlich", yearly: "Jährlich" };
  const REPEAT_UNIT  = { daily: "Tage", weekly: "Wochen", monthly: "Monate", yearly: "Jahre" };

  // Fortschritts-Farbe: 0% rot → 50% gelb → 100% grün (sauberer HSL-Verlauf)
  const pctColor = (p) => `hsl(${Math.round((p || 0) * 1.2)} 72% 45%)`;

  // Liste per Drag sortierbar machen (Pointer-Events, Maus + Touch).
  // handleSel = Greifelement, itemSel = sortierbares Element mit data-Attribut "key".
  function makeSortable(ul, handleSel, itemSel, key, onReorder) {
    let drag = null;
    ul.addEventListener("pointerdown", (e) => {
      const h = e.target.closest(handleSel); if (!h) return;
      const li = h.closest(itemSel); if (!li) return;
      e.preventDefault(); drag = li; li.classList.add("dragging");
      h.setPointerCapture(e.pointerId);
    });
    ul.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const sibs = [...ul.querySelectorAll(itemSel + ":not(.dragging)")];
      const after = sibs.find(el => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      if (after) ul.insertBefore(drag, after); else ul.appendChild(drag);
    });
    const end = () => {
      if (!drag) return;
      drag.classList.remove("dragging"); drag = null;
      onReorder([...ul.querySelectorAll(itemSel)].map(li => li.dataset[key]));
    };
    ul.addEventListener("pointerup", end);
    ul.addEventListener("pointercancel", end);
  }

  const prioBadge = (p) => p
    ? `<span class="prio-badge" style="background:${PRIO_COLOR[p]}" title="Priorität: ${PRIO_LABEL[p]}">P${p}</span>`
    : "";
  // Button-Gruppe zur Prioritäts-Auswahl (für Panel & Quick-Add)
  function prioPicker(cur) {
    const btn = (p) => `<button type="button" data-prio="${p}" class="${p === cur ? "sel" : ""}"
        style="${p && p === cur ? `background:${PRIO_COLOR[p]}` : ""}"
        title="${PRIO_LABEL[p]}">${p === 0 ? "—" : "P" + p}</button>`;
    return `<div class="prio-picker">${[0,1,2,3,4,5].map(btn).join("")}</div>`;
  }
  function bindPrioPicker(rootEl, onPick) {
    rootEl.querySelectorAll(".prio-picker button").forEach(b => b.onclick = () => {
      const p = +b.dataset.prio;
      rootEl.querySelectorAll(".prio-picker button").forEach(x => { x.classList.remove("sel"); x.style.background = ""; });
      b.classList.add("sel");
      if (p) b.style.background = PRIO_COLOR[p];
      onPick(p);
    });
  }

  /* ============ Datum-Formatierung ============ */
  function fmtDate(str) {
    if (!str) return "";
    const d = new Date(str + "T00:00:00");
    const today = Store.todayStr();
    const tmr = Store.addToDate(today, { type: "daily", interval: 1 });
    if (str === today) return "Heute";
    if (str === tmr) return "Morgen";
    return d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
  }

  /* ============ Toast ============ */
  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2600);
  }

  /* ============ SIDEBAR ============ */
  function renderSidebar() {
    navAreas.innerHTML = Store.state.areas.map(a => `
      <button class="nav-item" data-view="area" data-id="${a.id}">
        <span class="nav-ico" style="--chip:${a.color}">${a.emoji}</span>
        <span class="nav-label">${esc(a.name)}</span>
        <span class="nav-count">${Store.tasksForArea(a.id).filter(t => !t.done).length || ""}</span>
      </button>`).join("");

    $$("[data-count]").forEach(el => {
      const k = el.dataset.count;
      let n = 0;
      if (k === "myday") n = Store.myDayTasks().filter(t => !t.done).length;
      if (k === "all")   n = Store.allOpenTasks().filter(t => !t.done).length;
      el.textContent = n || "";
    });

    $$(".nav-item").forEach(b => {
      const active = b.dataset.view === view.name &&
        (view.name !== "area" || b.dataset.id === view.areaId);
      b.classList.toggle("active", active);
    });
  }

  /* ============ TASK-ZEILE ============ */
  function taskRow(t) {
    const pct = Store.progress(t);
    const overdue = Store.isOverdue(t);
    const subCount = (t.subtasks || []).length;
    const area = Store.areaById(t.areaId);
    return `
    <li class="task ${t.done ? "is-done" : ""} ${overdue ? "is-overdue" : ""}" data-id="${t.id}">
      ${canDrag() ? `<span class="drag-handle" title="Ziehen zum Sortieren">⠿</span>` : ""}
      <button class="check" data-act="toggle" aria-label="Erledigt">
        <span class="check-box">${t.done ? "✓" : ""}</span>
      </button>
      <span class="task-chip" style="--chip:${t.color}">${t.emoji}</span>
      <div class="task-body" data-act="open">
        <div class="task-title-row">
          ${prioBadge(t.priority)}
          <span class="task-title">${esc(t.title)}</span>
        </div>
        <div class="task-meta">
          ${t.due ? `<span class="meta ${overdue ? "overdue" : ""}">📅 ${fmtDate(t.due)}</span>` : ""}
          ${t.repeat ? `<span class="meta">🔁 ${REPEAT_LABEL[t.repeat.type]}</span>` : ""}
          ${subCount ? `<span class="meta">☑ ${t.subtasks.filter(s => s.done).length}/${subCount}</span>` : ""}
          ${area && view.name !== "area" ? `<span class="meta meta-area" style="--chip:${area.color}">${area.emoji} ${esc(area.name)}</span>` : ""}
        </div>
        ${subCount ? `<div class="progress"><span style="width:${pct}%;background:${pctColor(pct)}"></span></div>` : ""}
        ${subCount ? `<ul class="task-subs">${(t.subtasks || []).map(subRowList).join("")}</ul>` : ""}
      </div>
    </li>`;
  }
  // Kompakte Unteraufgabe für die Listenansicht (abhakbar, ohne Bearbeiten)
  function subRowList(s) {
    return `<li class="sub-inline ${s.done ? "done" : ""}" data-subrow="${s.id}">
      <button class="check xs" data-sub-check><span class="check-box">${s.done ? "✓" : ""}</span></button>
      <span class="sub-title">${esc(s.title)}</span>
    </li>`;
  }

  function listSection(title, tasks, opts = {}) {
    if (!tasks.length && !opts.alwaysShow) return "";
    return `
      <div class="list-block">
        ${title ? `<h3 class="block-title">${esc(title)} <span class="block-n">${tasks.length}</span></h3>` : ""}
        <ul class="task-list">${tasks.map(taskRow).join("")}</ul>
      </div>`;
  }

  /* ============ VIEWS ============ */
  function renderHeaderTitle(title, sub = "") {
    return `<div class="view-head"><h2>${esc(title)}</h2>${sub ? `<p class="view-sub">${esc(sub)}</p>` : ""}</div>`;
  }

  function viewMyDay() {
    const tasks = Store.myDayTasks();
    const open = tasks.filter(t => !t.done);
    const done = tasks.filter(t => t.done);
    const overdue = open.filter(Store.isOverdue);
    const rest = open.filter(t => !Store.isOverdue(t));
    const dateStr = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });

    let html = renderHeaderTitle("☀️ Mein Tag", dateStr);
    if (!tasks.length) {
      html += emptyState("Nichts für heute 🎉", "Füge Aufgaben hinzu oder markiere sie für „Mein Tag“.");
    } else {
      html += controlsBar();
      html += listSection("Überfällig", applySort(applyFilters(overdue)));
      html += listSection(overdue.length ? "Heute" : "", applySort(applyFilters(rest)), { alwaysShow: !overdue.length });
      html += listSection("Erledigt", done);
    }
    content.innerHTML = html;
  }

  function viewArea() {
    const area = Store.areaById(view.areaId);
    if (!area) { view = { name: "myday" }; return render(); }
    const tasks = Store.tasksForArea(area.id);
    const open = tasks.filter(t => !t.done);
    const done = tasks.filter(t => t.done);
    let html = `<div class="view-head">
        <h2><span class="task-chip lg" style="--chip:${area.color}">${area.emoji}</span> ${esc(area.name)}</h2>
        <button class="link-btn" id="edit-area-btn">Bereich bearbeiten</button>
      </div>`;
    if (!tasks.length) html += emptyState("Noch keine Aufgaben", "Lege mit „＋ Neue Aufgabe“ los.");
    else {
      html += controlsBar({ area: false });
      html += listSection("", applySort(applyFilters(open, { area: false })), { alwaysShow: true });
      html += listSection("Erledigt", done);
    }
    content.innerHTML = html;
    const eb = $("#edit-area-btn");
    if (eb) eb.onclick = () => openAreaModal(area);
  }

  function viewAll() {
    let html = renderHeaderTitle("🗂️ Alle Aufgaben");
    const byArea = Store.state.areas.map(a => ({ a, tasks: Store.tasksForArea(a.id).filter(t => !t.done) }))
      .filter(x => x.tasks.length);
    if (!byArea.length) html += emptyState("Alles erledigt!", "Keine offenen Aufgaben.");
    else {
      html += controlsBar();
      byArea.forEach(({ a, tasks }) => {
        const list = applySort(applyFilters(tasks));
        if (!list.length) return;
        html += `<div class="list-block">
          <h3 class="block-title"><span class="task-chip" style="--chip:${a.color}">${a.emoji}</span> ${esc(a.name)} <span class="block-n">${list.length}</span></h3>
          <ul class="task-list">${list.map(taskRow).join("")}</ul></div>`;
      });
    }
    content.innerHTML = html;
  }

  function viewArchive() {
    content.innerHTML = renderHeaderTitle("🗄️ Archiv") + `<div id="archive-list" class="muted">Lade…</div>`;
    Store.archivedTasks().then(tasks => {
      const el = $("#archive-list");
      if (!tasks.length) { el.outerHTML = emptyState("Archiv leer", "Erledigte Aufgaben landen hier nach Tagesabschluss."); return; }
      el.outerHTML = `<ul class="task-list archive">${tasks.map(t => `
        <li class="task is-done" data-id="${t.id}">
          <span class="task-chip" style="--chip:${t.color}">${t.emoji}</span>
          <div class="task-body"><span class="task-title">${esc(t.title)}</span>
            <div class="task-meta"><span class="meta">${new Date(t.archivedAt).toLocaleDateString("de-DE")}</span></div>
          </div>
          <button class="link-btn" data-act="restore" data-id="${t.id}">Wiederherstellen</button>
        </li>`).join("")}</ul>`;
    });
  }

  /* ---------- Kalender (Monat / Woche / Tag) ---------- */
  let calRef = new Date();
  let calMode = "month";  // month | week | day

  function viewCalendar() {
    const titleByMode = {
      month: calRef.toLocaleDateString("de-DE", { month: "long", year: "numeric" }),
      week: weekTitle(calRef),
      day: calRef.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    };
    content.innerHTML = `
      <div class="view-head cal-head">
        <h2>📅 ${titleByMode[calMode]}</h2>
        <div class="cal-nav">
          <div class="cal-modes">
            <button data-mode="month" class="${calMode==="month"?"sel":""}">Monat</button>
            <button data-mode="week" class="${calMode==="week"?"sel":""}">Woche</button>
            <button data-mode="day" class="${calMode==="day"?"sel":""}">Tag</button>
          </div>
          <button class="icon-btn" data-cal="prev">‹</button>
          <button class="link-btn" data-cal="today">Heute</button>
          <button class="icon-btn" data-cal="next">›</button>
        </div>
      </div>
      <div id="cal-area"></div>
      <div id="cal-day"></div>`;

    ({ month: renderCalMonth, week: renderCalWeek, day: renderCalDay }[calMode])();

    $$("[data-mode]").forEach(b => b.onclick = () => { calMode = b.dataset.mode; viewCalendar(); });
    $$("[data-cal]").forEach(b => b.onclick = () => {
      const step = b.dataset.cal === "prev" ? -1 : b.dataset.cal === "next" ? 1 : 0;
      if (b.dataset.cal === "today") calRef = new Date();
      else if (calMode === "month") calRef = new Date(calRef.getFullYear(), calRef.getMonth() + step, 1);
      else if (calMode === "week") calRef = new Date(calRef.getTime() + step * 7 * 864e5);
      else calRef = new Date(calRef.getTime() + step * 864e5);
      viewCalendar();
    });
  }

  function mondayOf(d) {
    const x = new Date(d); x.setHours(0,0,0,0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  function weekTitle(ref) {
    const mon = mondayOf(ref), sun = new Date(mon.getTime() + 6 * 864e5);
    const f = (d) => d.toLocaleDateString("de-DE", { day: "numeric", month: "short" });
    return `${f(mon)} – ${f(sun)} ${sun.getFullYear()}`;
  }

  function renderCalMonth() {
    const y = calRef.getFullYear(), m = calRef.getMonth();
    const startDow = (new Date(y, m, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const today = Store.todayStr();
    let cells = "";
    for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = Store.toDateStr(new Date(y, m, d));
      const tasks = Store.tasksOnDate(ds);
      const dots = tasks.slice(0, 4).map(t => `<span class="cal-dot ${Store.isOverdue(t) ? "od" : ""}" style="--chip:${t.color}"></span>`).join("");
      cells += `<div class="cal-cell ${ds === today ? "today" : ""}" data-date="${ds}">
        <span class="cal-num">${d}</span>
        <div class="cal-dots">${dots}${tasks.length > 4 ? `<span class="cal-more">+${tasks.length - 4}</span>` : ""}</div>
      </div>`;
    }
    const dows = ["Mo","Di","Mi","Do","Fr","Sa","So"].map(d => `<div class="cal-dow">${d}</div>`).join("");
    $("#cal-area").innerHTML = `<div class="cal-grid head">${dows}</div><div class="cal-grid">${cells}</div>`;
    $$("#cal-area .cal-cell[data-date]").forEach(c => c.onclick = () => showCalDay(c.dataset.date));
  }

  function renderCalWeek() {
    const mon = mondayOf(calRef), today = Store.todayStr();
    const wd = ["Mo","Di","Mi","Do","Fr","Sa","So"];
    let cols = "";
    for (let i = 0; i < 7; i++) {
      const day = new Date(mon.getTime() + i * 864e5);
      const ds = Store.toDateStr(day);
      const tasks = Store.tasksOnDate(ds);
      const items = tasks.map(t =>
        `<div class="cw-task ${t.done?"done":""} ${Store.isOverdue(t)?"od":""}" style="--chip:${t.color}" data-id="${t.id}">${prioBadge(t.priority)} ${esc(t.title)}</div>`).join("")
        || `<div class="muted" style="font-size:12px">–</div>`;
      cols += `<div class="cal-week-col ${ds===today?"today":""}">
        <div class="cal-week-head" data-date="${ds}"><span class="wd">${wd[i]}</span><span class="dn">${day.getDate()}</span></div>
        ${items}</div>`;
    }
    $("#cal-area").innerHTML = `<div class="cal-week">${cols}</div>`;
    $$("#cal-area .cw-task").forEach(el => el.onclick = () => openPanel(el.dataset.id));
    $$("#cal-area .cal-week-head").forEach(h => h.onclick = () => { calRef = new Date(h.dataset.date + "T00:00:00"); calMode = "day"; viewCalendar(); });
  }

  function renderCalDay() {
    const ds = Store.toDateStr(calRef);
    const tasks = Store.tasksOnDate(ds);
    $("#cal-area").innerHTML = `<div class="list-block">
      ${tasks.length ? `<ul class="task-list">${tasks.map(taskRow).join("")}</ul>`
        : `<p class="muted">Keine Aufgaben an diesem Tag.</p>`}</div>`;
  }

  function showCalDay(ds) {
    const tasks = Store.tasksOnDate(ds);
    const el = $("#cal-day");
    el.innerHTML = `<div class="list-block">
      <h3 class="block-title">${fmtDate(ds)} <span class="block-n">${tasks.length}</span></h3>
      ${tasks.length ? `<ul class="task-list">${tasks.map(taskRow).join("")}</ul>` : `<p class="muted">Keine Aufgaben an diesem Tag.</p>`}
    </div>`;
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function emptyState(title, sub) {
    return `<div class="empty"><div class="empty-emoji">🗒️</div><h3>${esc(title)}</h3><p>${esc(sub)}</p></div>`;
  }

  /* ---------- Anmerkungen (temporär, Entwicklung) ---------- */
  let notesTimer;
  function viewNotes() {
    content.innerHTML = renderHeaderTitle("📝 Anmerkungen", "Temporäres Feld für Feedback während der Entwicklung. Wird zum Schluss entfernt.") +
      `<textarea id="dev-notes" class="dev-notes" placeholder="Hier Wünsche, Bugs und Ideen notieren…"></textarea>
       <p class="muted small" id="dev-notes-status">Wird automatisch gespeichert.</p>`;
    const ta = $("#dev-notes");
    DB.metaGet("dev-notes").then(v => { ta.value = v || ""; });
    ta.oninput = () => {
      clearTimeout(notesTimer);
      const s1 = $("#dev-notes-status"); if (s1) s1.textContent = "Speichere…";
      notesTimer = setTimeout(async () => {
        await DB.metaSet("dev-notes", ta.value);
        const s2 = $("#dev-notes-status");   // Ansicht könnte gewechselt sein
        if (s2) s2.textContent = "Gespeichert ✓ " + new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      }, 500);
    };
  }

  /* ============================================================
     MODUL: ZIELE (Bucketlist)
     ============================================================ */
  const GOAL_CATEGORIES = ["Reise", "Lernen", "Sport", "Anschaffung", "Erlebnis", "Sonstiges"];

  function viewGoals() {
    const active = Store.state.goals.filter(g => !g.achieved);
    const done = Store.state.goals.filter(g => g.achieved);
    let html = `<div class="view-head">
        <h2>🎯 Ziele</h2>
        <button class="btn-primary" id="add-goal">＋ Neues Ziel</button>
      </div>
      <p class="view-sub">Langfristige Wünsche und Vorhaben — ohne Zeitdruck.</p>`;
    if (!Store.state.goals.length) html += emptyState("Noch keine Ziele", "Träume festhalten mit „＋ Neues Ziel“.");
    else {
      html += `<div class="card-grid">${active.map(goalCard).join("")}</div>`;
      if (done.length) html += `<h3 class="block-title" style="margin-top:24px">Erreicht <span class="block-n">${done.length}</span></h3>
        <div class="card-grid">${done.map(goalCard).join("")}</div>`;
    }
    content.innerHTML = html;
    $("#add-goal").onclick = () => openGoalPanel(null);
    $$("#content .goal-card").forEach(c => c.onclick = () => openGoalPanel(c.dataset.id));
    loadMediaImages();
  }
  function goalCard(g) {
    const pct = Store.goalProgress(g);
    const steps = (g.steps || []).length;
    return `<div class="goal-card ${g.achieved ? "achieved" : ""}" data-id="${g.id}">
      ${g.mediaId ? `<div class="card-img"><img data-media="${g.mediaId}" alt=""></div>` : `<div class="card-img placeholder">🎯</div>`}
      <div class="card-body">
        <div class="card-top">
          ${g.category ? `<span class="chip-tag">${esc(g.category)}</span>` : ""}
          ${g.targetYear ? `<span class="chip-tag soft">📅 ${g.targetYear}</span>` : ""}
          ${g.achieved ? `<span class="chip-tag ok">✓ Erreicht</span>` : ""}
        </div>
        <h3 class="card-title">${esc(g.title)}</h3>
        ${steps ? `<div class="card-sub muted">${(g.steps.filter(s=>s.done).length)}/${steps} Schritte</div>
          <div class="progress"><span style="width:${pct}%;background:${pctColor(pct)}"></span></div>` : ""}
      </div>
    </div>`;
  }
  function openGoalPanel(id) {
    const g = id ? Store.state.goals.find(x => x.id === id) : null;
    const isNew = !g;
    const cur = g || { title: "", notes: "", category: "", targetYear: "", steps: [], mediaId: null, achieved: false };
    const years = [];
    const y0 = new Date().getFullYear();
    for (let y = y0; y <= y0 + 15; y++) years.push(y);
    const catOpts = `<option value="">— Kategorie —</option>` +
      GOAL_CATEGORIES.map(c => `<option ${c === cur.category ? "selected" : ""}>${c}</option>`).join("");
    const yearOpts = `<option value="">— Zieljahr —</option>` +
      years.map(y => `<option ${String(cur.targetYear) === String(y) ? "selected" : ""}>${y}</option>`).join("");
    panel.innerHTML = `
      <header class="panel-head">
        <button class="icon-btn" data-p="close">✕</button>
        ${isNew ? "" : `<button class="link-btn danger" data-g="delete">Löschen</button>`}
      </header>
      <div class="panel-body">
        <input class="panel-title-input" data-g="title" placeholder="Was möchtest du erreichen?" value="${esc(cur.title)}">
        <div class="goal-img-edit">
          ${cur.mediaId ? `<img data-media="${cur.mediaId}" alt="">` : `<div class="goal-img-ph">🎯</div>`}
          <label class="btn-soft sm">📷 Bild${cur.mediaId ? " ändern" : ""}<input type="file" accept="image/*" data-g="img" hidden></label>
          ${cur.mediaId ? `<button class="link-btn danger sm" data-g="img-del">Bild entfernen</button>` : ""}
        </div>
        <div class="field-row">
          <label class="field"><span>Kategorie</span><select data-g="category">${catOpts}</select></label>
          <label class="field"><span>Zieljahr</span><select data-g="targetYear">${yearOpts}</select></label>
        </div>
        <div class="field"><span>Zwischenschritte <span class="muted">${Store.goalProgress(cur)}%</span></span>
          <div class="progress lg"><span style="width:${Store.goalProgress(cur)}%;background:${pctColor(Store.goalProgress(cur))}"></span></div>
          <ul class="subtasks" data-g-steps>${(cur.steps||[]).map(subRow).join("")}</ul>
          <div class="sub-add"><input type="text" data-g-step-new placeholder="Schritt hinzufügen…"><button class="icon-btn" data-g="add-step">＋</button></div>
        </div>
        <label class="field"><span>Notizen</span><textarea data-g="notes" rows="3" placeholder="Notizen…">${esc(cur.notes)}</textarea></label>
        <label class="toggle-field"><input type="checkbox" data-g="achieved" ${cur.achieved ? "checked" : ""}><span>✓ Als erreicht markieren</span></label>
      </div>`;
    panel.hidden = false; panelOv.hidden = false;
    requestAnimationFrame(() => panel.classList.add("open"));
    loadMediaImages();

    // Bei neuem Ziel: erst beim ersten Speichern anlegen
    let gid = g ? g.id : null;
    const ensure = async () => { if (!gid) { const ng = await Store.addGoal({ title: panel.querySelector('[data-g="title"]').value.trim() || "Neues Ziel" }); gid = ng.id; } return gid; };
    const save = async (patch) => { await ensure(); await Store.updateGoal(gid, patch); };

    panel.querySelector('[data-p="close"]').onclick = () => { closePanel(); render(); };
    const del = panel.querySelector('[data-g="delete"]');
    if (del) del.onclick = async () => { if (confirm("Ziel löschen?")) { await Store.deleteGoal(gid); closePanel(); render(); } };
    panel.querySelector('[data-g="title"]').onchange = (e) => save({ title: e.target.value.trim() || "Neues Ziel" });
    panel.querySelector('[data-g="category"]').onchange = (e) => save({ category: e.target.value });
    panel.querySelector('[data-g="targetYear"]').onchange = (e) => save({ targetYear: e.target.value ? +e.target.value : null });
    panel.querySelector('[data-g="notes"]').onchange = (e) => save({ notes: e.target.value });
    panel.querySelector('[data-g="achieved"]').onchange = (e) => { save({ achieved: e.target.checked }); };
    panel.querySelector('[data-g="img"]').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 6 * 1024 * 1024) { toast("Bild zu groß (max. 6 MB)"); return; }
      await ensure();
      const cg = Store.state.goals.find(x => x.id === gid);
      if (cg.mediaId) await Store.delMedia(cg.mediaId);
      const mediaId = await Store.addMedia(f);
      await Store.updateGoal(gid, { mediaId });
      openGoalPanel(gid);
    };
    const imgDel = panel.querySelector('[data-g="img-del"]');
    if (imgDel) imgDel.onclick = async () => {
      const cg = Store.state.goals.find(x => x.id === gid);
      if (cg.mediaId) await Store.delMedia(cg.mediaId);
      await Store.updateGoal(gid, { mediaId: null }); openGoalPanel(gid);
    };
    // Schritte
    const stepsEl = panel.querySelector("[data-g-steps]");
    const newStep = panel.querySelector("[data-g-step-new]");
    const addStep = async () => {
      const v = newStep.value.trim(); if (!v) return;
      await ensure();
      const cg = Store.state.goals.find(x => x.id === gid);
      const steps = [...(cg.steps || []), { id: Store.uid(), title: v, done: false }];
      await Store.updateGoal(gid, { steps });
      newStep.value = ""; refreshGoalSteps(gid);
    };
    panel.querySelector('[data-g="add-step"]').onclick = addStep;
    newStep.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addStep(); } };
    stepsEl.onclick = async (e) => {
      const li = e.target.closest("[data-sub]"); if (!li) return;
      const sid = li.dataset.sub;
      const cg = Store.state.goals.find(x => x.id === gid); if (!cg) return;
      if (e.target.closest("[data-sub-toggle]")) {
        const s = cg.steps.find(s => s.id === sid); s.done = !s.done;
        await Store.updateGoal(gid, { steps: cg.steps }); refreshGoalSteps(gid);
      }
      if (e.target.closest("[data-sub-del]")) {
        await Store.updateGoal(gid, { steps: cg.steps.filter(s => s.id !== sid) }); refreshGoalSteps(gid);
      }
    };
    // Zwischenschritte per Drag sortieren
    makeSortable(stepsEl, ".sub-drag", "[data-sub]", "sub", async (ids) => {
      const cg = Store.state.goals.find(x => x.id === gid); if (!cg) return;
      cg.steps = ids.map(id => (cg.steps || []).find(s => s.id === id)).filter(Boolean);
      await Store.updateGoal(gid, { steps: cg.steps });
    });
  }
  function refreshGoalSteps(gid) {
    const g = Store.state.goals.find(x => x.id === gid); if (!g) return;
    panel.querySelector("[data-g-steps]").innerHTML = (g.steps || []).map(subRow).join("");
    const p = Store.goalProgress(g);
    const bar = panel.querySelector(".progress.lg span");
    bar.style.width = p + "%"; bar.style.background = pctColor(p);
  }

  /* ============================================================
     MODUL: ORTE (Reise / Restaurant / Aktivität)
     ============================================================ */
  const PLACE_TYPES = {
    reise: { label: "Reise", icon: "✈️" },
    restaurant: { label: "Restaurant", icon: "🍽️" },
    aktivitaet: { label: "Aktivität", icon: "🎟️" }
  };
  let placesFilter = { type: "all", status: "all" };
  let placesSort = "recent"; // recent | rating | name

  function viewPlaces() {
    let list = [...Store.state.places];
    if (placesFilter.type !== "all") list = list.filter(p => p.type === placesFilter.type);
    if (placesFilter.status !== "all") list = list.filter(p => p.status === placesFilter.status);
    if (placesSort === "rating") list.sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.createdAt||0) - (a.createdAt||0));
    else if (placesSort === "name") list.sort((a, b) => a.name.localeCompare(b.name, "de"));
    else list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const tab = (val, label) => `<button class="seg ${placesFilter.type === val ? "sel" : ""}" data-ptype="${val}">${label}</button>`;
    const sortOpts = { recent: "Zuletzt", rating: "Bewertung", name: "Name" };
    let html = `<div class="view-head">
        <h2>📍 Orte</h2>
        <button class="btn-primary" id="add-place">＋ Neuer Ort</button>
      </div>
      <div class="seg-group">
        ${tab("all", "Alle")}${tab("reise", "✈️ Reise")}${tab("restaurant", "🍽️ Restaurant")}${tab("aktivitaet", "🎟️ Aktivität")}
      </div>
      <div class="controls-bar">
        <div class="ctrl"><span class="ctrl-label">Status</span>
          <select id="place-status">
            <option value="all" ${placesFilter.status==="all"?"selected":""}>Alle</option>
            <option value="want" ${placesFilter.status==="want"?"selected":""}>Will ich</option>
            <option value="visited" ${placesFilter.status==="visited"?"selected":""}>War ich</option>
          </select></div>
        <div class="ctrl"><span class="ctrl-label">Sortieren</span>
          <select id="place-sort">${Object.entries(sortOpts).map(([k,v]) => `<option value="${k}" ${placesSort===k?"selected":""}>${v}</option>`).join("")}</select></div>
      </div>`;
    if (!list.length) html += emptyState("Keine Orte", "Lege Reiseziele, Restaurants und Aktivitäten an.");
    else html += `<div class="card-grid">${list.map(placeCard).join("")}</div>`;
    content.innerHTML = html;
    $("#add-place").onclick = () => openPlacePanel(null);
    $("#place-status").onchange = (e) => { placesFilter.status = e.target.value; render(); };
    $("#place-sort").onchange = (e) => { placesSort = e.target.value; render(); };
    $$("[data-ptype]").forEach(b => b.onclick = () => { placesFilter.type = b.dataset.ptype; render(); });
    $$("#content .place-card").forEach(c => c.onclick = (e) => {
      if (e.target.closest("[data-pact]")) return; // Aktions-Links nicht als Öffnen werten
      openPlacePanel(c.dataset.id);
    });
    loadMediaImages();
  }
  function stars(n) { return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n); }
  function priceStr(n) { return n ? "€".repeat(n) : ""; }
  function placeCard(p) {
    const t = PLACE_TYPES[p.type] || {};
    return `<div class="place-card" data-id="${p.id}">
      ${p.mediaId ? `<div class="card-img"><img data-media="${p.mediaId}" alt=""></div>` : `<div class="card-img placeholder">${t.icon || "📍"}</div>`}
      <div class="card-body">
        <div class="card-top">
          <span class="chip-tag">${t.icon || ""} ${t.label || ""}</span>
          <span class="chip-tag ${p.status === "visited" ? "ok" : "soft"}">${p.status === "visited" ? "✓ War ich" : "Will ich"}${p.status === "visited" && p.visitedAt ? " · " + new Date(p.visitedAt+"T00:00:00").toLocaleDateString("de-DE", {month:"short", year:"numeric"}) : ""}</span>
        </div>
        <h3 class="card-title">${esc(p.name)}</h3>
        <div class="card-sub">
          ${p.rating ? `<span class="rating">${stars(p.rating)}</span>` : ""}
          ${p.price ? `<span class="price">${priceStr(p.price)}</span>` : ""}
        </div>
        ${(p.tags && p.tags.length) ? `<div class="tag-row">${p.tags.map(t => `<span class="tag-pill">${esc(t)}</span>`).join("")}</div>` : ""}
        <div class="place-actions">
          ${p.website ? `<a class="act-btn" data-pact href="${encodeURI(p.website)}" target="_blank" rel="noopener" title="Website">🌐</a>` : ""}
          ${p.phone ? `<a class="act-btn" data-pact href="tel:${esc(p.phone)}" title="Anrufen">☎️</a>` : ""}
          ${(p.mapsUrl || p.address) ? `<a class="act-btn" data-pact href="${p.mapsUrl ? encodeURI(p.mapsUrl) : "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(p.address)}" target="_blank" rel="noopener" title="Karte">📍</a>` : ""}
        </div>
      </div>
    </div>`;
  }
  function openPlacePanel(id) {
    const p = id ? Store.state.places.find(x => x.id === id) : null;
    const isNew = !p;
    const cur = p || { name: "", type: "reise", notes: "", website: "", phone: "", address: "", mapsUrl: "", rating: 0, price: 0, status: "want", tags: [], mediaId: null };
    const typeOpts = Object.entries(PLACE_TYPES).map(([k, v]) => `<option value="${k}" ${k === cur.type ? "selected" : ""}>${v.icon} ${v.label}</option>`).join("");
    panel.innerHTML = `
      <header class="panel-head">
        <button class="icon-btn" data-p="close">✕</button>
        ${isNew ? "" : `<button class="link-btn danger" data-pl="delete">Löschen</button>`}
      </header>
      <div class="panel-body">
        <input class="panel-title-input" data-pl="name" placeholder="Name des Ortes" value="${esc(cur.name)}">
        <div class="goal-img-edit">
          ${cur.mediaId ? `<img data-media="${cur.mediaId}" alt="">` : `<div class="goal-img-ph">${(PLACE_TYPES[cur.type]||{}).icon || "📍"}</div>`}
          <label class="btn-soft sm">📷 Bild${cur.mediaId ? " ändern" : ""}<input type="file" accept="image/*" data-pl="img" hidden></label>
          ${cur.mediaId ? `<button class="link-btn danger sm" data-pl="img-del">Bild entfernen</button>` : ""}
        </div>
        <div class="field-row">
          <label class="field"><span>Typ</span><select data-pl="type">${typeOpts}</select></label>
          <label class="field"><span>Status</span><select data-pl="status">
            <option value="want" ${cur.status==="want"?"selected":""}>Will ich</option>
            <option value="visited" ${cur.status==="visited"?"selected":""}>War ich</option>
          </select></label>
        </div>
        <div class="field-row">
          <div class="field"><span>Bewertung</span><div class="star-picker" data-pl="rating">${[1,2,3,4,5].map(n => `<button data-star="${n}" class="${n <= cur.rating ? "on" : ""}">★</button>`).join("")}</div></div>
          <div class="field"><span>Preis</span><div class="price-picker" data-pl="price">${[1,2,3,4].map(n => `<button data-price="${n}" class="${n <= cur.price ? "on" : ""}">€</button>`).join("")}</div></div>
        </div>
        <label class="field"><span>Besucht am (optional)</span><input type="date" data-pl="visitedAt" value="${cur.visitedAt || ""}"></label>
        <label class="field"><span>Website</span><input type="url" data-pl="website" placeholder="https://…" value="${esc(cur.website)}"></label>
        <label class="field"><span>Telefon</span><input type="tel" data-pl="phone" placeholder="+352 …" value="${esc(cur.phone)}"></label>
        <label class="field"><span>Adresse</span><input type="text" data-pl="address" placeholder="Straße, Ort" value="${esc(cur.address)}"></label>
        <label class="field"><span>Google-Maps-Link (optional)</span><input type="url" data-pl="mapsUrl" placeholder="https://maps.google.com/…" value="${esc(cur.mapsUrl)}"></label>
        <label class="field"><span>Tags (Komma-getrennt)</span><input type="text" data-pl="tags" placeholder="z.B. Italienisch, Terrasse" value="${esc((cur.tags||[]).join(", "))}"></label>
        <label class="field"><span>Notizen</span><textarea data-pl="notes" rows="3" placeholder="Notizen…">${esc(cur.notes)}</textarea></label>
      </div>`;
    panel.hidden = false; panelOv.hidden = false;
    requestAnimationFrame(() => panel.classList.add("open"));
    loadMediaImages();

    let pid = p ? p.id : null;
    const ensure = async () => { if (!pid) { const np = await Store.addPlace({ name: panel.querySelector('[data-pl="name"]').value.trim() || "Neuer Ort", type: panel.querySelector('[data-pl="type"]').value }); pid = np.id; } return pid; };
    const save = async (patch) => { await ensure(); await Store.updatePlace(pid, patch); };
    const bindVal = (sel, key, fn) => { const el = panel.querySelector(sel); el.onchange = () => save({ [key]: fn ? fn(el.value) : el.value }); };

    panel.querySelector('[data-p="close"]').onclick = () => { closePanel(); render(); };
    const del = panel.querySelector('[data-pl="delete"]');
    if (del) del.onclick = async () => { if (confirm("Ort löschen?")) { await Store.deletePlace(pid); closePanel(); render(); } };
    bindVal('[data-pl="name"]', "name", v => v.trim() || "Neuer Ort");
    bindVal('[data-pl="type"]', "type");
    bindVal('[data-pl="status"]', "status");
    bindVal('[data-pl="website"]', "website");
    bindVal('[data-pl="phone"]', "phone");
    bindVal('[data-pl="address"]', "address");
    bindVal('[data-pl="mapsUrl"]', "mapsUrl");
    bindVal('[data-pl="visitedAt"]', "visitedAt", v => v || null);
    bindVal('[data-pl="notes"]', "notes");
    panel.querySelector('[data-pl="tags"]').onchange = (e) => save({ tags: e.target.value.split(",").map(t => t.trim()).filter(Boolean) });
    // Sterne
    panel.querySelectorAll('[data-pl="rating"] [data-star]').forEach(b => b.onclick = async () => {
      let n = +b.dataset.star;
      const cp = pid ? Store.state.places.find(x => x.id === pid) : null;
      if (cp && cp.rating === n) n = 0; // nochmal klicken = zurücksetzen
      await save({ rating: n });
      panel.querySelectorAll('[data-pl="rating"] [data-star]').forEach(s => s.classList.toggle("on", +s.dataset.star <= n));
    });
    panel.querySelectorAll('[data-pl="price"] [data-price]').forEach(b => b.onclick = async () => {
      let n = +b.dataset.price;
      const cp = pid ? Store.state.places.find(x => x.id === pid) : null;
      if (cp && cp.price === n) n = 0;
      await save({ price: n });
      panel.querySelectorAll('[data-pl="price"] [data-price]').forEach(s => s.classList.toggle("on", +s.dataset.price <= n));
    });
    panel.querySelector('[data-pl="img"]').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 6 * 1024 * 1024) { toast("Bild zu groß (max. 6 MB)"); return; }
      await ensure();
      const cp = Store.state.places.find(x => x.id === pid);
      if (cp.mediaId) await Store.delMedia(cp.mediaId);
      const mediaId = await Store.addMedia(f);
      await Store.updatePlace(pid, { mediaId });
      openPlacePanel(pid);
    };
    const imgDel = panel.querySelector('[data-pl="img-del"]');
    if (imgDel) imgDel.onclick = async () => {
      const cp = Store.state.places.find(x => x.id === pid);
      if (cp.mediaId) await Store.delMedia(cp.mediaId);
      await Store.updatePlace(pid, { mediaId: null }); openPlacePanel(pid);
    };
  }

  /* ============================================================
     MODUL: BUDGET
     ============================================================ */
  let budgetRef = new Date();
  async function viewBudget() {
    const ym = `${budgetRef.getFullYear()}-${String(budgetRef.getMonth() + 1).padStart(2, "0")}`;
    const monthName = budgetRef.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
    content.innerHTML = `<div class="view-head cal-head">
        <h2>💶 Budget</h2>
        <div class="cal-nav">
          <button class="icon-btn" data-bm="prev">‹</button>
          <button class="link-btn" data-bm="today">Heute</button>
          <button class="icon-btn" data-bm="next">›</button>
          <button class="btn-soft" id="edit-cats">⚙ Kategorien</button>
          <button class="btn-primary" id="add-expense">＋ Ausgabe</button>
        </div>
      </div>
      <p class="view-sub">${monthName}</p>
      <div id="budget-body" class="muted">Lade…</div>`;
    $$("[data-bm]").forEach(b => b.onclick = () => {
      if (b.dataset.bm === "prev") budgetRef = new Date(budgetRef.getFullYear(), budgetRef.getMonth() - 1, 1);
      if (b.dataset.bm === "next") budgetRef = new Date(budgetRef.getFullYear(), budgetRef.getMonth() + 1, 1);
      if (b.dataset.bm === "today") budgetRef = new Date();
      viewBudget();
    });
    $("#add-expense").onclick = () => openExpenseModal(null);
    $("#edit-cats").onclick = () => openCategoryEditor();

    const expenses = await Store.expensesForMonth(ym);
    const cats = Store.state.budgetCategories;
    const sums = {};
    let total = 0;
    expenses.forEach(e => { sums[e.category] = (sums[e.category] || 0) + e.amount; total += e.amount; });
    const catData = cats.map(c => ({ ...c, sum: sums[c.id] || 0 }))
      .filter(c => c.sum > 0).sort((a, b) => b.sum - a.sum);

    const body = $("#budget-body");
    if (!expenses.length) {
      body.outerHTML = `<div id="budget-body">${emptyState("Keine Ausgaben", "Erfasse Ausgaben mit „＋ Ausgabe“.")}</div>`;
      return;
    }
    const overCount = catData.filter(c => c.limit && c.sum > c.limit).length;
    body.outerHTML = `<div id="budget-body">
      <div class="budget-top">
        ${donutSvg(catData, total)}
        <div class="budget-legend">
          <div class="budget-total"><span class="muted">Gesamt ${monthName}</span><strong>${fmtEur(total)}</strong></div>
          ${overCount ? `<div class="budget-warn">⚠ ${overCount} Kategorie${overCount>1?"n":""} über Limit</div>` : ""}
          ${catData.map(c => { const over = c.limit && c.sum > c.limit;
            return `<div class="legend-row">
            <span class="legend-dot" style="background:${c.color}"></span>
            <span class="legend-name">${c.icon} ${esc(c.name)}</span>
            <span class="legend-bar"><span style="width:${c.limit ? Math.min(100, Math.round(c.sum/c.limit*100)) : Math.round(c.sum/total*100)}%;background:${over ? "var(--overdue)" : c.color}"></span></span>
            <span class="legend-val">${fmtEur(c.sum)}${c.limit ? ` <small class="lim ${over ? "over" : ""}">/ ${fmtEur(c.limit)}</small>` : ""}</span>
          </div>`; }).join("")}
        </div>
      </div>
      <h3 class="block-title" style="margin-top:8px">Ausgaben <span class="block-n">${expenses.length}</span></h3>
      <ul class="expense-list">
        ${expenses.map(e => { const c = Store.categoryById(e.category) || { icon: "📦", name: e.category, color: "#888" };
          return `<li class="expense-row" data-id="${e.id}">
            <span class="exp-cat" style="--chip:${c.color}">${c.icon}</span>
            <div class="exp-mid"><span class="exp-note">${esc(e.note || c.name)}</span>
              <span class="exp-meta muted">${esc(c.name)}${e.subcategory ? " › " + esc(e.subcategory) : ""} · ${new Date(e.date+"T00:00:00").toLocaleDateString("de-DE")}</span></div>
            <span class="exp-amount">${fmtEur(e.amount)}</span>
          </li>`; }).join("")}
      </ul></div>`;
    $$("#content .expense-row").forEach(r => r.onclick = () => openExpenseModal(r.dataset.id));
  }
  function fmtEur(n) { return n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }); }
  function donutSvg(catData, total) {
    if (!total) return "";
    const r = 52, c = 2 * Math.PI * r; let off = 0;
    const segs = catData.map(cat => {
      const frac = cat.sum / total, len = frac * c;
      const seg = `<circle r="${r}" cx="70" cy="70" fill="none" stroke="${cat.color}" stroke-width="22"
        stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"></circle>`;
      off += len; return seg;
    }).join("");
    return `<svg class="donut" viewBox="0 0 140 140" width="150" height="150">
      ${segs}
      <text x="70" y="66" text-anchor="middle" class="donut-c1">${fmtEur(total).replace(/\s?€/, "")}</text>
      <text x="70" y="84" text-anchor="middle" class="donut-c2">EUR</text>
    </svg>`;
  }
  async function openExpenseModal(id) {
    const ex = id ? await DB.get("expenses", id) : null;
    const allExp = await DB.getAll("expenses");
    const cur = ex || { amount: "", category: Store.state.budgetCategories[0]?.id, subcategory: "", note: "", date: Store.todayStr() };
    const catOpts = Store.state.budgetCategories.map(c => `<option value="${c.id}" ${c.id === cur.category ? "selected" : ""}>${c.icon} ${esc(c.name)}</option>`).join("");
    // Vorschläge für Unterkategorien aus bisherigen Ausgaben
    const subSuggest = [...new Set(allExp.map(e => e.subcategory).filter(Boolean))].sort();
    const dataList = `<datalist id="ex-sub-list">${subSuggest.map(s => `<option value="${esc(s)}"></option>`).join("")}</datalist>`;
    modal.innerHTML = `
      <h3 class="modal-title">${ex ? "Ausgabe bearbeiten" : "Neue Ausgabe"}</h3>
      <label class="field"><span>Betrag (€)</span><input type="number" step="0.01" min="0" id="ex-amount" class="modal-input" value="${cur.amount}" placeholder="0,00"></label>
      <div class="field-row">
        <label class="field"><span>Kategorie</span><select id="ex-cat">${catOpts}</select></label>
        <label class="field"><span>Datum</span><input type="date" id="ex-date" value="${cur.date}"></label>
      </div>
      <label class="field"><span>Unterkategorie (optional)</span><input type="text" id="ex-sub" class="modal-input" list="ex-sub-list" value="${esc(cur.subcategory || "")}" placeholder="z.B. Pizza, Sprit, Trikot">${dataList}</label>
      <label class="field"><span>Notiz</span><input type="text" id="ex-note" class="modal-input" value="${esc(cur.note)}" placeholder="z.B. Wocheneinkauf"></label>
      <div class="modal-actions">
        ${ex ? `<button class="link-btn danger" data-x="delete">Löschen</button>` : "<span></span>"}
        <div><button class="btn-soft" data-x="cancel">Abbrechen</button><button class="btn-primary" data-x="save">${ex ? "Speichern" : "Hinzufügen"}</button></div>
      </div>`;
    showModal();
    $("#ex-amount").focus();
    modal.querySelector('[data-x="cancel"]').onclick = hideModal;
    modal.querySelector('[data-x="save"]').onclick = async () => {
      const amount = parseFloat($("#ex-amount").value); if (!(amount > 0)) { $("#ex-amount").focus(); return; }
      const data = { amount, category: $("#ex-cat").value, subcategory: $("#ex-sub").value.trim(), date: $("#ex-date").value || Store.todayStr(), note: $("#ex-note").value.trim() };
      if (ex) await Store.updateExpense(ex.id, data); else await Store.addExpense(data);
      hideModal(); viewBudget();
    };
    const del = modal.querySelector('[data-x="delete"]');
    if (del) del.onclick = async () => { await Store.deleteExpense(ex.id); hideModal(); viewBudget(); };
  }

  function openCategoryEditor() {
    const rowHtml = (c) => `<div class="cat-row" data-cat-row data-id="${c.id || ""}">
        <input class="cat-emoji" data-c="icon" maxlength="2" value="${esc(c.icon || "")}" placeholder="🙂">
        <input class="cat-name" data-c="name" value="${esc(c.name || "")}" placeholder="Name">
        <input type="color" data-c="color" value="${c.color || "#6c5ce7"}">
        <input type="number" class="cat-limit" data-c="limit" min="0" step="1" value="${c.limit || ""}" placeholder="Limit €">
        <button class="icon-btn sm" data-cat-del title="Löschen">✕</button>
      </div>`;
    modal.innerHTML = `
      <h3 class="modal-title">Budget-Kategorien</h3>
      <p class="muted small">Emoji, Name, Farbe und optionales Monatslimit.</p>
      <div class="cat-editor" data-cats>${Store.state.budgetCategories.map(rowHtml).join("")}</div>
      <button class="btn-soft" id="cat-add">＋ Kategorie</button>
      <div class="modal-actions"><span></span>
        <div><button class="btn-soft" data-x="cancel">Abbrechen</button><button class="btn-primary" data-x="save">Speichern</button></div>
      </div>`;
    showModal();
    const list = modal.querySelector("[data-cats]");
    modal.querySelector("#cat-add").onclick = () => {
      list.insertAdjacentHTML("beforeend", rowHtml({ id: "", icon: "📦", name: "", color: MAKI_COLORS[Math.floor(Math.random()*MAKI_COLORS.length)] }));
    };
    list.onclick = (e) => { const b = e.target.closest("[data-cat-del]"); if (b) b.closest("[data-cat-row]").remove(); };
    modal.querySelector('[data-x="cancel"]').onclick = hideModal;
    modal.querySelector('[data-x="save"]').onclick = async () => {
      const cats = [...list.querySelectorAll("[data-cat-row]")].map(row => {
        const get = (k) => row.querySelector(`[data-c="${k}"]`).value;
        const name = get("name").trim(); if (!name) return null;
        const id = row.dataset.id || (name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Store.uid().slice(-3));
        const limit = parseFloat(get("limit"));
        return { id, name, icon: get("icon").trim() || "📦", color: get("color"), limit: limit > 0 ? limit : null };
      }).filter(Boolean);
      if (!cats.length) { toast("Mindestens eine Kategorie nötig"); return; }
      await Store.setBudgetCategories(cats);
      hideModal(); viewBudget();
    };
  }

  /* Bilder aus IndexedDB nachladen (für Karten/Panels mit [data-media]) */
  function loadMediaImages(root = document) {
    root.querySelectorAll("img[data-media]:not([src])").forEach(async img => {
      const m = await Store.getMedia(img.dataset.media);
      if (m && m.blob) img.src = URL.createObjectURL(m.blob);
    });
  }

  /* ============ ROUTER ============ */
  function render() {
    renderSidebar();
    const q = $("#search").value.trim();
    if (q) return renderSearch(q);
    ({ myday: viewMyDay, all: viewAll, area: viewArea,
       calendar: viewCalendar, archive: viewArchive, notes: viewNotes,
       goals: viewGoals, places: viewPlaces, budget: viewBudget }[view.name] || viewMyDay)();
  }
  function renderSearch(q) {
    const tasks = Store.search(q);
    content.innerHTML = renderHeaderTitle(`🔍 Suche: „${q}“`, `${tasks.length} Treffer`) +
      (tasks.length ? `<ul class="task-list">${tasks.map(taskRow).join("")}</ul>` : emptyState("Nichts gefunden", "Andere Suchbegriffe versuchen."));
  }

  /* ============ TASK-DETAIL-PANEL ============ */
  let panelTaskId = null;
  async function openPanel(taskId) {
    const t = Store.state.tasks.find(t => t.id === taskId);
    if (!t) return;
    panelTaskId = taskId;
    const atts = await Store.getAttachments(taskId);
    panel.innerHTML = panelHTML(t, atts);
    panel.hidden = false; panelOv.hidden = false;
    requestAnimationFrame(() => panel.classList.add("open"));
    bindPanel(t);
  }
  function closePanel() {
    panel.classList.remove("open");
    panelOv.hidden = true;
    setTimeout(() => { panel.hidden = true; panelTaskId = null; }, 220);
  }
  function panelHTML(t, atts) {
    const areaOpts = Store.state.areas.map(a =>
      `<option value="${a.id}" ${a.id === t.areaId ? "selected" : ""}>${esc(a.emoji + " " + a.name)}</option>`).join("");
    const repType = t.repeat ? t.repeat.type : "";
    const repOpts = `<option value="">Keine</option>` + Object.entries(REPEAT_LABEL).map(([k,v]) =>
      `<option value="${k}" ${k === repType ? "selected" : ""}>${v}</option>`).join("");
    return `
      <header class="panel-head">
        <button class="icon-btn" data-p="close">✕</button>
        <button class="link-btn danger" data-p="delete">Löschen</button>
      </header>
      <div class="panel-body">
        <div class="panel-title-row">
          <button class="task-chip lg" data-p="pick-emoji" style="--chip:${t.color}">${t.emoji}</button>
          <textarea class="panel-title" data-f="title" rows="1" placeholder="Aufgabe">${esc(t.title)}</textarea>
        </div>

        <div class="emoji-picker" data-picker hidden>
          <div class="ep-emojis">${MAKI_EMOJIS.map(e => `<button data-emoji="${e}" class="${e===t.emoji?"sel":""}">${e}</button>`).join("")}</div>
          <div class="ep-colors">${MAKI_COLORS.map(c => `<button data-color="${c}" class="${c===t.color?"sel":""}" style="background:${c}"></button>`).join("")}</div>
        </div>

        <label class="field"><span>Bereich</span>
          <select data-f="areaId">${areaOpts}</select></label>

        <label class="field"><span>Fällig</span>
          <input type="date" data-f="due" value="${t.due || ""}"></label>

        <div class="field"><span>Priorität</span>${prioPicker(t.priority)}</div>

        <label class="field"><span>Wiederholung</span>
          <select data-f="repeat">${repOpts}</select></label>

        <label class="field" data-repeat-int ${t.repeat ? "" : "hidden"}><span>Intervall</span>
          <div class="interval-row">alle
            <input type="number" min="1" max="99" data-f="repeat-interval" value="${(t.repeat && t.repeat.interval) || 1}">
            <span data-repeat-unit>${REPEAT_UNIT[repType] || ""}</span>
          </div></label>

        <label class="toggle-field">
          <input type="checkbox" data-f="myDay" ${t.myDay ? "checked" : ""}>
          <span>☀️ Zu „Mein Tag“ hinzufügen</span>
        </label>

        <div class="field"><span>Unteraufgaben <span class="muted">${Store.progress(t)}%</span></span>
          <div class="progress lg"><span style="width:${Store.progress(t)}%;background:${pctColor(Store.progress(t))}"></span></div>
          <ul class="subtasks" data-subs>
            ${(t.subtasks||[]).map(s => subRow(s)).join("")}
          </ul>
          <div class="sub-add">
            <input type="text" data-sub-new placeholder="Unteraufgabe hinzufügen…">
            <button class="icon-btn" data-p="add-sub">＋</button>
          </div>
        </div>

        <label class="field"><span>Notizen</span>
          <textarea data-f="notes" rows="3" placeholder="Notizen…">${esc(t.notes)}</textarea></label>

        <div class="field"><span>Anhänge (Bild / PDF)</span>
          <ul class="atts" data-atts>${atts.map(attRow).join("")}</ul>
          <label class="att-add">
            <input type="file" accept="image/*,application/pdf" data-att-input hidden>
            <span class="btn-soft">📎 Datei anhängen</span>
          </label>
        </div>
      </div>`;
  }
  function subRow(s) {
    return `<li class="sub ${s.done ? "done" : ""}" data-sub="${s.id}">
      <span class="sub-drag" title="Ziehen zum Sortieren">⠿</span>
      <button class="check sm" data-sub-toggle><span class="check-box">${s.done ? "✓" : ""}</span></button>
      <span class="sub-title">${esc(s.title)}</span>
      <button class="icon-btn sm" data-sub-del>✕</button></li>`;
  }
  function attRow(a) {
    return `<li class="att" data-att="${a.id}">
      <span class="att-ico">${a.type.startsWith("image/") ? "🖼️" : "📄"}</span>
      <span class="att-name" data-att-open>${esc(a.name)}</span>
      <button class="icon-btn sm" data-att-del>✕</button></li>`;
  }

  function bindPanel(t) {
    const save = (patch) => Store.updateTask(t.id, patch).then(() => { render(); });

    panel.querySelector('[data-p="close"]').onclick = closePanel;
    panel.querySelector('[data-p="delete"]').onclick = async () => {
      if (!confirm("Diese Aufgabe wirklich löschen?")) return;
      await Store.deleteTask(t.id); closePanel(); render(); toast("Aufgabe gelöscht");
    };

    // Felder
    const titleEl = panel.querySelector('[data-f="title"]');
    autoGrow(titleEl);
    titleEl.oninput = () => autoGrow(titleEl);
    titleEl.onchange = () => save({ title: titleEl.value.trim() || "Unbenannte Aufgabe" });
    panel.querySelector('[data-f="notes"]').onchange = (e) => save({ notes: e.target.value });
    panel.querySelector('[data-f="areaId"]').onchange = (e) => save({ areaId: e.target.value });
    panel.querySelector('[data-f="due"]').onchange = (e) => save({ due: e.target.value || null });
    bindPrioPicker(panel, (p) => save({ priority: p }));
    const repSel = panel.querySelector('[data-f="repeat"]');
    const repIntWrap = panel.querySelector("[data-repeat-int]");
    const repIntInput = panel.querySelector('[data-f="repeat-interval"]');
    const repUnit = panel.querySelector("[data-repeat-unit]");
    repSel.onchange = (e) => {
      const type = e.target.value;
      repIntWrap.hidden = !type;
      repUnit.textContent = REPEAT_UNIT[type] || "";
      save({ repeat: type ? { type, interval: Math.max(1, +repIntInput.value || 1) } : null });
    };
    repIntInput.onchange = () => {
      if (!repSel.value) return;
      const interval = Math.min(99, Math.max(1, +repIntInput.value || 1));
      repIntInput.value = interval;
      save({ repeat: { type: repSel.value, interval } });
    };
    panel.querySelector('[data-f="myDay"]').onchange = (e) => save({ myDay: e.target.checked });

    // Emoji/Farb-Picker
    const picker = panel.querySelector("[data-picker]");
    panel.querySelector('[data-p="pick-emoji"]').onclick = () => picker.hidden = !picker.hidden;
    picker.querySelectorAll("[data-emoji]").forEach(b => b.onclick = async () => {
      await save({ emoji: b.dataset.emoji });
      panel.querySelector('[data-p="pick-emoji"]').textContent = b.dataset.emoji;
      picker.querySelectorAll("[data-emoji]").forEach(x => x.classList.remove("sel"));
      b.classList.add("sel");
    });
    picker.querySelectorAll("[data-color]").forEach(b => b.onclick = async () => {
      await save({ color: b.dataset.color });
      panel.querySelector('[data-p="pick-emoji"]').style.setProperty("--chip", b.dataset.color);
      picker.querySelectorAll("[data-color]").forEach(x => x.classList.remove("sel"));
      b.classList.add("sel");
    });

    // Unteraufgaben
    const subsEl = panel.querySelector("[data-subs]");
    const newSub = panel.querySelector("[data-sub-new]");
    const addSub = async () => {
      const v = newSub.value.trim(); if (!v) return;
      t.subtasks = t.subtasks || [];
      t.subtasks.push({ id: Store.uid(), title: v, done: false });
      await Store.updateTask(t.id, { subtasks: t.subtasks });
      newSub.value = ""; refreshSubs(t); render();
    };
    panel.querySelector('[data-p="add-sub"]').onclick = addSub;
    newSub.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addSub(); } };
    subsEl.onclick = async (e) => {
      const li = e.target.closest("[data-sub]"); if (!li) return;
      const sid = li.dataset.sub;
      if (e.target.closest("[data-sub-toggle]")) {
        const s = t.subtasks.find(s => s.id === sid);
        await Store.toggleSubtask(t.id, sid, !s.done); refreshSubs(t); render();
      }
      if (e.target.closest("[data-sub-del]")) {
        t.subtasks = t.subtasks.filter(s => s.id !== sid);
        await Store.updateTask(t.id, { subtasks: t.subtasks }); refreshSubs(t); render();
      }
    };
    // Unteraufgaben per Drag sortieren
    makeSortable(subsEl, ".sub-drag", "[data-sub]", "sub", async (ids) => {
      t.subtasks = ids.map(id => (t.subtasks || []).find(s => s.id === id)).filter(Boolean);
      await Store.updateTask(t.id, { subtasks: t.subtasks }); render();
    });

    // Anhänge
    const attInput = panel.querySelector("[data-att-input]");
    attInput.onchange = async () => {
      const f = attInput.files[0]; if (!f) return;
      if (f.size > 8 * 1024 * 1024) { toast("Datei zu groß (max. 8 MB)"); return; }
      await Store.addAttachment(t.id, f);
      refreshAtts(t); toast("Anhang hinzugefügt");
    };
    panel.querySelector("[data-atts]").onclick = async (e) => {
      const li = e.target.closest("[data-att]"); if (!li) return;
      const id = li.dataset.att;
      if (e.target.closest("[data-att-del]")) { await Store.deleteAttachment(id); refreshAtts(t); }
      else if (e.target.closest("[data-att-open]")) {
        const a = (await Store.getAttachments(t.id)).find(a => a.id === id);
        if (a) window.open(URL.createObjectURL(a.blob), "_blank");
      }
    };
  }
  function refreshSubs(t) {
    const fresh = Store.state.tasks.find(x => x.id === t.id);
    panel.querySelector("[data-subs]").innerHTML = (fresh.subtasks || []).map(subRow).join("");
    const bar = panel.querySelector(".progress.lg span");
    bar.style.width = Store.progress(fresh) + "%";
    bar.style.background = pctColor(Store.progress(fresh));
  }
  async function refreshAtts(t) {
    const atts = await Store.getAttachments(t.id);
    panel.querySelector("[data-atts]").innerHTML = atts.map(attRow).join("");
  }
  function autoGrow(el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }

  /* ============ QUICK ADD ============ */
  function openQuickAdd() {
    const areaOpts = Store.state.areas.map(a =>
      `<option value="${a.id}" ${view.name === "area" && a.id === view.areaId ? "selected" : ""}>${esc(a.emoji + " " + a.name)}</option>`).join("");
    modal.innerHTML = `
      <h3 class="modal-title">Neue Aufgabe</h3>
      <input type="text" id="qa-title" placeholder="Was ist zu tun?" class="modal-input" autofocus>
      <div class="field-row">
        <label class="field"><span>Bereich</span><select id="qa-area">${areaOpts}</select></label>
        <label class="field"><span>Fällig</span><input type="date" id="qa-due"></label>
      </div>
      <div class="field"><span>Priorität</span>${prioPicker(0)}</div>
      <label class="toggle-field"><input type="checkbox" id="qa-myday" ${view.name === "myday" ? "checked" : ""}><span>☀️ Zu „Mein Tag“</span></label>
      <div class="modal-actions">
        <button class="btn-soft" data-m="cancel">Abbrechen</button>
        <button class="btn-primary" data-m="save">Hinzufügen</button>
      </div>`;
    showModal();
    const titleEl = $("#qa-title"); titleEl.focus();
    let qaPrio = 0;
    bindPrioPicker(modal, (p) => qaPrio = p);
    const save = async () => {
      const title = titleEl.value.trim(); if (!title) { titleEl.focus(); return; }
      await Store.addTask({
        title, areaId: $("#qa-area").value, due: $("#qa-due").value || null,
        priority: qaPrio, myDay: $("#qa-myday").checked
      });
      hideModal(); render(); toast("Aufgabe hinzugefügt");
    };
    modal.querySelector('[data-m="save"]').onclick = save;
    modal.querySelector('[data-m="cancel"]').onclick = hideModal;
    titleEl.onkeydown = (e) => { if (e.key === "Enter") save(); };
  }

  /* ============ BEREICH-MODAL ============ */
  function openAreaModal(area = null) {
    const edit = !!area;
    const cur = area || { name: "", emoji: "🗂️", color: MAKI_COLORS[0] };
    modal.innerHTML = `
      <h3 class="modal-title">${edit ? "Bereich bearbeiten" : "Neuer Bereich"}</h3>
      <input type="text" id="ar-name" placeholder="Name" class="modal-input" value="${esc(cur.name)}">
      <div class="emoji-picker static">
        <div class="ep-emojis">${MAKI_EMOJIS.map(e => `<button data-emoji="${e}" class="${e===cur.emoji?"sel":""}">${e}</button>`).join("")}</div>
        <div class="ep-colors">${MAKI_COLORS.map(c => `<button data-color="${c}" class="${c===cur.color?"sel":""}" style="background:${c}"></button>`).join("")}</div>
      </div>
      <div class="modal-actions">
        ${edit ? `<button class="link-btn danger" data-m="delete">Löschen</button>` : "<span></span>"}
        <div>
          <button class="btn-soft" data-m="cancel">Abbrechen</button>
          <button class="btn-primary" data-m="save">${edit ? "Speichern" : "Anlegen"}</button>
        </div>
      </div>`;
    showModal();
    let pickEmoji = cur.emoji, pickColor = cur.color;
    modal.querySelectorAll("[data-emoji]").forEach(b => b.onclick = () => {
      pickEmoji = b.dataset.emoji;
      modal.querySelectorAll("[data-emoji]").forEach(x => x.classList.remove("sel")); b.classList.add("sel");
    });
    modal.querySelectorAll("[data-color]").forEach(b => b.onclick = () => {
      pickColor = b.dataset.color;
      modal.querySelectorAll("[data-color]").forEach(x => x.classList.remove("sel")); b.classList.add("sel");
    });
    modal.querySelector('[data-m="cancel"]').onclick = hideModal;
    modal.querySelector('[data-m="save"]').onclick = async () => {
      const name = $("#ar-name").value.trim() || "Neuer Bereich";
      if (edit) await Store.updateArea(area.id, { name, emoji: pickEmoji, color: pickColor });
      else { const a = await Store.addArea({ name, emoji: pickEmoji, color: pickColor }); view = { name: "area", areaId: a.id }; }
      hideModal(); render();
    };
    const del = modal.querySelector('[data-m="delete"]');
    if (del) del.onclick = async () => {
      if (!confirm(`Bereich „${area.name}“ und alle zugehörigen Aufgaben löschen?`)) return;
      await Store.deleteArea(area.id);
      if (view.areaId === area.id) view = { name: "myday" };
      hideModal(); render(); toast("Bereich gelöscht");
    };
  }

  /* ============ EINSTELLUNGEN / BACKUP ============ */
  function openSettings() {
    const counts = { tasks: Store.state.tasks.length, areas: Store.state.areas.length };
    const tp = themePref();
    modal.innerHTML = `
      <h3 class="modal-title">⚙️ Einstellungen</h3>
      <div class="settings-block">
        <h4>Darstellung</h4>
        <div class="theme-picker">
          <button data-theme-pref="light"  class="${tp==="light"?"sel":""}">☀️ Hell</button>
          <button data-theme-pref="dark"   class="${tp==="dark"?"sel":""}">🌙 Dunkel</button>
          <button data-theme-pref="system" class="${tp==="system"?"sel":""}">🖥️ System</button>
        </div>
      </div>
      <div class="settings-block">
        <h4>Erinnerungen</h4>
        <label class="toggle-field">
          <input type="checkbox" data-s="reminders" ${remindersOn()?"checked":""}>
          <span>Beim Öffnen an heute fällige Aufgaben erinnern</span>
        </label>
        <p class="muted small">Benachrichtigung beim ersten Öffnen pro Tag. (Auf dem iPhone erst nach Installation als App verfügbar.)</p>
      </div>
      <div class="settings-block">
        <h4>Backup</h4>
        <p class="muted">Deine Daten liegen nur lokal in diesem Browser. Sichere sie regelmäßig als Datei — und stelle sie bei Browser-/Gerätewechsel daraus wieder her.</p>
        <div class="settings-actions">
          <button class="btn-primary" data-s="export">⬇︎ Backup exportieren</button>
          <label class="btn-soft">⬆︎ Backup importieren
            <input type="file" accept="application/json,.json" data-s="import-file" hidden>
          </label>
        </div>
        <p class="muted small">Aktuell: ${counts.areas} Bereiche · ${counts.tasks} aktive Aufgaben</p>
      </div>
      <div class="modal-actions"><span></span>
        <button class="btn-soft" data-m="cancel">Schließen</button>
      </div>`;
    showModal();
    modal.querySelector('[data-m="cancel"]').onclick = hideModal;

    modal.querySelectorAll("[data-theme-pref]").forEach(b => b.onclick = () => {
      setThemePref(b.dataset.themePref);
      modal.querySelectorAll("[data-theme-pref]").forEach(x => x.classList.remove("sel"));
      b.classList.add("sel");
    });

    modal.querySelector('[data-s="reminders"]').onchange = async (e) => {
      if (e.target.checked) { const ok = await enableReminders(); e.target.checked = ok; if (ok) toast("Erinnerungen aktiviert"); }
      else { disableReminders(); toast("Erinnerungen aus"); }
    };

    modal.querySelector('[data-s="export"]').onclick = async () => {
      const data = await Store.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `todo-maki-backup_${Store.todayStr()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Backup exportiert");
    };

    modal.querySelector('[data-s="import-file"]').onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      let data;
      try { data = JSON.parse(await file.text()); }
      catch { toast("Datei konnte nicht gelesen werden"); return; }
      if (!confirm("Backup importieren? Alle aktuellen Daten werden dadurch ersetzt.")) { e.target.value = ""; return; }
      try {
        const r = await Store.importData(data, "replace");
        hideModal(); view = { name: "myday" }; render();
        toast(`Importiert: ${r.tasks} Aufgaben, ${r.areas} Bereiche`);
      } catch (err) { toast(err.message || "Import fehlgeschlagen"); }
    };
  }

  function showModal() { modalOv.hidden = false; }
  function hideModal() { modalOv.hidden = true; modal.innerHTML = ""; }

  /* ============ PRÄFERENZEN: THEME ============ */
  function themePref() { return localStorage.getItem("maki-theme") || "system"; }
  function applyTheme(pref = themePref()) {
    const dark = pref === "dark" ||
      (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#1d2027" : "#6c5ce7");
  }
  function setThemePref(pref) { localStorage.setItem("maki-theme", pref); applyTheme(pref); }
  // Bei „System" auf OS-Wechsel reagieren
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (themePref() === "system") applyTheme("system");
  });

  /* ============ ERINNERUNGEN / NOTIFICATIONS ============ */
  const remindersOn = () => localStorage.getItem("maki-reminders") === "on";
  async function enableReminders() {
    if (!("Notification" in window)) { toast("Benachrichtigungen werden nicht unterstützt"); return false; }
    const perm = Notification.permission === "granted"
      ? "granted" : await Notification.requestPermission();
    if (perm === "granted") { localStorage.setItem("maki-reminders", "on"); return true; }
    toast("Benachrichtigung wurde nicht erlaubt"); return false;
  }
  function disableReminders() { localStorage.setItem("maki-reminders", "off"); }

  // Beim Start: einmal pro Tag über heute fällige + überfällige Tasks erinnern
  function maybeNotify() {
    if (!remindersOn() || Notification.permission !== "granted") return;
    const today = Store.todayStr();
    if (localStorage.getItem("maki-last-notified") === today) return;
    const due = Store.myDayTasks().filter(t => !t.done && (Store.isDueToday(t) || Store.isOverdue(t)));
    if (!due.length) return;
    const overdue = due.filter(Store.isOverdue).length;
    const body = due.slice(0, 4).map(t => "• " + t.title).join("\n") + (due.length > 4 ? `\n…und ${due.length - 4} mehr` : "");
    try {
      new Notification(`☀️ ${due.length} Aufgabe${due.length>1?"n":""} heute${overdue?` (${overdue} überfällig)`:""}`,
        { body, icon: "assets/icon-192.png", tag: "maki-daily" });
      localStorage.setItem("maki-last-notified", today);
    } catch { /* z.B. iOS ohne installierte PWA */ }
  }

  /* ============ GLOBALE EVENTS ============ */
  function bindGlobal() {
    // Navigation (Sidebar) – Delegation
    $("#sidebar").addEventListener("click", (e) => {
      const item = e.target.closest(".nav-item");
      if (item) {
        if (item.dataset.view === "settings") { closeSidebarMobile(); openSettings(); return; }
        view = { name: item.dataset.view, areaId: item.dataset.id || null };
        $("#search").value = "";
        closeSidebarMobile();
        render();
      }
    });
    $("#add-area-btn").onclick = (e) => { e.stopPropagation(); openAreaModal(); };

    // Task-Liste (Delegation auf content)
    content.addEventListener("click", async (e) => {
      const li = e.target.closest(".task"); if (!li) return;
      const id = li.dataset.id;
      // Inline-Unteraufgabe abhaken (nicht das Panel öffnen)
      const subrow = e.target.closest("[data-subrow]");
      if (subrow) {
        if (e.target.closest("[data-sub-check]")) {
          const t = Store.state.tasks.find(t => t.id === id);
          const s = (t && t.subtasks || []).find(s => s.id === subrow.dataset.subrow);
          if (s) { await Store.toggleSubtask(id, s.id, !s.done); render(); }
        }
        return;
      }
      if (e.target.closest('[data-act="toggle"]')) {
        const t = Store.state.tasks.find(t => t.id === id);
        await Store.toggleTask(id, !t.done); render();
        return;
      }
      if (e.target.closest('[data-act="restore"]')) {
        await Store.restoreTask(e.target.dataset.id); render(); toast("Wiederhergestellt"); return;
      }
      if (e.target.closest('[data-act="open"]') || e.target.closest(".task-body")) openPanel(id);
    });

    $("#quick-add-btn").onclick = openQuickAdd;
    $("#search").addEventListener("input", () => render());

    // Sortier-/Filter-Steuerung (Delegation, da pro Render neu gerendert)
    content.addEventListener("change", (e) => {
      if (e.target.id === "sort-mode") {
        sortMode = e.target.value; localStorage.setItem("maki-sort", sortMode); render();
      } else if (e.target.id === "f-prio") { filters.priority = +e.target.value; render(); }
      else if (e.target.id === "f-due")  { filters.due = e.target.value; render(); }
      else if (e.target.id === "f-area") { filters.area = e.target.value; render(); }
    });
    content.addEventListener("click", (e) => {
      if (e.target.id === "f-reset") { filters = { priority: 0, due: "all", area: "all" }; render(); }
    });

    // Drag & Drop per Pointer-Events (Maus + Touch) — am Griff ⠿
    let drag = null;
    content.addEventListener("pointerdown", (e) => {
      const handle = e.target.closest(".drag-handle");
      if (!handle) return;
      const li = handle.closest(".task"); if (!li) return;
      e.preventDefault();
      drag = { li, ul: li.parentElement };
      li.classList.add("dragging");
      handle.setPointerCapture(e.pointerId);
    });
    content.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const siblings = [...drag.ul.querySelectorAll(".task:not(.dragging)")];
      const after = siblings.find(el => {
        const r = el.getBoundingClientRect();
        return e.clientY < r.top + r.height / 2;
      });
      if (after) drag.ul.insertBefore(drag.li, after);
      else drag.ul.appendChild(drag.li);
    });
    const endDrag = async () => {
      if (!drag) return;
      const ul = drag.ul; drag.li.classList.remove("dragging"); drag = null;
      const ids = [...ul.querySelectorAll(".task")].map(li => li.dataset.id);
      await Store.reorderTasks(ids);
      render();
    };
    content.addEventListener("pointerup", endDrag);
    content.addEventListener("pointercancel", endDrag);

    panelOv.onclick = closePanel;
    modalOv.onclick = (e) => { if (e.target === modalOv) hideModal(); };
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { if (!panel.hidden) closePanel(); if (!modalOv.hidden) hideModal(); }
    });

    // Mobile-Menü
    $("#menu-toggle").onclick = () => $("#sidebar").classList.toggle("open");
  }
  function closeSidebarMobile() { $("#sidebar").classList.remove("open"); }

  /* ============ START ============ */
  async function start() {
    applyTheme();
    await Store.init();
    bindGlobal();
    render();
    maybeNotify();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  start();
})();
