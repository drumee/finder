"use strict";

const { Emitter } = require("./emitter");

const CHUNK_THRESHOLD = 64 * 1024 * 1024;
const CHUNK_SIZE = 8 * 1024 * 1024;

function entry(kind, name, relpath, source = null) {
  return { id: `${kind}:${relpath}`, kind, name, relpath, size: source && source.size || 0, source, children: [], status: "pending", error: null };
}

async function readDirectory(reader) {
  const result = [];
  for (;;) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return result;
    result.push(...batch);
  }
}

async function scanFileSystemEntry(source, parent_path = "") {
  const relpath = parent_path ? `${parent_path}/${source.name}` : source.name;
  if (source.isFile) {
    const file = await new Promise((resolve, reject) => source.file(resolve, reject));
    return entry("file", source.name, relpath, file);
  }
  if (!source.isDirectory) return null;
  const folder = entry("folder", source.name, relpath);
  const children = await readDirectory(source.createReader());
  folder.children = (await Promise.all(children.map((child) => scanFileSystemEntry(child, relpath)))).filter(Boolean);
  return folder;
}

async function scanDataTransfer(data_transfer) {
  const sources = [...(data_transfer.items || [])].map((item) => item.webkitGetAsEntry && item.webkitGetAsEntry()).filter(Boolean);
  if (sources.length) return (await Promise.all(sources.map((source) => scanFileSystemEntry(source)))).filter(Boolean);
  return forestFromFiles(data_transfer.files || []);
}

function forestFromFiles(files) {
  const roots = [];
  const folders = new Map();
  for (const file of [...files]) {
    const parts = String(file.webkitRelativePath || file.name).split("/").filter(Boolean);
    let children = roots;
    let current = "";
    for (const part of parts.slice(0, -1)) {
      current = current ? `${current}/${part}` : part;
      let folder = folders.get(current);
      if (!folder) { folder = entry("folder", part, current); folders.set(current, folder); children.push(folder); }
      children = folder.children;
    }
    children.push(entry("file", parts.at(-1) || file.name, parts.join("/"), file));
  }
  return roots;
}

class UploadController extends Emitter {
  constructor({ mfs_client, transfer_client, file_concurrency = 4, chunk_concurrency = 4, chunk_threshold = CHUNK_THRESHOLD, chunk_size = CHUNK_SIZE } = {}) {
    super(); this.mfs_client = mfs_client; this.transfer_client = transfer_client; this.file_concurrency = file_concurrency; this.chunk_concurrency = chunk_concurrency; this.chunk_threshold = chunk_threshold; this.chunk_size = chunk_size; this.cancelled = false; this.active = new Set();
  }

  scan(data_transfer) { return scanDataTransfer(data_transfer); }
  scanFiles(files) { return forestFromFiles(files); }

  async uploadForest(forest, destination) {
    this.cancelled = false;
    const files = [];
    const create = async (nodes, parent) => {
      for (const node of nodes) {
        if (this.cancelled) throw Object.assign(new Error("Upload cancelled"), { code: "MFS_UPLOAD_CANCELLED" });
        if (node.kind === "folder") {
          node.status = "creating";
          const response = await this.mfs_client.mkdir(parent, node.name);
          const created = response.result || response;
          node.destination = { hub_id: created.hub_id || parent.hub_id, nid: created.nid };
          node.status = "created";
          this.emit("folder-created", node);
          await create(node.children, node.destination);
        } else files.push({ node, destination: parent });
      }
    };
    await create(forest, destination);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(this.file_concurrency, files.length || 1) }, async () => {
      while (!this.cancelled) {
        const index = cursor++;
        if (index >= files.length) return;
        await this.uploadFile(files[index].node, files[index].destination);
      }
    });
    await Promise.all(workers);
    if (this.cancelled) throw Object.assign(new Error("Upload cancelled"), { code: "MFS_UPLOAD_CANCELLED" });
    this.emit("done", forest);
    return forest;
  }

  async uploadFile(node, destination) {
    node.status = "uploading";
    const started = await this.transfer_client.uploadStart({ transfer_id: node.transfer_id, destination, size: node.size, metadata: { filename: node.name, size: node.size, mimetype: node.source.type || "application/octet-stream", filetype: "file" } });
    node.transfer_id = started.transfer_id;
    if (started.status === "done" && started.result) { node.result = started.result; node.status = "done"; return node; }
    if (started.chunks && started.chunks.length) this.emit("resumed", { node, chunks: started.chunks });
    this.active.add(started.transfer_id);
    const chunk_size = Number(started.chunk_size || this.chunk_size);
    if (!Number.isInteger(chunk_size) || chunk_size < 1) throw new Error("Upload server returned invalid chunk geometry");
    const chunks = [];
    for (let offset = 0, index = 0; offset < Math.max(node.size, 1); offset += chunk_size, index++) chunks.push({ index, blob: node.source.slice(offset, Math.min(offset + chunk_size, node.size)) });
    let cursor = 0;
    const completed = new Set(started.chunks || []);
    const pending = chunks.filter((item) => !completed.has(item.index));
    const workers = Array.from({ length: Math.min(this.chunk_concurrency, pending.length || 1) }, async () => {
      for (;;) {
        const item = pending[cursor++];
        if (!item) return;
        if (this.cancelled) throw Object.assign(new Error("Upload cancelled"), { code: "MFS_UPLOAD_CANCELLED" });
        let error;
        for (let attempt = 0; attempt < 3; attempt++) {
          try { const result = await this.transfer_client.uploadChunk({ transfer_id: started.transfer_id, index: item.index }, item.blob); this.emit("progress", { node, loaded: result && Number(result.uploaded) || 0, total: node.size }); error = null; break; }
          catch (caught) { error = caught; await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1))); }
        }
        if (error) throw error;
      }
    });
    try {
      await Promise.all(workers);
      node.result = await this.transfer_client.uploadComplete({ transfer_id: started.transfer_id });
      node.status = "done";
      this.emit("file-done", node);
    } catch (error) {
      node.status = this.cancelled ? "cancelled" : "paused"; node.error = error; this.emit(this.cancelled ? "error" : "paused", { node, error }); throw error;
    } finally { this.active.delete(started.transfer_id); }
  }

  resume(node, destination) { this.cancelled = false; node.error = null; return this.uploadFile(node, destination); }

  async cancel() {
    this.cancelled = true;
    await Promise.all([...this.active].map((transfer_id) => this.transfer_client.uploadAbort({ transfer_id }).catch(() => {})));
    this.active.clear(); this.emit("cancelled");
  }

  destroy() { this.cancel(); this.removeAllListeners(); }
}

module.exports = { CHUNK_SIZE, CHUNK_THRESHOLD, UploadController, bundleEntry: entry, forestFromFiles, scanDataTransfer, scanFileSystemEntry };
