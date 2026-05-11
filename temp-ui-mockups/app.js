// TaskTracker mockup — shared interactivity
// Exposes window.TT with helpers used across pages.
(function () {
  const STORAGE = {
    theme: "tt-theme",
    sidebar: "tt-sidebar-collapsed",
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
  // Any element with class .popover or .menu opens via a trigger [data-popover-trigger=id]
  // or [data-menu-trigger=id]. Clicking outside or Esc closes any open instance.
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
      // Click inside a popover stays open; click on .menu__item closes and fires handler
      const menuItem = e.target.closest(".menu__item");
      if (menuItem) {
        const menu = menuItem.closest(".menu");
        if (menu) {
          menu.classList.remove("is-open");
          // Bubbling is fine — page code listens on .menu__item
        }
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
  };
})();
