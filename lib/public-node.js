"use strict";

const PUBLIC_NODE_FIELDS = new Set(["hub_id", "nid", "parent", "parent_id", "filetype", "filename", "mimetype", "size", "filesize", "extension", "ext", "ctime", "mtime", "status", "privilege", "hub_privilege", "access"]);

function normalizeAccess(value) {
  if (!value || typeof value !== "object" || value.known !== true) return { known: false };
  const permission = {};
  for (const name of ["read", "write", "delete", "admin", "owner"]) {
    if (Number.isInteger(Number(value.permission && value.permission[name]))) permission[name] = Number(value.permission[name]);
  }
  return { known: true, hub_privilege: Number(value.hub_privilege || 0), node_privilege: Number(value.node_privilege || 0), permission };
}

function normalizePublicNode(item = {}, fallback_hub_id) {
  const normalized = {};
  for (const [name, value] of Object.entries(item)) if (PUBLIC_NODE_FIELDS.has(name)) normalized[name] = value;
  normalized.hub_id = normalized.hub_id || fallback_hub_id;
  if (!normalized.parent && normalized.parent_id) normalized.parent = { hub_id: normalized.hub_id, nid: normalized.parent_id };
  if (normalized.access !== undefined) normalized.access = normalizeAccess(normalized.access);
  return normalized;
}

module.exports = { normalizeAccess, normalizePublicNode, PUBLIC_NODE_FIELDS };
