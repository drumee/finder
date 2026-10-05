"use strict";

const PUBLIC_NODE_FIELDS = new Set(["hub_id", "nid", "parent", "parent_id", "filetype", "filename", "mimetype", "size", "extension", "ctime", "mtime", "status", "privilege"]);

function normalizePublicNode(item = {}, fallback_hub_id) {
  const normalized = {};
  for (const [name, value] of Object.entries(item)) if (PUBLIC_NODE_FIELDS.has(name)) normalized[name] = value;
  normalized.hub_id = normalized.hub_id || fallback_hub_id;
  if (!normalized.parent && normalized.parent_id) normalized.parent = { hub_id: normalized.hub_id, nid: normalized.parent_id };
  return normalized;
}

module.exports = { normalizePublicNode, PUBLIC_NODE_FIELDS };
