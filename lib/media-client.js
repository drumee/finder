"use strict";

const REPRESENTATIONS = new Set(["orig", "preview", "thumb", "document", "video", "master", "stream", "segment"]);

class MediaClient {
  constructor({ transport } = {}) { if (!transport) throw new Error("MediaClient requires a transport"); this.transport = transport; }
  representation(node, representation = "preview") {
    if (!REPRESENTATIONS.has(representation)) throw Object.assign(new Error("Unknown media representation"), { code: "MEDIA_REPRESENTATION_INVALID" });
    const logical = { hub_id: node.hub_id, nid: node.nid };
    if (typeof this.transport.mediaUrl === "function") return this.transport.mediaUrl(representation, logical);
    if (typeof this.transport.serviceUrl === "function") return this.transport.serviceUrl(`media.${representation}`, logical);
    throw new Error("Media transport cannot produce a representation URL");
  }
}

module.exports = { MediaClient, REPRESENTATIONS };
