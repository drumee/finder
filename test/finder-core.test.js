"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { FinderSelection } = require("../lib/finder-selection");
const { FinderAccessPolicy } = require("../lib/access-policy");
const { MfsSync } = require("../lib/mfs-sync");
const { normalizedRectangle, intersects } = require("../lib/geometry");
const { FinderTransferPolicy } = require("../lib/transfer-policy");
const { DownloadController } = require("../lib/download-controller");
const { UploadController, bundleEntry, forestFromFiles, scanDataTransfer } = require("../lib/upload-controller");
const { MfsTransferClient } = require("../lib/mfs-transfer-client");
const { MediaClient } = require("../lib/media-client");
const { normalizePublicNode } = require("../lib/public-node");
const { Finder } = require("../lib/finder");
const { MfsClient } = require("../lib/mfs-client");

const hub_x = "a000000000000001";
const hub_y = "b000000000000002";
const location_x = { hub_id: hub_x, nid: "1000000000000001" };
const canonical_permission = { read: 2, write: 4, delete: 8, admin: 16, owner: 32 };

function accessible(resource, { hub_privilege = 63, node_privilege = 63 } = {}) {
  return { ...resource, access: { known: true, hub_privilege, node_privilege, permission: canonical_permission } };
}

test("MfsClient uses the canonical sources field for copy requests", async () => {
  let request;
  const client = new MfsClient({ transport: { async call(service, input) { request = { service, input }; } } });
  const source = { hub_id: hub_x, nid: "2000000000000001" };
  const destination = { hub_id: hub_y, nid: "2000000000000002" };
  await client.copy([source], destination, "copy-operation");
  assert.deepEqual(request, {
    service: "mfs.copy",
    input: { sources: [source], destination, operation_id: "copy-operation" }
  });
});

test("public nodes normalize logical parents, caller access and exclude private fields", () => {
  const node = normalizePublicNode({ nid: "2000000000000001", parent_id: location_x.nid, filename: "safe.txt", filetype: "file", db_name: "private", storage_ref: "/private", payload_ref: { path: "/private" }, access: { known: true, hub_privilege: 3, node_privilege: 3, permission: { ...canonical_permission, domain_admin: 64 }, members: ["private"] } }, hub_x);
  assert.deepEqual(node.parent, location_x);
  assert.equal(node.db_name, undefined);
  assert.equal(node.storage_ref, undefined);
  assert.equal(node.payload_ref, undefined);
  assert.deepEqual(node.access, { known: true, hub_privilege: 3, node_privilege: 3, permission: canonical_permission });
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

test("modifier range selection is ordered, reversible and optionally additive", () => {
  const selection = new FinderSelection();
  const items = [1, 2, 3, 4].map((serial) => ({ hub_id: hub_x, nid: String(serial).padStart(16, "0") }));
  selection.selectRange(items, items[1], items[3]);
  assert.deepEqual(selection.getItems(), items.slice(1));
  selection.selectRange(items, items[2], items[0]);
  assert.deepEqual(selection.getItems(), items.slice(0, 3));
  selection.selectRange(items, items[3], items[3], { additive: true });
  assert.deepEqual(selection.getItems(), items);
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

test("move undo captures its source before awaiting and survives later navigation", async () => {
  let complete;
  const item = { hub_id: hub_x, nid: "3000000000000002", parent_id: location_x.nid, filename: "move.txt", filetype: "file" };
  const source = {
    location: { ...location_x },
    selection: { getItems: () => [item] },
    pending_operations: new Map(), items: new Map([[`${item.hub_id}:${item.nid}`, item]]), item_list: { remove() {} }, undo_stack: [],
    access_policy: { transfer() { return { known: true, allowed: true, action: "move" }; }, async authorizeTransfer() { return { action: "move" }; }, async resolve(value) { return value; } },
    transfer_policy: { transfer: () => new Promise((resolve) => { complete = resolve; }) },
    presentError() {}, refresh: async () => {}, trigger() {},
    mfs_client: { async move(nodes, destination) { source.inverse = { nodes, destination }; } }
  };
  const target = { finder: source, location: { hub_id: hub_x, nid: "1000000000000002" } };
  const moving = Finder.prototype.transferTo.call(source, target);
  await new Promise((resolve) => setImmediate(resolve));
  source.location = { hub_id: hub_x, nid: "1000000000000009" };
  complete({ ok: true });
  await moving;
  assert.deepEqual(source.undo_stack[0].destination, location_x);
  assert.equal(await Finder.prototype.undoLast.call(source), true);
  assert.deepEqual(source.inverse.destination, location_x);
});

test("failed moves create no undo entry and denied inverse remains retryable", async () => {
  const item = { hub_id: hub_x, nid: "3000000000000003", parent_id: location_x.nid, filename: "move.txt", filetype: "file" };
  const source = {
    location: { ...location_x }, selection: { getItems: () => [item] }, pending_operations: new Map(),
    items: new Map([[`${item.hub_id}:${item.nid}`, item]]), item_list: { remove() {} }, undo_stack: [],
    access_policy: { transfer() { return { known: true, allowed: true, action: "move" }; }, async authorizeTransfer() { return { action: "move" }; }, async resolve(value) { return value; } },
    transfer_policy: { async transfer() { throw Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" }); } },
    invalidateAccess() {}, reconcileAfterFailure: async () => {}, presentError(error, context) { source.error = { code: error.code, context }; }, refresh: async () => {}, trigger() {}
  };
  await assert.rejects(() => Finder.prototype.transferTo.call(source, { finder: source, location: { hub_id: hub_x, nid: "1000000000000002" } }), { code: "PERMISSION_DENIED" });
  assert.equal(source.undo_stack.length, 0);
  source.undo_stack.push({ type: "move", items: [{ hub_id: item.hub_id, nid: item.nid }], destination: { ...location_x } });
  source.mfs_client = { async move() { throw Object.assign(new Error("revoked"), { code: "PERMISSION_DENIED" }); } };
  await assert.rejects(() => Finder.prototype.undoLast.call(source), { code: "PERMISSION_DENIED" });
  assert.equal(source.undo_stack.length, 1);
  assert.deepEqual(source.error, { code: "PERMISSION_DENIED", context: "undo" });
});

test("access policy derives move, copy and read-only UX from server permission DTOs", async () => {
  const policy = new FinderAccessPolicy();
  const destination_x = accessible({ hub_id: hub_x, nid: "1000000000000002", filetype: "folder" }, { node_privilege: 7 });
  const destination_y = accessible({ hub_id: hub_y, nid: "1000000000000003", filetype: "folder" }, { node_privilege: 7 });
  const read_only = accessible({ hub_id: hub_x, nid: "3000000000000004", parent_id: location_x.nid, filetype: "file" }, { node_privilege: 3 });
  assert.equal(policy.evaluate("download", { items: [read_only] }).allowed, true);
  assert.equal(policy.transfer({ items: [read_only], destination: destination_x }).action, "move");
  assert.equal(policy.transfer({ items: [read_only], destination: destination_x }).allowed, false);
  assert.equal(policy.transfer({ items: [read_only], destination: destination_x }).reason, "SOURCE_PERMISSION_DENIED");
  assert.equal(policy.transfer({ items: [read_only], destination: destination_y }).action, "copy");
  assert.equal(policy.transfer({ items: [read_only], destination: destination_y }).allowed, true);
  assert.equal(policy.transfer({ items: [read_only], destination: accessible(destination_y, { node_privilege: 3 }) }).reason, "DESTINATION_PERMISSION_DENIED");
  assert.equal(policy.transfer({ items: [read_only], destination: accessible({ ...location_x, filetype: "folder" }) }).action, "noop");
});

test("unknown access is resolved once per resource and remains bound to the requested target", async () => {
  const calls = [];
  const by_id = new Map([
    ["source", accessible({ hub_id: hub_x, nid: "source", parent_id: location_x.nid }, { node_privilege: 15 })],
    ["allowed", accessible({ hub_id: hub_x, nid: "allowed", filetype: "folder" }, { node_privilege: 7 })],
    ["denied", accessible({ hub_id: hub_x, nid: "denied", filetype: "folder" }, { node_privilege: 3 })]
  ]);
  const policy = new FinderAccessPolicy({ mfs_client: { async get(resource) { calls.push(resource.nid); await new Promise((resolve) => setTimeout(resolve, resource.nid === "allowed" ? 10 : 1)); return by_id.get(resource.nid); } } });
  const source = { hub_id: hub_x, nid: "source", parent_id: location_x.nid };
  const allowed = { hub_id: hub_x, nid: "allowed" };
  const denied = { hub_id: hub_x, nid: "denied" };
  const [first, second] = await Promise.allSettled([
    policy.authorizeTransfer({ items: [source], destination: allowed }),
    policy.authorizeTransfer({ items: [source], destination: denied })
  ]);
  assert.equal(first.status, "fulfilled");
  assert.equal(second.status, "rejected");
  assert.equal(second.reason.decision.reason, "DESTINATION_PERMISSION_DENIED");
  assert.equal(calls.filter((nid) => nid === "source").length, 1, "concurrent source resolution is coalesced");
});

test("access invalidation makes an in-flight permission response obsolete", async () => {
  let release;
  const policy = new FinderAccessPolicy({ mfs_client: { get(resource) { return new Promise((resolve) => { release = () => resolve(accessible(resource)); }); } } });
  const resolving = policy.resolve({ hub_id: hub_x, nid: "stale-target" });
  policy.invalidate();
  release();
  await assert.rejects(() => resolving, { code: "MFS_ACCESS_UNKNOWN" });
});

test("mixed transfer denial is all-or-nothing and same-parent drops issue no request or undo", async () => {
  const allowed = accessible({ hub_id: hub_x, nid: "allowed", parent_id: location_x.nid }, { node_privilege: 15 });
  const denied = accessible({ hub_id: hub_x, nid: "denied", parent_id: location_x.nid }, { node_privilege: 3 });
  const destination = accessible({ hub_id: hub_x, nid: "destination" }, { node_privilege: 7 });
  const policy = new FinderAccessPolicy();
  assert.equal(policy.transfer({ items: [allowed, denied], destination }).allowed, false);
  const requests = [];
  const finder = {
    location: { ...location_x }, current_node: accessible(location_x), selection: { getItems: () => [allowed] },
    pending_operations: new Map(), items: new Map(), item_list: null, undo_stack: [],
    access_policy: policy, transfer_policy: { async transfer(value) { requests.push(value); } }, presentError() {}, refresh: async () => {}, trigger() {}
  };
  const result = await Finder.prototype.transferTo.call(finder, { finder, location: { ...location_x }, resource: accessible(location_x) });
  assert.equal(result.action, "noop");
  assert.equal(requests.length, 0);
  assert.equal(finder.undo_stack.length, 0);
});

test("undo checks current inverse rights before contacting the server", async () => {
  let moved = 0;
  const policy = new FinderAccessPolicy({ mfs_client: { async get(resource) {
    return accessible(resource, { node_privilege: resource.nid === location_x.nid ? 7 : 3 });
  } } });
  const finder = {
    undo_stack: [{ type: "move", items: [{ hub_id: hub_x, nid: "moved-after-revoke" }], destination: { ...location_x } }],
    access_policy: policy,
    mfs_client: { async move() { moved++; } },
    presentError() {}, reconcileAfterFailure: async () => {}, trigger() {}
  };
  await assert.rejects(() => Finder.prototype.undoLast.call(finder), { code: "MFS_TRANSFER_UNAVAILABLE" });
  assert.equal(moved, 0);
  assert.equal(finder.undo_stack.length, 1);
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

test("folder invalidations reconcile only matching views and preserve an invalidation received in flight", async () => {
  const listeners = new Map();
  const websocket = { bindEvent(name, fn) { listeners.set(name, fn); }, unbindEvent() {}, on(name, fn) { listeners.set(name, fn); }, off() {} };
  const sync = new MfsSync({ websocket });
  let release;
  const calls = [];
  const matching = {
    finder_id: "matching", location: { ...location_x }, hasItem: () => false, applyMfsEvent() {},
    invalidateMfsView() { calls.push("matching"); return calls.length === 1 ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(); }
  };
  const unrelated = { finder_id: "unrelated", location: { hub_id: hub_x, nid: "unrelated" }, hasItem: () => false, applyMfsEvent() {}, invalidateMfsView() { calls.push("unrelated"); } };
  sync.register(matching); sync.register(unrelated);
  listeners.get("mfs.event")({ type: "node.moved", operation_id: "invalidate-1", reconcile: [location_x] });
  listeners.get("mfs.event")({ type: "node.moved", operation_id: "invalidate-2", reconcile: [location_x] });
  assert.deepEqual(calls, ["matching", "matching"]);
  release();
  assert.equal(calls.includes("unrelated"), false);
  sync.destroy();
});

test("Finder reconciliation coalesces refreshes, retries after an in-flight invalidation and stops after destruction", async () => {
  const pending = [];
  const finder = {
    destroyed: false, invalidation_serial: 0, reconciliation: null, errors: [],
    invalidateAccess() {},
    refresh() { return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
    presentError(error, context) { this.errors.push([error.message, context]); }
  };
  const first = Finder.prototype.invalidateMfsView.call(finder);
  const same = Finder.prototype.invalidateMfsView.call(finder);
  assert.equal(first, same);
  pending.shift().resolve([]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 1, "an invalidation received in flight schedules another refresh");
  pending.shift().reject(new Error("refresh failed"));
  await first;
  assert.deepEqual(finder.errors, [["refresh failed", "reconciliation"]]);
  finder.destroyed = true;
  await Finder.prototype.invalidateMfsView.call(finder);
  assert.equal(pending.length, 0);
});

test("a refresh completed after navigation cannot replace the new folder listing", async () => {
  const pending = new Map();
  const response = (kind, location) => new Promise((resolve) => pending.set(`${kind}:${location.nid}`, resolve));
  const finder = {
    destroyed: false, refresh_serial: 0, location: { ...location_x }, items: new Map(), next_cursor: null,
    mfs_client: { list: (location) => response("list", location), get: (location) => response("get", location) },
    item_list: { setItems(items) { finder.rendered = items; } },
    mget() { return null; }, updateBreadcrumb() {}, trigger() {}
  };
  const old_refresh = Finder.prototype.refresh.call(finder);
  finder.location = { hub_id: hub_x, nid: "1000000000000099" };
  const new_refresh = Finder.prototype.refresh.call(finder);
  pending.get("list:1000000000000099")({ items: [{ hub_id: hub_x, nid: "new-item", parent_id: "1000000000000099" }] });
  pending.get("get:1000000000000099")({ hub_id: hub_x, nid: "1000000000000099", filename: "New" });
  await new_refresh;
  pending.get(`list:${location_x.nid}`)({ items: [{ hub_id: hub_x, nid: "old-item", parent_id: location_x.nid }] });
  pending.get(`get:${location_x.nid}`)({ ...location_x, filename: "Old" });
  await old_refresh;
  assert.deepEqual(finder.rendered.map((item) => item.nid), ["new-item"]);
  assert.equal(finder.current_title, "New");
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
