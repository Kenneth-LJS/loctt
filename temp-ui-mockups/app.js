// TaskTracker mockup — shared interactivity + mock data store
// Exposes window.TT (helpers) and window.TT.store (mock data + CRUD).
(function () {
  const STORAGE = {
    theme: "tt-theme",
    sidebar: "tt-sidebar-collapsed",
    mock: "tt-mock:v1",
  };

  // --- Theme ---------------------------------------------------------------
  const root = document.documentElement;

  function applyTheme(theme) {
    root.classList.toggle("dark", theme === "dark");
    document.querySelectorAll(".theme-toggle button").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.theme === theme);
    });
  }

  function setTheme(theme) {
    localStorage.setItem(STORAGE.theme, theme);
    applyTheme(theme);
  }

  function getTheme() {
    const v = localStorage.getItem(STORAGE.theme);
    return v === "dark" ? "dark" : "light";
  }

  function toggleTheme() {
    setTheme(getTheme() === "dark" ? "light" : "dark");
  }

  // --- Sidebar -------------------------------------------------------------
  function initSidebar() {
    const sidebar = document.querySelector(".sidebar");
    const btn = document.querySelector("[data-action='collapse-sidebar']");
    if (!sidebar) return;
    if (localStorage.getItem(STORAGE.sidebar) === "1") sidebar.classList.add("is-collapsed");
    if (btn) {
      btn.addEventListener("click", () => {
        sidebar.classList.toggle("is-collapsed");
        localStorage.setItem(STORAGE.sidebar, sidebar.classList.contains("is-collapsed") ? "1" : "0");
      });
    }
  }

  // --- Popover / menu dismissal -------------------------------------------
  function positionNear(trigger, target) {
    const r = trigger.getBoundingClientRect();
    target.style.top = window.scrollY + r.bottom + 4 + "px";
    target.style.left = window.scrollX + r.left + "px";
  }

  function closeAllFloating() {
    document.querySelectorAll(".popover.is-open, .menu.is-open").forEach((el) => el.classList.remove("is-open"));
  }

  function initFloating() {
    document.addEventListener("click", (e) => {
      const trigger =
        e.target.closest("[data-popover-trigger]") || e.target.closest("[data-menu-trigger]");
      if (trigger) {
        const id = trigger.dataset.popoverTrigger || trigger.dataset.menuTrigger;
        const target = document.getElementById(id);
        if (!target) return;
        const wasOpen = target.classList.contains("is-open");
        closeAllFloating();
        if (!wasOpen) {
          positionNear(trigger, target);
          target.classList.add("is-open");
          target._trigger = trigger;
        }
        e.stopPropagation();
        return;
      }
      const menuItem = e.target.closest(".menu__item");
      if (menuItem) {
        const menu = menuItem.closest(".menu");
        if (menu) menu.classList.remove("is-open");
        return;
      }
      if (e.target.closest(".popover")) return;
      closeAllFloating();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAllFloating();
    });

    window.addEventListener("scroll", closeAllFloating, true);
    window.addEventListener("resize", closeAllFloating);
  }

  // --- Mock store ----------------------------------------------------------
  // Single localStorage blob: tt-mock:v1 → JSON of the whole world.
  // CRUD helpers fire a `tt:change` CustomEvent on document so pages can
  // re-render without coupling.

  function ulid() {
    // Tiny non-cryptographic ULID-ish: timestamp-base36 + random tail.
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10).toUpperCase();
  }

  function todayISO() {
    return new Date().toISOString();
  }

  function todayYMD(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  // Default workflow + sample data, mirrors §1.5 of TEMP-UI-DISCREPANCIES.md
  function buildSampleData() {
    const userKen = "u_ken";
    const userSara = "u_sara";
    const userJess = "u_jess";
    const userMira = "u_mira";

    return {
      _meta: { version: 1, created_at: todayISO() },
      current_user: userKen,
      workflow: {
        statuses: [
          { key: "backlog",     label: "Backlog",     category: "pending",   icon: "archive",       color: "#94a3b8" },
          { key: "in_progress", label: "In progress", category: "active",    icon: "circle-dashed", color: "#3b82f6" },
          { key: "done",        label: "Done",        category: "completed", icon: "check-circle",  color: "#10b981" },
          { key: "wont_do",     label: "Won't do",    category: "discarded", icon: "x-circle",      color: "#64748b" },
        ],
        priorities: [
          { key: "critical", label: "Critical", icon: "chevrons-up",  color: "#ef4444", value: 4 },
          { key: "high",     label: "High",     icon: "chevron-up",   color: "#f97316", value: 3 },
          { key: "medium",   label: "Medium",   icon: "equal",        color: "#3b82f6", value: 2 },
          { key: "low",      label: "Low",      icon: "chevron-down", color: "#94a3b8", value: 1 },
        ],
        task_types: [
          { key: "story",   label: "Story",   icon: "bookmark",   color: "#8b5cf6" },
          { key: "bug",     label: "Bug",     icon: "bug",        color: "#ef4444" },
          { key: "task",    label: "Task",    icon: "circle-dot", color: "#64748b" },
          { key: "spike",   label: "Spike",   icon: "zap",        color: "#f59e0b" },
          { key: "feature", label: "Feature", icon: "sparkles",   color: "#a855f7" },
        ],
        relationships: [
          { key: "blocks",     label: "Blocks",     inverse: "is_blocked_by",    inverse_label: "Is blocked by",    structural: true, ranked: true },
          { key: "parent",     label: "Parent",     inverse: "child",            inverse_label: "Child",            structural: true, ranked: true },
          { key: "clones",     label: "Clones",     inverse: "is_cloned_by",     inverse_label: "Is cloned by" },
          { key: "duplicates", label: "Duplicates", inverse: "is_duplicated_by", inverse_label: "Is duplicated by" },
          { key: "causes",     label: "Causes",     inverse: "is_caused_by",     inverse_label: "Is caused by" },
          { key: "relates_to", label: "Relates to", kind: "symmetric" },
        ],
        custom_fields: [
          { key: "impact", label: "Customer impact", type: "enum",   multi: false, searchable: true,  values: [
              { key: "none",     label: "None",     color: "#94a3b8" },
              { key: "low",      label: "Low",      color: "#3b82f6" },
              { key: "medium",   label: "Medium",   color: "#f59e0b" },
              { key: "high",     label: "High",     color: "#f97316" },
              { key: "critical", label: "Critical", color: "#ef4444" },
            ]
          },
          { key: "risk",   label: "Risk score",      type: "number", multi: false, searchable: false },
        ],
        estimation: { enabled: true, unit: "points", unit_label: "pts", scale: "free" },
        boards: { columns: [] },
        timeline: {
          dependency_relationship: "blocks",
          default_zoom: "week",
          show_arrows: true,
          default_grouping: "sprint",
        },
      },
      projects: [
        { key: "web",     label: "Web",     prefix: "WEB-",     next_number: 129, archived: false, default: true },
        { key: "backend", label: "Backend", prefix: "BACKEND-", next_number: 127, archived: false },
        { key: "infra",   label: "Infra",   prefix: "INF-",     next_number: 12,  archived: false },
      ],
      users: [
        { id: userKen,  name: "Ken Loh",      email: "ken@example.com",  timezone: "Asia/Singapore",  archived: false, settings: { theme: "light", default_view: "list" } },
        { id: userSara, name: "Sara Marquez", email: "sara@example.com", timezone: "Europe/Madrid",   archived: false, settings: {} },
        { id: userJess, name: "Jess Park",    email: "jess@example.com", timezone: "America/New_York", archived: false, settings: {} },
        { id: userMira, name: "Mira Rao",     email: "mira@example.com", timezone: "Asia/Kolkata",    archived: false, settings: {} },
      ],
      labels: [
        { key: "frontend", label: "frontend", color: "#3b82f6", archived: false },
        { key: "backend",  label: "backend",  color: "#10b981", archived: false },
        { key: "infra",    label: "infra",    color: "#78716c", icon: "database", archived: false },
        { key: "design",   label: "design",   color: "#ec4899", archived: false },
        { key: "testing",  label: "testing",  color: "#f59e0b", archived: false },
        { key: "research", label: "research", color: "#a855f7", icon: "lightbulb", archived: false },
      ],
      milestones: [
        { key: "v1",        label: "v1 GA",       target_date: todayYMD(45), archived: false },
        { key: "v1-polish", label: "v1.1 polish", target_date: todayYMD(90), archived: false },
      ],
      sprints: [
        { key: "S-11", label: "S-11", start_date: todayYMD(-30), end_date: todayYMD(-17), state: "completed", goal: "Timeline MVP",   archived: false },
        { key: "S-12", label: "S-12", start_date: todayYMD(-3),  end_date: todayYMD(11),  state: "active",    goal: "Ship login flow", archived: false },
        { key: "S-13", label: "S-13", start_date: todayYMD(12),  end_date: todayYMD(25),  state: "future",    goal: "Settings polish", archived: false },
      ],
      tasks: buildSampleTasks(userKen, userSara, userJess),
      views: [
        { id: "v_in_progress", name: "In progress",         query: "status = in_progress", sort: [{ field: "priority", direction: "desc" }] },
        { id: "v_stale",       name: "Stale (no update > 14d)", query: "updated_at < today and status != done", sort: [{ field: "updated_at", direction: "asc" }] },
        { id: "v_hipri_bugs",  name: "High-prio bugs",      query: "task_type = bug and priority in (high, critical)", sort: [{ field: "created_at", direction: "desc" }] },
      ],
      calendar: {
        timezone: "Asia/Singapore",
        first_day_of_week: 1,
        working_days: [1, 2, 3, 4, 5],
        holidays: [
          { date: "2026-01-01", label: "New Year's Day" },
          { date: "2026-05-01", label: "Labor Day" },
          { date: "2026-12-25", label: "Christmas" },
        ],
      },
      list_view: {
        filters: { visible: ["status", "priority", "assignee", "labels", "milestone", "impact"], hidden: [] },
      },
      git: {
        enabled: true,
        branch: "loctt",
        remote: "origin",
        auto_push: true,
        auto_fetch: true,
        last_synced_commit: "ae88455",
        last_synced_at: todayISO(),
      },
      activity: [],
    };
  }

  function buildSampleTasks(uKen, uSara, uJess) {
    const now = todayISO();
    function mk(opts) {
      return Object.assign({
        id: ulid(),
        created_at: now,
        updated_at: now,
        archived: false,
        labels: [],
        relationships: [],
        body: "",
        fields: {},
        attachments: [],
        history: [],
      }, opts);
    }
    return [
      mk({ key: "WEB-128", project: "web",     title: "Implement Gantt edge-drag handles", status: "in_progress", priority: "high",     task_type: "feature", assignee: uKen,  reporter: uKen,  labels: ["frontend", "design"],  due_date: todayYMD(7),  start_date: todayYMD(-3), milestone: "v1",  sprint: "S-12", estimate: "3", board_rank: "a", body: "Drag the edges of bars to resize.\n\n- Edge zone: 6px on either side\n- Snap to day grid\n- Tooltip with new date" }),
      mk({ key: "WEB-127", project: "web",     title: "Audit dependency arrows on month zoom", status: "in_progress", priority: "medium", task_type: "bug",     assignee: uSara, reporter: uKen,  labels: ["frontend"], due_date: todayYMD(3), milestone: "v1", sprint: "S-12", estimate: "2", board_rank: "b" }),
      mk({ key: "WEB-126", project: "web",     title: "Detect edge-zone hover on bars",        status: "backlog",     priority: "medium", task_type: "task",    reporter: uKen,  labels: ["frontend"], milestone: "v1", sprint: "S-12", estimate: "1", board_rank: "c" }),
      mk({ key: "WEB-125", project: "web",     title: "Keyboard shortcuts overlay",            status: "backlog",     priority: "low",    task_type: "feature", reporter: uSara, labels: ["frontend"], sprint: "S-13", estimate: "2", board_rank: "d" }),
      mk({ key: "WEB-115", project: "web",     title: "Sidebar collapse animation jank",       status: "backlog",     priority: "low",    task_type: "bug",     reporter: uKen,  labels: ["frontend"], board_rank: "e" }),
      mk({ key: "WEB-101", project: "web",     title: "Theme tokens audit",                     status: "done",        priority: "low",    task_type: "task",    assignee: uKen,  reporter: uKen,  labels: ["frontend", "design"], board_rank: "f", completed_date: todayYMD(-5) }),
      mk({ key: "BACKEND-126", project: "backend", title: "Cycle-detect on inverse relationship key", status: "in_progress", priority: "critical", task_type: "bug", assignee: uJess, reporter: uKen, labels: ["backend"], due_date: todayYMD(1), milestone: "v1", sprint: "S-12", estimate: "5", board_rank: "g" }),
      mk({ key: "BACKEND-125", project: "backend", title: "Atomic schema sentinel write",          status: "done",        priority: "high",   task_type: "task",    assignee: uJess, reporter: uKen, labels: ["backend"], milestone: "v1", sprint: "S-11", estimate: "3", board_rank: "h", completed_date: todayYMD(-12) }),
      mk({ key: "BACKEND-9", project: "backend", title: "Bulk operations core helpers",          status: "backlog",     priority: "high",   task_type: "feature", reporter: uKen, labels: ["backend"], sprint: "S-13", estimate: "8", board_rank: "i" }),
      mk({ key: "INF-12",   project: "infra",   title: "Wire test workspace sweep",             status: "wont_do",     priority: "low",    task_type: "task",    reporter: uKen,  labels: ["infra"], board_rank: "j" }),
    ];
  }

  let _data = null;

  function load() {
    if (_data) return _data;
    try {
      const raw = localStorage.getItem(STORAGE.mock);
      if (raw) { _data = JSON.parse(raw); return _data; }
    } catch (_e) { /* fall through */ }
    _data = buildSampleData();
    save();
    return _data;
  }

  function save() {
    if (!_data) return;
    localStorage.setItem(STORAGE.mock, JSON.stringify(_data));
    document.dispatchEvent(new CustomEvent("tt:change", { detail: { reason: "save" } }));
  }

  function reset(toSample) {
    if (toSample === false) {
      _data = null;
      localStorage.removeItem(STORAGE.mock);
    } else {
      _data = buildSampleData();
      save();
    }
    document.dispatchEvent(new CustomEvent("tt:change", { detail: { reason: "reset" } }));
  }

  // CRUD helpers ----------------------------------------------------------
  // Most mutators just edit _data in place then save(). Pages re-render on
  // tt:change.

  const store = {
    get data() { return load(); },

    // tasks
    listTasks(opts = {}) {
      const all = load().tasks.slice();
      const filtered = opts.includeArchived ? all : all.filter(t => !t.archived);
      return filtered;
    },
    getTask(idOrKey) {
      const d = load();
      return d.tasks.find(t => t.id === idOrKey || t.key === idOrKey);
    },
    createTask(input) {
      const d = load();
      const proj = d.projects.find(p => p.key === input.project) || d.projects[0];
      const key = proj.prefix + proj.next_number;
      proj.next_number += 1;
      const task = {
        id: ulid(),
        key,
        project: proj.key,
        title: input.title || "(untitled)",
        status: input.status || d.workflow.statuses[0].key,
        priority: input.priority || null,
        task_type: input.task_type || d.workflow.task_types[0].key,
        labels: input.labels || [],
        assignee: input.assignee || null,
        reporter: input.reporter || d.current_user,
        start_date: input.start_date || null,
        due_date: input.due_date || null,
        estimate: input.estimate || null,
        milestone: input.milestone || null,
        sprint: input.sprint || null,
        archived: false,
        relationships: [],
        fields: input.fields || {},
        body: input.body || "",
        attachments: [],
        history: [{ id: ulid(), kind: "created", at: todayISO(), actor: d.current_user }],
        created_at: todayISO(),
        updated_at: todayISO(),
        board_rank: ulid().slice(-6),
      };
      d.tasks.push(task);
      save();
      return task;
    },
    updateTask(idOrKey, changes) {
      const t = store.getTask(idOrKey);
      if (!t) return null;
      const d = load();
      const before = {};
      for (const k of Object.keys(changes)) before[k] = t[k];
      Object.assign(t, changes);
      t.updated_at = todayISO();
      // Auto-stamp on status change
      if (changes.status) {
        t.status_updated_at = todayISO();
        const cat = (d.workflow.statuses.find(s => s.key === changes.status) || {}).category;
        if (cat === "completed" && !t.completed_date) t.completed_date = todayYMD();
        if (cat !== "completed") t.completed_date = null;
      }
      for (const k of Object.keys(changes)) {
        t.history.push({ id: ulid(), kind: "field_change", at: todayISO(), actor: d.current_user, field: k, before: before[k], after: changes[k] });
      }
      save();
      return t;
    },
    deleteTask(idOrKey) {
      const d = load();
      const i = d.tasks.findIndex(t => t.id === idOrKey || t.key === idOrKey);
      if (i < 0) return false;
      d.tasks.splice(i, 1);
      save();
      return true;
    },
    archiveTask(idOrKey) { return store.updateTask(idOrKey, { archived: true }); },
    unarchiveTask(idOrKey) { return store.updateTask(idOrKey, { archived: false }); },
    duplicateTask(idOrKey) {
      const src = store.getTask(idOrKey);
      if (!src) return null;
      const copy = store.createTask({
        project: src.project,
        title: src.title + " (copy)",
        status: src.status,
        priority: src.priority,
        task_type: src.task_type,
        labels: src.labels.slice(),
        assignee: src.assignee,
        reporter: src.reporter,
        start_date: src.start_date,
        due_date: src.due_date,
        estimate: src.estimate,
        milestone: src.milestone,
        sprint: src.sprint,
        fields: Object.assign({}, src.fields),
        body: src.body,
      });
      return copy;
    },
    linkTasks(srcId, type, targetId) {
      const src = store.getTask(srcId);
      const tgt = store.getTask(targetId);
      if (!src || !tgt) return false;
      src.relationships.push({ type, target: tgt.id });
      src.updated_at = todayISO();
      save();
      return true;
    },
    unlinkTasks(srcId, type, targetId) {
      const src = store.getTask(srcId);
      const tgt = store.getTask(targetId);
      if (!src || !tgt) return false;
      src.relationships = src.relationships.filter(r => !(r.type === type && r.target === tgt.id));
      src.updated_at = todayISO();
      save();
      return true;
    },

    // bulk
    bulkUpdate(ids, changes) {
      const d = load();
      const opId = ulid();
      ids.forEach(id => {
        const t = store.getTask(id);
        if (!t) return;
        Object.assign(t, changes);
        t.updated_at = todayISO();
        t.history.push({ id: ulid(), kind: "field_change", at: todayISO(), actor: d.current_user, bulk_op_id: opId, ...changes });
      });
      save();
    },
    bulkArchive(ids)   { store.bulkUpdate(ids, { archived: true }); },
    bulkUnarchive(ids) { store.bulkUpdate(ids, { archived: false }); },
    bulkDelete(ids)    { const d = load(); d.tasks = d.tasks.filter(t => !ids.includes(t.id) && !ids.includes(t.key)); save(); },

    // projects
    listProjects(includeArchived) { return load().projects.filter(p => includeArchived || !p.archived); },
    getProject(key) { return load().projects.find(p => p.key === key); },
    createProject(def) { load().projects.push({ ...def, next_number: 1, archived: false }); save(); },
    updateProject(key, changes) {
      const p = store.getProject(key); if (!p) return;
      // label only (key + prefix immutable)
      if (changes.label !== undefined) p.label = changes.label;
      if (changes.archived !== undefined) p.archived = changes.archived;
      save();
    },
    setDefaultProject(key) {
      const d = load();
      d.projects.forEach(p => { p.default = p.key === key; });
      save();
    },
    deleteProject(key, remapTo) {
      const d = load();
      if (remapTo) d.tasks.forEach(t => { if (t.project === key) t.project = remapTo; });
      d.projects = d.projects.filter(p => p.key !== key);
      save();
    },

    // users
    listUsers(includeArchived) { return load().users.filter(u => includeArchived || !u.archived); },
    getUser(id) { return load().users.find(u => u.id === id); },
    currentUser() { return store.getUser(load().current_user); },
    switchUser(id) { load().current_user = id; save(); },
    createUser(def) {
      const u = { id: ulid(), archived: false, settings: {}, ...def };
      load().users.push(u);
      save();
      return u;
    },
    updateUser(id, changes) { const u = store.getUser(id); if (u) Object.assign(u, changes); save(); },
    archiveUser(id) { store.updateUser(id, { archived: true }); },
    unarchiveUser(id) { store.updateUser(id, { archived: false }); },
    deleteUser(id, options) {
      const d = load();
      if (d.current_user === id) return false;
      if (options && options.remapTo) {
        d.tasks.forEach(t => {
          if (t.assignee === id) t.assignee = options.remapTo;
          if (t.reporter === id) t.reporter = options.remapTo;
        });
      } else if (options && options.unassign) {
        d.tasks.forEach(t => {
          if (t.assignee === id) t.assignee = null;
          if (t.reporter === id) t.reporter = null;
        });
      }
      d.users = d.users.filter(u => u.id !== id);
      save();
      return true;
    },

    // labels
    listLabels(includeArchived) { return load().labels.filter(l => includeArchived || !l.archived); },
    getLabel(key) { return load().labels.find(l => l.key === key); },
    createLabel(def) { load().labels.push({ archived: false, ...def }); save(); },
    updateLabel(key, changes) { const l = store.getLabel(key); if (l) Object.assign(l, changes); save(); },
    deleteLabel(key, remapTo) {
      const d = load();
      d.tasks.forEach(t => {
        if (t.labels.includes(key)) {
          t.labels = t.labels.filter(x => x !== key);
          if (remapTo && !t.labels.includes(remapTo)) t.labels.push(remapTo);
        }
      });
      d.labels = d.labels.filter(l => l.key !== key);
      save();
    },
    reorderLabel(key, beforeKey) {
      const d = load();
      const i = d.labels.findIndex(l => l.key === key);
      if (i < 0) return;
      const [item] = d.labels.splice(i, 1);
      if (beforeKey) {
        const j = d.labels.findIndex(l => l.key === beforeKey);
        d.labels.splice(j < 0 ? d.labels.length : j, 0, item);
      } else {
        d.labels.push(item);
      }
      save();
    },

    // milestones
    listMilestones(includeArchived) { return load().milestones.filter(m => includeArchived || !m.archived); },
    createMilestone(def) { load().milestones.push({ archived: false, ...def }); save(); },
    updateMilestone(key, changes) { const m = load().milestones.find(x => x.key === key); if (m) Object.assign(m, changes); save(); },
    deleteMilestone(key, remapTo) {
      const d = load();
      d.tasks.forEach(t => { if (t.milestone === key) t.milestone = remapTo || null; });
      d.milestones = d.milestones.filter(m => m.key !== key);
      save();
    },

    // sprints
    listSprints(includeArchived) { return load().sprints.filter(s => includeArchived || !s.archived); },
    createSprint(def) { load().sprints.push({ archived: false, ...def }); save(); },
    updateSprint(key, changes) { const s = load().sprints.find(x => x.key === key); if (s) Object.assign(s, changes); save(); },
    deleteSprint(key, remapTo) {
      const d = load();
      d.tasks.forEach(t => { if (t.sprint === key) t.sprint = remapTo || null; });
      d.sprints = d.sprints.filter(s => s.key !== key);
      save();
    },

    // workflow (statuses / priorities / types / relationships / custom fields)
    workflow() { return load().workflow; },
    updateWorkflow(changes) { Object.assign(load().workflow, changes); save(); },
    upsertStatus(def, oldKey) {
      const w = load().workflow;
      const i = oldKey ? w.statuses.findIndex(s => s.key === oldKey) : -1;
      if (i >= 0) w.statuses.splice(i, 1, { ...w.statuses[i], ...def });
      else w.statuses.push(def);
      save();
    },
    deleteStatus(key) { load().workflow.statuses = load().workflow.statuses.filter(s => s.key !== key); save(); },
    reorderStatuses(keys) {
      const w = load().workflow;
      const map = Object.fromEntries(w.statuses.map(s => [s.key, s]));
      w.statuses = keys.map(k => map[k]).filter(Boolean);
      save();
    },
    upsertPriority(def, oldKey) {
      const w = load().workflow;
      const i = oldKey ? w.priorities.findIndex(p => p.key === oldKey) : -1;
      if (i >= 0) w.priorities.splice(i, 1, { ...w.priorities[i], ...def });
      else w.priorities.push(def);
      save();
    },
    deletePriority(key) { load().workflow.priorities = load().workflow.priorities.filter(p => p.key !== key); save(); },
    reorderPriorities(keys) {
      const w = load().workflow;
      const map = Object.fromEntries(w.priorities.map(p => [p.key, p]));
      w.priorities = keys.map(k => map[k]).filter(Boolean);
      // Recompute values: top = highest = w.priorities.length, bottom = 1
      w.priorities.forEach((p, idx) => { p.value = w.priorities.length - idx; });
      save();
    },
    upsertTaskType(def, oldKey) {
      const w = load().workflow;
      const i = oldKey ? w.task_types.findIndex(t => t.key === oldKey) : -1;
      if (i >= 0) w.task_types.splice(i, 1, { ...w.task_types[i], ...def });
      else w.task_types.push(def);
      save();
    },
    deleteTaskType(key) { load().workflow.task_types = load().workflow.task_types.filter(t => t.key !== key); save(); },
    reorderTaskTypes(keys) {
      const w = load().workflow;
      const map = Object.fromEntries(w.task_types.map(t => [t.key, t]));
      w.task_types = keys.map(k => map[k]).filter(Boolean);
      save();
    },
    upsertRelationship(def, oldKey) {
      const w = load().workflow;
      const i = oldKey ? w.relationships.findIndex(r => r.key === oldKey) : -1;
      if (i >= 0) w.relationships.splice(i, 1, { ...w.relationships[i], ...def });
      else w.relationships.push(def);
      save();
    },
    deleteRelationship(key) { load().workflow.relationships = load().workflow.relationships.filter(r => r.key !== key); save(); },
    upsertCustomField(def, oldKey) {
      const w = load().workflow;
      const i = oldKey ? w.custom_fields.findIndex(f => f.key === oldKey) : -1;
      if (i >= 0) w.custom_fields.splice(i, 1, { ...w.custom_fields[i], ...def });
      else w.custom_fields.push(def);
      save();
    },
    deleteCustomField(key) {
      const d = load();
      d.workflow.custom_fields = d.workflow.custom_fields.filter(f => f.key !== key);
      d.tasks.forEach(t => { if (t.fields) delete t.fields[key]; });
      save();
    },

    // views (saved queries)
    listViews() { return load().views.slice(); },
    getView(id) { return load().views.find(v => v.id === id); },
    createView(def) { const v = { id: ulid(), ...def }; load().views.push(v); save(); return v; },
    updateView(id, changes) { const v = store.getView(id); if (v) Object.assign(v, changes); save(); },
    deleteView(id) { const d = load(); d.views = d.views.filter(v => v.id !== id); save(); },

    // calendar
    calendar() { return load().calendar; },
    updateCalendar(changes) { Object.assign(load().calendar, changes); save(); },

    // list-view config
    listViewConfig() { return load().list_view; },
    updateListViewConfig(changes) { Object.assign(load().list_view, changes); save(); },

    // git
    git() { return load().git; },
    updateGit(changes) { Object.assign(load().git, changes); save(); },

    // user settings (per-current-user)
    userSettings() { const u = store.currentUser(); return (u && u.settings) || {}; },
    updateUserSettings(changes) {
      const u = store.currentUser();
      if (!u) return;
      u.settings = Object.assign({}, u.settings, changes);
      save();
    },

    // util
    ulid,
    todayISO,
    todayYMD,
    reset,
  };

  // --- Reset controls ------------------------------------------------------
  // Injects a small floating widget (bottom-right) with "Reset to sample" +
  // "Wipe all mock data" buttons. Visible on every mockup page.
  function injectResetControls() {
    if (document.getElementById("tt-mock-controls")) return;
    const el = document.createElement("div");
    el.id = "tt-mock-controls";
    el.innerHTML = `
      <button class="tt-mock-toggle" title="Mock data controls" aria-label="Mock data controls">⚙</button>
      <div class="tt-mock-panel" hidden>
        <div class="tt-mock-panel__title">Mock data</div>
        <div class="tt-mock-panel__hint">Changes persist in <code>localStorage</code> until reset.</div>
        <button class="btn btn--secondary btn--sm" data-mock-action="reset">Reset to sample data</button>
        <button class="btn btn--ghost btn--sm" data-mock-action="wipe">Wipe (no sample)</button>
        <a class="btn btn--ghost btn--sm" href="index.html">Back to index</a>
      </div>
    `;
    document.body.appendChild(el);
    const toggle = el.querySelector(".tt-mock-toggle");
    const panel = el.querySelector(".tt-mock-panel");
    toggle.addEventListener("click", () => { panel.hidden = !panel.hidden; });
    el.querySelector("[data-mock-action='reset']").addEventListener("click", () => {
      if (confirm("Reset all mock data to fresh sample fixtures? Any edits you made will be lost.")) {
        reset(true);
        location.reload();
      }
    });
    el.querySelector("[data-mock-action='wipe']").addEventListener("click", () => {
      if (confirm("Wipe ALL mock data from localStorage? On next page load, the sample fixtures will be recreated.")) {
        reset(false);
        location.reload();
      }
    });
  }

  // Inline-injected stylesheet for the reset widget — keeps tokens.css clean.
  function injectResetStyles() {
    if (document.getElementById("tt-mock-controls-style")) return;
    const s = document.createElement("style");
    s.id = "tt-mock-controls-style";
    s.textContent = `
      #tt-mock-controls {
        position: fixed; bottom: 16px; right: 16px; z-index: 9999;
        font-family: inherit;
      }
      #tt-mock-controls .tt-mock-toggle {
        width: 36px; height: 36px; border-radius: 50%;
        background: var(--bg-surface); border: 1px solid var(--border-default);
        cursor: pointer; box-shadow: var(--shadow-raised);
        font-size: 16px; line-height: 34px; text-align: center;
        color: var(--text-secondary);
      }
      #tt-mock-controls .tt-mock-toggle:hover { background: var(--bg-muted); }
      #tt-mock-controls .tt-mock-panel {
        position: absolute; bottom: 44px; right: 0;
        min-width: 260px;
        background: var(--bg-surface); border: 1px solid var(--border-default);
        border-radius: var(--radius-md); padding: 12px;
        box-shadow: var(--shadow-overlay);
        display: flex; flex-direction: column; gap: 8px;
      }
      #tt-mock-controls .tt-mock-panel[hidden] { display: none; }
      #tt-mock-controls .tt-mock-panel__title {
        font-size: 13px; font-weight: 600; color: var(--text-primary);
      }
      #tt-mock-controls .tt-mock-panel__hint {
        font-size: 11px; color: var(--text-tertiary); margin-bottom: 4px;
      }
    `;
    document.head.appendChild(s);
  }

  // --- Global init ---------------------------------------------------------
  function initHeaderThemeButtons() {
    document.querySelectorAll(".theme-toggle button").forEach((b) => {
      b.addEventListener("click", () => setTheme(b.dataset.theme));
    });
    applyTheme(getTheme());
  }

  function initKeyboard() {
    document.addEventListener("keydown", (e) => {
      if (e.target.matches("input, textarea, select, [contenteditable]")) return;
      if (e.key === "t") toggleTheme();
      if (e.key === "[") {
        const s = document.querySelector(".sidebar");
        if (s) {
          s.classList.toggle("is-collapsed");
          localStorage.setItem(STORAGE.sidebar, s.classList.contains("is-collapsed") ? "1" : "0");
        }
      }
    });
  }

  function init() {
    initHeaderThemeButtons();
    initSidebar();
    initFloating();
    initKeyboard();
    injectResetStyles();
    injectResetControls();
    // Touch the store on first run so localStorage gets seeded.
    load();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Expose helpers
  window.TT = {
    setTheme,
    getTheme,
    toggleTheme,
    closeAllFloating,
    positionNear,
    store,
    ulid,
    todayISO,
    todayYMD,
  };
})();
