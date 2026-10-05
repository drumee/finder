"use strict";

class FinderTransferPolicy {
  constructor({ mfs_client } = {}) { this.mfs_client = mfs_client; }
  async transfer({ source, target, items, operation_id }) {
    if (!target || !target.location || !target.location.hub_id || !target.location.nid) throw Object.assign(new Error("Transfer destination is invalid"), { code: "MFS_DESTINATION_INVALID" });
    const nodes = items.map((item) => ({ hub_id: item.hub_id, nid: item.nid }));
    const destination = { ...target.location };
    if (nodes.some((node) => node.hub_id === destination.hub_id && node.nid === destination.nid)) throw Object.assign(new Error("A node cannot be transferred into itself"), { code: "MFS_DESTINATION_INVALID" });
    if (source.location.hub_id === destination.hub_id) {
      return { action: "move", response: await this.mfs_client.move(nodes, destination, operation_id) };
    }
    return { action: "copy", response: await this.mfs_client.copy(nodes, destination, operation_id) };
  }
}

module.exports = { FinderTransferPolicy };
