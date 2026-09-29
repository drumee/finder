"use strict";

class FinderTransferPolicy {
  constructor({ mfs_client } = {}) { this.mfs_client = mfs_client; }
  async transfer({ source, target, items, operation_id }) {
    const nodes = items.map((item) => ({ hub_id: item.hub_id, nid: item.nid }));
    const destination = { ...target.location };
    if (source.location.hub_id === destination.hub_id) {
      return { action: "move", response: await this.mfs_client.move(nodes, destination, operation_id) };
    }
    return { action: "copy", response: await this.mfs_client.copy(nodes, destination, operation_id) };
  }
}

module.exports = { FinderTransferPolicy };
