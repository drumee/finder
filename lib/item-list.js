"use strict";

const { LetcBox } = require("@drumee/ui-runtime");
const { itemKey } = require("./finder-selection");

function escape(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

class ItemList extends LetcBox {
  static figName = "finder_item_list";

  initialize(options = {}) {
    super.initialize(options);
    this.finder = options.finder || this.mget("finder");
    this.items = new Map();
    this.bounds_cache = new Map();
    this.bounds_dirty = true;
    this.anchor_key = null;
    this._listeners = [];
  }

  onDomRefresh() {
    this.el.dataset.kind = "finder_item_list";
    this.el.classList.add("drumee-finder__items");
    this.el.setAttribute("role", "list");
    if (!this._events_bound) {
      this._events_bound = true;
      this._listen("click", (event) => this.onClick(event));
      this._listen("dblclick", (event) => this.onDoubleClick(event));
      this._listen("keydown", (event) => this.onKeyDown(event));
      this._listen("contextmenu", (event) => this.onContextMenu(event));
      this._listen("scroll", () => this.invalidateBounds());
      this._listen("dragover", (event) => { if (event.dataTransfer) event.preventDefault(); });
      this._listen("drop", (event) => this.onExternalDrop(event));
    }
    this.renderItems();
  }

  _listen(name, listener) { this.el.addEventListener(name, listener); this._listeners.push([name, listener]); }

  setItems(items) {
    this.items = new Map((items || []).map((item) => [itemKey(item), { ...item }]));
    this.finder.selection.set(this.finder.selection.getItems().map((item) => this.items.get(itemKey(item))).filter(Boolean));
    this.invalidateBounds();
    this.renderItems();
  }

  upsert(item) { this.items.set(itemKey(item), { ...(this.items.get(itemKey(item)) || {}), ...item }); this.invalidateBounds(); this.renderItems(); }
  remove(identity) { this.items.delete(itemKey(identity)); this.finder.selection.unselect(identity); this.invalidateBounds(); this.renderItems(); }
  get(identity) { return this.items.get(itemKey(identity)) || null; }
  values() { return [...this.items.values()]; }

  renderItems() {
    if (!this.isRendered()) return;
    this.el.innerHTML = this.values().map((item) => {
      const selected = this.finder.selection.has(item);
      return `<article class="drumee-finder__tile" role="listitem" tabindex="0" data-item-id="${escape(item.nid)}" data-hub-id="${escape(item.hub_id)}" data-filetype="${escape(item.filetype)}" data-selected="${selected}"><button type="button" class="drumee-finder__check" data-service="tick" aria-pressed="${selected}">✓</button><div class="drumee-finder__preview" data-preview="pending"></div><div class="drumee-finder__filename">${escape(item.filename)}</div></article>`;
    }).join("");
    this.observePreviews();
  }

  projectSelection() {
    for (const tile of this.el.querySelectorAll("[data-item-id]")) {
      const item = this.get({ hub_id: tile.dataset.hubId, nid: tile.dataset.itemId });
      const selected = Boolean(item && this.finder.selection.has(item));
      if (tile.dataset.selected !== String(selected)) tile.dataset.selected = String(selected);
      const checkbox = tile.querySelector("[data-service=tick]");
      if (checkbox) checkbox.setAttribute("aria-pressed", String(selected));
    }
  }

  onClick(event) {
    const tile = event.target.closest("[data-item-id]");
    if (!tile || !this.el.contains(tile)) return;
    const item = this.get({ hub_id: tile.dataset.hubId, nid: tile.dataset.itemId });
    if (!item) return;
    const additive = Boolean(event.ctrlKey || event.metaKey);
    if (event.shiftKey && this.anchor_key) {
      const anchor = this.items.get(this.anchor_key);
      if (anchor) this.finder.selection.selectRange(this.values(), anchor, item, { additive });
    } else if (event.target.closest("[data-service=tick]") || additive) this.finder.selection.toggle(item);
    else this.finder.selection.set([item]);
    this.anchor_key = itemKey(item);
    if (typeof tile.focus === "function") tile.focus();
  }

  onKeyDown(event) {
    const tiles = [...this.el.querySelectorAll("[data-item-id]")];
    if (!tiles.length) return;
    const current = event.target.closest && event.target.closest("[data-item-id]");
    const index = Math.max(0, tiles.indexOf(current));
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = Math.min(tiles.length - 1, index + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = Math.max(0, index - 1);
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault(); this.finder.selection.set(this.values()); return;
    } else if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault(); if (current) this.finder.selection.toggle(this.get({ hub_id: current.dataset.hubId, nid: current.dataset.itemId })); return;
    } else if (event.key === "Enter") {
      if (current) { event.preventDefault(); this.finder.open(this.get({ hub_id: current.dataset.hubId, nid: current.dataset.itemId })); } return;
    } else if (event.key === "Backspace") { event.preventDefault(); this.finder.up(); return; }
    else return;
    event.preventDefault();
    const target = tiles[next];
    const item = this.get({ hub_id: target.dataset.hubId, nid: target.dataset.itemId });
    if (event.shiftKey && this.anchor_key) {
      const anchor = this.items.get(this.anchor_key);
      if (anchor) this.finder.selection.selectRange(this.values(), anchor, item, { additive: Boolean(event.ctrlKey || event.metaKey) });
    } else {
      this.finder.selection.set([item]);
      this.anchor_key = itemKey(item);
    }
    target.focus();
  }

  onContextMenu(event) {
    const tile = event.target.closest("[data-item-id]");
    if (!tile) return;
    event.preventDefault();
    const item = this.get({ hub_id: tile.dataset.hubId, nid: tile.dataset.itemId });
    if (!this.finder.selection.has(item)) this.finder.selection.set([item]);
    this.anchor_key = itemKey(item);
    this.finder.trigger("context:request", {
      finder: this.finder,
      item,
      selection: this.finder.selection.getItems(),
      commands: ["open", "download", "rename", "remove"],
      client_x: event.clientX,
      client_y: event.clientY
    });
  }

  onDoubleClick(event) {
    const tile = event.target.closest("[data-item-id]");
    if (!tile) return;
    const item = this.get({ hub_id: tile.dataset.hubId, nid: tile.dataset.itemId });
    if (item) this.finder.open(item);
  }

  async onExternalDrop(event) {
    if (!event.dataTransfer || !(event.dataTransfer.items && event.dataTransfer.items.length || event.dataTransfer.files && event.dataTransfer.files.length)) return;
    event.preventDefault();
    if (!this.finder.upload_controller) return;
    const forest = await this.finder.upload_controller.scan(event.dataTransfer);
    await this.finder.uploadForest(forest);
  }

  invalidateBounds() { this.bounds_dirty = true; }

  measureBounds() {
    if (!this.bounds_dirty) return this.bounds_cache;
    const list = this.el.getBoundingClientRect();
    const next = new Map();
    for (const tile of this.el.querySelectorAll("[data-item-id]")) {
      const rect = tile.getBoundingClientRect();
      next.set(`${tile.dataset.hubId}:${tile.dataset.itemId}`, {
        left: rect.left - list.left + this.el.scrollLeft,
        right: rect.right - list.left + this.el.scrollLeft,
        top: rect.top - list.top + this.el.scrollTop,
        bottom: rect.bottom - list.top + this.el.scrollTop
      });
    }
    this.bounds_cache = next;
    this.bounds_dirty = false;
    return next;
  }

  observePreviews() {
    if (!this.finder.preview_observer) return;
    for (const preview of this.el.querySelectorAll("[data-preview=pending]")) this.finder.preview_observer.observe(preview);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const [name, listener] of this._listeners) this.el.removeEventListener(name, listener);
    this._listeners = [];
    this._events_bound = false;
    if (this.finder.preview_observer) for (const preview of this.el.querySelectorAll("[data-preview]")) this.finder.preview_observer.unobserve(preview);
    this.items.clear();
    this.bounds_cache.clear();
    super.destroy();
  }
}

module.exports = { ItemList, escapeHtml: escape };
