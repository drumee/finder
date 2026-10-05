"use strict";

const { Emitter } = require("./emitter");

class DownloadController extends Emitter {
  constructor({ transfer_client } = {}) { super(); this.transfer_client = transfer_client; this.active = new Set(); }
  async prepare(items) {
    const roots = items.map((item) => ({ hub_id: item.hub_id, nid: item.nid }));
    const job = await this.transfer_client.downloadPrepare({ roots });
    this.active.add(job.transfer_id); this.emit("status", job); return job;
  }
  async waitUntilReady(transfer_id, { interval = 50, attempts = 120 } = {}) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const state = await this.status(transfer_id);
      if (state.status === "ready") return state;
      if (["failed", "cancelled"].includes(state.status)) throw Object.assign(new Error(`Download ${state.status}`), { code: `MFS_DOWNLOAD_${state.status.toUpperCase()}` });
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw Object.assign(new Error("Download preparation timed out"), { code: "MFS_DOWNLOAD_TIMEOUT" });
  }
  async download(items, { filename = "drumee-download.zip", document = globalThis.document, URL = globalThis.URL } = {}) {
    const job = await this.prepare(items);
    try {
      if (job.status !== "ready") await this.waitUntilReady(job.transfer_id);
      const result = await this.retrieve(job.transfer_id);
      if (result && Object.hasOwn(result, "data")) throw Object.assign(new Error("Download retrieval must use the Nginx data plane"), { code: "MFS_DOWNLOAD_DATA_PLANE_INVALID" });
      if (document && result && result.url) {
        const anchor = document.createElement("a"); anchor.href = result.url; anchor.download = result.filename || filename; anchor.hidden = true; document.body.append(anchor); anchor.click(); anchor.remove();
      }
      return result;
    } finally {
      if (this.active.has(job.transfer_id)) await this.release(job.transfer_id).catch(() => { this.active.delete(job.transfer_id); });
    }
  }
  async status(transfer_id) { const state = await this.transfer_client.downloadStatus({ transfer_id }); this.emit("status", state); return state; }
  retrieve(transfer_id) { return this.transfer_client.downloadRetrieve({ transfer_id }); }
  async cancel(transfer_id) { const result = await this.transfer_client.downloadCancel({ transfer_id }); this.active.delete(transfer_id); this.emit("cancelled", result); return result; }
  async release(transfer_id) { const result = await this.transfer_client.downloadRelease({ transfer_id }); this.active.delete(transfer_id); return result; }
  async destroy() { if (this.destroyed) return; this.destroyed = true; await Promise.all([...this.active].map((id) => this.cancel(id).catch(() => {}))); this.removeAllListeners(); }
}

module.exports = { DownloadController };
