interface ImageMount {
  host: HTMLElement;
  layer: HTMLDivElement;
  planes: [HTMLDivElement, HTMLDivElement];
}

interface ImageScene {
  scene: HTMLDivElement;
  planes: [HTMLDivElement, HTMLDivElement];
  paint: [string, string];
}

interface ComposerImage {
  kind: "composer" | "settings";
  clip: HTMLDivElement;
  scenes: Map<ImageMount, ImageScene>;
  saved: { property: string; value: string; priority: string }[];
  attribute: string | null;
}

/** Paint only wallpaper behind floating surfaces, never underlying application text. */
export function createComposerBackgrounds(document: Document, owner: string) {
  const window = document.defaultView!;
  const images = new Map<HTMLElement, ComposerImage>();
  const observed = new Set<Element>();
  const resize = typeof window.ResizeObserver === "function" ? new window.ResizeObserver(queue) : undefined;
  let mounts: ImageMount[] = [];
  let disposed = false;
  let queued = false;

  function ownedDiv(marker: string): HTMLDivElement {
    const node = document.createElement("div");
    node.setAttribute(marker, "");
    node.setAttribute("data-dsh-background-owner", owner);
    return node;
  }

  function remove(surface: HTMLElement): void {
    const image = images.get(surface);
    if (!image) return;
    image.clip.remove();
    for (const { property, value, priority } of image.saved) {
      if (value === "") surface.style.removeProperty(property);
      else surface.style.setProperty(property, value, priority);
    }
    const marker = `data-dsh-${image.kind}-surface`;
    if (image.attribute === null) surface.removeAttribute(marker);
    else surface.setAttribute(marker, image.attribute);
    images.delete(surface);
  }

  function add(surface: HTMLElement, kind: ComposerImage["kind"]): ComposerImage {
    // Settings' tint and card fills belong to the renderer; do not save/restore
    // the same properties in both controllers when a portal closes or disables.
    const styles: Record<string, string> = { "backdrop-filter": "none", isolation: "isolate" };
    if (kind === "composer") {
      styles["background-color"] = "transparent";
      styles["background-image"] = "none";
    }
    if (surface.hasAttribute("data-trigger-menu")) {
      // MenuSurface's own material and bottom fade must not sample the history.
      styles["--dsw-menu-surface-fill"] = "transparent";
      styles["--dsw-menu-backdrop-filter"] = "none";
      styles["--dsw-specific-menu"] = "transparent";
    }
    if (["static", ""].includes(window.getComputedStyle(surface).position)) styles.position = "relative";
    const saved = Object.keys(styles).map(property => ({
      property, value: surface.style.getPropertyValue(property), priority: surface.style.getPropertyPriority(property),
    }));
    for (const [property, value] of Object.entries(styles)) surface.style.setProperty(property, value, "important");
    const clip = ownedDiv(`data-dsh-${kind}-background`);
    clip.setAttribute("aria-hidden", "true");
    Object.assign(clip.style, {
      position: "absolute", inset: "0px", overflow: "hidden", borderRadius: "inherit",
      zIndex: "-1", pointerEvents: "none", userSelect: "none",
      // Opacity and transparent PNGs must composite over the theme, not chat text.
      backgroundColor: "var(--dsw-alias-bg-base, Canvas)",
    });
    surface.prepend(clip);
    const marker = `data-dsh-${kind}-surface`;
    const attribute = surface.getAttribute(marker);
    surface.setAttribute(marker, owner);
    const image: ComposerImage = { kind, clip, scenes: new Map(), saved, attribute };
    images.set(surface, image);
    return image;
  }

  function syncScene(source: ImageMount, image: ImageScene): void {
    image.scene.style.backgroundColor = source.layer.style.backgroundColor;
    source.planes.forEach((plane, index) => {
      const css = plane.style.cssText;
      if (image.paint[index] === css) return;
      image.paint[index] = css;
      const copy = image.planes[index]!;
      copy.style.cssText = css;
      copy.style.position = "absolute";
      copy.style.backgroundRepeat = "no-repeat";
      copy.style.pointerEvents = "none";
    });
  }

  function refresh(): void {
    if (disposed) return;
    const desired = new Map<HTMLElement, { sources: ImageMount[]; kind: ComposerImage["kind"] }>();
    for (const card of document.querySelectorAll('[data-composer-seat][data-conversation-region="composer"] [data-composer-card]')) {
      if (!(card instanceof window.HTMLElement)) continue;
      const sources = mounts.filter(mount => mount.host.contains(card));
      if (sources.length === 0) continue;
      desired.set(card, { sources, kind: "composer" });
      // The + menu is inside InputBar's overlay anchor, positioned above the card.
      for (const menu of card.querySelectorAll('[data-trigger-menu][data-menu-material]')) {
        if (menu instanceof window.HTMLElement) desired.set(menu, { sources, kind: "composer" });
      }
    }
    if (mounts.length > 0) {
      for (const panel of document.querySelectorAll('[data-shortcut-modal="settings"]')) {
        if (panel instanceof window.HTMLElement) {
          // Settings is a body portal that can overlap all three regions. Align
          // copies of their existing image planes in viewport space; the opaque
          // theme base stops sidebar timestamps even with low-opacity/PNG images.
          desired.set(panel, { sources: mounts, kind: "settings" });
        }
      }
    }
    for (const surface of images.keys()) if (!desired.has(surface)) remove(surface);
    const elements = new Set<Element>();
    for (const [surface, { sources, kind }] of desired) {
      if (images.has(surface) && !images.get(surface)!.clip.isConnected) remove(surface);
      const image = images.get(surface) ?? add(surface, kind);
      const bounds = image.clip.getBoundingClientRect();
      elements.add(surface);
      for (const [mount, scene] of image.scenes) {
        if (sources.includes(mount)) continue;
        scene.scene.remove();
        image.scenes.delete(mount);
      }
      for (const [order, mount] of sources.entries()) {
        let scene = image.scenes.get(mount);
        if (!scene) {
          const layer = ownedDiv(`data-dsh-${kind}-scene`);
          Object.assign(layer.style, { position: "absolute", overflow: "hidden", filter: kind === "settings" ? "blur(6px)" : "blur(4px)" });
          const planes = [ownedDiv(`data-dsh-${kind}-plane`), ownedDiv(`data-dsh-${kind}-plane`)] as [HTMLDivElement, HTMLDivElement];
          layer.append(...planes);
          image.clip.append(layer);
          scene = { scene: layer, planes, paint: ["unset", "unset"] };
          image.scenes.set(mount, scene);
        }
        const rect = mount.layer.getBoundingClientRect();
        Object.assign(scene.scene.style, {
          left: `${rect.left - bounds.left}px`, top: `${rect.top - bounds.top}px`,
          width: `${rect.width}px`, height: `${rect.height}px`, zIndex: String(order),
        });
        syncScene(mount, scene);
        elements.add(mount.layer);
      }
    }
    for (const element of observed) {
      if (elements.has(element)) continue;
      resize?.unobserve(element);
      observed.delete(element);
    }
    for (const element of elements) {
      if (observed.has(element)) continue;
      resize?.observe(element);
      observed.add(element);
    }
  }

  function queue(): void {
    if (queued || disposed) return;
    queued = true;
    void Promise.resolve().then(() => { queued = false; refresh(); });
  }

  window.addEventListener("resize", queue);
  document.addEventListener("scroll", queue, true);
  return {
    update(nextMounts: ImageMount[]) { mounts = nextMounts; refresh(); },
    sync(mount: ImageMount) {
      for (const image of images.values()) {
        const scene = image.scenes.get(mount);
        if (scene) syncScene(mount, scene);
      }
    },
    lostNode(node: Node): boolean {
      return [...images.values()].some(image => image.clip === node && !image.clip.isConnected);
    },
    dispose() {
      disposed = true;
      resize?.disconnect();
      observed.clear();
      window.removeEventListener("resize", queue);
      document.removeEventListener("scroll", queue, true);
      for (const surface of images.keys()) remove(surface);
    },
  };
}
