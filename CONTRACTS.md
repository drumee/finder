# Finder Phase 4.9 contract freeze

Frozen after real-use stabilization at transient commit `f2ac32b86`.

## Construction

`registerFinderKinds(runtime)` registers Finder's LETC kinds. Core mounting is:

```js
runtime.mount({
  kind: "finder",
  location: { hub_id, nid },
  mfs_client,
  mfs_sync,
  transfer_client, // optional
  media_client     // optional
}, host)
```

`location` and `mfs_client` are required. `mfs_sync`, `transfer_client`, and
`media_client` are capability dependencies. Finder creates and owns its upload
and download controllers when `transfer_client` is supplied. Injected
controllers are host-owned unless `own_upload_controller` or
`own_download_controller` is explicitly true. `MfsSync` is shared and
host-owned; Finder owns only its registration. Finder destruction is
idempotent.

## Logical identities

A location is exactly `{ hub_id, nid }`. A public node contains at least:

```js
{ hub_id, nid, parent, filetype, filename }
```

`parent` is a logical `{hub_id,nid}` identity. `parent_id` remains accepted at
the service boundary and is normalized. Physical storage and database fields
are stripped and are not part of either contract.

The Hub identity on every location is a client selection only. The server
authorizes each logical source and destination independently, requires
`system-mfs` ready on that Hub, applies the operation's Hub permission bit and
then retains the existing node-level MFS permission check. No mutable global
Hub context is part of the Finder contract, so simultaneous windows may target
different Hubs. Transfers, media requests and reconnect operations retain the
same rule for their complete lifetime.

## Service clients

`MfsClient` consumes `list(location, options)`, `get(node)`,
`mkdir(destination, name, operation_id)`, `rename(node, name, operation_id)`,
`remove(node, operation_id)`, `move(nodes, destination, operation_id)`, and
`copy(nodes, destination, operation_id)`.

The public JavaScript copy method keeps the `nodes` argument for symmetry with
move, but its wire DTO uses the canonical backend field `{sources,
destination, operation_id}`.

`MfsTransferClient` consumes upload start, binary chunk, status, complete and
abort operations, plus download prepare, status, cancel, retrieve and release.
Upload bodies are `Blob` objects sent through `uploadBinary`; they never enter
the structured request path. Download retrieval returns an Nginx/FileIo URL,
never archive bytes.

`MediaClient.representation(node, name)` accepts only explicit public
representations. Finder normally requests `thumb`, `document`, `video`, or
`preview` for near-viewport tiles.

## Synchronization

`MfsSync` consumes `mfs.event` values with:

```js
{
  type,
  operation_id,
  node,
  source_parent,
  destination,
  result,
  hard_delete
}
```

Supported types are `node.created`, `node.renamed`, `node.removed`,
`node.moved`, and `node.copied`. Scope matching uses logical identities only.
`operation_id` suppresses duplicate echoes. Reconnect coalesces a refresh of
each open Finder scope.

## Transfer and window adapters

`FinderTransferPolicy.transfer({source,target,items,operation_id})` chooses
MOVE when source and destination hubs match and COPY otherwise. The backend
remains authoritative for permission and ancestor-cycle validation.
Same-hub MOVE projects an optimistic logical update and converges with the
committed event by identity/`operation_id`; failure refreshes affected scopes.
Cross-hub COPY is not optimistic because destination identities are assigned
by the backend.

Click replaces selection; checkbox and Ctrl/Command-click toggle it;
Shift-click and Shift-arrow select a contiguous range. Arrow keys move the
focused selection, Space toggles, Ctrl/Command-A selects the loaded page,
Enter opens a folder and Backspace navigates up. Grid and compact list modes
share the same logical collection. Context-menu requests expose a bounded
command descriptor to the host rather than importing a global Desk menu.

Successful same-Hub moves create a bounded session-local undo entry. Undo
submits a new authorized MFS move and reconciles the view; it never rewinds
server state locally. Cross-Hub copy has no synthetic undo because destination
identities and conflict policy belong to the server. Conflict codes are
presented explicitly and followed by reconciliation.

The source location and inverse DTO are snapshotted before the original move
awaits its server response. Navigation while the request is pending cannot
retarget undo. A failed move creates no entry; a denied inverse keeps its entry
available for a later authorized retry and refreshes the affected views.

`FinderWindow` requires `{manager, runtime, finder_options, window_options}`.
It creates one Finder, passes its DOM element to `manager.open`, projects
`location:change` into the window title, and destroys the Finder on close. It
owns no navigation, selection, MFS, transfer, media, or sync semantics.

## Resource ownership

| Resource | Owner | Cleanup boundary |
|---|---|---|
| location, history, listing, selection | Finder | `Finder.destroy()` |
| selected logical nodes | FinderSelection | `FinderSelection.destroy()` |
| pointer geometry and document listeners | SelectionMarquee | `detach()` / `destroy()` |
| active drag and document listeners | FinderDragController | `cleanupGesture()` / `destroy()` |
| tile DOM listeners and preview observations | ItemList | `ItemList.destroy()` |
| Finder resize/preview observers and file input | Finder | `Finder.destroy()` |
| shared WebSocket subscription | MfsSync host | `MfsSync.destroy()` |
| per-Finder sync registration | Finder | unregister during `Finder.destroy()` |
| locally created transfer controllers | Finder | cancel/destroy during `Finder.destroy()` |
| injected transfer controllers | host | host-selected bounded lifetime |
| window chrome and geometry | FinderWindow / Window Manager | window close/destroy |
