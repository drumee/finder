"use strict";

const assert = require("node:assert/strict");
const child_process = require("node:child_process");
const events = require("node:events");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const webpack = require("webpack");

const root = path.resolve(__dirname, "..");

function run(command, args, cwd, env = {}) {
  const execution_env = { ...process.env, ...env };
  delete execution_env.NODE_TEST_CONTEXT;
  const result = child_process.spawnSync(command, args, { cwd, encoding: "utf8", env: execution_env });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
}

function chrome() { return [process.env.CHROME_BIN, "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find(fs.existsSync); }

function makeConsumer(work) {
  const artifacts = path.join(work, "artifacts");
  const consumer = path.join(work, "consumer");
  const cache = path.join(work, "cache");
  fs.mkdirSync(artifacts, { recursive: true }); fs.mkdirSync(consumer, { recursive: true });
  fs.writeFileSync(path.join(consumer, "package.json"), JSON.stringify({ name: "finder-consumer", private: true }));
  for (const package_root of [path.dirname(require.resolve("@drumee/ui-runtime/package.json")), path.dirname(require.resolve("@drumee/window-manager/package.json")), root]) {
    run("npm", ["pack", "--ignore-scripts", "--pack-destination", artifacts], package_root, { NPM_CONFIG_CACHE: cache });
  }
  const archives = fs.readdirSync(artifacts).filter((name) => name.endsWith(".tgz")).map((name) => path.join(artifacts, name));
  assert.equal(archives.length, 3);
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...archives], consumer, { NPM_CONFIG_CACHE: cache, NODE_PATH: "" });
  const resolver = createRequire(path.join(consumer, "package.json"));
  for (const name of ["@drumee/finder", "@drumee/finder/browser", "@drumee/finder/window", "@drumee/finder/skin.css"]) assert.ok(resolver.resolve(name).startsWith(path.join(consumer, "node_modules")), name);
  return consumer;
}

function compile(output, consumer) {
  return new Promise((resolve, reject) => webpack({
    mode: "development", devtool: false, context: consumer,
    entry: path.join(root, "test/fixtures/browser-entry.js"),
    output: { path: output, filename: "finder.js" },
    resolve: { modules: [path.join(consumer, "node_modules")] },
    module: { rules: [
      { test: /\.css$/, use: [require.resolve("style-loader"), require.resolve("css-loader")] },
      { test: /\.scss$/, use: [require.resolve("style-loader"), require.resolve("css-loader"), require.resolve("sass-loader")] }
    ] }
  }, (error, stats) => {
    if (error) return reject(error);
    if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })));
    const graph = stats.toJson({ all: false, modules: true }).modules.map((item) => item.name || "").join("\n");
    for (const term of ["server-runtime", "system-mfs", "server-team", "server-core", "ui-team", "target/modules", "sources/"]) assert.equal(graph.includes(term), false, term);
    resolve();
  }));
}

async function endpoint(port) {
  for (let count = 0; count < 120; count++) {
    try { const response = await fetch(`http://127.0.0.1:${port}/json/list`); if (response.ok) return (await response.json()).find((entry) => entry.type === "page"); } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Chrome endpoint unavailable");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url); const pending = new Map(); let id = 0;
    socket.onopen = () => resolve({ close: () => socket.close(), send(method, params = {}) { const serial = ++id; socket.send(JSON.stringify({ id: serial, method, params })); return new Promise((yes, no) => pending.set(serial, { yes, no })); } });
    socket.onerror = reject;
    socket.onmessage = (event) => { const message = JSON.parse(event.data); const call = pending.get(message.id); if (!call) return; pending.delete(message.id); message.error ? call.no(new Error(message.error.message)) : call.yes(message.result); };
  });
}

async function evaluate(client, expression) {
  const value = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
  return value.result.value;
}

test("packed clean consumer mounts core Finder and FinderWindow without boundary leakage", { timeout: 120000 }, async (context) => {
  if (!chrome()) return context.skip("Chromium is required");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "drumee-finder-consumer-"));
  const output = path.join(work, "output"); fs.mkdirSync(output);
  const consumer = makeConsumer(work); await compile(output, consumer);
  fs.writeFileSync(path.join(output, "index.html"), '<!doctype html><html><body><main id="workspace" style="width:500px;height:300px"></main><section id="plain" style="width:500px;height:300px"></section><script>window.onerror=(m,s,l,c,e)=>document.body.dataset.error=String(e||m)</script><script src="finder.js"></script></body></html>');
  const port = 30100 + Math.floor(Math.random() * 300); const profile = path.join(work, "profile");
  const child = child_process.spawn(chrome(), ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let client;
  try {
    const page = await endpoint(port); client = await connect(page.webSocketDebuggerUrl); await client.send("Page.enable"); await client.send("Page.navigate", { url: `file://${path.join(output, "index.html")}` });
    for (let count = 0; count < 120; count++) { const state = await evaluate(client, "({ready:document.body.dataset.ready,error:document.body.dataset.error})"); if (state.error) throw new Error(state.error); if (state.ready === "true") break; await new Promise((resolve) => setTimeout(resolve, 50)); }
    assert.deepEqual(await evaluate(client, "({plain:document.querySelector('#plain .drumee-finder')?.dataset.kind,window:document.querySelector('#workspace .drumee-window')?.dataset.kind,finders:finderConsumer.mfs_sync.finders.size,tiles:document.querySelectorAll('.drumee-finder__tile').length})"), { plain: "finder", window: "managed_window", finders: 2, tiles: 2 });
    assert.equal(await evaluate(client, "finderConsumer.plain.destroy();finderConsumer.managed.destroy();finderConsumer.mfs_sync.finders.size"), 0);
  } finally {
    if (client) client.close(); child.kill("SIGTERM"); await Promise.race([events.once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1500))]);
  }
});
