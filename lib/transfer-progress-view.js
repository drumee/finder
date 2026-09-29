"use strict";

const { LetcBox } = require("@drumee/ui-runtime");
const progressSkeleton = require("../skeleton/transfer-progress");

class TransferProgressView extends LetcBox {
  static figName = "finder_transfer_progress";

  initialize(options = {}) {
    super.initialize(options);
    this.controller = options.controller || this.mget("controller");
    this.transfer_kind = options.transfer_kind || this.mget("transfer_kind") || "transfer";
    this.listeners = [];
    this.collection.reset(progressSkeleton(this));
  }

  onDomRefresh() {
    this.el.dataset.kind = "finder_transfer_progress";
    this.el.dataset.transferKind = this.transfer_kind;
    if (this.bound || !this.controller || typeof this.controller.on !== "function") return;
    this.bound = true;
    for (const name of ["progress", "status", "paused", "resumed", "done", "file-done", "cancelled", "error"]) {
      const listener = (state) => this.update(name, state);
      this.controller.on(name, listener);
      this.listeners.push([name, listener]);
    }
  }

  update(name, state = {}) {
    const loaded = Number(state.loaded == null ? state.progress && state.progress.loaded : state.loaded);
    const total = Number(state.total == null ? state.progress && state.progress.total : state.total);
    const percent = total > 0 && Number.isFinite(loaded) ? ` ${Math.min(100, Math.round(loaded * 100 / total))}%` : "";
    const status = state.status || name;
    const label = this.getPart("transfer-label");
    if (label && typeof label.set === "function") label.set({ content: `${this.transfer_kind} ${status}${percent}` });
    this.el.dataset.status = status;
  }

  onUiEvent(source) { if (source.mget("service") === "cancel") return this.cancel(); return undefined; }

  cancel() {
    if (!this.controller || typeof this.controller.cancel !== "function") return undefined;
    if (this.transfer_kind === "download") {
      const transfer_id = this.controller.active && this.controller.active.values().next().value;
      return transfer_id ? this.controller.cancel(transfer_id) : undefined;
    }
    return this.controller.cancel();
  }

  destroy() {
    if (this.controller && typeof this.controller.off === "function") for (const [name, listener] of this.listeners) this.controller.off(name, listener);
    this.listeners = [];
    super.destroy();
  }
}

module.exports = { TransferProgressView };
