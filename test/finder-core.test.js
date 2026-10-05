"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { FinderSelection } = require("../lib/finder-selection");
const { MfsSync } = require("../lib/mfs-sync");
const { normalizedRectangle, intersects } = require("../lib/geometry");
const { FinderTransferPolicy } = require("../lib/transfer-policy");
const { DownloadController } = require("../lib/download-controller");
const { UploadController, bundleEntry, forestFromFiles, scanDataTransfer } = require("../lib/upload-controller");
const { MfsTransferClient } = require("../lib/mfs-transfer-client");
const { MediaClient } = require("../lib/media-client");
const { normalizePublicNode } = require("../lib/public-node");

const hub_x = "a000000000000001";
const hub_y = "b000000000000002";
const location_x = { hub_id: hub_x, nid: "1000000000000001" };

test("public nodes normalize logical parents and exclude physical fields", () => {
  const node = normalizePublicNode({ nid: "2000000000000001", parent_id: location_x.nid, filename: "safe.txt", filetype: "file", db_name: "private", storage_ref: "/private", payload_ref: { path: "/private" } }, hub_x);
  assert.deepEqual(node.parent, location_x);
  assert.equal(node.db_name, undefined);
  assert.equal(node.storage_ref, undefined);
  assert.equal(node.payload_ref, undefined);
});

test("single, checkbox and drag semantics share one selection authority", () => {
  const selection = new FinderSelection();
  const a = { hub_id: hub_x, nid: "2000000000000001" };
  const c = { hub_id: hub_x, nid: "2000000000000003" };
  selection.set([a]);
  selection.toggle(c);
  assert.deepEqual(selection.getItems().map((item) => item.nid), [a.nid, c.nid]);
  selection.toggle(a);
  assert.deepEqual(selection.getItems(), [c]);
});

test("marquee geometry normalizes every direction and uses inclusive intersection", () => {
  for (const point of [{ x: 40, y: 50 }, { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 50 }]) {
    const rect = normalizedRectangle({ x: 20, y: 25 }, point);
    assert.ok(rect.left <= rect.right && rect.top <= rect.bottom);
  }
  assert.equal(intersects({ left: 0, right: 10, top: 0, bottom: 10 }, { left: 10, right: 20, top: 10, bottom: 20 }), true);
});

test("transfer policy moves within a hub and copies across hubs", async () => {
  const calls = [];
  const policy = new FinderTransferPolicy({ mfs_client: {
    async move(nodes, destination) { calls.push(["move", nodes, destination]); return "moved"; },
    async copy(nodes, destination) { calls.push(["copy", nodes, destination]); return "copied"; }
  } });
  const item = { hub_id: hub_x, nid: "3000000000000001" };
  assert.equal((await policy.transfer({ source: { location: location_x }, target: { location: { hub_id: hub_x, nid: "1000000000000002" } }, items: [item] })).action, "move");
  assert.equal((await policy.transfer({ source: { location: location_x }, target: { location: { hub_id: hub_y, nid: "1000000000000003" } }, items: [item] })).action, "copy");
  assert.deepEqual(calls.map((call) => call[0]), ["move", "copy"]);
  await assert.rejects(() => policy.transfer({ source: { location: location_x }, target: { location: item }, items: [item] }), { code: "MFS_DESTINATION_INVALID" });
});

test("MediaClient exposes allowlisted logical representation URLs only", () => {
  const calls = [];
  const client = new MediaClient({ transport: { serviceUrl(service, node) { calls.push([service, node]); return `/-/svc/${service}?hub_id=${node.hub_id}&nid=${node.nid}`; } } });
  const url = client.representation({ ...location_x, db_name: "private", storage_ref: "/private" }, "thumb");
  assert.match(url, /^\/-\/svc\/media\.thumb\?/);
  assert.deepEqual(calls[0], ["media.thumb", location_x]);
  assert.throws(() => client.representation(location_x, "generator-name"), { code: "MEDIA_REPRESENTATION_INVALID" });
});

test("MfsSync filters scopes, deduplicates echoes, reconciles and unregisters", async () => {
  const listeners = new Map();
  const websocket = { bindEvent(name, fn) { listeners.set(name, fn); }, unbindEvent(name) { listeners.delete(name); }, on(name, fn) { listeners.set(name, fn); }, off(name) { listeners.delete(name); } };
  const sync = new MfsSync({ websocket });
  const calls = [];
  const a = { finder_id: "a", location: location_x, hasItem: () => false, applyMfsEvent: (event) => calls.push(["a", event.type]), refresh: async () => calls.push(["refresh-a"]) };
  const b = { finder_id: "b", location: { hub_id: hub_y, nid: "1000000000000002" }, hasItem: () => false, applyMfsEvent: (event) => calls.push(["b", event.type]), refresh: async () => calls.push(["refresh-b"]) };
  sync.register(a); const remove_b = sync.register(b);
  listeners.get("mfs.event")({ type: "node.created", operation_id: "op-1", destination: location_x });
  listeners.get("mfs.event")({ type: "node.created", operation_id: "op-1", destination: location_x });
  assert.deepEqual(calls, [["a", "node.created"]]);
  await listeners.get("connected")();
  assert.ok(calls.some((entry) => entry[0] === "refresh-a"));
  remove_b(); sync.destroy();
  assert.equal(listeners.size, 0);
});

test("MfsSync routes changes to the open node itself and binds only once", async () => {
  const bound = [];
  const unbound = [];
  const websocket = {
    bindEvent(name, listener) { bound.push([name, listener]); },
    unbindEvent(name, listener) { unbound.push([name, listener]); },
    on(name, listener) { bound.push([name, listener]); },
    off(name, listener) { unbound.push([name, listener]); }
  };
  const sync = new MfsSync({ websocket });
  const events = [];
  const finder = {
    finder_id: "open-folder",
    location: location_x,
    hasItem: () => false,
    applyMfsEvent: (event) => events.push(event.type),
    refresh: async () => {}
  };
  sync.register(finder);
  bound.find(([name]) => name === "mfs.event")[1]({
    type: "node.renamed",
    operation_id: "rename-open-folder",
    node: location_x,
    result: { ...location_x, filename: "Renamed" }
  });
  assert.deepEqual(events, ["node.renamed"]);
  sync.destroy();
  sync.destroy();
  assert.deepEqual(bound.map(([name]) => name), ["mfs.event", "connected"]);
  assert.deepEqual(unbound.map(([name]) => name), ["mfs.event", "connected"]);
});

test("mixed upload forest preserves explicit empty folders and uploads into real parent nids", async () => {
  const empty = { name: "Empty", isDirectory: true, isFile: false, createReader: () => ({ readEntries: (resolve) => resolve([]) }) };
  const folder = { name: "Pictures", isDirectory: true, isFile: false, createReader: () => { let read = false; return { readEntries(resolve) { resolve(read ? [] : (read = true, [empty])); } }; } };
  const loose_file = new Blob(["loose"]); loose_file.name = "loose.txt";
  const loose = { name: "loose.txt", isDirectory: false, isFile: true, file: (resolve) => resolve(loose_file) };
  const forest = await scanDataTransfer({ items: [folder, loose].map((value) => ({ webkitGetAsEntry: () => value })) });
  assert.equal(forest[0].children[0].kind, "folder");
  assert.equal(forest[0].children[0].children.length, 0);
  const calls = [];
  let serial = 0;
  const controller = new UploadController({
    mfs_client: { async mkdir(destination, name) { const result = { hub_id: destination.hub_id, nid: `000000000000000${++serial}`, filename: name }; calls.push(["mkdir", destination.nid, name, result.nid]); return { result }; } },
    transfer_client: {
      async uploadStart(input) { calls.push(["start", input.destination.nid, input.metadata.filename]); return { transfer_id: `t-${serial}` }; },
      async uploadChunk() {}, async uploadComplete() { return { result: { nid: "9000000000000001" } }; }, async uploadAbort() {}
    }
  });
  await controller.uploadForest(forest, location_x);
  assert.ok(calls.some((call) => call[0] === "mkdir" && call[2] === "Empty"));
  assert.ok(calls.some((call) => call[0] === "start" && call[1] === location_x.nid && call[2] === "loose.txt"));
});

test("one upload operation accepts multiple recursive folders plus standalone files", async () => {
  const file = (name, value) => { const source = new Blob([value]); source.name = name; return bundleEntry("file", name, name, source); };
  const folder_a = bundleEntry("folder", "FolderA", "FolderA");
  const sub = bundleEntry("folder", "Sub", "FolderA/Sub");
  sub.children = [file("b.txt", "b")];
  folder_a.children = [file("a.txt", "a"), sub];
  const folder_b = bundleEntry("folder", "FolderB", "FolderB");
  const empty = bundleEntry("folder", "Empty", "FolderB/Empty");
  folder_b.children = [empty];
  const forest = [folder_a, folder_b, file("loose-1.txt", "one"), file("loose-2.txt", "two")];
  const directories = [];
  const uploads = [];
  let id = 100;
  let transfer = 0;
  const controller = new UploadController({
    mfs_client: { async mkdir(destination, name) { const result = { hub_id: destination.hub_id, nid: (++id).toString(16).padStart(16, "0"), filename: name }; directories.push({ destination, name, result }); return { result }; } },
    transfer_client: {
      async uploadStart(input) { const value = { transfer_id: `transfer-${++transfer}` }; uploads.push({ ...input, transfer_id: value.transfer_id }); return value; },
      async uploadChunk() {}, async uploadComplete() { return { result: { nid: (++id).toString(16).padStart(16, "0") } }; }, async uploadAbort() {}
    }
  });
  await controller.uploadForest(forest, location_x);
  assert.deepEqual(directories.map((item) => item.name), ["FolderA", "Sub", "FolderB", "Empty"]);
  assert.deepEqual(uploads.map((item) => item.metadata.filename).sort(), ["a.txt", "b.txt", "loose-1.txt", "loose-2.txt"]);
  const folder_a_id = directories.find((item) => item.name === "FolderA").result.nid;
  const sub_id = directories.find((item) => item.name === "Sub").result.nid;
  assert.equal(directories.find((item) => item.name === "Sub").destination.nid, folder_a_id);
  assert.equal(uploads.find((item) => item.metadata.filename === "b.txt").destination.nid, sub_id);
  assert.ok(uploads.filter((item) => item.metadata.filename.startsWith("loose-")).every((item) => item.destination.nid === location_x.nid));
});

test("file-picker paths form a recursive forest and chunk uploads are bounded and retryable", async () => {
  const nested = new Blob(["abcdef"]); nested.name = "b.txt"; Object.defineProperty(nested, "webkitRelativePath", { value: "Folder/Sub/b.txt" });
  const loose = new Blob(["xy"]); loose.name = "loose.txt";
  const forest = forestFromFiles([nested, loose]);
  assert.deepEqual(forest.map((item) => [item.kind, item.name]), [["folder", "Folder"], ["file", "loose.txt"]]);
  assert.equal(forest[0].children[0].children[0].relpath, "Folder/Sub/b.txt");

  const attempts = new Map();
  const progress = [];
  const controller = new UploadController({
    chunk_threshold: 3,
    chunk_size: 2,
    chunk_concurrency: 2,
    mfs_client: { async mkdir(destination, name) { return { result: { hub_id: destination.hub_id, nid: `${destination.nid}-${name}`, filename: name } }; } },
    transfer_client: {
      async uploadStart() { return { transfer_id: "chunked-1", chunk_size: 2 }; },
      async uploadChunk({ index }, body) { assert.ok(body instanceof Blob); const count = (attempts.get(index) || 0) + 1; attempts.set(index, count); if (index === 1 && count === 1) throw new Error("retry"); return { uploaded: Math.min(6, (index + 1) * 2) }; },
      async uploadComplete() { return { result: { hub_id: hub_x, nid: "9000000000000002" } }; },
      async uploadAbort() {}
    }
  });
  controller.on("progress", (value) => progress.push(value.loaded));
  await controller.uploadForest(forest, location_x);
  assert.equal(attempts.size, 3);
  assert.equal(attempts.get(1), 2);
  assert.ok(progress.length >= 4);
});

test("upload resume skips committed chunks and invalid geometry retains no active transfer", async () => {
  const sent = [];
  const resumed = new UploadController({
    mfs_client: {},
    transfer_client: {
      async uploadStart() { return { transfer_id: "resume-1", chunk_size: 2, chunks: [0, 2] }; },
      async uploadChunk({ index }) { sent.push(index); return { uploaded: 6 }; },
      async uploadComplete() { return { result: { ...location_x, nid: "resume-node" } }; },
      async uploadAbort() {}
    }
  });
  const source = new Blob(["abcdef"]);
  await resumed.uploadFile(bundleEntry("file", "resume.txt", "resume.txt", source), location_x);
  assert.deepEqual(sent, [1]);
  const invalid = new UploadController({
    mfs_client: {},
    transfer_client: { async uploadStart() { return { transfer_id: "invalid-1", chunk_size: -1 }; }, async uploadAbort() {} }
  });
  await assert.rejects(() => invalid.uploadFile(bundleEntry("file", "invalid.txt", "invalid.txt", source), location_x), /invalid chunk geometry/);
  assert.equal(invalid.active.size, 0);
});

test("MfsTransferClient keeps binary chunks out of structured service calls", async () => {
  const calls = [];
  const client = new MfsTransferClient({ transport: {
    postService(service, input) { calls.push(["structured", service, input]); return {}; },
    uploadBinary(service, input, body) { calls.push(["binary", service, input, body]); return { uploaded: body.size }; }
  } });
  await client.uploadStart({ size: 7 });
  const body = new Blob(["payload"]);
  await client.uploadChunk({ transfer_id: "upload-1", index: 0 }, body);
  assert.deepEqual(calls.map((entry) => entry.slice(0, 2)), [["structured", "mfs-transfer.upload_start"], ["binary", "mfs-transfer.upload_chunk"]]);
  assert.equal(calls[1][3], body);
});

test("download controller delegates Nginx retrieval without buffering archive bytes", async () => {
  const calls = [];
  let polls = 0;
  const controller = new DownloadController({ transfer_client: {
    async downloadPrepare({ roots }) { calls.push(["prepare", roots]); return { transfer_id: "download-1", status: "preparing" }; },
    async downloadStatus() { calls.push(["status"]); return { transfer_id: "download-1", status: ++polls > 1 ? "ready" : "preparing" }; },
    async downloadRetrieve() { calls.push(["retrieve"]); return { url: "/-/svc/mfs-transfer.download_retrieve?transfer_id=download-1", filename: "archive.zip" }; },
    async downloadRelease() { calls.push(["release"]); return { released: true }; },
    async downloadCancel() { calls.push(["cancel"]); return { cancelled: true }; }
  } });
  const anchor = { click() { calls.push(["click", this.href]); }, remove() {}, hidden: false };
  const document = { body: { append() {} }, createElement() { return anchor; } };
  const URL = { createObjectURL() { throw new Error("archive bytes must not be buffered into a Blob URL"); }, revokeObjectURL() {} };
  const result = await controller.download([{ hub_id: hub_x, nid: "7000000000000001" }, { hub_id: hub_y, nid: "7000000000000002" }], { document, URL });
  assert.equal(result.url, "/-/svc/mfs-transfer.download_retrieve?transfer_id=download-1");
  assert.equal(Object.hasOwn(result, "data"), false);
  assert.deepEqual(calls.map((call) => call[0]), ["prepare", "status", "status", "retrieve", "click", "release"]);
  assert.equal(anchor.href, result.url);
  assert.equal(controller.active.size, 0);
});

test("failed download retrieval releases its bounded server artifact", async () => {
  const calls = [];
  const controller = new DownloadController({ transfer_client: {
    async downloadPrepare() { return { transfer_id: "failed-1", status: "ready" }; },
    async downloadRetrieve() { calls.push("retrieve"); throw Object.assign(new Error("network disconnected"), { code: "NETWORK_DISCONNECTED" }); },
    async downloadRelease() { calls.push("release"); return { released: true }; },
    async downloadCancel() { calls.push("cancel"); return { cancelled: true }; }
  } });
  await assert.rejects(() => controller.download([{ ...location_x, nid: "failed-node" }], { document: null, URL: null }), { code: "NETWORK_DISCONNECTED" });
  assert.deepEqual(calls, ["retrieve", "release"]);
  assert.equal(controller.active.size, 0);
});

test("production Finder code contains no historical global selection or Desk coupling", () => {
  const root = path.resolve(__dirname, "../lib");
  const source = fs.readdirSync(root).filter((name) => name.endsWith(".js")).map((name) => fs.readFileSync(path.join(root, name), "utf8")).join("\n");
  for (const forbidden of ["Wm.getGlobalSelection", "window.Selector", "RADIO_POINTER", "Wm.capture", "@drumee/system-mfs"]) assert.equal(source.includes(forbidden), false, forbidden);
  const finder_source = fs.readFileSync(path.join(root, "finder.js"), "utf8");
  assert.equal(finder_source.includes("@drumee/window-manager"), false);
  const upload_source = fs.readFileSync(path.join(root, "upload-controller.js"), "utf8");
  assert.doesNotMatch(upload_source, /Array\.from\s*\(\s*new Uint8Array|\.arrayBuffer\s*\(/);
});
