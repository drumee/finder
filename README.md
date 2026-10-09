# @drumee/finder

`@drumee/finder` is Drumee's standalone logical MFS browsing capability. It
owns Finder-local navigation, selection, dense item rendering, drag/drop,
transfer presentation, media preview activation and MFS synchronization.

It is not a filesystem engine, authorization authority, server module,
historical Desktop, or global Window Manager. It never consumes database or
physical-storage identities.

## Core and window adapter

The core entry has no Window Manager dependency:

```js
const { MfsClient, MfsSync, registerFinderKinds } = require("@drumee/finder");

registerFinderKinds(runtime);
const mfs_client = new MfsClient({ transport });
const mfs_sync = new MfsSync({ websocket: runtime.Websocket });
const finder = runtime.mount({
  kind: "finder",
  location: { hub_id, nid },
  mfs_client,
  mfs_sync
}, host);
```

Window-managed use is optional:

```js
const { FinderWindow } = require("@drumee/finder/window");
const finder_window = new FinderWindow({ manager, runtime, finder_options });
```

`FinderWindow` owns window lifecycle/title projection only. Core Finder can be
mounted in any host container that provides `@drumee/ui-runtime` and the
logical service contracts.

## Contracts

Locations are `{hub_id,nid}`. Public nodes contain `{hub_id,nid,parent,
filetype,filename}` plus bounded public presentation metadata. Physical paths,
database names, storage references and transfer payload references are
excluded.

Normal click replaces selection, the checkbox toggles membership, marquee
selection replaces membership after a five-pixel threshold, and drag payloads
come only from FinderSelection. Same-hub drag is MOVE; cross-hub drag is COPY.
Backend ACL and MFS semantics remain authoritative.
Same-hub MOVE is projected optimistically and converges with committed sync;
failures reconcile affected scopes. Cross-hub COPY waits for server-assigned
destination identities.

Uploads use bounded structured control calls plus `Blob` binary chunks.
Downloads prepare offline artifacts and return FileIo/Nginx retrieval URLs;
Finder does not buffer ZIP archives. Near-viewport previews request explicit
allowlisted representations.

MfsSync consumes recipient-filtered logical events, suppresses duplicate
operation echoes, and reconciles open scopes after reconnect. A Finder owns
its sync registration, listeners and observers. `destroy()` is idempotent.
Locally created transfer controllers are cancelled on destroy; injected
controllers remain host-owned unless explicit ownership flags are set.

Each request carries only opaque logical `{hub_id,nid}` identities. The
browser-selected Hub is a request, not authority: the server runtime must
authorize every source and destination Hub, require the `system-mfs`
capability to be ready, then apply node-level MFS permission checks. Finder
never receives or selects `hub_context`, shard names, SQL hosts, credentials,
or filesystem roots. Separate Finder windows therefore retain separate
locations without a mutable global Hub context.

See `CONTRACTS.md` for the frozen API and resource ownership map.

## Package status

This is an alpha CommonJS/Webpack capability. Version `0.1.0-alpha.2` is
prepared locally for the official Hub-context integration; this work does not
publish it to npm.
