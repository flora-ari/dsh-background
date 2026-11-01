const LAYOUT_ELEMENTS = "div, main, section, aside, article, header, footer, nav, form, ul, ol, li";
const NATIVE_CONTENT = '[data-slot="main.conversation"], [data-testid="task-manager-page"], [data-slot="conversation.chat.flow"], [data-chat-node-key]';
const FOREGROUND = [
  "button", "a", "input", "textarea", "select", "option", "pre", "code", "figure", "table",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]', '[role="checkbox"]', '[role="switch"]', '[role="tab"]',
  '[role="menu"]', '[role="listbox"]', '[role="dialog"]', '[role="alertdialog"]',
  '[role="tooltip"]', '[role="status"]', '[role="alert"]', '[role="img"]',
  '[aria-selected="true"]', '[aria-pressed="true"]',
].join(", ");

/** Collect layout fills in plugin seats, regardless of the plugin's name or CSS hash. */
export function pluginSurfaceStyles(
  document: Document,
  hosts: HTMLElement[],
  owned: (node: Node) => boolean,
): Map<HTMLElement, Record<string, string>> {
  const window = document.defaultView!;
  const roots = new Set<HTMLElement>();
  const desired = new Map<HTMLElement, Record<string, string>>();
  const panels = new Set<HTMLElement>();
  const clear = { "background-color": "transparent", "background-image": "none" };

  for (const host of hosts) {
    const candidates = host.querySelectorAll([
      '[data-slot="main"] > *',
      '[data-slot="sidebar.right.pane.tab"] > *',
      '[data-dsh-plugin]',
    ].join(", "));
    for (const root of candidates) {
      if (!(root instanceof window.HTMLElement) || owned(root) || root.closest(FOREGROUND)
        || root.matches(NATIVE_CONTENT) || root.closest(NATIVE_CONTENT)
        || root.querySelector(NATIVE_CONTENT)) continue;
      roots.add(root);
    }
  }

  for (const root of roots) {
    // One walk per page, even when it exposes a plugin marker inside a slot root.
    if ([...roots].some(other => other !== root && other.contains(root))) continue;
    const parent = root.parentElement;
    if (parent?.matches('[data-slot="main"], [data-slot="sidebar.right.pane.tab"]')) {
      desired.set(parent, clear);
    }
    for (const surface of [root, ...root.querySelectorAll(LAYOUT_ELEMENTS)]) {
      if (!(surface instanceof window.HTMLElement) || owned(surface)
        || surface.closest(FOREGROUND) || surface.closest(NATIVE_CONTENT)) continue;
      const computed = window.getComputedStyle(surface);
      if (surface !== root) {
        // Keep artwork and semantic color fills. Transparent nodes remain eligible
        // after our override, so MutationObserver reconciliation never oscillates.
        if (computed.backgroundImage.includes("url(")) continue;
        const color = computed.backgroundColor;
        const rgb = color.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
        if (rgb) {
          const channels = rgb.slice(1, 4).map(Number);
          if (Math.max(...channels) - Math.min(...channels) > 24) continue;
        } else if (color && color !== "transparent") continue;
      }
      desired.set(surface, clear);
      const rounded = [computed.borderTopLeftRadius, computed.borderTopRightRadius,
        computed.borderBottomLeftRadius, computed.borderBottomRightRadius].some(value => parseFloat(value) > 0);
      const bordered = [computed.borderTopWidth, computed.borderRightWidth,
        computed.borderBottomWidth, computed.borderLeftWidth].some(value => parseFloat(value) > 0);
      if (surface !== root && surface.children.length > 0 && (rounded || bordered)) panels.add(surface);
    }
  }

  for (const panel of panels) {
    let parent = panel.parentElement;
    while (parent && !panels.has(parent)) parent = parent.parentElement;
    // Match message-block glass, without blurring text or compounding nested cards.
    desired.set(panel, { ...clear, "backdrop-filter": parent ? "none" : "blur(6px)" });
  }
  return desired;
}
