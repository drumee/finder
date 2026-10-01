"use strict";

class MfsTransferClient {
  constructor({ transport } = {}) { if (!transport) throw new Error("MfsTransferClient requires a request transport"); this.transport = transport; }
  call(method, payload) { const fn = this.transport.postService || this.transport.fetchService || this.transport.call; if (typeof fn !== "function") throw new Error("MFS transfer transport is invalid"); return fn.call(this.transport, `mfs-transfer.${method}`, payload); }
  uploadBinary(payload, body) { if (typeof this.transport.uploadBinary !== "function") throw new Error("MFS transfer binary transport is unavailable"); return this.transport.uploadBinary("mfs-transfer.upload_chunk", payload, body); }
  uploadStart(payload) { return this.call("upload_start", payload); }
  uploadChunk(payload, body) { return this.uploadBinary(payload, body); }
  uploadStatus(payload) { return this.call("upload_status", payload); }
  uploadComplete(payload) { return this.call("upload_complete", payload); }
  uploadAbort(payload) { return this.call("upload_abort", payload); }
  downloadPrepare(payload) { return this.call("download_prepare", payload); }
  downloadStatus(payload) { return this.call("download_status", payload); }
  downloadCancel(payload) { return this.call("download_cancel", payload); }
  downloadRetrieve(payload) { return this.call("download_retrieve", payload); }
  downloadRelease(payload) { return this.call("download_release", payload); }
}

module.exports = { MfsTransferClient };
