(() => {
  const key = "model-desk.theme";
  const choices = new Set(["system", "light", "dark", "sepia", "forest", "rose", "midnight", "contrast"]);
  const device = matchMedia("(prefers-color-scheme: dark)");
  let theme = "system";
  let selector;
  try {
    const stored = localStorage.getItem(key);
    if (choices.has(stored)) theme = stored;
  } catch {
    // System mode also works when browser storage is unavailable.
  }

  function applyTheme() {
    const root = document.documentElement;
    root.dataset.theme = theme === "system" ? (device.matches ? "dark" : "light") : theme;
    if (!selector) return;
    selector.value = theme;
    const paper = getComputedStyle(root).getPropertyValue("--paper").trim();
    if (paper) document.querySelector('meta[name="theme-color"]').content = paper;
  }

  applyTheme();
  device.addEventListener("change", () => {
    if (theme === "system") applyTheme();
  });
  document.addEventListener("DOMContentLoaded", () => {
    selector = document.querySelector("#theme-select");
    applyTheme();
    selector.addEventListener("change", () => {
      if (!choices.has(selector.value)) return;
      theme = selector.value;
      applyTheme();
      try {
        localStorage.setItem(key, theme);
      } catch {
        // The current tab still uses the selected theme.
      }
    });
  });
})();
