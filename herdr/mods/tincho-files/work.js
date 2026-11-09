import { layout, watchFolder } from "herdr";

// Keep both personal panels' work.js copies identical (panel-idle.test.mjs).
// Herdr's mod loader forbids imports outside each mod's application directory.
// These copies target the unique Files/Changes blocks in tincho.json.
function shown(node, mod) {
  if (!node || node.hidden) return false;
  if (node.content?.mod === mod) return true;
  const children = node.children ?? [];
  if (node.type === "stack") {
    const active = children.find(child => child.id === node.active) ?? children[0];
    return shown(active, mod);
  }
  return children.some(child => shown(child, mod));
}

export class PanelWork {
  constructor(mod, key) {
    this.mod = mod;
    this.key = key;
    this.token = null;
    this.waits = new Map();
  }

  stop() {
    this.token = null;
    this.watching = null;
    // Native watch promises cannot be cancelled. Keep outstanding waits so
    // reveal can reuse the same root instead of allocating another waiter.
    this.timer?.cancel();
    this.timer = null;
  }

  close() { this.dead = true; this.stop(); }

  sync() {
    if (this.dead || !shown(layout(), this.mod)) { this.stop(); return null; }
    const key = this.key();
    if (!this.token || this.token.key !== key) {
      this.stop();
      this.token = { key };
    }
    return this.token;
  }

  current(token) {
    if (!token || token !== this.token || this.dead) return false;
    if (!shown(layout(), this.mod) || token.key !== this.key()) { this.stop(); return false; }
    return true;
  }

  schedule(cx, token, refresh) {
    if (!this.current(token)) return;
    this.timer?.cancel();
    // Slow safety refresh for missed/ignored changes; bounded polling for
    // remote roots, failed watches, or a full outstanding-wait budget.
    const delay = this.watching?.token === token ? 60000 : 10000;
    this.timer = cx.timer.after(delay, cx => {
      this.timer = null;
      if (this.current(token)) refresh(cx);
      // Hidden: do not rearm. Herdr renders again when the block is shown.
    });
  }

  watch(root, on, cx, token, refresh) {
    if (!this.current(token) || on) return;
    const existing = this.waits.get(root);
    if (existing) {
      existing.token = token; existing.refresh = refresh;
      this.watching = existing;
      return;
    }
    this.watching = null;
    // Folder churn must not accumulate unlimited uncancellable promises.
    // Poll new roots until one of these waits resolves and releases its slot.
    if (this.waits.size >= 4) return;
    const watch = { token, root, refresh };
    this.waits.set(root, watch);
    this.watching = watch;
    cx.spawn(async cx => {
      try {
        while (this.watching === watch && this.current(watch.token)) {
          await watchFolder(root);
          if (this.watching !== watch || !this.current(watch.token)) return;
          // A reused same-root wait signals a change, not old file data.
          // Read fresh data for the current visible context; do not lose the
          // first edit after reveal just because this wait predates reveal.
          watch.refresh(cx);
        }
      } catch {
        if (this.watching !== watch || !this.current(watch.token)) return;
        this.watching = null;
        this.schedule(cx, watch.token, watch.refresh);
      } finally {
        this.waits.delete(root);
      }
    });
  }
}
