"use strict";

const assert = require("node:assert/strict");
const child_process = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("package exposes only the deliberate core and window APIs", () => {
  const api = require("..");
  assert.deepEqual(Object.keys(api).sort(), ["Finder", "FinderTransferPolicy", "MediaClient", "MfsClient", "MfsSync", "MfsTransferClient", "registerFinderKinds"]);
  assert.deepEqual(Object.keys(require("../lib/window")), ["FinderWindow"]);
  assert.equal(require("../package.json").peerDependenciesMeta["@drumee/window-manager"].optional, true);
});

test("production boundary contains no backend, transient or physical-storage implementation", () => {
  const files = [...fs.readdirSync(path.join(root, "lib")).map((name) => path.join(root, "lib", name)), ...fs.readdirSync(path.join(root, "skeleton")).map((name) => path.join(root, "skeleton", name))].filter((name) => name.endsWith(".js"));
  const source = files.map((name) => fs.readFileSync(name, "utf8")).join("\n");
  for (const pattern of [
    /\/home\/somanos\/github\/transient/,
    /target\/modules\//,
    /sources\//,
    /require\(["'](?:node:)?(?:fs|path)["']\)/,
    /@drumee\/(?:server-runtime|system-mfs)/,
    /server-team|server-core|ui-team|window\.Desk|window\.Wm/,
    /\b(?:db_name|db_host|fs_host|home_dir|mfs_root|archive_path|tempfile)\b/
  ]) assert.doesNotMatch(source, pattern);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "lib/index.js"), "utf8"), /window-manager|finder-window/);
});

test("npm pack contains only the standalone browser capability", () => {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), "drumee-finder-pack-"));
  const result = child_process.spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const packed = JSON.parse(result.stdout)[0];
  const paths = packed.files.map((file) => file.path);
  assert.ok(paths.includes("lib/index.js"));
  assert.ok(paths.includes("lib/window.js"));
  assert.ok(paths.includes("skin/finder.css"));
  assert.equal(paths.some((name) => /(?:server|schemas|sql|archive-worker|host-filesystem)/i.test(name)), false);
  assert.equal(paths.some((name) => name.startsWith("test/")), false);
});
