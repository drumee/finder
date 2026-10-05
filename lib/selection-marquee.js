"use strict";

const { LetcBox } = require("@drumee/ui-runtime");
const { intersects, normalizedRectangle } = require("./geometry");

class SelectionMarquee extends LetcBox {
  static figName = "finder_selection_marquee";

  initialize(options = {}) {
    super.initialize(options);
    this.finder = options.finder || this.mget("finder");
    this.threshold = Number(options.threshold || 5);
    this.active = false;
    this.started = false;
    this.members = new Set();
    this._listeners = [];
  }

  onDomRefresh() {
    this.el.dataset.kind = "finder_selection_marquee";
    this.el.classList.add("drumee-finder__marquee");
    Object.assign(this.el.style, { display: "none", position: "absolute", pointerEvents: "none" });
  }

  attach(item_list) {
    this.detach();
    this.item_list = item_list;
    this.pointerdown = (event) => this.onPointerDown(event);
    item_list.el.addEventListener("pointerdown", this.pointerdown);
    this._listeners.push([item_list.el, "pointerdown", this.pointerdown]);
  }

  onPointerDown(event) {
    if (event.button !== 0 || event.target.closest("[data-item-id]") || event.target.closest("button,input")) return;
    const rect = this.item_list.el.getBoundingClientRect();
    this.pointer_id = event.pointerId;
    this.start = { x: event.clientX - rect.left + this.item_list.el.scrollLeft, y: event.clientY - rect.top + this.item_list.el.scrollTop };
    this.active = true;
    this.started = false;
    this.members.clear();
    this.move_listener = (move) => this.onPointerMove(move);
    this.up_listener = (up) => this.onPointerUp(up);
    this.item_list.el.ownerDocument.addEventListener("pointermove", this.move_listener);
    this.item_list.el.ownerDocument.addEventListener("pointerup", this.up_listener);
    this.item_list.el.ownerDocument.addEventListener("pointercancel", this.up_listener);
    if (typeof this.item_list.el.setPointerCapture === "function") this.item_list.el.setPointerCapture(event.pointerId);
  }

  onPointerMove(event) {
    if (!this.active || event.pointerId !== this.pointer_id) return;
    const host = this.item_list.el;
    const rect = host.getBoundingClientRect();
    const point = { x: event.clientX - rect.left + host.scrollLeft, y: event.clientY - rect.top + host.scrollTop };
    if (!this.started && Math.hypot(point.x - this.start.x, point.y - this.start.y) < this.threshold) return;
    if (!this.started) { this.started = true; this.finder.selection.clear(); this.el.style.display = "block"; }
    const selection_rect = normalizedRectangle(this.start, point);
    const bounds = this.item_list.measureBounds();
    const next = new Set();
    for (const [id, item_rect] of bounds) if (intersects(selection_rect, item_rect)) next.add(id);
    for (const id of next) if (!this.members.has(id)) { const item = this.item_list.items.get(id); if (item) this.finder.selection.select(item); }
    for (const id of this.members) if (!next.has(id)) { const item = this.item_list.items.get(id); if (item) this.finder.selection.unselect(item); }
    this.members = next;
    Object.assign(this.el.style, { left: `${selection_rect.left}px`, top: `${selection_rect.top}px`, width: `${selection_rect.right - selection_rect.left}px`, height: `${selection_rect.bottom - selection_rect.top}px` });
  }

  onPointerUp(event) { if (this.active && event.pointerId === this.pointer_id) this.cancel(); }

  cancel() {
    if (this.item_list) {
      const document = this.item_list.el.ownerDocument;
      document.removeEventListener("pointermove", this.move_listener);
      document.removeEventListener("pointerup", this.up_listener);
      document.removeEventListener("pointercancel", this.up_listener);
    }
    this.active = false; this.started = false; this.members.clear(); this.el.style.display = "none";
  }

  detach() { this.cancel(); for (const [target, name, listener] of this._listeners) target.removeEventListener(name, listener); this._listeners = []; this.item_list = null; }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.detach(); super.destroy(); }
}

module.exports = { SelectionMarquee };
