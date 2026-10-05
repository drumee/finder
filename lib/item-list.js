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
    if (event.target.closest("[data-service=tick]")) this.finder.selection.toggle(item);
    else this.finder.selection.set([item]);
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
