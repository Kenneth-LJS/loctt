// TaskTracker mockup — page views (data-driven from window.TT.store).
// Each page calls TT.views.<page>() at the bottom of its HTML to hydrate.
// Re-renders on document `tt:change` events.
(function () {
  if (!window.TT || !window.TT.store) return;
  const { store, ulid, todayYMD } = window.TT;

  // --- helpers -----------------------------------------------------------
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === "class") node.className = attrs[k];
        else if (k === "style" && typeof attrs[k] === "object") Object.assign(node.style, attrs[k]);
        else if (k.startsWith("on") && typeof attrs[k] === "function") node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k === "checked" || k === "selected" || k === "disabled" || k === "hidden" || k === "autofocus") {
          if (attrs[k] != null && attrs[k] !== false) node.setAttribute(k, "");
        } else node.setAttribute(k, attrs[k]);
      }
    }
    children.flat().forEach(c => {
      if (c == null || c === false) return;
      node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return node;
  }

  function mount(selector) { return document.querySelector(selector); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function on(node, ev, fn) { node.addEventListener(ev, fn); return node; }

  function findStatus(key)   { return store.workflow().statuses.find(s => s.key === key); }
  function findPriority(key) { return store.workflow().priorities.find(p => p.key === key); }
  function findType(key)     { return store.workflow().task_types.find(t => t.key === key); }
  function findRel(key)      { return store.workflow().relationships.find(r => r.key === key || r.inverse === key); }

  function avatarFor(user) {
    if (!user) return el("span", { class: "avatar", title: "Unassigned" }, "?");
    const initials = (user.name || "?").split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
    const cls = "avatar avatar--" + "abcde"[(hashCode(user.id) % 5)];
    return el("span", { class: cls, title: user.name }, initials);
  }
  function hashCode(s) { let h = 0; for (const c of String(s||"")) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }

  function userOpts(includeNull, label) {
    const out = includeNull ? [el("option", { value: "" }, label || "—")] : [];
    store.listUsers().forEach(u => out.push(el("option", { value: u.id }, u.name)));
    return out;
  }

  function statusBadge(statusKey) {
    const s = findStatus(statusKey);
    if (!s) return el("span", { class: "badge" }, statusKey || "—");
    const cat = "badge badge--status-" + s.category;
    const icon = s.category === "active" ? "●" : s.category === "completed" ? "✓" : s.category === "discarded" ? "⊘" : "○";
    return el("span", { class: cat }, `${icon} ${s.label}`);
  }
  function priorityChip(priorityKey) {
    const p = findPriority(priorityKey);
    if (!p) return el("span", { class: "priority-label" }, "—");
    const cls = "priority-label";
    const dotCls = "priority-dot priority-dot--" + (p.key === "critical" ? "critical" : p.key === "high" ? "high" : p.key === "medium" ? "medium" : "low");
    return el("span", { class: cls }, el("span", { class: dotCls }), p.label);
  }
  function typeBadge(typeKey) {
    const t = findType(typeKey);
    if (!t) return el("span", { class: "badge badge--type" }, "—");
    return el("span", { class: "badge badge--type" }, t.label);
  }
  function labelChip(labelKey, onX) {
    const l = store.getLabel(labelKey);
    if (!l) return el("span", { class: "chip" }, labelKey);
    const ch = el("span", { class: "chip", style: l.color ? { background: l.color + "22", color: l.color } : null }, l.label);
    if (onX) ch.appendChild(el("span", { class: "chip__x", onclick: onX }, "×"));
    return ch;
  }
  function projectChip(projectKey) {
    const p = store.getProject(projectKey);
    return el("span", { class: "chip", style: { fontSize: "10px" } }, p ? p.label : projectKey);
  }
  function fmtDate(d) {
    if (!d) return "—";
    const parts = String(d).slice(0, 10).split("-");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${months[+parts[1] - 1]} ${+parts[2]}`;
  }
  function relTime(iso) {
    if (!iso) return "—";
    const t = new Date(iso).getTime();
    const diff = Date.now() - t;
    const s = Math.floor(diff / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60); if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60); if (h < 24) return h + "h ago";
    const d = Math.floor(h / 24); if (d < 7) return d + "d ago";
    return new Date(iso).toISOString().slice(0, 10);
  }
  function isOverdue(d) {
    if (!d) return false;
    return String(d).slice(0,10) < todayYMD();
  }

  // --- toast -------------------------------------------------------------
  function toast(msg, opts) {
    const t = el("div", { class: "tt-toast", style: {
      position: "fixed", bottom: "60px", right: "20px",
      background: "var(--bg-surface-raised)", border: "1px solid var(--border-default)",
      borderRadius: "var(--radius-md)", padding: "10px 14px",
      boxShadow: "var(--shadow-overlay)", zIndex: "10000",
      maxWidth: "320px", display: "flex", alignItems: "center", gap: "10px",
      fontSize: "13px",
    }},
      el("span", { style: {
        width: "20px", height: "20px", borderRadius: "50%",
        background: "var(--feedback-success-bg)", color: "var(--feedback-success-fg)",
        display: "inline-grid", placeItems: "center", fontSize: "13px",
      }}, "✓"),
      el("span", null, msg),
    );
    if (opts && opts.action) {
      t.appendChild(el("a", { href: opts.action.href, style: { color: "var(--accent)", fontWeight: "500" } }, opts.action.label));
    }
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  // --- shared shell rendering -------------------------------------------
  // Pages set <body data-tt-shell> and a couple of mount points to opt-in.
  function renderShell() {
    // Header avatar + user menu (current user)
    const me = store.currentUser();
    if (me) {
      const initials = me.name.split(/\s+/).slice(0,2).map(w => w[0]).join("").toUpperCase();
      document.querySelectorAll("[data-tt-mount='user-avatar']").forEach(node => {
        clear(node);
        node.textContent = initials;
        node.title = me.name + " (" + me.email + ")";
      });
    }
    // User menu items
    const menu = document.getElementById("user-menu");
    if (menu) {
      const dynamic = menu.querySelector("[data-tt-mount='user-switcher']");
      if (dynamic) {
        clear(dynamic);
        const me = store.currentUser();
        // Current user block
        if (me) {
          const meInitials = me.name.split(/\s+/).slice(0,2).map(w=>w[0]).join("").toUpperCase();
          dynamic.appendChild(el("div", { style: { padding: "10px 12px", borderBottom: "1px solid var(--border-subtle)" }},
            el("div", { style: { display: "flex", alignItems: "center", gap: "10px" }},
              el("span", { class: "avatar" }, meInitials),
              el("div", null,
                el("div", { style: { fontWeight: "500", fontSize: "13px" }}, me.name),
                el("div", { style: { fontSize: "11px", color: "var(--text-tertiary)" }}, `${me.email} · ${me.timezone}`),
              )
            )
          ));
        }
        dynamic.appendChild(el("div", { style: { padding: "6px 12px", fontSize: "11px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" } }, "Switch user"));
        store.listUsers().filter(u => u.id !== (me && me.id)).forEach(u => {
          const initials = u.name.split(/\s+/).slice(0,2).map(w=>w[0]).join("").toUpperCase();
          dynamic.appendChild(el("div", {
            class: "menu__item",
            onclick: () => { store.switchUser(u.id); }
          },
            el("span", { class: "avatar", style: { width: "22px", height: "22px", fontSize: "10px" }}, initials),
            u.name
          ));
        });
        dynamic.appendChild(el("div", { style: { borderTop: "1px solid var(--border-subtle)", margin: "6px 0" }}));
        dynamic.appendChild(el("a", { class: "menu__item", href: "settings.html#users" }, "Manage users…"));
        dynamic.appendChild(el("a", { class: "menu__item", href: "settings.html#preferences" }, "My preferences…"));
      }
    }

    // Sidebar dynamic groups
    document.querySelectorAll("[data-tt-mount='sidebar-projects']").forEach(node => {
      clear(node);
      const tasks = store.listTasks();
      const counts = {};
      tasks.forEach(t => counts[t.project] = (counts[t.project] || 0) + 1);
      store.listProjects().forEach(p => {
        const a = el("a", { class: "sidebar__item", href: `list.html?project=${p.key}` },
          el("span", { class: "priority-dot", style: { background: "#1E6FCB" }}),
          el("span", { class: "sidebar__label" }, p.label),
          p.default ? el("span", { style: { fontSize: "10px", color: "var(--accent)" } }, "★") : null,
          el("span", { class: "sidebar__badge" }, counts[p.key] || 0),
        );
        node.appendChild(a);
      });
    });

    document.querySelectorAll("[data-tt-mount='sidebar-builtins']").forEach(node => {
      clear(node);
      const me = store.currentUser();
      const tasks = store.listTasks();
      const builtins = [
        { name: "Assigned to me", icon: "👤", count: tasks.filter(t => me && t.assignee === me.id && t.status !== "done" && t.status !== "wont_do").length },
        { name: "Reported by me", icon: "✎", count: tasks.filter(t => me && t.reporter === me.id).length },
        { name: "Due this week", icon: "📅", count: tasks.filter(t => t.due_date && t.due_date <= todayYMD(7) && t.status !== "done" && t.status !== "wont_do").length },
        { name: "Overdue", icon: "!", count: tasks.filter(t => isOverdue(t.due_date) && t.status !== "done" && t.status !== "wont_do").length },
        { name: "High priority", icon: "▲", count: tasks.filter(t => (t.priority === "high" || t.priority === "critical") && t.status !== "done" && t.status !== "wont_do").length },
      ];
      builtins.forEach(b => {
        node.appendChild(el("a", { class: "sidebar__item builtin-filter", "data-filter": b.name },
          el("span", { class: "icon", style: { width: "16px", textAlign: "center" }}, b.icon),
          el("span", { class: "sidebar__label" }, b.name),
          el("span", { class: "sidebar__badge" }, b.count),
        ));
      });
      // "+ New filter" entry to open editor
      node.appendChild(el("a", { class: "sidebar__item", style: { color: "var(--accent)", fontWeight: "500" }, onclick: () => openSavedViewEditor(null) },
        el("span", { class: "icon" }, "+"),
        el("span", { class: "sidebar__label" }, "New filter…"),
      ));
    });

    document.querySelectorAll("[data-tt-mount='sidebar-views']").forEach(node => {
      clear(node);
      store.listViews().forEach(v => {
        node.appendChild(el("a", { class: "sidebar__item", "data-view-id": v.id },
          el("span", { class: "icon", style: { width: "16px", textAlign: "center" }}, "★"),
          el("span", { class: "sidebar__label" }, v.name),
          el("button", { class: "btn btn--icon btn--sm btn--ghost", style: { width: "20px", height: "20px", fontSize: "10px", opacity: "0.6" }, title: "Edit view", onclick: (e) => { e.preventDefault(); e.stopPropagation(); openSavedViewEditor(v.id); } }, "✎"),
        ));
      });
    });

    document.querySelectorAll("[data-tt-mount='sidebar-milestones']").forEach(node => {
      clear(node);
      const tasks = store.listTasks();
      store.listMilestones().forEach(m => {
        const count = tasks.filter(t => t.milestone === m.key).length;
        node.appendChild(el("a", { class: "sidebar__item" },
          el("span", { class: "sidebar__label" }, m.label),
          el("span", { class: "sidebar__badge" }, count),
        ));
      });
    });

    document.querySelectorAll("[data-tt-mount='sidebar-sprints']").forEach(node => {
      clear(node);
      store.listSprints().filter(s => s.state !== "completed").forEach(s => {
        node.appendChild(el("a", { class: "sidebar__item" },
          el("span", { class: "priority-dot", style: { background: s.state === "active" ? "#1F8A4C" : "var(--text-tertiary)" }}),
          el("span", { class: "sidebar__label" }, s.label, " ", el("span", { style: { color: "var(--text-tertiary)", fontSize: "11px" }}, s.state)),
        ));
      });
    });

    document.querySelectorAll("[data-tt-mount='sidebar-labels']").forEach(node => {
      clear(node);
      store.listLabels().forEach(l => {
        node.appendChild(el("a", { class: "sidebar__item" },
          el("span", { class: "priority-dot", style: { background: l.color || "var(--text-tertiary)" }}),
          el("span", { class: "sidebar__label" }, l.label),
        ));
      });
    });

    document.querySelectorAll("[data-tt-mount='sidebar-footer']").forEach(node => {
      clear(node);
      const tasks = store.listTasks();
      const def = store.listProjects().find(p => p.default) || store.listProjects()[0];
      node.appendChild(el("div", { style: { padding: "8px 12px", fontSize: "11px", color: "var(--text-tertiary)", borderTop: "1px solid var(--border-subtle)" }},
        el("div", { style: { fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}, "~/PDev/loctt/.loctt/"),
        el("div", null, `${tasks.length} tasks · default `, el("strong", null, def ? def.prefix : "—"), ` · next `, el("strong", null, def ? def.prefix + def.next_number : "—")),
      ));
    });
  }

  // ===================================================================
  //  LIST VIEW
  // ===================================================================
  const LIST_STATE = {
    sort: { col: "updated_at", dir: -1 },
    filters: {}, // {project: ["web"], status: ["in_progress"], priority: [...], labels: [...], assignee: [...], milestone: [...], sprint: [...], type: [...]}
    showArchived: false,
    columns: ["key", "project", "title", "status", "priority", "type", "assignee", "labels", "due", "updated"],
    selected: new Set(),
    pageSize: 50,
  };

  function renderList() {
    renderShell();
    const root = mount("[data-tt-mount='list-view']");
    if (!root) return;
    clear(root);

    const tasks = applyListFiltering(store.listTasks({ includeArchived: LIST_STATE.showArchived }));
    const sorted = applyListSorting(tasks);

    // Filter bar
    root.appendChild(renderListFilterBar());
    root.appendChild(renderListFilterPills());
    root.appendChild(renderBulkBar());
    root.appendChild(renderListTable(sorted));
    root.appendChild(renderListPager(sorted));
  }

  function applyListFiltering(tasks) {
    const f = LIST_STATE.filters;
    return tasks.filter(t => {
      for (const k in f) {
        const vals = f[k];
        if (!vals || !vals.length) continue;
        if (k === "labels") { if (!vals.some(v => t.labels.includes(v))) return false; continue; }
        if (k === "project")   { if (!vals.includes(t.project))   return false; continue; }
        if (k === "status")    { if (!vals.includes(t.status))    return false; continue; }
        if (k === "priority")  { if (!vals.includes(t.priority))  return false; continue; }
        if (k === "type")      { if (!vals.includes(t.task_type)) return false; continue; }
        if (k === "assignee")  { if (!vals.includes(t.assignee))  return false; continue; }
        if (k === "milestone") { if (!vals.includes(t.milestone)) return false; continue; }
        if (k === "sprint")    { if (!vals.includes(t.sprint))    return false; continue; }
      }
      return true;
    });
  }

  function applyListSorting(tasks) {
    const { col, dir } = LIST_STATE.sort;
    const get = {
      key: t => t.key,
      project: t => t.project || "",
      title: t => t.title || "",
      status: t => t.status || "",
      priority: t => { const p = findPriority(t.priority); return p ? p.value || 0 : -1; },
      type: t => t.task_type || "",
      assignee: t => { const u = t.assignee && store.getUser(t.assignee); return u ? u.name : ""; },
      due: t => t.due_date || "9999-99-99",
      updated: t => t.updated_at || "",
      updated_at: t => t.updated_at || "",
    }[col] || (() => "");
    return tasks.slice().sort((a, b) => {
      const av = get(a), bv = get(b);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return 0;
    });
  }

  function renderListFilterBar() {
    const filters = [
      { key: "project",   label: "Project",   opts: store.listProjects().map(p => ({ value: p.key, label: p.label })) },
      { key: "status",    label: "Status",    opts: store.workflow().statuses.map(s => ({ value: s.key, label: s.label })) },
      { key: "priority",  label: "Priority",  opts: store.workflow().priorities.map(p => ({ value: p.key, label: p.label })) },
      { key: "type",      label: "Type",      opts: store.workflow().task_types.map(t => ({ value: t.key, label: t.label })) },
      { key: "assignee",  label: "Assignee",  opts: store.listUsers().map(u => ({ value: u.id, label: u.name })) },
      { key: "label",     label: "Label",     opts: store.listLabels().map(l => ({ value: l.key, label: l.label })), filterKey: "labels" },
      { key: "milestone", label: "Milestone", opts: store.listMilestones().map(m => ({ value: m.key, label: m.label })) },
      { key: "sprint",    label: "Sprint",    opts: store.listSprints().map(s => ({ value: s.key, label: s.label })) },
    ];

    const bar = el("div", { class: "filter-bar" });
    filters.forEach(f => bar.appendChild(makeFilterDropdown(f)));

    bar.appendChild(el("button", {
      class: "btn btn--secondary btn--ghost",
      title: "Filter by a custom field declared in workflow.yaml",
      onclick: () => alert("Custom-field filter — opens a picker of declared workflow.custom_fields (mockup limit)."),
    }, "+ Field"));

    bar.appendChild(el("div", { style: { flex: "1" }}));
    const showArch = el("label", { class: "chk" },
      el("input", { type: "checkbox", checked: LIST_STATE.showArchived, onchange: (e) => { LIST_STATE.showArchived = e.target.checked; renderList(); }}),
      el("span", { class: "chk__box" }),
      " Show archived"
    );
    bar.appendChild(showArch);
    return bar;
  }

  function makeFilterDropdown(spec) {
    const filterKey = spec.filterKey || spec.key;
    const activeVals = LIST_STATE.filters[filterKey] || [];
    const btn = el("button", { class: "btn btn--secondary" }, spec.label, activeVals.length ? ` · ${activeVals.length}` : "", el("span", { html: " <svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>"}));
    const menuId = "f-" + spec.key + "-" + Math.random().toString(36).slice(2,8);
    const menu = el("div", { class: "menu", id: menuId, style: { minWidth: "200px" }});
    spec.opts.forEach(opt => {
      const checked = activeVals.includes(opt.value);
      menu.appendChild(el("div", {
        class: "menu__item menu__item--check" + (checked ? " is-selected" : ""),
        onclick: (e) => {
          e.stopPropagation();
          const vals = LIST_STATE.filters[filterKey] = LIST_STATE.filters[filterKey] || [];
          const i = vals.indexOf(opt.value);
          if (i >= 0) vals.splice(i, 1); else vals.push(opt.value);
          if (!vals.length) delete LIST_STATE.filters[filterKey];
          renderList();
        }
      }, opt.label));
    });
    btn.setAttribute("data-menu-trigger", menuId);
    const wrap = el("span", { style: { position: "relative", display: "inline-block" }}, btn, menu);
    return wrap;
  }

  function renderListFilterPills() {
    const pills = el("div", { class: "filter-pills" });
    const f = LIST_STATE.filters;
    let any = false;
    for (const k in f) {
      const vals = f[k];
      if (!vals || !vals.length) continue;
      any = true;
      const labelMap = {
        project: v => (store.getProject(v) || {}).label,
        status: v => (findStatus(v) || {}).label,
        priority: v => (findPriority(v) || {}).label,
        type: v => (findType(v) || {}).label,
        assignee: v => (store.getUser(v) || {}).name,
        labels: v => (store.getLabel(v) || {}).label,
        milestone: v => v,
        sprint: v => v,
      }[k] || (v => v);
      const labels = vals.map(labelMap).filter(Boolean).join(", ");
      pills.appendChild(el("span", { class: "chip chip--accent" }, `${k}: ${labels}`,
        el("span", { class: "chip__x", onclick: () => { delete LIST_STATE.filters[k]; renderList(); }}, "×")));
    }
    if (any) {
      pills.appendChild(el("button", { class: "btn btn--ghost btn--sm", onclick: () => { LIST_STATE.filters = {}; renderList(); }}, "Clear all"));
      pills.appendChild(el("div", { style: { flex: "1" }}));
      pills.appendChild(el("button", { class: "btn btn--ghost btn--sm", title: "Save these filters as a view", onclick: () => openSavedViewEditor(null, { fromFilters: true })}, "⭑ Save as view"));
    }
    return pills;
  }

  function renderBulkBar() {
    const n = LIST_STATE.selected.size;
    const bar = el("div", {
      class: "bulk-bar",
      style: {
        display: n > 0 ? "flex" : "none", position: "sticky", bottom: "12px", zIndex: "5",
        margin: "8px 0", padding: "10px 14px", background: "var(--bg-surface-raised)",
        border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-overlay)", alignItems: "center", gap: "12px",
      }
    });
    bar.appendChild(el("span", { style: { fontWeight: "500", fontSize: "13px" }}, `${n} selected`));
    bar.appendChild(el("div", { style: { width: "1px", height: "20px", background: "var(--border-subtle)" }}));
    const bulkSelectMenu = (label, options, applyFn) => {
      const id = "bulk-" + label.toLowerCase().replace(/\W+/g, "-") + Math.random().toString(36).slice(2,5);
      const btn = el("button", { class: "btn btn--secondary btn--sm", "data-menu-trigger": id }, label);
      const menu = el("div", { class: "menu", id, style: { minWidth: "180px" }});
      options.forEach(opt => menu.appendChild(el("div", { class: "menu__item", onclick: () => {
        applyFn(opt.value);
        LIST_STATE.selected.clear();
        renderList();
      }}, opt.label)));
      return el("span", { style: { position: "relative" }}, btn, menu);
    };
    bar.appendChild(bulkSelectMenu("Set status…", store.workflow().statuses.map(s => ({ value: s.key, label: s.label })), v => store.bulkUpdate([...LIST_STATE.selected], { status: v })));
    bar.appendChild(bulkSelectMenu("Set priority…", store.workflow().priorities.map(p => ({ value: p.key, label: p.label })), v => store.bulkUpdate([...LIST_STATE.selected], { priority: v })));
    bar.appendChild(bulkSelectMenu("Set assignee…", [{ value: null, label: "Unassigned" }].concat(store.listUsers().map(u => ({ value: u.id, label: u.name }))), v => store.bulkUpdate([...LIST_STATE.selected], { assignee: v })));
    bar.appendChild(bulkSelectMenu("Set milestone…", [{ value: null, label: "—" }].concat(store.listMilestones().map(m => ({ value: m.key, label: m.label }))), v => store.bulkUpdate([...LIST_STATE.selected], { milestone: v })));
    bar.appendChild(bulkSelectMenu("Set sprint…", [{ value: null, label: "—" }].concat(store.listSprints().map(s => ({ value: s.key, label: s.label }))), v => store.bulkUpdate([...LIST_STATE.selected], { sprint: v })));
    bar.appendChild(el("div", { style: { flex: "1" }}));
    bar.appendChild(el("button", { class: "btn btn--secondary btn--sm", onclick: () => {
      store.bulkArchive([...LIST_STATE.selected]);
      LIST_STATE.selected.clear();
      renderList();
    }}, "Archive"));
    bar.appendChild(el("button", { class: "btn btn--danger btn--sm", onclick: () => {
      if (!confirm(`Delete ${n} task(s) permanently? This cannot be undone.`)) return;
      store.bulkDelete([...LIST_STATE.selected]);
      LIST_STATE.selected.clear();
      renderList();
    }}, "Delete…"));
    bar.appendChild(el("button", { class: "btn btn--ghost btn--icon btn--sm", "aria-label": "Clear selection", onclick: () => { LIST_STATE.selected.clear(); renderList(); }}, "✕"));
    return bar;
  }

  function renderListTable(tasks) {
    const table = el("table", { class: "table tabular" });
    const thead = el("thead");
    const colDefs = {
      key: { label: "Key", sortable: true, style: { width: "90px" }, klass: "col-key" },
      project: { label: "Project", sortable: true, style: { width: "70px" }},
      title: { label: "Title", sortable: true },
      status: { label: "Status", sortable: true, style: { width: "130px" }},
      priority: { label: "Priority", sortable: true, style: { width: "100px" }},
      type: { label: "Type", sortable: true, style: { width: "80px" }},
      assignee: { label: "Assignee", sortable: true, style: { width: "120px" }},
      labels: { label: "Labels", style: { width: "180px" }},
      due: { label: "Due", sortable: true, style: { width: "80px" }},
      updated: { label: "Updated", sortable: true, style: { width: "100px" }, klass: "col-updated" },
    };
    const tr = el("tr");
    tr.appendChild(el("th", { class: "col-checkbox" },
      el("label", { class: "chk" },
        el("input", { type: "checkbox", checked: tasks.length > 0 && tasks.every(t => LIST_STATE.selected.has(t.id)), onchange: (e) => {
          if (e.target.checked) tasks.forEach(t => LIST_STATE.selected.add(t.id));
          else tasks.forEach(t => LIST_STATE.selected.delete(t.id));
          renderList();
        }}),
        el("span", { class: "chk__box" })
      )));
    LIST_STATE.columns.forEach(colKey => {
      const def = colDefs[colKey];
      if (!def) return;
      const sortIcon = LIST_STATE.sort.col === colKey ? (LIST_STATE.sort.dir === 1 ? " ▲" : " ▼") : (def.sortable ? " ▾" : "");
      const th = el("th", {
        class: def.klass || "", style: def.style,
        onclick: def.sortable ? () => {
          if (LIST_STATE.sort.col === colKey) LIST_STATE.sort.dir *= -1;
          else { LIST_STATE.sort.col = colKey; LIST_STATE.sort.dir = 1; }
          renderList();
        } : null,
      }, def.label, def.sortable ? el("span", { class: "sort" }, sortIcon) : null);
      if (def.sortable) th.style.cursor = "pointer";
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);

    const tbody = el("tbody");
    if (tasks.length === 0) {
      tbody.appendChild(el("tr", null, el("td", { colspan: String(LIST_STATE.columns.length + 1), style: { padding: "32px", textAlign: "center", color: "var(--text-tertiary)" }}, "No tasks match these filters.")));
    }
    tasks.forEach(t => tbody.appendChild(renderListRow(t)));
    table.appendChild(tbody);
    return table;
  }

  function renderListRow(t) {
    const tr = el("tr", { style: t.archived ? { opacity: "0.5" } : null, ondblclick: () => { window.location.href = `task-detail.html?id=${t.id}`; }});
    tr.appendChild(el("td", { class: "col-checkbox" },
      el("label", { class: "chk", onclick: e => e.stopPropagation() },
        el("input", { type: "checkbox", checked: LIST_STATE.selected.has(t.id), onchange: (e) => {
          if (e.target.checked) LIST_STATE.selected.add(t.id); else LIST_STATE.selected.delete(t.id);
          renderList();
        }}),
        el("span", { class: "chk__box" })
      )));
    const cells = {
      key:      () => el("td", { class: "col-key" }, el("a", { href: `task-detail.html?id=${t.id}`, style: { color: "inherit" }}, t.key)),
      project:  () => el("td", null, projectChip(t.project)),
      title:    () => {
        const inboundBlocked = store.listTasks().filter(x => x.relationships.some(r => r.type === "blocks" && r.target === t.id));
        const subLines = [];
        if (t.relationships.length) subLines.push(`${t.relationships.length} relation${t.relationships.length === 1 ? "" : "s"}`);
        if (inboundBlocked.length) subLines.push(`blocked by ${inboundBlocked[0].key}${inboundBlocked.length > 1 ? ` +${inboundBlocked.length - 1}` : ""}`);
        return el("td", { class: "col-title" }, t.title, subLines.length ? el("div", { class: "sub" }, subLines.join(" · ")) : null);
      },
      status:   () => el("td", null, statusBadge(t.status)),
      priority: () => el("td", null, priorityChip(t.priority)),
      type:     () => el("td", null, typeBadge(t.task_type)),
      assignee: () => {
        const u = t.assignee && store.getUser(t.assignee);
        return el("td", null, u ? el("span", { class: "row" }, avatarFor(u), u.name.split(" ")[0]) : el("span", { style: { color: "var(--text-tertiary)" }}, "—"));
      },
      labels:   () => el("td", null, ...t.labels.map(k => labelChip(k))),
      due:      () => el("td", { style: isOverdue(t.due_date) ? { color: "var(--feedback-danger-fg)", fontWeight: "500" } : null }, fmtDate(t.due_date)),
      updated:  () => el("td", { class: "col-updated" }, relTime(t.updated_at)),
    };
    LIST_STATE.columns.forEach(col => { if (cells[col]) tr.appendChild(cells[col]()); });
    return tr;
  }

  function renderListPager(tasks) {
    const wrap = el("div", { class: "pager" });
    wrap.appendChild(el("div", null, `Showing ${tasks.length} of ${store.listTasks({ includeArchived: true }).length}`));
    return wrap;
  }

  // --- Saved-view editor (used in list, sidebar, settings) -------------
  function openSavedViewEditor(viewId, opts) {
    const existing = viewId ? store.getView(viewId) : null;
    // If a built-in name was passed, opts.builtinName = name, fromBuiltin = true
    const fromFilters = opts && opts.fromFilters;
    const initialFilters = fromFilters
      ? JSON.parse(JSON.stringify(LIST_STATE.filters))
      : (existing && existing._basicFilters) || {};

    const backdrop = el("div", { class: "tt-modal-backdrop" });
    const dlg = el("div", { class: "tt-modal", style: { maxWidth: "720px", width: "90vw" }});
    const state = {
      mode: "basic",
      name: existing ? existing.name : "",
      filters: initialFilters,
      sorts: existing && existing.sort ? existing.sort.slice() : [],
      rawQuery: existing ? existing.query : "",
    };

    function tab(name, label) {
      return el("button", { class: "btn btn--sm " + (state.mode === name ? "btn--secondary" : "btn--ghost"), onclick: () => { state.mode = name; render(); }}, label);
    }

    function fieldOpts() {
      const wf = store.workflow();
      return [
        { key: "project",   label: "Project",   type: "enum",  values: store.listProjects().map(p => ({ value: p.key, label: p.label })) },
        { key: "status",    label: "Status",    type: "enum",  values: wf.statuses.map(s => ({ value: s.key, label: s.label })) },
        { key: "priority",  label: "Priority",  type: "enum",  values: wf.priorities.map(p => ({ value: p.key, label: p.label })) },
        { key: "task_type", label: "Type",      type: "enum",  values: wf.task_types.map(t => ({ value: t.key, label: t.label })) },
        { key: "assignee",  label: "Assignee",  type: "user" },
        { key: "reporter",  label: "Reporter",  type: "user" },
        { key: "labels",    label: "Label",     type: "enum",  values: store.listLabels().map(l => ({ value: l.key, label: l.label })), multi: true },
        { key: "milestone", label: "Milestone", type: "enum",  values: store.listMilestones().map(m => ({ value: m.key, label: m.label })) },
        { key: "sprint",    label: "Sprint",    type: "enum",  values: store.listSprints().map(s => ({ value: s.key, label: s.label })) },
        { key: "due_date",  label: "Due date",  type: "date" },
        { key: "start_date",label: "Start date",type: "date" },
        { key: "created_at",label: "Created",   type: "date" },
        { key: "updated_at",label: "Updated",   type: "date" },
        { key: "text",      label: "Text",      type: "text" },
        ...wf.custom_fields.map(f => ({ key: "fields." + f.key, label: f.label + " (custom)", type: f.type === "enum" ? "enum" : "text", values: f.values || [], multi: f.multi })),
        ...wf.relationships.map(r => ({ key: "relationship." + r.key, label: r.label + " (relation)", type: "text" })),
      ];
    }

    function buildDSL() {
      const parts = [];
      const fields = fieldOpts();
      for (const k in state.filters) {
        const vals = state.filters[k];
        if (!vals || !vals.length) continue;
        const f = fields.find(x => x.key === k || x.key === ({ labels: "labels", project: "project", status: "status", priority: "priority", task_type: "task_type", type: "task_type", assignee: "assignee", reporter: "reporter", milestone: "milestone", sprint: "sprint" }[k] || k));
        if (vals.length === 1) parts.push(`${k} = ${vals[0]}`);
        else parts.push(`${k} in (${vals.join(", ")})`);
      }
      return parts.join(" and ");
    }

    function basicPanel() {
      const wrap = el("div", { class: "col", style: { gap: "10px" }});
      // Filters
      wrap.appendChild(el("div", { style: { fontSize: "11px", textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: "600", letterSpacing: "0.06em", marginTop: "4px" }}, "Filters"));
      const fields = fieldOpts();
      Object.keys(state.filters).forEach((fk, idx) => {
        const f = fields.find(x => x.key === fk) || { key: fk, label: fk, type: "text", values: [] };
        const row = el("div", { class: "row", style: { gap: "8px" }});
        if (idx > 0) row.appendChild(el("span", { style: { fontSize: "11px", color: "var(--text-tertiary)", fontWeight: "600", padding: "0 4px" }}, "AND"));
        row.appendChild(el("strong", { style: { minWidth: "100px" }}, f.label));
        row.appendChild(el("span", { class: "chip" }, state.filters[fk].length > 1 ? "in" : "="));
        if (f.type === "enum") {
          state.filters[fk].forEach(v => {
            const opt = (f.values || []).find(x => x.value === v) || { label: v };
            row.appendChild(el("span", { class: "chip chip--accent" }, opt.label, el("span", { class: "chip__x", onclick: () => { state.filters[fk] = state.filters[fk].filter(x => x !== v); if (!state.filters[fk].length) delete state.filters[fk]; render(); }}, "×")));
          });
          // Add new value picker
          const add = el("select", { class: "select", style: { minWidth: "120px" }, onchange: (e) => { if (e.target.value) { state.filters[fk].push(e.target.value); render(); }}},
            el("option", { value: "" }, "+ value"),
            ...(f.values || []).map(v => el("option", { value: v.value }, v.label))
          );
          row.appendChild(add);
        } else {
          row.appendChild(el("input", { class: "input", value: state.filters[fk].join(", "), onchange: (e) => { state.filters[fk] = e.target.value.split(",").map(s => s.trim()).filter(Boolean); if (!state.filters[fk].length) delete state.filters[fk]; render(); }}));
        }
        row.appendChild(el("button", { class: "btn btn--ghost btn--icon btn--sm", title: "Remove filter", onclick: () => { delete state.filters[fk]; render(); }}, "×"));
        wrap.appendChild(row);
      });
      // Add filter row
      const addRow = el("div", { class: "row", style: { gap: "8px" }});
      const addSel = el("select", { class: "select", onchange: (e) => { if (e.target.value && !state.filters[e.target.value]) { state.filters[e.target.value] = []; render(); }}},
        el("option", { value: "" }, "+ Add filter"),
        ...fields.filter(f => !state.filters[f.key]).map(f => el("option", { value: f.key }, f.label))
      );
      addRow.appendChild(addSel);
      wrap.appendChild(addRow);

      // Sorts
      wrap.appendChild(el("div", { style: { fontSize: "11px", textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: "600", letterSpacing: "0.06em", marginTop: "16px" }}, "Sort"));
      state.sorts.forEach((s, idx) => {
        const row = el("div", { class: "row", style: { gap: "8px" }});
        if (idx > 0) row.appendChild(el("span", { style: { fontSize: "11px", color: "var(--text-tertiary)", fontWeight: "600", padding: "0 4px" }}, "Then"));
        row.appendChild(el("select", { class: "select", onchange: (e) => { s.field = e.target.value; render(); }},
          ...fields.map(f => el("option", Object.assign({ value: f.key }, s.field === f.key ? { selected: "" } : {}), f.label))
        ));
        row.appendChild(el("select", { class: "select", onchange: (e) => { s.direction = e.target.value; render(); }},
          el("option", Object.assign({ value: "asc" }, s.direction === "asc" ? { selected: "" } : {}), "ascending"),
          el("option", Object.assign({ value: "desc" }, s.direction === "desc" ? { selected: "" } : {}), "descending"),
        ));
        row.appendChild(el("button", { class: "btn btn--ghost btn--icon btn--sm", onclick: () => { state.sorts.splice(idx, 1); render(); }}, "×"));
        wrap.appendChild(row);
      });
      wrap.appendChild(el("button", { class: "btn btn--ghost btn--sm", onclick: () => { state.sorts.push({ field: "updated_at", direction: "desc" }); render(); }}, "+ Add sort"));
      return wrap;
    }

    function advancedPanel() {
      const wrap = el("div", { class: "col", style: { gap: "8px" }});
      wrap.appendChild(el("div", { style: { fontSize: "12px", color: "var(--text-tertiary)" }}, "Raw query (LocttQL). Supports: ", el("code", null, "field = value"), ", ", el("code", null, "field in (a, b)"), ", ", el("code", null, "and / or / not"), ", ", el("code", null, "today"), ", ", el("code", null, "text ~ \"search\""), ". Fields: built-ins, ", el("code", null, "fields.<key>"), ", ", el("code", null, "relationship.<type>"), ", ", el("code", null, "parent"), "."));
      const ta = el("textarea", { class: "input", style: { width: "100%", minHeight: "120px", fontFamily: "ui-monospace, Menlo, Consolas, monospace", padding: "10px", lineHeight: "1.5" }, oninput: (e) => { state.rawQuery = e.target.value; }}, state.rawQuery || buildDSL());
      wrap.appendChild(ta);
      return wrap;
    }

    function render() {
      clear(dlg);
      // Header
      const headerRow = el("div", { style: { display: "flex", alignItems: "center", borderBottom: "1px solid var(--border-subtle)", padding: "14px 18px" }},
        el("div", { style: { fontWeight: "600", fontSize: "15px", flex: "1" }}, existing ? "Edit view" : "New view"),
        el("button", { class: "btn btn--icon btn--ghost", onclick: close }, "✕"),
      );
      dlg.appendChild(headerRow);

      const body = el("div", { style: { padding: "18px" }});
      body.appendChild(el("div", { class: "row", style: { marginBottom: "12px" }},
        el("label", { style: { minWidth: "60px", fontSize: "12px", color: "var(--text-secondary)" }}, "Name"),
        el("input", { class: "input", style: { flex: "1" }, value: state.name, oninput: (e) => { state.name = e.target.value; }, placeholder: "e.g. High-prio bugs" }),
      ));
      body.appendChild(el("div", { class: "row", style: { gap: "6px", marginBottom: "12px" }}, tab("basic", "Basic"), tab("advanced", "Advanced")));
      body.appendChild(state.mode === "basic" ? basicPanel() : advancedPanel());
      dlg.appendChild(body);

      const footer = el("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px", borderTop: "1px solid var(--border-subtle)", padding: "12px 18px" }},
        existing ? el("button", { class: "btn btn--danger btn--sm", style: { marginRight: "auto" }, onclick: () => { if (confirm("Delete this view?")) { store.deleteView(existing.id); close(); }}}, "Delete") : null,
        el("button", { class: "btn btn--ghost", onclick: close }, "Cancel"),
        el("button", { class: "btn btn--primary", onclick: save }, "Save"),
      );
      dlg.appendChild(footer);
    }

    function save() {
      if (!state.name.trim()) { alert("Name is required."); return; }
      const dup = store.listViews().find(v => v.name === state.name.trim() && (!existing || v.id !== existing.id));
      if (dup && !confirm(`A view named "${state.name}" already exists. Save anyway?`)) return;
      const query = state.mode === "advanced" ? state.rawQuery : buildDSL();
      const payload = { name: state.name.trim(), query, sort: state.sorts, _basicFilters: state.filters };
      if (existing) store.updateView(existing.id, payload);
      else store.createView(payload);
      close();
    }

    function close() {
      backdrop.remove();
      dlg.remove();
    }

    backdrop.addEventListener("click", close);
    document.addEventListener("keydown", function onEsc(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onEsc); }});
    injectModalStyles();
    document.body.appendChild(backdrop);
    document.body.appendChild(dlg);
    render();
  }

  function injectModalStyles() {
    if (document.getElementById("tt-modal-style")) return;
    const s = document.createElement("style");
    s.id = "tt-modal-style";
    s.textContent = `
      .tt-modal-backdrop {
        position: fixed; inset: 0; background: rgba(0,0,0,0.42);
        z-index: 100;
      }
      .tt-modal {
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: var(--bg-surface-raised); border: 1px solid var(--border-default);
        border-radius: var(--radius-lg); box-shadow: var(--shadow-overlay);
        max-height: 90vh; overflow: auto; z-index: 101;
        display: flex; flex-direction: column;
      }
    `;
    document.head.appendChild(s);
  }

  // ===================================================================
  //  CREATE TASK MODAL
  // ===================================================================
  function openCreateTaskModal() {
    const backdrop = el("div", { class: "tt-modal-backdrop" });
    const dlg = el("div", { class: "tt-modal", style: { width: "640px", maxWidth: "92vw" }});
    const wf = store.workflow();
    const me = store.currentUser();
    const def = store.listProjects().find(p => p.default) || store.listProjects()[0];
    const state = {
      project: def && def.key,
      title: "",
      status: wf.statuses[0] && wf.statuses[0].key,
      priority: "medium",
      task_type: "task",
      sprint: null,
      milestone: null,
      assignee: null,
      reporter: me && me.id,
      labels: [],
      start_date: null,
      due_date: null,
      body: "",
      createAnother: false,
    };

    function render() {
      clear(dlg);
      const proj = store.getProject(state.project);
      // Header
      dlg.appendChild(el("div", { style: { display: "flex", alignItems: "center", borderBottom: "1px solid var(--border-subtle)", padding: "14px 18px" }},
        el("div", { style: { fontWeight: "600", fontSize: "15px", flex: "1" }}, "Create task"),
        el("button", { class: "btn btn--icon btn--ghost", onclick: close }, "✕"),
      ));
      const body = el("div", { style: { padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }});
      // Project + Milestone
      body.appendChild(el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }},
        col("Project *",
          el("select", { class: "select", onchange: (e) => { state.project = e.target.value; render(); }, style: { width: "100%" }},
            ...store.listProjects().map(p => el("option", Object.assign({ value: p.key }, state.project === p.key ? { selected: "" } : {}), `${p.label} (${p.prefix})`))
          ),
          el("div", { style: { fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px" }}, proj ? `Next key: ${proj.prefix}${proj.next_number}. The project's prefix is immutable.` : "")
        ),
        col("Milestone",
          el("select", { class: "select", onchange: (e) => state.milestone = e.target.value || null, style: { width: "100%" }},
            el("option", { value: "" }, "—"),
            ...store.listMilestones().map(m => el("option", Object.assign({ value: m.key }, state.milestone === m.key ? { selected: "" } : {}), m.label))
          )
        ),
      ));
      // Title
      body.appendChild(col("Title *", el("input", { class: "input", style: { width: "100%", fontSize: "15px", height: "40px" }, placeholder: "What needs doing?", autofocus: "", oninput: e => state.title = e.target.value, value: state.title })));
      // Status + Priority
      body.appendChild(el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }},
        col("Status", el("select", { class: "select", onchange: e => state.status = e.target.value, style: { width: "100%" }},
          ...wf.statuses.map(s => el("option", Object.assign({ value: s.key }, state.status === s.key ? { selected: "" } : {}), s.label))
        )),
        col("Priority", el("select", { class: "select", onchange: e => state.priority = e.target.value, style: { width: "100%" }},
          ...wf.priorities.map(p => el("option", Object.assign({ value: p.key }, state.priority === p.key ? { selected: "" } : {}), p.label))
        )),
      ));
      // Type + Sprint
      body.appendChild(el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }},
        col("Type", el("select", { class: "select", onchange: e => state.task_type = e.target.value, style: { width: "100%" }},
          ...wf.task_types.map(t => el("option", Object.assign({ value: t.key }, state.task_type === t.key ? { selected: "" } : {}), t.label))
        )),
        col("Sprint", el("select", { class: "select", onchange: e => state.sprint = e.target.value || null, style: { width: "100%" }},
          el("option", { value: "" }, "—"),
          ...store.listSprints().map(s => el("option", Object.assign({ value: s.key }, state.sprint === s.key ? { selected: "" } : {}), `${s.label} (${s.state})`))
        )),
      ));
      // Assignee + Reporter
      body.appendChild(el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }},
        col("Assignee", el("select", { class: "select", onchange: e => state.assignee = e.target.value || null, style: { width: "100%" }},
          el("option", { value: "" }, "Unassigned"),
          ...store.listUsers().map(u => el("option", Object.assign({ value: u.id }, state.assignee === u.id ? { selected: "" } : {}), u.name))
        )),
        col("Reporter", el("select", { class: "select", onchange: e => state.reporter = e.target.value || null, style: { width: "100%" }},
          ...store.listUsers().map(u => el("option", Object.assign({ value: u.id }, state.reporter === u.id ? { selected: "" } : {}), u.name)),
        ), el("div", { style: { fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px" }}, "Defaults to the current user.")),
      ));
      // Labels
      const labelsRow = el("div", { class: "row", style: { flexWrap: "wrap", gap: "6px", padding: "8px", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)" }});
      state.labels.forEach(l => labelsRow.appendChild(labelChip(l, () => { state.labels = state.labels.filter(x => x !== l); render(); })));
      const labelInput = el("input", { style: { flex: "1", minWidth: "120px", border: "none", outline: "none", background: "transparent" }, placeholder: "Add a label…", onkeydown: (e) => {
        if (e.key === "Enter" && e.target.value.trim()) {
          e.preventDefault();
          const key = e.target.value.trim().toLowerCase().replace(/\s+/g, "-");
          if (!store.getLabel(key)) {
            if (confirm(`Create new label "${key}"?`)) store.createLabel({ key, label: e.target.value.trim(), color: "#3b82f6" });
            else { e.target.value = ""; return; }
          }
          if (!state.labels.includes(key)) state.labels.push(key);
          e.target.value = "";
          render();
        }
      }});
      labelsRow.appendChild(labelInput);
      body.appendChild(col("Labels", labelsRow));
      // Dates
      body.appendChild(el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }},
        col("Start date", el("input", { type: "date", class: "input", style: { width: "100%" }, oninput: e => state.start_date = e.target.value || null, value: state.start_date || "" })),
        col("Due date",   el("input", { type: "date", class: "input", style: { width: "100%" }, oninput: e => state.due_date   = e.target.value || null, value: state.due_date || "" })),
      ));
      // Body
      body.appendChild(col("Description", el("textarea", { class: "input", style: { width: "100%", minHeight: "100px", padding: "10px", lineHeight: "1.5" }, placeholder: "Add more detail (optional)…", oninput: e => state.body = e.target.value }, state.body)));
      dlg.appendChild(body);
      // Footer
      dlg.appendChild(el("div", { style: { display: "flex", alignItems: "center", borderTop: "1px solid var(--border-subtle)", padding: "12px 18px", gap: "8px" }},
        el("label", { class: "chk", style: { marginRight: "auto" }},
          el("input", { type: "checkbox", checked: state.createAnother, onchange: e => state.createAnother = e.target.checked }),
          el("span", { class: "chk__box" }),
          "Create another"
        ),
        el("button", { class: "btn btn--ghost", onclick: close }, "Cancel"),
        el("button", { class: "btn btn--primary btn--lg", onclick: submit }, "Create task"),
      ));
    }

    function col(label, ...children) {
      return el("div", null,
        el("div", { style: { fontSize: "12px", color: "var(--text-secondary)", marginBottom: "4px", fontWeight: "500" }}, label),
        ...children
      );
    }

    function submit() {
      if (!state.title.trim()) { alert("Title is required."); return; }
      const task = store.createTask({
        project: state.project, title: state.title.trim(), status: state.status, priority: state.priority,
        task_type: state.task_type, sprint: state.sprint, milestone: state.milestone, assignee: state.assignee,
        reporter: state.reporter, labels: state.labels.slice(), start_date: state.start_date, due_date: state.due_date,
        body: state.body,
      });
      toast(`Task created`, { action: { href: `task-detail.html?id=${task.id}`, label: "Open" }});
      if (state.createAnother) {
        state.title = "";
        state.body = "";
        render();
        setTimeout(() => dlg.querySelector("input")?.focus(), 50);
      } else {
        close();
      }
    }

    function close() {
      backdrop.remove();
      dlg.remove();
    }

    backdrop.addEventListener("click", close);
    document.addEventListener("keydown", function onEsc(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onEsc); }});
    injectModalStyles();
    document.body.appendChild(backdrop);
    document.body.appendChild(dlg);
    render();
  }

  // ===================================================================
  //  TASK DETAIL VIEW
  // ===================================================================
  function renderTaskDetail() {
    renderShell();
    const root = mount("[data-tt-mount='task-detail']");
    if (!root) return;
    clear(root);
    const params = new URLSearchParams(window.location.search);
    const idOrKey = params.get("id") || params.get("key") || (store.listTasks()[0] && store.listTasks()[0].id);
    const t = store.getTask(idOrKey);
    if (!t) { root.appendChild(el("div", { class: "page" }, el("h1", null, "Task not found"))); return; }
    const wf = store.workflow();

    // Breadcrumb + title row
    const proj = store.getProject(t.project);
    root.appendChild(el("div", { style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-tertiary)" }},
      el("a", { href: "list.html" }, "All tasks"), " › ", el("span", null, `Project · ${proj ? proj.label : t.project}`)
    ));
    const titleRow = el("div", { class: "row", style: { gap: "12px" }});
    titleRow.appendChild(el("span", { class: "chip", style: { fontFamily: "ui-monospace, monospace" }}, t.key));
    const titleEl = el("h1", { style: { fontSize: "22px", margin: "0", fontWeight: "600", flex: "1", padding: "4px", borderRadius: "var(--radius-sm)", cursor: "text" }, contenteditable: "true", onblur: (e) => { const v = e.target.textContent.trim(); if (v && v !== t.title) store.updateTask(t.id, { title: v }); } }, t.title);
    titleRow.appendChild(titleEl);
    titleRow.appendChild(el("button", { class: "btn btn--icon btn--ghost", "data-menu-trigger": "task-more-menu", title: "More" }, "…"));
    titleRow.appendChild(el("button", { class: "btn btn--secondary", onclick: () => { (t.archived ? store.unarchiveTask : store.archiveTask)(t.id); }}, t.archived ? "Unarchive" : "Archive"));
    root.appendChild(titleRow);

    // More menu
    const moreMenu = el("div", { class: "menu", id: "task-more-menu", style: { minWidth: "200px" }},
      el("div", { class: "menu__item", onclick: () => { navigator.clipboard?.writeText(t.key); toast("Key copied"); }}, "Copy key"),
      el("div", { class: "menu__item", onclick: () => { navigator.clipboard?.writeText(window.location.href); toast("Link copied"); }}, "Copy link"),
      el("div", { class: "menu__item", onclick: () => { const copy = store.duplicateTask(t.id); window.location.href = `task-detail.html?id=${copy.id}`; }}, "Duplicate"),
      el("div", { class: "menu__item", style: { color: "var(--feedback-danger-fg)" }, onclick: () => { if (confirm("Delete this task permanently? This cannot be undone.")) { store.deleteTask(t.id); window.location.href = "list.html"; }}}, "Delete (hard)…"),
    );
    root.appendChild(moreMenu);

    // Layout: two-column main / sidebar
    const grid = el("div", { style: { display: "grid", gridTemplateColumns: "1fr 280px", gap: "20px" }});

    // ---- LEFT COLUMN ----
    const left = el("div", { class: "col", style: { gap: "20px" }});

    // Description
    left.appendChild(section("Description",
      el("textarea", { class: "input", style: { width: "100%", minHeight: "160px", padding: "12px", lineHeight: "1.5", fontFamily: "ui-monospace, Menlo, Consolas, monospace" }, onblur: (e) => { if (e.target.value !== t.body) store.updateTask(t.id, { body: e.target.value }); } }, t.body || "")
    ));

    // Related
    const relatedSec = section(`Related · ${t.relationships.length}`, null);
    const relList = el("div", { class: "col", style: { gap: "10px" }});
    // Group by type
    const grouped = {};
    t.relationships.forEach(r => {
      grouped[r.type] = grouped[r.type] || [];
      grouped[r.type].push(r);
    });
    Object.keys(grouped).forEach(typeKey => {
      const rdef = findRel(typeKey);
      const isInverse = rdef && rdef.inverse === typeKey;
      const label = isInverse ? rdef.inverse_label : (rdef ? rdef.label : typeKey);
      const block = el("div", null,
        el("div", { style: { fontSize: "12px", color: "var(--text-tertiary)", fontWeight: "600", textTransform: "uppercase", marginBottom: "6px" }}, `${label} · ${grouped[typeKey].length}`));
      grouped[typeKey].forEach(rel => {
        const tgt = store.getTask(rel.target);
        if (!tgt) return;
        const row = el("div", { class: "row", style: { padding: "8px", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)" }},
          el("span", { style: { color: "var(--text-tertiary)" }}, "⋮⋮"),
          el("a", { href: `task-detail.html?id=${tgt.id}`, style: { fontFamily: "ui-monospace, monospace", color: "var(--text-tertiary)" }}, tgt.key),
          el("span", { style: { flex: "1" }}, tgt.title),
          statusBadge(tgt.status),
          el("button", { class: "btn btn--ghost btn--icon btn--sm", title: "Remove", onclick: () => store.unlinkTasks(t.id, rel.type, tgt.id) }, "×"),
        );
        block.appendChild(row);
      });
      relList.appendChild(block);
    });
    relList.appendChild(el("button", { class: "btn btn--ghost btn--sm", onclick: () => openLinkPicker(t) }, "+ Add link"));
    relatedSec.appendChild(relList);
    left.appendChild(relatedSec);

    // Attachments
    const attSec = section(`Attachments · ${t.attachments.length}`, null);
    const attGrid = el("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: "10px" }});
    t.attachments.forEach(a => {
      const card = el("div", { style: { border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: "8px", position: "relative" }},
        el("div", { style: { width: "100%", height: "80px", background: "var(--bg-muted)", borderRadius: "var(--radius-sm)", display: "grid", placeItems: "center", color: "var(--text-tertiary)" }}, "📄"),
        el("div", { style: { fontSize: "11px", fontWeight: "500", marginTop: "6px", overflow: "hidden", textOverflow: "ellipsis" }}, a.name),
        el("div", { style: { fontSize: "10px", color: "var(--text-tertiary)" }}, `${a.size || "—"} · ${a.mime || ""}`),
        el("button", { class: "btn btn--ghost btn--icon btn--sm", style: { position: "absolute", top: "4px", right: "4px" }, title: "Remove", onclick: () => { t.attachments = t.attachments.filter(x => x.name !== a.name); store.updateTask(t.id, {}); }}, "×"),
      );
      attGrid.appendChild(card);
    });
    const dropZone = el("div", { style: { gridColumn: "1 / -1", padding: "16px", border: "1px dashed var(--border-default)", borderRadius: "var(--radius-md)", textAlign: "center", color: "var(--text-tertiary)", fontSize: "12px", cursor: "pointer" }, onclick: () => {
      const name = prompt("Mock attachment filename (e.g. notes.pdf, screenshot.png):");
      if (!name) return;
      t.attachments.push({ name, size: Math.floor(Math.random() * 500) + "kb", mime: guessMime(name) });
      store.updateTask(t.id, {});
    }}, "Drop files here, or click to add (mock)");
    attGrid.appendChild(dropZone);
    attSec.appendChild(attGrid);
    left.appendChild(attSec);

    // Activity
    const actSec = section(`Activity · ${t.history.length}`, null);
    const actList = el("div", { class: "col", style: { gap: "8px" }});
    t.history.slice().reverse().slice(0, 30).forEach(h => {
      const u = h.actor && store.getUser(h.actor);
      const icon = {
        created: "+", field_change: "→", custom_field_change: "→", label_added: "#", label_removed: "#",
        archived: "▢", unarchived: "▣", link_added: "⇢", link_removed: "⇢", body_edited: "✎",
        attachment_added: "📎", attachment_removed: "📎",
      }[h.kind] || "·";
      const msg = h.kind === "created" ? "created this task"
        : h.kind === "field_change" ? `changed ${h.field}${h.before != null ? ` from ${JSON.stringify(h.before)}` : ""} to ${JSON.stringify(h.after)}`
        : h.kind;
      actList.appendChild(el("div", { class: "row", style: { gap: "10px", fontSize: "12px" }},
        el("span", { style: { width: "22px", height: "22px", borderRadius: "50%", background: "var(--bg-muted)", display: "inline-grid", placeItems: "center", flexShrink: "0" }}, icon),
        el("span", { style: { flex: "1", color: "var(--text-secondary)" }}, u ? u.name + " " : "", msg),
        el("span", { style: { color: "var(--text-tertiary)" }}, relTime(h.at)),
      ));
    });
    actSec.appendChild(actList);
    left.appendChild(actSec);

    // ---- RIGHT COLUMN (meta panel) ----
    const right = el("div", { style: { background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: "12px", display: "flex", flexDirection: "column", gap: "10px", height: "fit-content" }});

    function metaRow(label, value, opts) {
      const row = el("div", { class: "row", style: { gap: "8px", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }});
      row.appendChild(el("span", { style: { width: "80px", fontSize: "11px", color: "var(--text-tertiary)", textTransform: "uppercase", fontWeight: "600", letterSpacing: "0.05em" }}, label));
      row.appendChild(el("span", { style: { flex: "1" }}, value));
      if (opts && opts.note) row.appendChild(el("span", { style: { fontSize: "10px", color: "var(--text-tertiary)" }}, opts.note));
      return row;
    }
    function selectField(field, options, valueAccessor) {
      const sel = el("select", { class: "select", style: { width: "100%" }, onchange: e => store.updateTask(t.id, { [field]: e.target.value === "" ? null : e.target.value })});
      sel.appendChild(el("option", { value: "" }, "—"));
      options.forEach(o => {
        const opt = el("option", { value: o.value }, o.label);
        if (t[field] === o.value) opt.selected = true;
        sel.appendChild(opt);
      });
      return sel;
    }

    right.appendChild(metaRow("Project", el("span", null, projectChip(t.project), " ", el("span", { style: { fontSize: "10px", color: "var(--text-tertiary)" }}, "(immutable)"))));
    right.appendChild(metaRow("Status",   selectField("status",   wf.statuses.map(s => ({ value: s.key, label: s.label })))));
    right.appendChild(metaRow("Priority", selectField("priority", wf.priorities.map(p => ({ value: p.key, label: p.label })))));
    right.appendChild(metaRow("Type",     selectField("task_type", wf.task_types.map(tt => ({ value: tt.key, label: tt.label })))));
    right.appendChild(metaRow("Assignee", selectField("assignee", store.listUsers().map(u => ({ value: u.id, label: u.name })))));
    right.appendChild(metaRow("Reporter", selectField("reporter", store.listUsers().map(u => ({ value: u.id, label: u.name })))));
    right.appendChild(metaRow("Start",    el("input", { type: "date", class: "input", style: { width: "100%" }, value: t.start_date || "", onchange: e => store.updateTask(t.id, { start_date: e.target.value || null })})));
    right.appendChild(metaRow("Due",      el("input", { type: "date", class: "input", style: { width: "100%" }, value: t.due_date || "", onchange: e => store.updateTask(t.id, { due_date: e.target.value || null })})));
    right.appendChild(metaRow("Completed",t.completed_date || "—", { note: "(auto)" }));
    right.appendChild(metaRow("Estimate", el("input", { class: "input", style: { width: "100%" }, value: t.estimate || "", placeholder: wf.estimation.enabled ? wf.estimation.unit_label : "—", onchange: e => store.updateTask(t.id, { estimate: e.target.value || null })})));
    right.appendChild(metaRow("Milestone",selectField("milestone", store.listMilestones().map(m => ({ value: m.key, label: m.label })))));
    right.appendChild(metaRow("Sprint",   selectField("sprint", store.listSprints().map(s => ({ value: s.key, label: `${s.label} (${s.state})` })))));

    // Labels
    const labelsCell = el("div", { class: "row", style: { flexWrap: "wrap", gap: "4px" }});
    t.labels.forEach(lk => labelsCell.appendChild(labelChip(lk, () => { t.labels = t.labels.filter(x => x !== lk); store.updateTask(t.id, {}); })));
    labelsCell.appendChild(el("button", { class: "btn btn--ghost btn--sm", onclick: () => {
      const choices = store.listLabels().filter(l => !t.labels.includes(l.key)).map(l => l.label + " (" + l.key + ")").join("\n");
      const k = prompt("Label key to add (available: " + store.listLabels().filter(l => !t.labels.includes(l.key)).map(l => l.key).join(", ") + ")");
      if (k && store.getLabel(k.trim())) { t.labels.push(k.trim()); store.updateTask(t.id, {}); }
    }}, "+"));
    right.appendChild(metaRow("Labels", labelsCell));

    // Custom fields
    wf.custom_fields.forEach(cf => {
      const val = (t.fields || {})[cf.key];
      let widget;
      if (cf.type === "enum") {
        widget = el("select", { class: "select", style: { width: "100%" }, onchange: e => { t.fields = t.fields || {}; t.fields[cf.key] = e.target.value || null; store.updateTask(t.id, {}); }});
        widget.appendChild(el("option", { value: "" }, "—"));
        (cf.values || []).forEach(v => widget.appendChild(el("option", Object.assign({ value: v.key }, val === v.key ? { selected: "" } : {}), v.label)));
      } else if (cf.type === "number") {
        widget = el("input", { type: "number", class: "input", style: { width: "100%" }, value: val || "", onchange: e => { t.fields = t.fields || {}; t.fields[cf.key] = e.target.value ? Number(e.target.value) : null; store.updateTask(t.id, {}); }});
      } else {
        widget = el("input", { class: "input", style: { width: "100%" }, value: val || "", onchange: e => { t.fields = t.fields || {}; t.fields[cf.key] = e.target.value || null; store.updateTask(t.id, {}); }});
      }
      right.appendChild(metaRow(cf.label, widget));
    });

    // Footer meta
    right.appendChild(el("div", { style: { fontSize: "11px", color: "var(--text-tertiary)", paddingTop: "8px" }},
      el("div", null, `Created ${relTime(t.created_at)}`),
      el("div", null, `Updated ${relTime(t.updated_at)}`),
      t.key_history && t.key_history.length ? el("div", null, "Key history: " + t.key_history.join(" → ") + " → " + t.key) : null,
    ));

    grid.appendChild(left);
    grid.appendChild(right);
    root.appendChild(grid);
  }

  function section(title, content) {
    const wrap = el("div", { class: "col", style: { gap: "8px" }});
    wrap.appendChild(el("div", { style: { fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-tertiary)" }}, title));
    if (content) wrap.appendChild(content);
    return wrap;
  }

  function guessMime(name) {
    const ext = name.split(".").pop().toLowerCase();
    return { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
      pdf: "application/pdf", mp4: "video/mp4", mp3: "audio/mpeg",
      txt: "text/plain", md: "text/markdown" }[ext] || "application/octet-stream";
  }

  function openLinkPicker(task) {
    const wf = store.workflow();
    const type = prompt("Relationship type (e.g. " + wf.relationships.map(r => r.key).join(", ") + ")", "relates_to");
    if (!type || !findRel(type)) return alert("Unknown relationship type.");
    const target = prompt("Target task key (e.g. WEB-127):");
    if (!target) return;
    const tgt = store.getTask(target.toUpperCase()) || store.getTask(target);
    if (!tgt) return alert("Target not found.");
    store.linkTasks(task.id, type, tgt.id);
  }

  // ===================================================================
  //  BOARD VIEW
  // ===================================================================
  function renderBoard() {
    renderShell();
    const root = mount("[data-tt-mount='board-view']");
    if (!root) return;
    clear(root);
    const wf = store.workflow();

    // Status filter chips (replaces "Hide discarded" toggle per D13)
    const visibleStatuses = JSON.parse(localStorage.getItem("tt-board-visible-statuses") || "null") || wf.statuses.filter(s => s.category !== "discarded").map(s => s.key);
    function persistVis() { localStorage.setItem("tt-board-visible-statuses", JSON.stringify(visibleStatuses)); }

    const chipBar = el("div", { class: "row", style: { flexWrap: "wrap", gap: "6px", marginBottom: "12px" }});
    chipBar.appendChild(el("span", { style: { fontSize: "12px", color: "var(--text-secondary)", marginRight: "4px" }}, "Show statuses:"));
    wf.statuses.forEach(s => {
      const on = visibleStatuses.includes(s.key);
      chipBar.appendChild(el("button", {
        class: "chip " + (on ? "chip--accent" : ""),
        style: { cursor: "pointer", opacity: on ? "1" : "0.5" },
        onclick: () => {
          const i = visibleStatuses.indexOf(s.key);
          if (i >= 0) visibleStatuses.splice(i, 1); else visibleStatuses.push(s.key);
          persistVis(); renderBoard();
        },
      }, s.label));
    });
    root.appendChild(chipBar);

    const board = el("div", { style: { display: "flex", gap: "12px", overflowX: "auto", paddingBottom: "12px", alignItems: "flex-start" }});
    const tasks = store.listTasks();
    const cols = (wf.boards && wf.boards.columns && wf.boards.columns.length)
      ? wf.boards.columns
      : wf.statuses.map(s => ({ key: s.key, label: s.label, statuses: [s.key], wip: null }));
    cols.forEach(col => {
      if (!col.statuses.some(s => visibleStatuses.includes(s))) return;
      const colTasks = tasks.filter(t => col.statuses.includes(t.status)).sort((a, b) => (a.board_rank || "").localeCompare(b.board_rank || ""));
      const colEl = el("div", { class: "board-col", style: { background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: "10px", minWidth: "260px", flex: "0 0 260px" }, "data-col": col.key });
      const header = el("div", { class: "row", style: { marginBottom: "8px" }},
        el("span", { style: { fontWeight: "600", fontSize: "13px", flex: "1" }}, col.label),
        col.wip ? el("span", { class: "wip-indicator " + (colTasks.length > col.wip ? "wip-indicator--over" : "wip-indicator--ok") }, `${colTasks.length}/${col.wip}`) : el("span", { class: "wip-indicator wip-indicator--ok" }, colTasks.length),
      );
      colEl.appendChild(header);
      const list = el("div", { class: "col", style: { gap: "8px", minHeight: "40px" }, ondragover: (e) => { e.preventDefault(); list.style.background = "var(--accent-muted)"; }, ondragleave: () => { list.style.background = ""; }, ondrop: (e) => {
        e.preventDefault();
        list.style.background = "";
        const id = e.dataTransfer.getData("text/plain");
        if (id) store.updateTask(id, { status: col.statuses[0] });
      }});
      colTasks.forEach(t => list.appendChild(renderBoardCard(t)));
      colEl.appendChild(list);
      // Inline add
      colEl.appendChild(el("button", { class: "btn btn--ghost btn--sm", style: { width: "100%", marginTop: "8px" }, onclick: () => {
        const title = prompt(`New task in "${col.label}":`);
        if (!title) return;
        store.createTask({ title, status: col.statuses[0] });
      }}, "+ Add task"));
      board.appendChild(colEl);
    });
    root.appendChild(board);
  }

  function renderBoardCard(t) {
    const card = el("div", {
      class: "board-card", draggable: "true",
      style: { background: "var(--bg-surface-raised)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", padding: "10px", cursor: "grab" },
      ondragstart: (e) => { e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "move"; },
      ondblclick: () => { window.location.href = `task-detail.html?id=${t.id}`; },
    });
    card.appendChild(el("div", { style: { fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "ui-monospace, monospace" }}, t.key));
    card.appendChild(el("div", { style: { fontSize: "13px", fontWeight: "500", margin: "4px 0", lineHeight: "1.35" }}, t.title));
    if (t.labels.length) {
      const labels = el("div", { style: { display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "6px" }});
      t.labels.forEach(l => labels.appendChild(labelChip(l)));
      card.appendChild(labels);
    }
    const footer = el("div", { class: "row", style: { marginTop: "8px", gap: "6px" }});
    footer.appendChild(priorityChip(t.priority));
    footer.appendChild(el("div", { style: { flex: "1" }}));
    if (t.assignee) footer.appendChild(avatarFor(store.getUser(t.assignee)));
    card.appendChild(footer);
    return card;
  }

  // ===================================================================
  //  TIMELINE VIEW
  // ===================================================================
  function renderTimeline() {
    renderShell();
    const root = mount("[data-tt-mount='timeline-view']");
    if (!root) return;
    clear(root);
    const tasks = store.listTasks().filter(t => t.start_date || t.due_date);
    const wf = store.workflow();

    // Date axis: 28 days starting from min(start)-1 day
    const startISO = tasks.reduce((min, t) => {
      const d = t.start_date || t.due_date; return !min || d < min ? d : min;
    }, null) || todayYMD();
    const start = new Date(startISO); start.setDate(start.getDate() - 1);
    const days = 28;
    const axis = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      axis.push(d);
    }
    const colWidth = 36;
    const labelWidth = 240;
    const today = new Date(); today.setHours(0,0,0,0);

    const wrap = el("div", { style: { background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", overflowX: "auto" }});
    const inner = el("div", { style: { minWidth: (labelWidth + colWidth * days) + "px" }});
    // Axis header
    const axisRow = el("div", { style: { display: "flex", borderBottom: "1px solid var(--border-subtle)", position: "sticky", top: "0", background: "var(--bg-surface)", zIndex: "2" }});
    axisRow.appendChild(el("div", { style: { width: labelWidth + "px", flex: "0 0 " + labelWidth + "px", padding: "8px 12px", fontWeight: "600", fontSize: "12px" }}, "Task"));
    axis.forEach(d => {
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const isToday = d.toISOString().slice(0,10) === today.toISOString().slice(0,10);
      axisRow.appendChild(el("div", {
        style: { width: colWidth + "px", flex: "0 0 " + colWidth + "px", textAlign: "center", padding: "6px 0", fontSize: "11px",
          background: isWeekend ? "var(--bg-muted)" : "", color: isToday ? "var(--accent)" : (isWeekend ? "var(--text-tertiary)" : "var(--text-secondary)"),
          fontWeight: isToday ? "700" : "500", borderLeft: "1px solid var(--border-subtle)" }
      }, ["S","M","T","W","T","F","S"][d.getDay()], el("br"), String(d.getDate())));
    });
    inner.appendChild(axisRow);

    // Rows
    tasks.forEach(t => {
      const row = el("div", { style: { display: "flex", borderBottom: "1px solid var(--border-subtle)", position: "relative" }});
      row.appendChild(el("div", { style: { width: labelWidth + "px", flex: "0 0 " + labelWidth + "px", padding: "8px 12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }},
        el("span", { style: { fontFamily: "ui-monospace, monospace", color: "var(--text-tertiary)", fontSize: "11px", marginRight: "6px" }}, t.key),
        el("a", { href: `task-detail.html?id=${t.id}`, style: { color: "inherit" }}, t.title)
      ));
      // Track
      const track = el("div", { style: { display: "flex", flex: "1", position: "relative", minHeight: "32px" }});
      axis.forEach(d => {
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        track.appendChild(el("div", { style: { width: colWidth + "px", flex: "0 0 " + colWidth + "px", background: isWeekend ? "var(--bg-muted)" : "", borderLeft: "1px solid var(--border-subtle)" }}));
      });
      // Bar
      const startDateRaw = t.start_date || t.due_date;
      const endDateRaw = t.due_date || t.start_date;
      const startIdx = Math.floor((new Date(startDateRaw) - start) / (86400000));
      const endIdx = Math.floor((new Date(endDateRaw) - start) / (86400000));
      if (startIdx >= 0 && startIdx < days) {
        const isPoint = !t.start_date || !t.due_date || startIdx === endIdx;
        const s = findStatus(t.status) || {};
        const barColor = s.category === "completed" ? "var(--status-completed-fg)" : s.category === "discarded" ? "var(--text-tertiary)" : s.category === "active" ? "var(--accent)" : "var(--border-strong)";
        if (isPoint) {
          const point = el("div", { style: { position: "absolute", left: (startIdx * colWidth + colWidth / 2 - 6) + "px", top: "10px", width: "12px", height: "12px", background: barColor, transform: "rotate(45deg)", borderRadius: "2px" }, title: `${t.key} · ${endDateRaw}` });
          track.appendChild(point);
        } else {
          const w = (endIdx - startIdx + 1) * colWidth;
          const bar = el("div", { style: { position: "absolute", left: (startIdx * colWidth) + "px", width: w + "px", top: "6px", height: "20px", background: barColor, color: "white", fontSize: "11px", borderRadius: "var(--radius-sm)", padding: "0 6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "grab" }, title: `${t.start_date} → ${t.due_date}` }, t.title);
          track.appendChild(bar);
        }
      }
      row.appendChild(track);
      inner.appendChild(row);
    });
    // Today vertical line
    const todayIdx = Math.floor((today - start) / 86400000);
    if (todayIdx >= 0 && todayIdx < days) {
      inner.appendChild(el("div", { style: { position: "absolute", left: (labelWidth + todayIdx * colWidth + colWidth / 2) + "px", top: "0", bottom: "0", width: "2px", background: "var(--accent)", pointerEvents: "none" }}));
    }
    inner.style.position = "relative";
    wrap.appendChild(inner);
    root.appendChild(wrap);
  }

  // ===================================================================
  //  SETTINGS VIEWS (renders panels into placeholders)
  // ===================================================================
  function renderSettings() {
    renderShell();
    const root = mount("[data-tt-mount='settings-view']");
    if (!root) return;
    clear(root);

    const hash = window.location.hash.slice(1) || "projects";

    // Nav
    const navWrap = el("div", { style: { display: "grid", gridTemplateColumns: "220px 1fr", gap: "24px" }});
    const nav = el("div", { style: { display: "flex", flexDirection: "column", gap: "16px", position: "sticky", top: "12px", alignSelf: "start" }});
    const groups = [
      ["Workspace", [["projects", "Projects"], ["users", "Users"], ["general", "General"], ["calendar", "Calendar"]]],
      ["Workflow", [["statuses","Statuses"],["priorities","Priorities"],["types","Task types"],["relationships","Relationships"],["custom-fields","Custom fields"],["estimation","Estimation"],["board-columns","Board columns"],["timeline-defaults","Timeline"]]],
      ["Data", [["labels", "Labels"], ["milestones", "Milestones"], ["sprints", "Sprints"], ["views", "Saved views"]]],
      ["Tracker", [["sync", "Sync"], ["doctor", "Doctor"]]],
      ["Personal", [["preferences", "My preferences"], ["card-layout", "Card layout"], ["sidebar-pins", "Sidebar pins"], ["keyboard", "Keyboard"]]],
    ];
    groups.forEach(([gname, items]) => {
      const g = el("div", { class: "col", style: { gap: "2px" }});
      g.appendChild(el("div", { style: { fontSize: "11px", textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: "600", letterSpacing: "0.06em", padding: "6px 10px 2px" }}, gname));
      items.forEach(([h, l]) => g.appendChild(el("a", { class: "sidebar__item" + (h === hash ? " is-active" : ""), href: "#" + h, onclick: (e) => { setTimeout(renderSettings, 0); }}, l)));
      nav.appendChild(g);
    });
    navWrap.appendChild(nav);

    const panel = el("div", { class: "col", style: { gap: "16px" }});
    switch (hash) {
      case "projects":     renderProjectsPanel(panel); break;
      case "users":        renderUsersPanel(panel); break;
      case "statuses":     renderEntityPanel(panel, "statuses", "Statuses", "Drag to reorder. Click a swatch or icon to change it."); break;
      case "priorities":   renderPrioritiesPanel(panel); break;
      case "types":        renderEntityPanel(panel, "task_types", "Task types", "Categorise tasks (Bug, Feature, Task, etc.)."); break;
      case "relationships":renderRelationshipsPanel(panel); break;
      case "custom-fields":renderCustomFieldsPanel(panel); break;
      case "estimation":   renderEstimationPanel(panel); break;
      case "calendar":     renderCalendarPanel(panel); break;
      case "labels":       renderLabelsPanel(panel); break;
      case "milestones":   renderMilestonesPanel(panel); break;
      case "sprints":      renderSprintsPanel(panel); break;
      case "views":        renderViewsPanel(panel); break;
      case "general":      renderGeneralPanel(panel); break;
      case "board-columns":renderBoardColumnsPanel(panel); break;
      case "timeline-defaults": renderTimelinePanel(panel); break;
      case "sync":         renderSyncPanel(panel); break;
      case "doctor":       renderDoctorPanel(panel); break;
      case "preferences":  renderPreferencesPanel(panel); break;
      case "card-layout":  renderCardLayoutPanel(panel); break;
      case "sidebar-pins": renderSidebarPinsPanel(panel); break;
      case "keyboard":     renderKeyboardPanel(panel); break;
      default:             renderProjectsPanel(panel);
    }
    navWrap.appendChild(panel);
    root.appendChild(navWrap);
  }

  function panelHeader(title, subtitle, actions) {
    return el("div", { class: "row", style: { paddingBottom: "12px", borderBottom: "1px solid var(--border-subtle)" }},
      el("div", { style: { flex: "1" }},
        el("h2", { style: { margin: "0 0 4px", fontSize: "18px", fontWeight: "600" }}, title),
        subtitle ? el("div", { style: { fontSize: "12px", color: "var(--text-secondary)" }}, subtitle) : null,
      ),
      actions ? el("div", { class: "row" }, ...actions) : null,
    );
  }

  function renderProjectsPanel(panel) {
    let showArch = false;
    function rerender() {
      clear(panel);
      panel.appendChild(panelHeader("Projects", "Each project has its own prefix and key counter.", [
        el("label", { class: "chk" }, el("input", { type: "checkbox", checked: showArch, onchange: e => { showArch = e.target.checked; rerender(); }}), el("span", { class: "chk__box" }), " Show archived"),
        el("button", { class: "btn btn--secondary", onclick: () => {
          const key = prompt("Project key (slug, immutable):");
          if (!key) return;
          const prefix = prompt("Prefix (immutable, e.g. WEB-):");
          if (!prefix) return;
          const label = prompt("Display label:", key) || key;
          store.createProject({ key, prefix, label });
        }}, "+ New project"),
      ]));
      const tasks = store.listTasks();
      store.listProjects(showArch).forEach(p => {
        const count = tasks.filter(t => t.project === p.key).length;
        const row = el("div", { class: "row", style: { padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }},
          el("span", { style: { fontWeight: "500", flex: "0 0 auto" }}, p.label, p.default ? el("span", { style: { color: "var(--accent)", marginLeft: "6px" }}, "★") : null),
          el("span", { class: "chip" }, `key: ${p.key}`),
          el("span", { class: "chip" }, `prefix: ${p.prefix}`),
          el("span", { class: "chip" }, `next: ${p.prefix}${p.next_number}`),
          el("div", { style: { flex: "1" }}),
          el("span", { style: { color: "var(--text-tertiary)", fontSize: "12px" }}, `${count} tasks`),
          el("button", { class: "btn btn--ghost btn--sm", onclick: () => store.setDefaultProject(p.key) }, "Set default"),
          el("button", { class: "btn btn--ghost btn--sm", onclick: () => { const lbl = prompt("New label:", p.label); if (lbl) store.updateProject(p.key, { label: lbl }); }}, "Edit"),
          el("button", { class: "btn btn--ghost btn--sm", onclick: () => store.updateProject(p.key, { archived: !p.archived })}, p.archived ? "Unarchive" : "Archive"),
          el("button", { class: "btn btn--ghost btn--sm", style: { color: "var(--feedback-danger-fg)" }, onclick: () => {
            if (count > 0) {
              const remap = prompt(`This project has ${count} task(s). Remap to project key (or cancel):`);
              if (!remap) return;
              store.deleteProject(p.key, remap);
            } else {
              if (confirm("Delete this project?")) store.deleteProject(p.key);
            }
          }}, "Delete"),
        );
        panel.appendChild(row);
      });
    }
    rerender();
  }

  function renderUsersPanel(panel) {
    let showArch = false;
    function rerender() {
      clear(panel);
      panel.appendChild(panelHeader("Users", "Tracked users. Each user has a profile, optional avatar, and gitignored UI preferences.", [
        el("label", { class: "chk" }, el("input", { type: "checkbox", checked: showArch, onchange: e => { showArch = e.target.checked; rerender(); }}), el("span", { class: "chk__box" }), " Show archived"),
        el("button", { class: "btn btn--secondary", onclick: () => {
          const name = prompt("Name:");
          if (!name) return;
          const email = prompt("Email (optional):");
          const tz = prompt("Timezone:", "Asia/Singapore");
          store.createUser({ name, email, timezone: tz });
        }}, "+ Add user"),
      ]));
      const me = store.currentUser();
      store.listUsers(showArch).forEach(u => {
        const initials = u.name.split(/\s+/).slice(0,2).map(w=>w[0]).join("").toUpperCase();
        const isActive = me && me.id === u.id;
        const row = el("div", { class: "row", style: { padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }},
          el("span", { class: "avatar" }, initials),
          el("span", { style: { fontWeight: "500" }}, u.name),
          el("span", { class: "chip" }, u.email || "—"),
          el("span", { class: "chip" }, u.timezone),
          isActive ? el("span", { class: "chip chip--accent" }, "active") : null,
          el("div", { style: { flex: "1" }}),
          !isActive ? el("button", { class: "btn btn--ghost btn--sm", onclick: () => store.switchUser(u.id) }, "Switch to") : null,
          el("button", { class: "btn btn--ghost btn--sm", onclick: () => {
            const n = prompt("Name:", u.name);
            if (!n) return;
            store.updateUser(u.id, { name: n });
          }}, "Edit"),
          el("button", { class: "btn btn--ghost btn--sm", disabled: isActive ? "" : null, onclick: () => store.updateUser(u.id, { archived: !u.archived })}, u.archived ? "Unarchive" : "Archive"),
          el("button", { class: "btn btn--ghost btn--sm", disabled: isActive ? "" : null, style: { color: "var(--feedback-danger-fg)" }, onclick: () => {
            const refs = store.listTasks().filter(t => t.assignee === u.id || t.reporter === u.id).length;
            if (refs > 0) {
              const choice = prompt(`${refs} task(s) reference this user. Enter remap user id, "unassign", or cancel:`);
              if (!choice) return;
              if (choice === "unassign") store.deleteUser(u.id, { unassign: true });
              else store.deleteUser(u.id, { remapTo: choice });
            } else if (confirm("Delete user?")) store.deleteUser(u.id);
          }}, "Delete"),
        );
        panel.appendChild(row);
      });
    }
    rerender();
  }

  function renderEntityPanel(panel, kind, title, subtitle) {
    // generic CRUD list for statuses/types
    function rerender() {
      clear(panel);
      const wf = store.workflow();
      const items = wf[kind];
      const upsertFn = kind === "statuses" ? store.upsertStatus : store.upsertTaskType;
      const deleteFn = kind === "statuses" ? store.deleteStatus : store.deleteTaskType;
      const reorderFn = kind === "statuses" ? store.reorderStatuses : store.reorderTaskTypes;
      panel.appendChild(panelHeader(title, subtitle, [
        el("button", { class: "btn btn--secondary", onclick: () => {
          const key = prompt("Key (slug, immutable):");
          if (!key) return;
          const label = prompt("Label:", key) || key;
          const def = { key, label, color: "#94a3b8" };
          if (kind === "statuses") def.category = prompt("Category (pending/active/completed/discarded):", "pending");
          upsertFn(def);
        }}, "+ Add"),
      ]));
      items.forEach((item, idx) => {
        const row = el("div", { class: "row", style: { padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }},
          el("span", { style: { color: "var(--text-tertiary)", cursor: "grab" }, draggable: "true", ondragstart: (e) => { e.dataTransfer.setData("text/plain", item.key); }}, "⋮⋮"),
          el("span", { style: { width: "16px", height: "16px", borderRadius: "4px", background: item.color || "#94a3b8" }}),
          el("span", { style: { fontWeight: "500" }}, item.label),
          el("span", { class: "chip" }, `key: ${item.key}`),
          item.category ? el("span", { class: "chip" }, `category: ${item.category}`) : null,
          el("div", { style: { flex: "1" }}),
          el("button", { class: "btn btn--ghost btn--sm", onclick: () => {
            const newLabel = prompt("Label:", item.label);
            if (newLabel == null) return;
            const newColor = prompt("Color (hex):", item.color || "#94a3b8");
            upsertFn({ ...item, label: newLabel, color: newColor }, item.key);
          }}, "Edit"),
          el("button", { class: "btn btn--ghost btn--sm", style: { color: "var(--feedback-danger-fg)" }, onclick: () => {
            if (confirm(`Delete "${item.label}"? Tasks referencing it will need remap (mockup just deletes).`)) deleteFn(item.key);
          }}, "Delete"),
        );
        row.ondragover = (e) => { e.preventDefault(); row.style.borderTop = "2px solid var(--accent)"; };
        row.ondragleave = () => { row.style.borderTop = ""; };
        row.ondrop = (e) => {
          e.preventDefault();
          row.style.borderTop = "";
          const movedKey = e.dataTransfer.getData("text/plain");
          if (movedKey === item.key) return;
          const order = items.map(x => x.key).filter(k => k !== movedKey);
          const targetIdx = order.indexOf(item.key);
          order.splice(targetIdx, 0, movedKey);
          reorderFn(order);
        };
        panel.appendChild(row);
      });
    }
    rerender();
  }

  function renderPrioritiesPanel(panel) {
    function rerender() {
      clear(panel);
      const items = store.workflow().priorities;
      panel.appendChild(panelHeader("Priorities", "Drag to reorder. Top = highest priority. Numeric weight recomputed on save.", [
        el("button", { class: "btn btn--secondary", onclick: () => {
          const key = prompt("Key:");
          if (!key) return;
          const label = prompt("Label:", key) || key;
          store.upsertPriority({ key, label, color: "#94a3b8" });
        }}, "+ Add"),
      ]));
      items.forEach(item => {
        const row = el("div", { class: "row", style: { padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }},
          el("span", { style: { color: "var(--text-tertiary)", cursor: "grab" }, draggable: "true", ondragstart: (e) => { e.dataTransfer.setData("text/plain", item.key); }}, "⋮⋮"),
          el("span", { style: { width: "16px", height: "16px", borderRadius: "4px", background: item.color || "#94a3b8" }}),
          el("span", { style: { fontWeight: "500" }}, item.label),
          el("span", { class: "chip" }, `key: ${item.key}`),
          el("div", { style: { flex: "1" }}),
          el("button", { class: "btn btn--ghost btn--sm", onclick: () => {
            const l = prompt("Label:", item.label); if (l == null) return;
            const c = prompt("Color:", item.color);
            store.upsertPriority({ ...item, label: l, color: c }, item.key);
          }}, "Edit"),
          el("button", { class: "btn btn--ghost btn--sm", style: { color: "var(--feedback-danger-fg)" }, onclick: () => { if (confirm("Delete?")) store.deletePriority(item.key); }}, "Delete"),
        );
        row.ondragover = (e) => { e.preventDefault(); row.style.borderTop = "2px solid var(--accent)"; };
        row.ondragleave = () => { row.style.borderTop = ""; };
        row.ondrop = (e) => {
          e.preventDefault();
          row.style.borderTop = "";
          const movedKey = e.dataTransfer.getData("text/plain");
          if (movedKey === item.key) return;
          const order = items.map(x => x.key).filter(k => k !== movedKey);
          const targetIdx = order.indexOf(item.key);
          order.splice(targetIdx, 0, movedKey);
          store.reorderPriorities(order);
        };
        panel.appendChild(row);
      });
    }
    rerender();
  }

  function renderRelationshipsPanel(panel) {
    function rerender() {
      clear(panel);
      const items = store.workflow().relationships;
      panel.appendChild(panelHeader("Relationship types", "Forward/inverse pairs. Structural = cycle-protected. Ranked = drag-reorder of targets within a task.", [
        el("button", { class: "btn btn--secondary", onclick: () => {
          const key = prompt("Forward key (e.g. depends_on):");
          if (!key) return;
          const label = prompt("Forward label:", key) || key;
          const inv = prompt("Inverse key:", "is_" + key + "_by") || "inverse_" + key;
          const invLabel = prompt("Inverse label:", "Is " + key + " by") || inv;
          const ranked = confirm("Ranked? (OK = yes)");
          const structural = confirm("Structural (cycle-protected)? (OK = yes)");
          store.upsertRelationship({ key, label, inverse: inv, inverse_label: invLabel, ranked, structural });
        }}, "+ Add"),
      ]));
      items.forEach(r => {
        const isTimelineDep = store.workflow().timeline.dependency_relationship === r.key;
        const row = el("div", { class: "row", style: { padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }},
          el("span", { style: { color: "var(--text-tertiary)" }}, "⋮⋮"),
          el("span", { style: { fontWeight: "500" }}, r.label),
          el("span", { style: { color: "var(--text-tertiary)" }}, "↔"),
          el("span", { style: { fontWeight: "500" }}, r.inverse_label),
          r.ranked ? el("span", { class: "chip" }, "ranked") : null,
          r.structural ? el("span", { class: "chip" }, "structural") : null,
          isTimelineDep ? el("span", { class: "chip chip--accent" }, "timeline arrows") : null,
          el("div", { style: { flex: "1" }}),
          el("button", { class: "btn btn--ghost btn--sm", onclick: () => {
            const label = prompt("Forward label:", r.label); if (label == null) return;
            const invLabel = prompt("Inverse label:", r.inverse_label); if (invLabel == null) return;
            const ranked = confirm("Ranked?");
            const structural = confirm("Structural?");
            store.upsertRelationship({ ...r, label, inverse_label: invLabel, ranked, structural }, r.key);
          }}, "Edit"),
          el("button", { class: "btn btn--ghost btn--sm", style: { color: "var(--feedback-danger-fg)" }, onclick: () => { if (confirm("Delete?")) store.deleteRelationship(r.key); }}, "Delete"),
        );
        panel.appendChild(row);
      });
    }
    rerender();
  }

  function renderCustomFieldsPanel(panel) {
    function rerender() {
      clear(panel);
      const items = store.workflow().custom_fields;
      const tasks = store.listTasks();
      panel.appendChild(panelHeader("Custom fields", "Project-specific fields. Type is locked after creation.", [
        el("button", { class: "btn btn--secondary", onclick: () => {
          const key = prompt("Key:");
          if (!key) return;
          const label = prompt("Label:", key) || key;
          const type = prompt("Type (string/number/date/boolean/enum):", "string");
          const multi = confirm("Multi-value?");
          const searchable = confirm("Searchable (text search)?");
          const def = { key, label, type, multi, searchable };
          if (type === "enum") {
            const values = prompt("Enum values (comma-separated keys):", "low,medium,high").split(",").map(v => ({ key: v.trim(), label: v.trim() }));
            def.values = values;
          }
          store.upsertCustomField(def);
        }}, "+ Add"),
      ]));
      items.forEach(f => {
        const count = tasks.filter(t => t.fields && t.fields[f.key] != null).length;
        const row = el("div", { class: "row", style: { padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }},
          el("span", { style: { color: "var(--text-tertiary)" }}, "⋮⋮"),
          el("span", { style: { fontWeight: "500" }}, f.label),
          el("span", { class: "chip" }, `key: ${f.key}`),
          el("span", { class: "chip" }, f.type),
          f.multi ? el("span", { class: "chip" }, "multi") : null,
          f.searchable ? el("span", { class: "chip" }, "searchable") : null,
          f.values ? el("span", { class: "chip" }, `${f.values.length} values`) : null,
          el("div", { style: { flex: "1" }}),
          el("span", { style: { color: "var(--text-tertiary)", fontSize: "12px" }}, `${count} tasks`),
          el("button", { class: "btn btn--ghost btn--sm", onclick: () => {
            const label = prompt("Label:", f.label); if (label == null) return;
            const multi = confirm("Multi-value?");
            const searchable = confirm("Searchable?");
            store.upsertCustomField({ ...f, label, multi, searchable }, f.key);
          }}, "Edit"),
          el("button", { class: "btn btn--ghost btn--sm", style: { color: "var(--feedback-danger-fg)" }, onclick: () => { if (confirm("Delete? Values on all tasks will be removed.")) store.deleteCustomField(f.key); }}, "Delete"),
        );
        panel.appendChild(row);
      });
    }
    rerender();
  }

  function renderEstimationPanel(panel) {
    function rerender() {
      clear(panel);
      const e = store.workflow().estimation;
      panel.appendChild(panelHeader("Estimation", "Display-only. Estimates don't drive timeline or duration math.", null));
      function row(label, value, hint) {
        panel.appendChild(el("div", { style: { padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }},
          el("div", { class: "row" }, el("span", { style: { width: "180px", fontSize: "12px", color: "var(--text-secondary)", fontWeight: "500" }}, label), value),
          hint ? el("div", { style: { fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px", marginLeft: "180px" }}, hint) : null,
        ));
      }
      row("Enable estimates", el("label", { class: "chk" }, el("input", { type: "checkbox", checked: e.enabled, onchange: ev => store.updateWorkflow({ estimation: { ...e, enabled: ev.target.checked }}) }), el("span", { class: "chk__box" })), "Hides the estimate field across the app when off.");
      row("Unit", el("select", { class: "select", onchange: ev => store.updateWorkflow({ estimation: { ...e, unit: ev.target.value }})},
        ...["points","hours","days","custom_numeric","custom_enum"].map(u => el("option", Object.assign({ value: u }, e.unit === u ? { selected: "" } : {}), u))
      ), "Numeric units sum across tasks. custom_enum is categorical.");
      row("Unit label", el("input", { class: "input", value: e.unit_label || "", onchange: ev => store.updateWorkflow({ estimation: { ...e, unit_label: ev.target.value }})}));
      row("Scale", el("select", { class: "select", onchange: ev => store.updateWorkflow({ estimation: { ...e, scale: ev.target.value }})},
        ...["free","linear","fibonacci"].map(s => el("option", Object.assign({ value: s }, e.scale === s ? { selected: "" } : {}), s))
      ));
      row("Preset values", el("input", { class: "input", value: (e.preset_values || []).join(", "), onchange: ev => store.updateWorkflow({ estimation: { ...e, preset_values: ev.target.value.split(",").map(s => s.trim()).filter(Boolean) }})}));

      // Weights sub-table (only for custom_enum)
      if (e.unit === "custom_enum") {
        panel.appendChild(el("div", { style: { padding: "12px 0" }},
          el("div", { style: { fontWeight: "500", marginBottom: "8px" }}, "Weights"),
          el("div", { style: { fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "8px" }}, "Optional numeric weights per enum value. When present, burndown sums weights instead of counts."),
          ...(e.preset_values || []).map(pv => el("div", { class: "row", style: { padding: "4px 0" }},
            el("span", { style: { width: "120px" }}, pv),
            el("input", { type: "number", class: "input", style: { width: "100px" }, value: (e.weights && e.weights[pv]) || "", onchange: ev => {
              const weights = Object.assign({}, e.weights);
              if (ev.target.value === "") delete weights[pv]; else weights[pv] = Number(ev.target.value);
              store.updateWorkflow({ estimation: { ...e, weights }});
            }}),
          ))
        ));
      }
    }
    rerender();
  }

  function renderCalendarPanel(panel) {
    function rerender() {
      clear(panel);
      const c = store.calendar();
      panel.appendChild(panelHeader("Calendar", "Working days + holidays shade the Timeline.", null));
      // Timezone
      panel.appendChild(el("div", { style: { padding: "10px 0" }},
        el("div", { class: "row" }, el("span", { style: { width: "180px" }}, "Timezone"),
          el("input", { class: "input", value: c.timezone, onchange: ev => store.updateCalendar({ timezone: ev.target.value })}),
        ),
      ));
      // First day of week
      panel.appendChild(el("div", { style: { padding: "10px 0", borderTop: "1px solid var(--border-subtle)" }},
        el("div", { class: "row" }, el("span", { style: { width: "180px" }}, "First day of week"),
          el("select", { class: "select", onchange: ev => store.updateCalendar({ first_day_of_week: Number(ev.target.value) })},
            ...["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((d, i) => el("option", Object.assign({ value: i }, c.first_day_of_week === i ? { selected: "" } : {}), d))
          ),
        ),
      ));
      // Working days
      const wd = el("div", { class: "row", style: { gap: "4px" }});
      ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].forEach((d, i) => {
        const on = c.working_days.includes(i);
        wd.appendChild(el("button", { class: "btn " + (on ? "btn--primary" : "btn--secondary") + " btn--sm", onclick: () => {
          const days = on ? c.working_days.filter(x => x !== i) : c.working_days.concat(i).sort();
          store.updateCalendar({ working_days: days });
        }}, d));
      });
      panel.appendChild(el("div", { style: { padding: "10px 0", borderTop: "1px solid var(--border-subtle)" }},
        el("div", { class: "row" }, el("span", { style: { width: "180px" }}, "Working days"), wd),
      ));
      // Holidays
      panel.appendChild(el("div", { style: { padding: "10px 0", borderTop: "1px solid var(--border-subtle)" }},
        el("div", { class: "row" },
          el("span", { style: { width: "180px", fontWeight: "500" }}, "Holidays"),
          el("button", { class: "btn btn--secondary btn--sm", onclick: () => {
            const d = prompt("Date (YYYY-MM-DD):");
            if (!d) return;
            const l = prompt("Label:") || d;
            store.updateCalendar({ holidays: c.holidays.concat([{ date: d, label: l }]) });
          }}, "+ Add holiday"),
        ),
      ));
      c.holidays.forEach((h, i) => panel.appendChild(el("div", { class: "row", style: { padding: "4px 0 4px 180px" }},
        el("span", { style: { fontFamily: "ui-monospace, monospace" }}, h.date),
        el("span", null, h.label),
        el("button", { class: "btn btn--ghost btn--icon btn--sm", style: { marginLeft: "auto" }, onclick: () => store.updateCalendar({ holidays: c.holidays.filter((_, j) => j !== i) })}, "×"),
      )));
    }
    rerender();
  }

  function renderLabelsPanel(panel) {
    let showArch = false;
    function rerender() {
      clear(panel);
      const tasks = store.listTasks();
      panel.appendChild(panelHeader("Labels", "Label registry. Setting an unknown label fails — register here first (or from a task form).", [
        el("label", { class: "chk" }, el("input", { type: "checkbox", checked: showArch, onchange: e => { showArch = e.target.checked; rerender(); }}), el("span", { class: "chk__box" }), " Show archived"),
        el("button", { class: "btn btn--secondary", onclick: () => {
          const key = prompt("Key:");
          if (!key) return;
          const label = prompt("Label:", key) || key;
          const color = prompt("Color (hex):", "#3b82f6");
          store.createLabel({ key, label, color });
        }}, "+ Add label"),
      ]));
      store.listLabels(showArch).forEach(l => {
        const count = tasks.filter(t => t.labels.includes(l.key)).length;
        const row = el("div", { class: "row", style: { padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }, draggable: "true", ondragstart: e => { e.dataTransfer.setData("text/plain", l.key); }},
          el("span", { style: { color: "var(--text-tertiary)" }}, "⋮⋮"),
          el("span", { style: { width: "16px", height: "16px", borderRadius: "4px", background: l.color || "#94a3b8" }}),
          el("span", { style: { fontWeight: "500" }}, l.label),
          el("span", { class: "chip" }, `key: ${l.key}`),
          el("div", { style: { flex: "1" }}),
          el("span", { style: { color: "var(--text-tertiary)", fontSize: "12px" }}, `${count} tasks`),
          el("button", { class: "btn btn--ghost btn--sm", onclick: () => {
            const label = prompt("Label:", l.label); if (label == null) return;
            const color = prompt("Color:", l.color);
            store.updateLabel(l.key, { label, color });
          }}, "Edit"),
          el("button", { class: "btn btn--ghost btn--sm", onclick: () => store.updateLabel(l.key, { archived: !l.archived })}, l.archived ? "Unarchive" : "Archive"),
          el("button", { class: "btn btn--ghost btn--sm", style: { color: "var(--feedback-danger-fg)" }, onclick: () => {
            if (count > 0) { const remap = prompt(`${count} task(s) reference this label. Remap to (or cancel):`); if (!remap) return; store.deleteLabel(l.key, remap); }
            else if (confirm("Delete?")) store.deleteLabel(l.key);
          }}, "Delete"),
        );
        row.ondragover = e => { e.preventDefault(); row.style.borderTop = "2px solid var(--accent)"; };
        row.ondragleave = () => { row.style.borderTop = ""; };
        row.ondrop = e => { e.preventDefault(); row.style.borderTop = ""; const k = e.dataTransfer.getData("text/plain"); if (k && k !== l.key) store.reorderLabel(k, l.key); };
        panel.appendChild(row);
      });
    }
    rerender();
  }

  function renderMilestonesPanel(panel) {
    function rerender() {
      clear(panel);
      const tasks = store.listTasks();
      panel.appendChild(panelHeader("Milestones", "Target dates for groups of tasks.", [
        el("button", { class: "btn btn--secondary", onclick: () => {
          const key = prompt("Key:"); if (!key) return;
          const label = prompt("Label:", key) || key;
          const target = prompt("Target date (YYYY-MM-DD, optional):");
          store.createMilestone({ key, label, target_date: target || null });
        }}, "+ New milestone"),
      ]));
      store.listMilestones(true).forEach(m => {
        const count = tasks.filter(t => t.milestone === m.key).length;
        const row = el("div", { class: "row", style: { padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }},
          el("span", { style: { fontWeight: "500" }}, m.label),
          m.target_date ? el("span", { class: "chip" }, `target: ${m.target_date}`) : null,
          el("div", { style: { flex: "1" }}),
          el("span", { style: { color: "var(--text-tertiary)", fontSize: "12px" }}, `${count} tasks`),
          el("button", { class: "btn btn--ghost btn--sm", onclick: () => {
            const label = prompt("Label:", m.label); if (label == null) return;
            const target = prompt("Target date:", m.target_date || "");
            store.updateMilestone(m.key, { label, target_date: target || null });
          }}, "Edit"),
          el("button", { class: "btn btn--ghost btn--sm", style: { color: "var(--feedback-danger-fg)" }, onclick: () => {
            if (count > 0) { const remap = prompt(`${count} task(s) reference. Remap (or cancel):`); if (!remap) return; store.deleteMilestone(m.key, remap); }
            else if (confirm("Delete?")) store.deleteMilestone(m.key);
          }}, "Delete"),
        );
        panel.appendChild(row);
      });
    }
    rerender();
  }

  function renderSprintsPanel(panel) {
    function rerender() {
      clear(panel);
      const tasks = store.listTasks();
      panel.appendChild(panelHeader("Sprints", "Time-boxed work intervals.", [
        el("button", { class: "btn btn--secondary", onclick: () => {
          const key = prompt("Key (e.g. S-14):"); if (!key) return;
          const start = prompt("Start date (YYYY-MM-DD):"); if (!start) return;
          const end = prompt("End date (YYYY-MM-DD):"); if (!end) return;
          const goal = prompt("Goal (optional):");
          store.createSprint({ key, label: key, start_date: start, end_date: end, state: "future", goal });
        }}, "+ New sprint"),
      ]));
      store.listSprints(true).forEach(s => {
        const count = tasks.filter(t => t.sprint === s.key).length;
        const row = el("div", { class: "row", style: { padding: "10px 0", borderBottom: "1px solid var(--border-subtle)", opacity: s.state === "completed" ? "0.7" : "1" }},
          el("span", { style: { fontWeight: "500" }}, s.label),
          el("span", { class: "chip chip--" + (s.state === "active" ? "accent" : "") }, s.state),
          el("span", { class: "chip" }, `${s.start_date} → ${s.end_date}`),
          s.goal ? el("span", { style: { fontStyle: "italic", color: "var(--text-secondary)" }}, s.goal) : null,
          el("div", { style: { flex: "1" }}),
          el("span", { style: { color: "var(--text-tertiary)", fontSize: "12px" }}, `${count} tasks`),
          el("button", { class: "btn btn--ghost btn--sm", onclick: () => {
            const newState = prompt("State (active/future/completed):", s.state);
            store.updateSprint(s.key, { state: newState });
          }}, "Edit"),
          el("button", { class: "btn btn--ghost btn--sm", style: { color: "var(--feedback-danger-fg)" }, onclick: () => {
            if (count > 0) { const remap = prompt(`${count} task(s) reference. Remap (or cancel):`); if (!remap) return; store.deleteSprint(s.key, remap); }
            else if (confirm("Delete?")) store.deleteSprint(s.key);
          }}, "Delete"),
        );
        panel.appendChild(row);
      });

      // Burndown placeholder
      panel.appendChild(el("div", { style: { marginTop: "24px", padding: "16px", background: "var(--bg-muted)", border: "1px dashed var(--border-default)", borderRadius: "var(--radius-md)", textAlign: "center", color: "var(--text-tertiary)", fontSize: "12px" }}, "📉 Burndown chart placeholder · resolved at request time from history."));
    }
    rerender();
  }

  function renderViewsPanel(panel) {
    function rerender() {
      clear(panel);
      panel.appendChild(panelHeader("Saved views", "Workspace-shared filters from queries.yaml. Renaming display name doesn't break sidebar pins.", [
        el("button", { class: "btn btn--secondary", onclick: () => openSavedViewEditor(null) }, "+ New view"),
      ]));
      store.listViews().forEach(v => {
        const row = el("div", { class: "row", style: { padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }},
          el("span", { style: { fontWeight: "500", flex: "0 0 auto" }}, v.name),
          el("code", { style: { fontSize: "11px", color: "var(--text-tertiary)" }}, v.query),
          v.sort && v.sort.length ? el("span", { class: "chip" }, "sort: " + v.sort.map(s => s.field + " " + s.direction).join(", ")) : null,
          el("div", { style: { flex: "1" }}),
          el("button", { class: "btn btn--ghost btn--sm", onclick: () => openSavedViewEditor(v.id) }, "Edit"),
          el("button", { class: "btn btn--ghost btn--sm", onclick: () => store.updateView(v.id, { archived: !v.archived })}, v.archived ? "Unarchive" : "Archive"),
          el("button", { class: "btn btn--ghost btn--sm", style: { color: "var(--feedback-danger-fg)" }, onclick: () => { if (confirm("Delete view?")) store.deleteView(v.id); }}, "Delete"),
        );
        panel.appendChild(row);
      });
    }
    rerender();
  }

  function renderGeneralPanel(panel) {
    function rerender() {
      clear(panel);
      panel.appendChild(panelHeader("General", "Workspace-shared defaults.", null));
      const def = store.listProjects().find(p => p.default);
      panel.appendChild(el("div", { style: { padding: "12px 0" }},
        el("div", { class: "row" }, el("span", { style: { width: "180px" }}, "Default project"),
          el("select", { class: "select", onchange: e => store.setDefaultProject(e.target.value || null)},
            el("option", { value: "" }, "— (force picker)"),
            ...store.listProjects().map(p => el("option", Object.assign({ value: p.key }, def && def.key === p.key ? { selected: "" } : {}), `${p.label} (${p.prefix})`))
          ),
        ),
      ));
      panel.appendChild(el("div", { style: { padding: "12px 0", borderTop: "1px solid var(--border-subtle)" }},
        el("div", { class: "row" }, el("span", { style: { width: "180px" }}, "Schema version"),
          el("span", { class: "chip" }, "version: 1"),
          el("span", { style: { fontSize: "11px", color: "var(--text-tertiary)", marginLeft: "8px" }}, "Run loctt migrate via CLI to upgrade."),
        ),
      ));
    }
    rerender();
  }

  function renderBoardColumnsPanel(panel) {
    function rerender() {
      clear(panel);
      const cols = (store.workflow().boards && store.workflow().boards.columns) || [];
      panel.appendChild(panelHeader("Board columns", "Default: one status = one column. Optionally group statuses or set WIP limits (passive indicator).", [
        el("button", { class: "btn btn--secondary", onclick: () => {
          const key = prompt("Column key:"); if (!key) return;
          const label = prompt("Label:", key) || key;
          const statuses = prompt("Status keys (comma-separated):").split(",").map(s => s.trim()).filter(Boolean);
          const wip = prompt("WIP limit (number, or blank):");
          const newCol = { key, label, statuses, wip: wip ? Number(wip) : null };
          const updated = cols.concat(newCol);
          store.updateWorkflow({ boards: { columns: updated }});
        }}, "+ Add column"),
      ]));
      if (cols.length === 0) {
        panel.appendChild(el("div", { style: { color: "var(--text-tertiary)", padding: "16px 0" }}, "No board grouping configured — board shows 1 status = 1 column."));
      }
      cols.forEach((c, idx) => {
        const row = el("div", { class: "row", style: { padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }},
          el("span", null, c.label),
          el("span", { class: "chip" }, `statuses: ${c.statuses.join(", ")}`),
          c.wip ? el("span", { class: "chip" }, `WIP: ${c.wip}`) : null,
          el("div", { style: { flex: "1" }}),
          el("button", { class: "btn btn--ghost btn--sm", onclick: () => {
            const label = prompt("Label:", c.label); if (label == null) return;
            const statuses = prompt("Statuses:", c.statuses.join(",")).split(",").map(x => x.trim());
            const wip = prompt("WIP:", c.wip || "");
            const updated = cols.slice(); updated[idx] = { ...c, label, statuses, wip: wip ? Number(wip) : null };
            store.updateWorkflow({ boards: { columns: updated }});
          }}, "Edit"),
          el("button", { class: "btn btn--ghost btn--sm", style: { color: "var(--feedback-danger-fg)" }, onclick: () => {
            const updated = cols.filter((_, j) => j !== idx);
            store.updateWorkflow({ boards: { columns: updated }});
          }}, "Delete"),
        );
        panel.appendChild(row);
      });
    }
    rerender();
  }

  function renderTimelinePanel(panel) {
    function rerender() {
      clear(panel);
      const tl = store.workflow().timeline;
      panel.appendChild(panelHeader("Timeline defaults", "Defaults when a user opens Timeline. Each saved view can override these.", null));
      const setTl = (changes) => store.updateWorkflow({ timeline: { ...tl, ...changes }});
      function row(label, value, hint) {
        panel.appendChild(el("div", { style: { padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }},
          el("div", { class: "row" }, el("span", { style: { width: "200px" }}, label), value),
          hint ? el("div", { style: { fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px", marginLeft: "200px" }}, hint) : null,
        ));
      }
      row("Default zoom", el("select", { class: "select", onchange: e => setTl({ default_zoom: e.target.value })},
        ...["day","week","month"].map(z => el("option", Object.assign({ value: z }, tl.default_zoom === z ? { selected: "" } : {}), z))));
      row("Dependency relationship", el("select", { class: "select", onchange: e => setTl({ dependency_relationship: e.target.value || null })},
        el("option", { value: "" }, "— none —"),
        ...store.workflow().relationships.map(r => el("option", Object.assign({ value: r.key }, tl.dependency_relationship === r.key ? { selected: "" } : {}), r.label))
      ), "Which relationship draws arrows between bars.");
      row("Show arrows by default", el("label", { class: "chk" }, el("input", { type: "checkbox", checked: tl.show_arrows, onchange: e => setTl({ show_arrows: e.target.checked })}), el("span", { class: "chk__box" })));
      row("Default grouping", el("select", { class: "select", onchange: e => setTl({ default_grouping: e.target.value })},
        ...["none","milestone","assignee","status","sprint"].map(g => el("option", Object.assign({ value: g }, tl.default_grouping === g ? { selected: "" } : {}), g))
      ));
    }
    rerender();
  }

  function renderSyncPanel(panel) {
    function rerender() {
      clear(panel);
      const g = store.git();
      panel.appendChild(panelHeader("Git sync", "Optional. LocTT uses a sparse worktree on a dedicated loctt branch.", null));
      function row(label, value, hint) {
        panel.appendChild(el("div", { style: { padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }},
          el("div", { class: "row" }, el("span", { style: { width: "200px" }}, label), value),
          hint ? el("div", { style: { fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px", marginLeft: "200px" }}, hint) : null,
        ));
      }
      row("Status", el("span", null, g.enabled ? el("span", { class: "chip chip--accent" }, "enabled") : el("span", { class: "chip" }, "disabled"), " ", el("span", { class: "chip" }, `branch: ${g.branch}`), " ", el("span", { class: "chip" }, `remote: ${g.remote}`)));
      row("Enable", el("label", { class: "chk" }, el("input", { type: "checkbox", checked: g.enabled, onchange: e => {
        if (!e.target.checked && !confirm("Disabling git-backed mode tears down the sparse worktree. Proceed?")) { e.target.checked = true; return; }
        if (e.target.checked && !confirm("Enabling creates the sparse worktree on the loctt branch. Proceed?")) { e.target.checked = false; return; }
        store.updateGit({ enabled: e.target.checked });
      }}), el("span", { class: "chk__box" })));
      row("Auto-push on publish", el("label", { class: "chk" }, el("input", { type: "checkbox", checked: g.auto_push, onchange: e => store.updateGit({ auto_push: e.target.checked })}), el("span", { class: "chk__box" })));
      row("Auto-fetch on sync", el("label", { class: "chk" }, el("input", { type: "checkbox", checked: g.auto_fetch, onchange: e => store.updateGit({ auto_fetch: e.target.checked })}), el("span", { class: "chk__box" })));
      row("Last synced", el("div", null,
        el("span", { style: { fontSize: "12px", color: "var(--text-tertiary)" }}, `Commit ${g.last_synced_commit} · ${relTime(g.last_synced_at)}`),
        el("div", { style: { marginTop: "6px" }},
          el("button", { class: "btn btn--secondary btn--sm", onclick: () => { store.updateGit({ last_synced_commit: ulid().slice(-7), last_synced_at: window.TT.todayISO() }); toast("Published (mock)"); }}, "Publish local changes"),
          " ",
          el("button", { class: "btn btn--secondary btn--sm", onclick: () => { store.updateGit({ last_synced_at: window.TT.todayISO() }); toast("Synced (mock)"); }}, "Sync from remote"),
        ),
      ));
    }
    rerender();
  }

  function renderDoctorPanel(panel) {
    function rerender() {
      clear(panel);
      panel.appendChild(panelHeader("Doctor", "Diagnostic checks across the tracker.", [
        el("button", { class: "btn btn--primary", onclick: () => { rerender(); toast("Checks re-run"); }}, "⟲ Re-run checks"),
      ]));
      const tasks = store.listTasks();
      const projs = store.listProjects();
      const users = store.listUsers();
      const orphans = tasks.filter(t => t.relationships.some(r => !store.getTask(r.target)));
      const checks = [
        { name: "schema_version",        status: "ok", msg: "Schema version 1 matches CLI." },
        { name: "projects",               status: projs.length > 0 ? "ok" : "error", msg: `${projs.length} project(s), ${projs.filter(p => p.default).length} default, all prefixes unique.` },
        { name: "user_references",        status: "ok", msg: "All assignee/reporter references resolve." },
        { name: "label_registry",         status: "ok", msg: "All task labels are registered." },
        { name: "current_user_resolvable",status: store.currentUser() ? "ok" : "error", msg: store.currentUser() ? `.current-user → ${store.currentUser().name}.` : "No current user." },
        { name: "orphaned_relationships", status: orphans.length === 0 ? "ok" : "error", msg: orphans.length === 0 ? "No orphaned relationships." : `${orphans.length} task(s) reference missing targets.` },
        { name: "cycle_check",            status: "ok", msg: "No structural cycles detected." },
      ];
      checks.forEach(c => {
        const icon = c.status === "ok" ? "✓" : c.status === "warn" ? "!" : "✗";
        const color = c.status === "ok" ? "var(--feedback-success-fg)" : c.status === "warn" ? "var(--feedback-warn-fg)" : "var(--feedback-danger-fg)";
        panel.appendChild(el("div", { class: "row", style: { padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }},
          el("span", { style: { width: "22px", height: "22px", borderRadius: "50%", display: "inline-grid", placeItems: "center", background: color + "22", color }}, icon),
          el("span", { style: { fontWeight: "500", width: "200px" }}, c.name),
          el("span", { style: { color: "var(--text-secondary)" }}, c.msg),
        ));
      });
      panel.appendChild(el("div", { style: { fontSize: "11px", color: "var(--text-tertiary)", paddingTop: "12px" }}, "Equivalent to `loctt doctor` on the CLI. `--rebuild-index` is CLI-only."));
    }
    rerender();
  }

  function renderPreferencesPanel(panel) {
    function rerender() {
      clear(panel);
      const s = store.userSettings();
      const me = store.currentUser();
      panel.appendChild(panelHeader("My preferences", "Per-user UI settings (gitignored).", null));
      function row(label, control) {
        panel.appendChild(el("div", { style: { padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }},
          el("div", { class: "row" }, el("span", { style: { width: "180px" }}, label), control)));
      }
      row("Theme", el("select", { class: "select", onchange: e => {
        store.updateUserSettings({ theme: e.target.value });
        if (e.target.value === "system") {
          const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
          window.TT.setTheme(prefersDark ? "dark" : "light");
        } else {
          window.TT.setTheme(e.target.value);
        }
      }},
        ...["light","dark","system"].map(t => el("option", Object.assign({ value: t }, (s.theme || "light") === t ? { selected: "" } : {}), t))
      ));
      row("Date format", el("select", { class: "select", onchange: e => store.updateUserSettings({ date_format: e.target.value })},
        ...["YYYY-MM-DD","MMM DD, YYYY","DD MMM YYYY"].map(f => el("option", Object.assign({ value: f }, (s.date_format || "MMM DD, YYYY") === f ? { selected: "" } : {}), f))
      ));
      row("Default view", el("select", { class: "select", onchange: e => store.updateUserSettings({ default_view: e.target.value })},
        ...["list","board","timeline"].map(v => el("option", Object.assign({ value: v }, (s.default_view || "list") === v ? { selected: "" } : {}), v))
      ));
      row("Default sort", el("select", { class: "select", onchange: e => store.updateUserSettings({ default_sort: e.target.value })},
        ...["created","updated","due","priority"].map(v => el("option", Object.assign({ value: v }, (s.default_sort || "created") === v ? { selected: "" } : {}), v))
      ));
      row("Default project", el("select", { class: "select", onchange: e => store.updateUserSettings({ default_project: e.target.value || null })},
        el("option", { value: "" }, "— (use workspace default)"),
        ...store.listProjects().map(p => el("option", Object.assign({ value: p.key }, s.default_project === p.key ? { selected: "" } : {}), p.label))
      ));
      row("Timezone", el("input", { class: "input", value: (me && me.timezone) || "", onchange: e => { if (me) store.updateUser(me.id, { timezone: e.target.value }); }}));
    }
    rerender();
  }

  function renderCardLayoutPanel(panel) {
    function rerender() {
      clear(panel);
      const s = store.userSettings();
      const fields = s.card_layout || ["project","priority","assignee","labels","due"];
      const all = [
        { key: "project", label: "Project" }, { key: "priority", label: "Priority" },
        { key: "assignee", label: "Assignee" }, { key: "labels", label: "Labels" },
        { key: "type", label: "Type" }, { key: "due", label: "Due date" },
        { key: "estimate", label: "Estimate" }, { key: "milestone", label: "Milestone" },
        { key: "sprint", label: "Sprint" }, { key: "relations", label: "Relation count" },
      ];
      panel.appendChild(panelHeader("Card layout", "Which fields render on each kanban card.", null));
      all.forEach(f => {
        const on = fields.includes(f.key);
        panel.appendChild(el("label", { class: "chk", style: { padding: "8px 0" }},
          el("input", { type: "checkbox", checked: on, onchange: e => {
            const next = e.target.checked ? fields.concat(f.key) : fields.filter(x => x !== f.key);
            store.updateUserSettings({ card_layout: next });
          }}),
          el("span", { class: "chk__box" }),
          f.label
        ));
      });
    }
    rerender();
  }

  function renderSidebarPinsPanel(panel) {
    function rerender() {
      clear(panel);
      const s = store.userSettings();
      const pins = s.sidebar_pins || ["builtin:assigned_to_me", "builtin:due_this_week"];
      panel.appendChild(panelHeader("Sidebar pins", "Drag-reorder of pinned filters in the sidebar.", null));
      pins.forEach((p, i) => panel.appendChild(el("div", { class: "row", style: { padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }},
        el("span", { style: { color: "var(--text-tertiary)" }}, "⋮⋮"),
        el("span", { style: { fontWeight: "500" }}, p),
        el("span", { class: "chip" }, p.startsWith("builtin:") ? "built-in" : "saved view"),
        el("div", { style: { flex: "1" }}),
        el("button", { class: "btn btn--ghost btn--icon btn--sm", onclick: () => store.updateUserSettings({ sidebar_pins: pins.filter((_, j) => j !== i)})}, "✕"),
      )));
      panel.appendChild(el("button", { class: "btn btn--ghost btn--sm", onclick: () => {
        const p = prompt("Pin name (builtin:name or view id):");
        if (p) store.updateUserSettings({ sidebar_pins: pins.concat(p) });
      }}, "+ Add pin"));
    }
    rerender();
  }

  function renderKeyboardPanel(panel) {
    clear(panel);
    panel.appendChild(panelHeader("Keyboard shortcuts", "Global shortcuts that work anywhere in the app.", null));
    const table = el("table", { class: "table", style: { width: "auto" }});
    const rows = [
      ["c", "Create a new task"],
      ["/", "Focus search"],
      ["g l", "Go to List"],
      ["g b", "Go to Board"],
      ["g t", "Go to Timeline"],
      ["[", "Toggle sidebar"],
      ["t", "Toggle theme"],
      ["Esc", "Close dialog / popover"],
      ["?", "This help"],
    ];
    rows.forEach(([k, l]) => table.appendChild(el("tr", null,
      el("td", null, el("span", { class: "kbd" }, k)),
      el("td", null, l)
    )));
    panel.appendChild(table);
  }

  // ===================================================================
  //  Auto-rerender on store changes (debounced)
  // ===================================================================
  let _renderTimer = null;
  function autoRerender() {
    if (_renderTimer) clearTimeout(_renderTimer);
    _renderTimer = setTimeout(() => {
      if (document.querySelector("[data-tt-mount='list-view']")) renderList();
      else if (document.querySelector("[data-tt-mount='task-detail']")) renderTaskDetail();
      else if (document.querySelector("[data-tt-mount='board-view']")) renderBoard();
      else if (document.querySelector("[data-tt-mount='timeline-view']")) renderTimeline();
      else if (document.querySelector("[data-tt-mount='settings-view']")) renderSettings();
      else renderShell();
    }, 30);
  }
  document.addEventListener("tt:change", autoRerender);

  // Expose
  window.TT.views = {
    renderShell, renderList, renderTaskDetail, renderBoard, renderTimeline, renderSettings,
    openCreateTaskModal, openSavedViewEditor,
  };
})();
