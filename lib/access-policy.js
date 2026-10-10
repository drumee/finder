"use strict";

function accessError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function accessOf(resource) {
  const access = resource && resource.access;
  if (!access || access.known !== true || !access.permission) return { known: false };
  return access;
}

function grants(word, bit) {
  const granted = Number(word);
  const requested = Number(bit);
  return Number.isInteger(granted) && Number.isInteger(requested) && requested > 0 && (granted & requested) === requested;
}

class FinderAccessPolicy {
  constructor({ mfs_client } = {}) {
    this.mfs_client = mfs_client;
    this.pending = new Map();
    this.epoch = 0;
  }

  permission(resource, name) {
    const access = accessOf(resource);
    const bit = access.known && Number(access.permission[name]);
    if (!access.known || !Number.isInteger(bit) || bit < 1) return { known: false, allowed: false, permission: name };
    return {
      known: true,
      allowed: grants(access.hub_privilege, bit) && grants(access.node_privilege, bit),
      permission: name,
      bit
    };
  }

  evaluate(action, { items = [], destination = null } = {}) {
    const requirements = {
      open: ["read"], download: ["read"], rename: ["delete"], remove: ["delete"],
      upload: ["write"], mkdir: ["write"]
    };
    if (["upload", "mkdir"].includes(action)) return this.permission(destination, requirements[action][0]);
    const permission = requirements[action] && requirements[action][0];
    if (!permission || !items.length) return { known: true, allowed: false, action, reason: "EMPTY_SELECTION" };
    const decisions = items.map((item) => this.permission(item, permission));
    return {
      known: decisions.every((entry) => entry.known),
      allowed: decisions.every((entry) => entry.allowed),
      action,
      decisions
    };
  }

  transfer({ items = [], destination } = {}) {
    if (!destination || !destination.hub_id || !destination.nid) return { known: true, allowed: false, reason: "INVALID_DESTINATION" };
    if (!items.length) return { known: true, allowed: false, reason: "EMPTY_SELECTION" };
    const action = items.every((item) => item.hub_id === destination.hub_id) ? "move" : "copy";
    if (action === "move" && items.some((item) => item.hub_id !== destination.hub_id)) return { known: true, allowed: false, action, reason: "MIXED_HUB_SELECTION" };
    const same_parent = items.filter((item) => item.hub_id === destination.hub_id && (item.parent && item.parent.nid || item.parent_id) === destination.nid);
    if (same_parent.length === items.length) return { known: true, allowed: true, action: "noop", reason: "CURRENT_PARENT" };
    if (same_parent.length) return { known: true, allowed: false, action, reason: "MIXED_NOOP_SELECTION" };
    const source_permission = action === "move" ? "delete" : "read";
    const sources = items.map((item) => this.permission(item, source_permission));
    const target = this.permission(destination, "write");
    return {
      known: sources.every((entry) => entry.known) && target.known,
      allowed: sources.every((entry) => entry.allowed) && target.allowed,
      action,
      source_permission,
      sources,
      destination: target,
      reason: sources.some((entry) => entry.known && !entry.allowed) ? "SOURCE_PERMISSION_DENIED" : target.known && !target.allowed ? "DESTINATION_PERMISSION_DENIED" : null
    };
  }

  async resolve(resource) {
    if (accessOf(resource).known) return resource;
    if (!this.mfs_client || typeof this.mfs_client.get !== "function") throw accessError("MFS_ACCESS_UNKNOWN", "Access information is unavailable");
    const key = `${resource.hub_id}:${resource.nid}`;
    if (!this.pending.has(key)) {
      const epoch = this.epoch;
      const request = Promise.resolve(this.mfs_client.get({ hub_id: resource.hub_id, nid: resource.nid }))
        .then((response) => response && (response.result || response))
        .then((value) => {
          if (epoch !== this.epoch) throw accessError("MFS_ACCESS_UNKNOWN", "Access information changed while it was being resolved");
          return value;
        })
        .finally(() => { if (this.pending.get(key) === request) this.pending.delete(key); });
      this.pending.set(key, request);
    }
    return this.pending.get(key);
  }

  async authorizeTransfer({ items, destination } = {}) {
    let decision = this.transfer({ items, destination });
    if (!decision.known) {
      const resolved = await Promise.all([...items, destination].map((resource) => this.resolve(resource)));
      decision = this.transfer({ items: resolved.slice(0, -1), destination: resolved.at(-1) });
    }
    if (!decision.known) throw accessError("MFS_ACCESS_UNKNOWN", "Transfer permissions are still unknown", { decision });
    if (!decision.allowed) throw accessError("MFS_TRANSFER_UNAVAILABLE", "The selected items cannot be transferred to this destination", { decision });
    return decision;
  }

  commands(items = []) {
    const first = items[0];
    const commands = [];
    if (first && ["folder", "root"].includes(first.filetype) && this.evaluate("open", { items: [first] }).allowed) commands.push("open");
    if (this.evaluate("download", { items }).allowed) commands.push("download");
    if (items.length === 1 && this.evaluate("rename", { items }).allowed) commands.push("rename");
    if (this.evaluate("remove", { items }).allowed) commands.push("remove");
    return commands;
  }

  invalidate() { this.epoch++; this.pending.clear(); }
}

module.exports = { FinderAccessPolicy, accessOf, grants };
