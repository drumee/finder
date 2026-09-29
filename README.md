# Phase 4.8 Finder integration

This private CommonJS module is the Phase 4.8 integration implementation. It
is not the Phase 4.9 standalone Finder package.

`lib/index.js` exports the Window-Manager-independent Finder entry. The
optional `lib/window.js` entry exports `FinderWindow`, the thin adapter to
`@drumee/window-manager`. Filesystem metadata and byte-transfer requests use
separate `MfsClient` and `MfsTransferClient` contracts.

Structural UI is LETC/Skeletons. `ItemList` deliberately owns a delegated raw
HTML tile renderer for dense directories. Canonical identities are always
`{hub_id,nid}`.
