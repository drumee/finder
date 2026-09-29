"use strict";

class FinderWindow {
  constructor({ manager, runtime, finder_options = {}, window_options = {} } = {}) {
    if (!manager || typeof manager.open !== "function") throw new Error("FinderWindow requires @drumee/window-manager");
    this.manager = manager;
    this.runtime = runtime || manager.runtime;
    this.finder = this.runtime.createWidget({ kind: "finder", ...finder_options });
    this.finder.render();
    this.window = manager.open({ title: "Finder", ...window_options, content: this.finder.el, on_event: (name, detail) => this.onWindowEvent(name, detail, window_options.on_event) });
    this.location_listener = ({ title }) => this.setTitle(title);
    this.finder.on("location:change", this.location_listener);
  }

  setTitle(title) {
    this.window.window_options.title = title || "Finder";
    const note = this.window.getPart("window-title");
    if (note && typeof note.set === "function") note.set({ content: this.window.window_options.title });
  }

  onWindowEvent(name, detail, downstream) {
    if (name === "close") this.destroyFinder();
    if (typeof downstream === "function") downstream(name, detail);
  }

  destroyFinder() {
    if (!this.finder) return;
    this.finder.off("location:change", this.location_listener);
    if (!this.finder.isDestroyed()) this.finder.destroy();
    this.finder = null;
  }

  close() { return this.manager.close(this.window); }
  destroy() { if (this.window && this.window.lifecycle !== "closed") this.manager.close(this.window); else this.destroyFinder(); }
}

module.exports = { FinderWindow };
