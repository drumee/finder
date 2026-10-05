"use strict";

function same(left, right) { return Boolean(left && right && left.hub_id === right.hub_id && left.nid === right.nid); }

class MfsSync {
  constructor({ websocket } = {}) {
    if (!websocket || typeof websocket.bindEvent !== "function") throw new Error("MfsSync requires runtime.Websocket");
    this.websocket = websocket;
    this.finders = new Map();
    this.seen = new Set();
    this.on_event = (data) => this.handle(data);
    this.on_connected = () => { this.reconcile().catch(() => {}); };
    websocket.bindEvent("mfs.event", this.on_event);
    if (typeof websocket.on === "function") websocket.on("connected", this.on_connected);
  }

  register(finder) { this.finders.set(finder.finder_id, finder); return () => this.unregister(finder); }
  unregister(finder) { this.finders.delete(typeof finder === "string" ? finder : finder.finder_id); }

  normalize(event = {}) {
    return {
      type: event.type,
      operation_id: event.operation_id || event.echoId || null,
      node: event.node || event.result && event.result.node || null,
      source_parent: event.source_parent || null,
      destination: event.destination || event.destination_parent || null,
      result: event.result || null,
      hard_delete: Boolean(event.hard_delete)
    };
  }

  handle(raw) {
    if (this.destroyed) return false;
    const event = this.normalize(raw);
    const id = event.operation_id && `${event.operation_id}:${event.type}`;
    if (id && this.seen.has(id)) return false;
    if (id) { this.seen.add(id); if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value); }
    for (const finder of this.finders.values()) {
      const relevant = same(finder.location, event.node) || same(finder.location, event.source_parent) || same(finder.location, event.destination) ||
        (event.node && typeof finder.hasItem === "function" && finder.hasItem(event.node));
      if (relevant) finder.applyMfsEvent(event);
    }
    return true;
  }

  async reconcile() {
    if (this.destroyed) return [];
    if (!this.reconciliation) {
      this.reconciliation = Promise.all([...this.finders.values()].map((finder) => finder.refresh({ reconciliation: true })))
        .finally(() => { this.reconciliation = null; });
    }
    return this.reconciliation;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.websocket.unbindEvent("mfs.event", this.on_event);
    if (typeof this.websocket.off === "function") this.websocket.off("connected", this.on_connected);
    this.finders.clear();
    this.seen.clear();
  }
}

module.exports = { MfsSync, sameIdentity: same };
