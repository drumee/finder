"use strict";

const { Emitter } = require("./emitter");

function key(item) { return `${item.hub_id}:${item.nid}`; }

class FinderSelection extends Emitter {
  constructor() { super(); this.items = new Map(); }
  select(item) { const id = key(item); if (this.items.has(id)) return false; this.items.set(id, item); this.emit("change", this.getItems()); return true; }
  unselect(item) { const changed = this.items.delete(key(item)); if (changed) this.emit("change", this.getItems()); return changed; }
  toggle(item) { return this.has(item) ? this.unselect(item) : this.select(item); }
  clear() { if (!this.items.size) return false; this.items.clear(); this.emit("change", []); return true; }
  has(item) { return this.items.has(key(item)); }
  getItems() { return [...this.items.values()]; }
  set(items) { const next = new Map((items || []).map((item) => [key(item), item])); const changed = next.size !== this.items.size || [...next.keys()].some((id) => !this.items.has(id)); this.items = next; if (changed) this.emit("change", this.getItems()); return changed; }
  selectRange(items, start, end, { additive = false } = {}) {
    const ordered = Array.isArray(items) ? items : [];
    const from = ordered.findIndex((item) => key(item) === key(start));
    const to = ordered.findIndex((item) => key(item) === key(end));
    if (from < 0 || to < 0) return false;
    const range = ordered.slice(Math.min(from, to), Math.max(from, to) + 1);
    return this.set(additive ? [...this.getItems(), ...range] : range);
  }
  selectCanonical(item) { const id = key(item); if (!this.items.has(id)) return false; this.items.set(id, item); this.emit("change", this.getItems()); return true; }
  destroy() { this.items.clear(); this.removeAllListeners(); }
}

module.exports = { FinderSelection, itemKey: key };
