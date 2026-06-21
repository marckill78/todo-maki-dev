/* store.js — State & Geschäftslogik für ToDo Maki
   Hält den In-Memory-Cache, kapselt alle Regeln (Mein Tag, überfällig,
   Archiv-Automatik, Wiederholungen) und persistiert über DB. */

const Store = (() => {
  const state = {
    areas: [],
    tasks: [],           // nur nicht-archivierte
    goals: [],           // Bucketlist
    places: [],          // Orte
    budgetCategories: [], // Budget-Kategorien
    loaded: false
  };

  const DEFAULT_BUDGET_CATEGORIES = [
    { id: "lebensmittel", name: "Lebensmittel", color: "#00b894", icon: "🛒" },
    { id: "restaurant",   name: "Restaurant",   color: "#e17055", icon: "🍽️" },
    { id: "reisen",       name: "Reisen",       color: "#0984e3", icon: "✈️" },
    { id: "kinder",       name: "Kinder",       color: "#e84393", icon: "🧒" },
    { id: "lego",         name: "Lego",         color: "#d63031", icon: "🧱" },
    { id: "fussball",     name: "Fussball",     color: "#00b894", icon: "⚽" },
    { id: "atelier",      name: "Atelier",      color: "#a29bfe", icon: "🔨" },
    { id: "garten",       name: "Garten",       color: "#00b894", icon: "🌳" },
    { id: "schule",       name: "Schule",       color: "#fdcb6e", icon: "🏫" },
    { id: "gesundheit",   name: "Gesundheit",   color: "#0984e3", icon: "🩺" },
    { id: "transport",    name: "Transport",    color: "#fdcb6e", icon: "🚗" },
    { id: "sonstiges",    name: "Sonstiges",    color: "#636e72", icon: "📦" }
  ];
  // Vom Nutzer gewünschte Zusatz-Kategorien (für Migration bestehender Installationen)
  const EXTRA_BUDGET_CATEGORIES = ["reisen", "kinder", "lego", "fussball", "atelier", "garten", "schule", "gesundheit"]
    .map(id => DEFAULT_BUDGET_CATEGORIES.find(c => c.id === id));

  /* ---------- Hilfen ---------- */
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const todayStr = () => toDateStr(new Date());
  function toDateStr(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"),
          day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function addToDate(dateStr, rule) {
    const d = new Date(dateStr + "T00:00:00");
    const n = rule.interval || 1;
    if (rule.type === "daily")   d.setDate(d.getDate() + n);
    if (rule.type === "weekly")  d.setDate(d.getDate() + 7 * n);
    if (rule.type === "monthly") d.setMonth(d.getMonth() + n);
    if (rule.type === "yearly")  d.setFullYear(d.getFullYear() + n);
    return toDateStr(d);
  }

  /* ---------- Default-Bereiche (Erstinstallation) ---------- */
  const DEFAULT_AREAS = [
    { name: "Haus",     emoji: "🏠", color: "#0984e3" },
    { name: "Atelier",  emoji: "🔨", color: "#e84393" },
    { name: "Garten",   emoji: "🌳", color: "#00b894" },
    { name: "LJBM",     emoji: "🏫", color: "#6c5ce7" },
    { name: "Marisca",  emoji: "⚽", color: "#d63031" },
    { name: "Projekte", emoji: "🛠️", color: "#fdcb6e" }
  ];

  async function init() {
    let areas = await DB.getAll("areas");
    if (!areas.length) {
      areas = DEFAULT_AREAS.map((a, i) => ({
        id: uid(), order: i, createdAt: Date.now(), ...a
      }));
      for (const a of areas) await DB.put("areas", a);
    }
    state.areas = areas.sort((a, b) => a.order - b.order);

    const all = await DB.getAll("tasks");
    state.tasks = all.filter(t => !t.archived);

    state.goals = (await DB.getAll("goals")).sort((a, b) => (a.order || 0) - (b.order || 0));
    state.places = (await DB.getAll("places")).sort((a, b) => (a.order || 0) - (b.order || 0));
    state.budgetCategories = (await DB.metaGet("budget-categories")) || DEFAULT_BUDGET_CATEGORIES;

    await runMigrations();
    await runDailyCleanup();   // erledigte Tasks von gestern → Archiv
    state.loaded = true;
  }

  // State aus der DB neu laden (nach Cloud-Sync), ohne Seed/Migration/Cleanup
  async function reload() {
    state.areas = (await DB.getAll("areas")).sort((a, b) => (a.order || 0) - (b.order || 0));
    state.tasks = (await DB.getAll("tasks")).filter(t => !t.archived);
    state.goals = (await DB.getAll("goals")).sort((a, b) => (a.order || 0) - (b.order || 0));
    state.places = (await DB.getAll("places")).sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  /* Einmalige Datenmigrationen (greifen in bestehende Installationen) */
  async function runMigrations() {
    // 1) Bereich-Symbole anpassen (nur falls noch der alte Default gesetzt ist)
    if (!(await DB.metaGet("mig-area-emojis-1"))) {
      const map = { Atelier: ["🎨", "🔨"], LJBM: ["📌", "🏫"], Marisca: ["❤️", "⚽"], Projekte: ["🎯", "🛠️"] };
      for (const a of state.areas) {
        const m = map[a.name];
        if (m && a.emoji === m[0]) { a.emoji = m[1]; await DB.put("areas", a); }
      }
      await DB.metaSet("mig-area-emojis-1", true);
    }
    // 2) Fehlende Budget-Kategorien ergänzen
    if (!(await DB.metaGet("mig-budget-cats-1"))) {
      const have = new Set(state.budgetCategories.map(c => c.name.toLowerCase()));
      const merged = [...state.budgetCategories];
      for (const c of EXTRA_BUDGET_CATEGORIES) if (!have.has(c.name.toLowerCase())) merged.push({ ...c });
      state.budgetCategories = merged;
      await DB.metaSet("budget-categories", merged);
      await DB.metaSet("mig-budget-cats-1", true);
    }
  }

  /* ---------- Tages-Bereinigung ----------
     Regel: erledigte Tasks bleiben den Tag über durchgestrichen sichtbar.
     Erst wenn der Erledigungstag vorbei ist, wandern sie ins Archiv. */
  async function runDailyCleanup() {
    const today = todayStr();
    const last = await DB.metaGet("lastCleanup");
    const toArchive = state.tasks.filter(
      t => t.done && t.completedAt && toDateStr(new Date(t.completedAt)) < today
    );
    for (const t of toArchive) {
      t.archived = true;
      t.archivedAt = Date.now();
      await DB.put("tasks", t);
    }
    if (toArchive.length) state.tasks = state.tasks.filter(t => !t.archived);
    await DB.metaSet("lastCleanup", today);
    void last;
  }

  /* ---------- Abgeleitete Werte ---------- */
  function progress(task) {
    const subs = task.subtasks || [];
    if (!subs.length) return task.done ? 100 : 0;
    return Math.round(subs.filter(s => s.done).length / subs.length * 100);
  }
  function isOverdue(task) {
    return !task.done && task.due && task.due < todayStr();
  }
  function isDueToday(task) {
    return task.due === todayStr();
  }
  /* Mein Tag = manuell hinzugefügt ODER heute fällig ODER überfällig */
  function inMyDay(task) {
    return task.myDay || isDueToday(task) || isOverdue(task);
  }

  /* ---------- Queries ---------- */
  const areaById = (id) => state.areas.find(a => a.id === id);
  function tasksForArea(areaId) {
    return state.tasks.filter(t => t.areaId === areaId)
      .sort(sortTasks);
  }
  function myDayTasks() {
    return state.tasks.filter(inMyDay).sort(sortTasks);
  }
  function allOpenTasks() {
    return [...state.tasks].sort(sortTasks);
  }
  function tasksOnDate(dateStr) {
    return state.tasks.filter(t => t.due === dateStr).sort(sortTasks);
  }
  function search(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    return state.tasks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      (t.notes || "").toLowerCase().includes(q) ||
      (t.tags || []).some(tg => tg.toLowerCase().includes(q)) ||
      (t.subtasks || []).some(s => s.title.toLowerCase().includes(q))
    ).sort(sortTasks);
  }
  /* Sortierung: offen vor erledigt, dann manuelle Reihenfolge (Drag&Drop).
     Priorität wird als Badge angezeigt, bestimmt aber nicht mehr die Reihenfolge. */
  function sortTasks(a, b) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return (a.order || 0) - (b.order || 0);
  }

  /* ---------- Mutationen: Bereiche ---------- */
  async function addArea(data) {
    const area = {
      id: uid(), name: data.name || "Neuer Bereich",
      emoji: data.emoji || "🗂️", color: data.color || MAKI_COLORS[0],
      order: state.areas.length, createdAt: Date.now()
    };
    await DB.put("areas", area);
    state.areas.push(area);
    return area;
  }
  async function updateArea(id, patch) {
    const a = areaById(id);
    if (!a) return;
    Object.assign(a, patch);
    await DB.put("areas", a);
    return a;
  }
  async function deleteArea(id) {
    // zugehörige Tasks ebenfalls entfernen (inkl. archivierte + Anhänge)
    const all = await DB.getAll("tasks");
    for (const t of all.filter(t => t.areaId === id)) {
      const atts = await DB.getByIndex("attachments", "taskId", t.id);
      for (const at of atts) await DB.del("attachments", at.id);
      await DB.del("tasks", t.id);
    }
    await DB.del("areas", id);
    state.areas = state.areas.filter(a => a.id !== id);
    state.tasks = state.tasks.filter(t => t.areaId !== id);
  }

  /* ---------- Mutationen: Tasks ---------- */
  async function addTask(data) {
    const task = {
      id: uid(),
      areaId: data.areaId || (state.areas[0] && state.areas[0].id) || null,
      title: (data.title || "").trim() || "Unbenannte Aufgabe",
      notes: data.notes || "",
      due: data.due || null,
      priority: data.priority || 0,        // 0 = keine, 1–5
      emoji: data.emoji || "📝",
      color: data.color || MAKI_COLORS[0],
      myDay: !!data.myDay,
      myDayDate: data.myDay ? todayStr() : null,
      repeat: data.repeat || null,          // {type, interval}
      tags: data.tags || [],
      subtasks: data.subtasks || [],
      done: false,
      completedAt: null,
      archived: false,
      archivedAt: null,
      order: state.tasks.length,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await DB.put("tasks", task);
    state.tasks.push(task);
    return task;
  }
  async function updateTask(id, patch) {
    const t = state.tasks.find(t => t.id === id);
    if (!t) return;
    Object.assign(t, patch, { updatedAt: Date.now() });
    if (patch.myDay === true && !t.myDayDate) t.myDayDate = todayStr();
    await DB.put("tasks", t);
    return t;
  }
  async function toggleTask(id, done) {
    const t = state.tasks.find(t => t.id === id);
    if (!t) return;
    t.done = done;
    t.completedAt = done ? Date.now() : null;
    // alle Unteraufgaben mit-abhaken
    if (done && t.subtasks) t.subtasks.forEach(s => s.done = true);
    await DB.put("tasks", t);

    // Wiederholung: bei Erledigung nächste Instanz erzeugen
    if (done && t.repeat && t.due) {
      await addTask({
        areaId: t.areaId, title: t.title, notes: t.notes,
        due: addToDate(t.due, t.repeat), priority: t.priority,
        emoji: t.emoji, color: t.color, repeat: t.repeat,
        subtasks: (t.subtasks || []).map(s => ({ id: uid(), title: s.title, done: false })),
        myDay: false
      });
    }
    return t;
  }
  async function toggleSubtask(taskId, subId, done) {
    const t = state.tasks.find(t => t.id === taskId);
    if (!t) return;
    const s = (t.subtasks || []).find(s => s.id === subId);
    if (!s) return;
    s.done = done;
    // Haupt-Task-Status aus Unteraufgaben ableiten
    const all = t.subtasks.length && t.subtasks.every(x => x.done);
    t.done = all;
    t.completedAt = all ? Date.now() : null;
    await DB.put("tasks", t);
    return t;
  }
  async function deleteTask(id) {
    const atts = await DB.getByIndex("attachments", "taskId", id);
    for (const at of atts) await DB.del("attachments", at.id);
    await DB.del("tasks", id);
    state.tasks = state.tasks.filter(t => t.id !== id);
  }
  // Reihenfolge per Drag&Drop: ids in neuer Reihenfolge → order = Index
  async function reorderTasks(orderedIds) {
    for (let i = 0; i < orderedIds.length; i++) {
      const t = state.tasks.find(t => t.id === orderedIds[i]);
      if (t && t.order !== i) { t.order = i; await DB.put("tasks", t); }
    }
  }

  /* ---------- Anhänge ---------- */
  async function addAttachment(taskId, file) {
    const att = { id: uid(), taskId, name: file.name, type: file.type, blob: file };
    await DB.put("attachments", att);
    return att;
  }
  const getAttachments = (taskId) => DB.getByIndex("attachments", "taskId", taskId);
  const deleteAttachment = (id) => DB.del("attachments", id);

  /* ---------- Archiv ---------- */
  async function archivedTasks() {
    const all = await DB.getAll("tasks");
    return all.filter(t => t.archived).sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
  }
  async function restoreTask(id) {
    const t = await DB.get("tasks", id);
    if (!t) return;
    t.archived = false; t.archivedAt = null; t.done = false; t.completedAt = null;
    await DB.put("tasks", t);
    state.tasks.push(t);
  }

  /* ---------- Backup: Export / Import ---------- */
  function blobToDataURL(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
  }
  async function dataURLToBlob(url) {
    return (await fetch(url)).blob();
  }

  async function exportData() {
    const areas = await DB.getAll("areas");
    const tasks = await DB.getAll("tasks");        // inkl. archivierte
    const goals = await DB.getAll("goals");
    const places = await DB.getAll("places");
    const expenses = await DB.getAll("expenses");
    const budgetCategories = (await DB.metaGet("budget-categories")) || null;
    const attsRaw = await DB.getAll("attachments");
    const attachments = [];
    for (const a of attsRaw) {
      attachments.push({
        id: a.id, taskId: a.taskId, name: a.name, type: a.type,
        data: await blobToDataURL(a.blob)
      });
    }
    const mediaRaw = await DB.getAll("media");
    const media = [];
    for (const m of mediaRaw) media.push({ id: m.id, data: await blobToDataURL(m.blob) });
    return {
      app: "todo-maki", version: 2, exportedAt: new Date().toISOString(),
      areas, tasks, goals, places, expenses, budgetCategories, attachments, media
    };
  }

  // mode: "replace" (alles ersetzen) | "merge" (nur Neues per id ergänzen)
  async function importData(data, mode = "replace") {
    if (!data || data.app !== "todo-maki" || !Array.isArray(data.areas))
      throw new Error("Ungültige Backup-Datei.");
    if (mode === "replace") {
      for (const s of ["areas", "tasks", "attachments", "goals", "places", "expenses", "media"]) await DB.clear(s);
    }
    const existIds = mode === "merge"
      ? new Set([...(await DB.getAll("areas")), ...(await DB.getAll("tasks"))].map(x => x.id))
      : new Set();
    for (const a of data.areas) if (!(mode === "merge" && existIds.has(a.id))) await DB.put("areas", a);
    for (const t of data.tasks) if (!(mode === "merge" && existIds.has(t.id))) await DB.put("tasks", t);
    for (const g of (data.goals || [])) await DB.put("goals", g);
    for (const p of (data.places || [])) await DB.put("places", p);
    for (const ex of (data.expenses || [])) await DB.put("expenses", ex);
    if (data.budgetCategories) await DB.metaSet("budget-categories", data.budgetCategories);
    for (const at of (data.attachments || [])) {
      const blob = await dataURLToBlob(at.data);
      await DB.put("attachments", { id: at.id, taskId: at.taskId, name: at.name, type: at.type, blob });
    }
    for (const m of (data.media || [])) {
      const blob = await dataURLToBlob(m.data);
      await DB.put("media", { id: m.id, blob });
    }
    // State neu laden
    state.areas = (await DB.getAll("areas")).sort((a, b) => a.order - b.order);
    state.tasks = (await DB.getAll("tasks")).filter(t => !t.archived);
    state.goals = (await DB.getAll("goals")).sort((a, b) => (a.order || 0) - (b.order || 0));
    state.places = (await DB.getAll("places")).sort((a, b) => (a.order || 0) - (b.order || 0));
    state.budgetCategories = (await DB.metaGet("budget-categories")) || state.budgetCategories;
    return { areas: data.areas.length, tasks: data.tasks.length, attachments: (data.attachments || []).length };
  }

  /* ---------- Media (Bilder für Goals/Places) ---------- */
  async function addMedia(file) {
    const id = uid();
    await DB.put("media", { id, blob: file });
    return id;
  }
  const getMedia = (id) => DB.get("media", id);
  const delMedia = (id) => id && DB.del("media", id);

  /* ---------- Ziele (Bucketlist) ---------- */
  async function addGoal(data = {}) {
    const goal = {
      id: uid(), title: (data.title || "").trim() || "Neues Ziel",
      notes: data.notes || "", category: data.category || "",
      targetYear: data.targetYear || null, mediaId: data.mediaId || null, imageUrl: data.imageUrl || "",
      steps: data.steps || [], achieved: false, achievedAt: null,
      order: state.goals.length, createdAt: Date.now()
    };
    await DB.put("goals", goal); state.goals.push(goal); return goal;
  }
  async function updateGoal(id, patch) {
    const g = state.goals.find(g => g.id === id); if (!g) return;
    Object.assign(g, patch);
    if (patch.achieved === true && !g.achievedAt) g.achievedAt = Date.now();
    if (patch.achieved === false) g.achievedAt = null;
    await DB.put("goals", g); return g;
  }
  async function deleteGoal(id) {
    const g = state.goals.find(g => g.id === id);
    if (g && g.mediaId) await delMedia(g.mediaId);
    await DB.del("goals", id);
    state.goals = state.goals.filter(g => g.id !== id);
  }
  function goalProgress(g) {
    if (g.achieved) return 100;
    const s = g.steps || []; if (!s.length) return 0;
    return Math.round(s.filter(x => x.done).length / s.length * 100);
  }

  /* ---------- Orte ---------- */
  async function addPlace(data = {}) {
    const place = {
      id: uid(), name: (data.name || "").trim() || "Neuer Ort",
      type: data.type || "reise", notes: data.notes || "",
      website: data.website || "", phone: data.phone || "",
      address: data.address || "", mapsUrl: data.mapsUrl || "",
      rating: data.rating || 0, price: data.price || 0,
      status: data.status || "want", visitedAt: data.visitedAt || null,
      mediaId: data.mediaId || null, imageUrl: data.imageUrl || "", tags: data.tags || [],
      lat: data.lat ?? null, lng: data.lng ?? null,
      order: state.places.length, createdAt: Date.now()
    };
    await DB.put("places", place); state.places.push(place); return place;
  }
  async function updatePlace(id, patch) {
    const p = state.places.find(p => p.id === id); if (!p) return;
    Object.assign(p, patch);
    await DB.put("places", p); return p;
  }
  async function deletePlace(id) {
    const p = state.places.find(p => p.id === id);
    if (p && p.mediaId) await delMedia(p.mediaId);
    await DB.del("places", id);
    state.places = state.places.filter(p => p.id !== id);
  }

  /* ---------- Budget ---------- */
  async function addExpense(data = {}) {
    const e = {
      id: uid(), amount: +data.amount || 0, category: data.category || "sonstiges",
      subcategory: data.subcategory || "",
      note: data.note || "", date: data.date || todayStr(), createdAt: Date.now()
    };
    await DB.put("expenses", e); return e;
  }
  async function updateExpense(id, patch) {
    const e = await DB.get("expenses", id); if (!e) return;
    Object.assign(e, patch); await DB.put("expenses", e); return e;
  }
  const deleteExpense = (id) => DB.del("expenses", id);
  async function expensesForMonth(ym) { // ym = "YYYY-MM"
    const all = await DB.getAll("expenses");
    return all.filter(e => (e.date || "").startsWith(ym)).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }
  const categoryById = (id) => state.budgetCategories.find(c => c.id === id);
  async function setBudgetCategories(cats) {
    state.budgetCategories = cats;
    await DB.metaSet("budget-categories", cats);
  }

  return {
    state, init, reload,
    uid, todayStr, toDateStr, addToDate,
    exportData, importData,
    progress, isOverdue, isDueToday, inMyDay,
    areaById, tasksForArea, myDayTasks, allOpenTasks, tasksOnDate, search,
    addArea, updateArea, deleteArea,
    addTask, updateTask, toggleTask, toggleSubtask, deleteTask, reorderTasks,
    addAttachment, getAttachments, deleteAttachment,
    archivedTasks, restoreTask,
    addMedia, getMedia, delMedia,
    addGoal, updateGoal, deleteGoal, goalProgress,
    addPlace, updatePlace, deletePlace,
    addExpense, updateExpense, deleteExpense, expensesForMonth, categoryById, setBudgetCategories
  };
})();

window.Store = Store;
