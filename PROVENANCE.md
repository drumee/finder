# Finder provenance

## Fixed source commits

- Phase 4.8 transient baseline: `2033335491d84b1dc07a5b36bc18de17f9affaba`
- Phase 4.9 stabilized transient source: `96d093eeb`
- historical ui-team: `17d1d4a03a135c33b44bbb22054fa2d140bbc1a6`
- historical server-team: `7fb16c449ed09258c501e88e3c87a4d71c51a941`

The repository was created from the `target/modules/finder` subtree so the
Phase 4.8 and Phase 4.9 extraction commits retain provenance.

## Adapted and rewritten

Historical folder-window behavior, dense media grids, selection geometry,
MFS delta handling and transfer workflows were decomposed into a Finder-local
capability. Global Desk/selection/radio ownership was rewritten as explicit
instance state and injected logical clients.

## Retained conceptually

The LETC Widget/skeleton/skin structure, delegated dense-grid rendering,
five-pixel marquee threshold, logical MFS identity, MOVE/COPY policy,
resumable upload control and offline download preparation are retained.

## Excluded

Desk Window Manager, Team/Chat behavior, backend services, runtime ACL,
server-runtime, system-mfs, SQL, FileIo, host-filesystem, media generators,
archive workers and all physical-storage knowledge are excluded. FinderWindow
is the only optional adapter to the standalone Window Manager.
