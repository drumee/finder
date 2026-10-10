"use strict";

const runtime_api = require("@drumee/ui-runtime/browser");
const finder_api = require("@drumee/finder/browser");
const { FinderWindow } = require("@drumee/finder/window");
const window_manager_api = require("@drumee/window-manager/browser");

runtime_api.bootstrap().then(async (runtime) => {
  finder_api.registerFinderKinds(runtime);
  const root = { hub_id: "a000000000000001", nid: "1000000000000001" };
  const permission = { read: 2, write: 4, delete: 8, admin: 16, owner: 32 };
  const accessible = (node) => ({ ...node, privilege: 63, hub_privilege: 63, access: { known: true, hub_privilege: 63, node_privilege: 63, permission } });
  const transport = { async postService(service, input) {
    if (service === "mfs.list") return { items: [accessible({ ...root, nid: "2000000000000001", parent_id: root.nid, filename: "file.txt", filetype: "file" })] };
    if (service === "mfs.get") return accessible({ ...input.node, parent_id: "0", filename: "Root", filetype: "root" });
    throw new Error(`Unexpected service ${service}`);
  } };
  const mfs_client = new finder_api.MfsClient({ transport });
  const mfs_sync = new finder_api.MfsSync({ websocket: runtime.Websocket });
  const plain = runtime.mount({ kind: "finder", finder_id: "plain", location: root, mfs_client, mfs_sync }, document.getElementById("plain"));
  const manager = window_manager_api.createWindowManager({ workspace: document.getElementById("workspace"), runtime, jquery: runtime_api.Backbone.$ });
  const managed = new FinderWindow({ manager, runtime, finder_options: { finder_id: "managed", location: root, mfs_client, mfs_sync }, window_options: { window_id: "finder-window" } });
  await Promise.all([plain.refresh(), managed.finder.refresh()]);
  window.finderConsumer = { runtime, plain, manager, managed, mfs_sync };
  document.body.dataset.ready = "true";
}).catch((error) => { document.body.dataset.error = error.stack || String(error); });
