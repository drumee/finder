"use strict";

class MfsClient {
  constructor({ transport } = {}) { if (!transport) throw new Error("MfsClient requires a request transport"); this.transport = transport; }
  call(method, payload) { const fn = this.transport.postService || this.transport.fetchService || this.transport.call; if (typeof fn !== "function") throw new Error("MFS request transport is invalid"); return fn.call(this.transport, `mfs.${method}`, payload); }
  list(location, options = {}) { return this.call("list", { location, ...options }); }
  get(node) { return this.call("get", { node }); }
  mkdir(destination, name, operation_id) { return this.call("mkdir", { destination, name, operation_id }); }
  rename(node, name, operation_id) { return this.call("rename", { node, name, operation_id }); }
  remove(node, operation_id) { return this.call("remove", { node, operation_id }); }
  move(nodes, destination, operation_id) { return this.call("move", { nodes, destination, operation_id }); }
  copy(nodes, destination, operation_id) { return this.call("copy", { nodes, destination, operation_id }); }
}

module.exports = { MfsClient };
