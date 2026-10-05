"use strict";

const PRIVATE_NODE_FIELDS = new Set(["db_name", "db_host", "fs_host", "home_dir", "mfs_root", "storage_ref", "payload_ref", "archive_path", "tempfile", "path"]);

function normalizePublicNode(item = {}, fallback_hub_id) {
  const normalized = {};
  for (const [name, value] of Object.entries(item)) if (!PRIVATE_NODE_FIELDS.has(name)) normalized[name] = value;
  normalized.hub_id = normalized.hub_id || fallback_hub_id;
  if (!normalized.parent && normalized.parent_id) normalized.parent = { hub_id: normalized.hub_id, nid: normalized.parent_id };
  return normalized;
}

module.exports = { normalizePublicNode, PRIVATE_NODE_FIELDS };
