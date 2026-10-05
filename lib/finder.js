"use strict";

const { LetcBox } = require("@drumee/ui-runtime");
const finderSkeleton = require("../skeleton/finder");
const { DownloadController } = require("./download-controller");
const { FinderDragController } = require("./drag-controller");
const { FinderSelection } = require("./finder-selection");
const { ItemList } = require("./item-list");
const { SelectionMarquee } = require("./selection-marquee");
const { FinderTransferPolicy } = require("./transfer-policy");
const { TransferProgressView } = require("./transfer-progress-view");
const { UploadController } = require("./upload-controller");

let serial = 0;
function operationId() { return globalThis.crypto && typeof globalThis.crypto.randomUUID === "function" ? globalThis.crypto.randomUUID() : `finder-${Date.now()}-${++serial}`; }

function registerFinderKinds(runtime) {
  for (const [kind, Widget] of Object.entries({ finder: Finder, finder_item_list: ItemList, finder_selection_marquee: SelectionMarquee, finder_transfer_progress: TransferProgressView })) {
    const existing = runtime.Kind.get(kind);
    if (existing && existing !== Widget) throw new Error(`${kind} is already owned by another implementation`);
    if (!existing) runtime.Kind.register(kind, Widget);
  }
}

class Finder extends LetcBox {
  static figName = "drumee_finder";

  initialize(options = {}) {
    super.initialize(options);
    this.finder_id = options.finder_id || `finder-${++serial}`;
    this.location = { ...(options.location || this.mget("location")) };
    if (!this.location.hub_id || !this.location.nid) throw new Error("Finder requires location { hub_id, nid }");
    this.mfs_client = options.mfs_client || this.mget("mfs_client");
    this.media_client = options.media_client || this.mget("media_client");
    this.mfs_sync = options.mfs_sync || this.mget("mfs_sync");
    this.transfer_client = options.transfer_client || this.mget("transfer_client");
    if (!this.mfs_client) throw new Error("Finder requires MfsClient");
    this.selection = new FinderSelection();
    this.transfer_policy = options.transfer_policy || new FinderTransferPolicy({ mfs_client: this.mfs_client });
    this.upload_controller = options.upload_controller || (this.transfer_client ? new UploadController({ mfs_client: this.mfs_client, transfer_client: this.transfer_client }) : null);
    this.download_controller = options.download_controller || (this.transfer_client ? new DownloadController({ transfer_client: this.transfer_client }) : null);
    this.owns_upload_controller = options.own_upload_controller == null ? !options.upload_controller : Boolean(options.own_upload_controller);
    this.owns_download_controller = options.own_download_controller == null ? !options.download_controller : Boolean(options.own_download_controller);
    this.drag_controller = new FinderDragController({ finder: this });
    this.initial_location = { ...this.location }; this.history = [{ ...this.location }]; this.history_index = 0; this.items = new Map(); this.next_cursor = null; this.destroyed = false; this.refresh_serial = 0;
    this.declareHandlers();
    this.collection.reset(finderSkeleton(this));
  }

  onDomRefresh() {
    this.el.dataset.kind = "finder"; this.el.dataset.finderId = this.finder_id; this.el.__drumee_finder = this;
    this.el.classList.add("drumee-finder");
    if (this.lifecycle_bound) return;
    this.lifecycle_bound = true;
    this.file_input = this.el.ownerDocument.createElement("input");
    this.file_input.type = "file"; this.file_input.multiple = true; this.file_input.hidden = true;
    this.file_change_listener = () => this.uploadFiles(this.file_input.files).catch((error) => this.presentError(error, "upload"));
    this.file_input.addEventListener("change", this.file_change_listener);
    this.el.append(this.file_input);
    this.selection_listener = () => this.item_list && this.item_list.projectSelection();
    this.selection.on("change", this.selection_listener);
    this.resize_observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.invalidateBounds()) : null;
    if (this.resize_observer) this.resize_observer.observe(this.el);
    this.sync_unregister = this.mfs_sync && this.mfs_sync.register(this);
    queueMicrotask(() => { if (!this.destroyed) this.refresh(); });
  }

  onPartReady(part, name) {
    if (name === "item-list") this.item_list = part;
    if (name === "selection-marquee") this.selection_marquee = part;
    if (name === "breadcrumb" && !this.breadcrumb_listener) {
      this.breadcrumb_part = part;
      this.breadcrumb_listener = (event) => { event.preventDefault(); event.stopImmediatePropagation(); this.navigateBreadcrumb(this.initial_location).catch((error) => this.presentError(error, "navigation")); };
      part.el.addEventListener("click", this.breadcrumb_listener);
    }
    if (this.item_list && this.selection_marquee && !this.interactions_ready) {
      this.interactions_ready = true;
      this.selection_marquee.attach(this.item_list);
      this.drag_controller.attach(this.item_list);
      this.preview_observer = typeof IntersectionObserver === "function" ? new IntersectionObserver((entries) => {
        for (const observed of entries) if (observed.isIntersecting) { this.preview_observer.unobserve(observed.target); this.activatePreview(observed.target); }
      }, { root: this.item_list.el, rootMargin: "600px" }) : null;
    }
  }

  onUiEvent(source) {
    switch (source.mget("service")) {
      case "back": return this.back();
      case "forward": return this.forward();
      case "up": return this.up();
      case "breadcrumb-root": return this.navigateBreadcrumb(this.initial_location);
      case "download": return this.downloadSelection();
      case "upload": if (this.file_input) this.file_input.click(); return undefined;
      default: return undefined;
    }
  }

  async refresh({ reconciliation = false } = {}) {
    if (this.destroyed) return [];
    const refresh_serial = ++this.refresh_serial;
    const location = { ...this.location };
    const [response, current] = await Promise.all([
      this.mfs_client.list(location, { limit: 100 }),
      this.mfs_client.get(location)
    ]);
    if (this.destroyed || refresh_serial !== this.refresh_serial || location.hub_id !== this.location.hub_id || location.nid !== this.location.nid) return [];
    const value = response.result || response;
    const items = value.items || value;
    this.next_cursor = value.next_cursor || null;
    this.items = new Map((items || []).map((item) => [`${item.hub_id || this.location.hub_id}:${item.nid}`, { hub_id: item.hub_id || this.location.hub_id, ...item }]));
    if (this.item_list) this.item_list.setItems([...this.items.values()]);
    const current_node = current && (current.result || current);
    this.current_title = current_node && current_node.filename || this.mget("title") || this.location.nid;
    this.updateBreadcrumb();
    this.trigger("location:change", { finder: this, location: { ...this.location }, title: this.current_title });
    this.trigger("listing:change", { finder: this, reconciliation, items: [...this.items.values()] });
    return items;
  }

  async loadMore() {
    if (!this.next_cursor) return [];
    const response = await this.mfs_client.list(this.location, { cursor: this.next_cursor, limit: 100 });
    const value = response.result || response;
    for (const item of value.items || []) this.items.set(`${item.hub_id || this.location.hub_id}:${item.nid}`, { hub_id: item.hub_id || this.location.hub_id, ...item });
    this.next_cursor = value.next_cursor || null;
    this.item_list.setItems([...this.items.values()]);
    return value.items || [];
  }

  async navigate(location, { history = true } = {}) {
    if (!location || !location.hub_id || !location.nid) throw new Error("Finder navigation requires location { hub_id, nid }");
    this.refresh_serial++;
    this.cancelInteractions(); this.selection.clear(); this.items.clear(); if (this.item_list) this.item_list.setItems([]);
    this.location = { hub_id: location.hub_id, nid: location.nid };
    if (history) { this.history = this.history.slice(0, this.history_index + 1); this.history.push({ ...this.location }); this.history_index++; }
    await this.refresh();
  }

  async open(item) { if (!["folder", "root"].includes(item.filetype)) return false; await this.navigate({ hub_id: item.hub_id, nid: item.nid }); return true; }
  async back() { if (this.history_index < 1) return false; this.history_index--; await this.navigate(this.history[this.history_index], { history: false }); return true; }
  async forward() { if (this.history_index >= this.history.length - 1) return false; this.history_index++; await this.navigate(this.history[this.history_index], { history: false }); return true; }
  async up() { const node = await this.mfs_client.get(this.location); const item = node.result || node; if (!item || !item.parent_id || item.parent_id === "0") return false; await this.navigate({ hub_id: this.location.hub_id, nid: item.parent_id }); return true; }
  async navigateBreadcrumb(location) { await this.navigate(location); return true; }

  async activatePreview(element) {
    const tile = element && element.closest("[data-item-id]");
    const item = tile && this.item_list && this.item_list.get({ hub_id: tile.dataset.hubId, nid: tile.dataset.itemId });
    if (!item || !this.media_client || item.filetype !== "file") { if (element) element.dataset.preview = "visible"; return null; }
    const mimetype = String(item.mimetype || "");
    const representation = mimetype.startsWith("image/") ? "thumb" : mimetype.startsWith("video/") ? "video" : mimetype ? "document" : "preview";
    try {
      const url = await this.media_client.representation(item, representation);
      if (!this.destroyed && element.isConnected) { element.dataset.preview = "visible"; element.dataset.representation = representation; element.dataset.representationUrl = url; }
      return url;
    } catch (error) {
      if (!this.destroyed && element.isConnected) element.dataset.preview = "unavailable";
      this.presentError(error, "preview"); return null;
    }
  }

  updateBreadcrumb() {
    const breadcrumb = this.getPart("breadcrumb");
    if (!breadcrumb) return;
    if (!this.breadcrumb_listener) {
      this.breadcrumb_part = breadcrumb;
      this.breadcrumb_listener = (event) => { event.preventDefault(); event.stopImmediatePropagation(); this.navigateBreadcrumb(this.initial_location).catch((error) => this.presentError(error, "navigation")); };
      breadcrumb.el.addEventListener("click", this.breadcrumb_listener);
    }
    if (typeof breadcrumb.set === "function") breadcrumb.set({ content: `${this.location.hub_id} / ${this.current_title || this.location.nid}` });
  }
  hasItem(identity) { return this.items.has(`${identity.hub_id}:${identity.nid}`); }
  invalidateBounds() { if (this.item_list) this.item_list.invalidateBounds(); }
  cancelInteractions() { if (this.selection_marquee) this.selection_marquee.cancel(); if (this.drag_controller) this.drag_controller.cleanupGesture(); this.invalidateBounds(); }

  async transferTo(target) {
    const items = this.selection.getItems(); if (!items.length) return null;
    try { return await this.transfer_policy.transfer({ source: this, target, items, operation_id: operationId() }); }
    catch (error) {
      this.presentError(error, "transfer");
      await Promise.all([this.refresh({ reconciliation: true }).catch(() => {}), target && target.finder && target.finder !== this ? target.finder.refresh({ reconciliation: true }).catch(() => {}) : null]);
      throw error;
    }
  }

  applyMfsEvent(event) {
    const result = event.result && event.result.result || event.result;
    const current_event = event.node && event.node.hub_id === this.location.hub_id && event.node.nid === this.location.nid;
    if (current_event && event.type === "node.removed") {
      this.cancelInteractions(); this.selection.clear(); this.items.clear(); if (this.item_list) this.item_list.setItems([]);
      this.presentError(Object.assign(new Error("Current folder is unavailable"), { code: "MFS_LOCATION_UNAVAILABLE" }), "sync");
      this.trigger("location:invalid", { finder: this, location: { ...this.location }, code: "MFS_LOCATION_UNAVAILABLE" });
      return;
    }
    if (current_event && event.type === "node.renamed" && result) {
      this.current_title = result.filename || this.current_title; this.updateBreadcrumb();
      this.trigger("location:change", { finder: this, location: { ...this.location }, title: this.current_title });
    }
    if (event.type === "node.removed" || (event.type === "node.moved" && event.source_parent && event.source_parent.nid === this.location.nid && event.source_parent.hub_id === this.location.hub_id)) {
      const removed = event.node ? [event.node] : result && result.nodes || [];
      for (const item of removed) { const identity = { hub_id: item.hub_id, nid: item.nid }; this.items.delete(`${identity.hub_id}:${identity.nid}`); this.item_list.remove(identity); }
    }
    if (["node.created", "node.copied"].includes(event.type) && event.destination && event.destination.nid === this.location.nid && event.destination.hub_id === this.location.hub_id) {
      const created = result && result.nid ? [result] : result && result.nodes || [];
      for (const value of created) {
        const item = value.item || value;
        if (!item || !item.nid) continue;
        const normalized = { hub_id: item.hub_id || this.location.hub_id, ...item };
        this.items.set(`${normalized.hub_id}:${normalized.nid}`, normalized);
        this.item_list.upsert(normalized);
      }
    }
    if (event.type === "node.moved" && event.destination && event.destination.nid === this.location.nid && event.destination.hub_id === this.location.hub_id) {
      for (const item of result && result.nodes || []) { const normalized = { hub_id: item.hub_id || this.location.hub_id, ...item }; this.items.set(`${normalized.hub_id}:${normalized.nid}`, normalized); this.item_list.upsert(normalized); }
    }
    if (event.type === "node.renamed" && event.node && this.hasItem(event.node) && result) { const normalized = { ...this.items.get(`${event.node.hub_id}:${event.node.nid}`), ...result }; this.items.set(`${event.node.hub_id}:${event.node.nid}`, normalized); this.item_list.upsert(normalized); if (this.selection.has(event.node)) this.selection.selectCanonical(normalized); }
  }

  presentError(error, context = "operation") {
    const code = error && error.code || "FINDER_OPERATION_FAILED";
    const messages = {
      MFS_DESTINATION_INVALID: "The destination is invalid",
      MFS_LOCATION_UNAVAILABLE: "The current folder is unavailable",
      MFS_UPLOAD_CANCELLED: "Upload cancelled",
      MFS_DOWNLOAD_CANCELLED: "Download cancelled",
      MFS_DOWNLOAD_FAILED: "Download failed",
      NETWORK_DISCONNECTED: "Network disconnected",
      MEDIA_REPRESENTATION_INVALID: "Media preview is unavailable"
    };
    this.last_error = { code, context, message: messages[code] || "Finder operation failed" };
    this.trigger("finder:error", { finder: this, ...this.last_error });
    return this.last_error;
  }

  uploadForest(forest) { if (!this.upload_controller) throw new Error("Finder upload controller is not configured"); return this.upload_controller.uploadForest(forest, this.location); }
  uploadFiles(files) { if (!this.upload_controller) throw new Error("Finder upload controller is not configured"); return this.upload_controller.uploadForest(this.upload_controller.scanFiles(files), this.location); }
  downloadSelection() { if (!this.download_controller) throw new Error("Finder download controller is not configured"); return this.download_controller.download(this.selection.getItems()); }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; this.cancelInteractions();
    this.refresh_serial++;
    if (this.sync_unregister) this.sync_unregister();
    if (this.resize_observer) this.resize_observer.disconnect();
    if (this.preview_observer) this.preview_observer.disconnect();
    if (this.drag_controller) this.drag_controller.destroy();
    if (this.upload_controller && this.owns_upload_controller) this.upload_controller.destroy();
    if (this.download_controller && this.owns_download_controller) this.download_controller.destroy();
    if (this.file_input) { this.file_input.removeEventListener("change", this.file_change_listener); this.file_input.remove(); }
    if (this.breadcrumb_part && this.breadcrumb_listener) this.breadcrumb_part.el.removeEventListener("click", this.breadcrumb_listener);
    this.selection.destroy(); this.items.clear(); delete this.el.__drumee_finder;
    super.destroy();
  }
}

module.exports = { Finder, registerFinderKinds };
