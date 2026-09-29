"use strict";

class FinderDragController {
  constructor({ finder, threshold = 5 } = {}) { this.finder = finder; this.threshold = threshold; this.listeners = []; }

  attach(item_list) {
    this.detach(); this.item_list = item_list;
    this.down = (event) => this.onDown(event);
    item_list.el.addEventListener("pointerdown", this.down);
    this.listeners.push([item_list.el, "pointerdown", this.down]);
  }

  onDown(event) {
    if (event.button !== 0 || event.target.closest("[data-service=tick]")) return;
    const tile = event.target.closest("[data-item-id]");
    if (!tile) return;
    const item = this.item_list.get({ hub_id: tile.dataset.hubId, nid: tile.dataset.itemId });
    if (!item) return;
    if (!this.finder.selection.has(item)) this.finder.selection.set([item]);
    this.pointer_id = event.pointerId; this.start = { x: event.clientX, y: event.clientY }; this.dragging = false;
    this.move = (move) => this.onMove(move); this.up = (up) => this.onUp(up);
    const document = tile.ownerDocument;
    document.addEventListener("pointermove", this.move); document.addEventListener("pointerup", this.up); document.addEventListener("pointercancel", this.up);
    if (typeof tile.setPointerCapture === "function") tile.setPointerCapture(event.pointerId);
  }

  onMove(event) {
    if (event.pointerId !== this.pointer_id) return;
    if (!this.dragging && Math.hypot(event.clientX - this.start.x, event.clientY - this.start.y) < this.threshold) return;
    this.dragging = true;
    this.finder.el.dataset.itemDragging = "true";
  }

  async onUp(event) {
    if (event.pointerId !== this.pointer_id) return;
    const dragging = this.dragging;
    this.cleanupGesture();
    if (!dragging) return;
    const target_element = this.finder.el.ownerDocument.elementFromPoint(event.clientX, event.clientY);
    const target_root = target_element && target_element.closest("[data-finder-id]");
    const target = target_root && target_root.__drumee_finder;
    if (target && target !== this.finder) await this.finder.transferTo(target);
  }

  cleanupGesture() {
    if (this.item_list) {
      const document = this.item_list.el.ownerDocument;
      document.removeEventListener("pointermove", this.move); document.removeEventListener("pointerup", this.up); document.removeEventListener("pointercancel", this.up);
    }
    if (this.finder && this.finder.el) delete this.finder.el.dataset.itemDragging;
    this.dragging = false; this.pointer_id = null;
  }

  detach() { this.cleanupGesture(); for (const [target, name, listener] of this.listeners) target.removeEventListener(name, listener); this.listeners = []; this.item_list = null; }
  destroy() { this.detach(); }
}

module.exports = { FinderDragController };
