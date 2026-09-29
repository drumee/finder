# Phase 4.8 Finder provenance

Historical behavior is recovered from `drumee/ui-team` at
`17d1d4a03a135c33b44bbb22054fa2d140bbc1a6`:

- `builtins/window/folder/**`: navigation and composite window evidence;
- `builtins/media/{core,interact,grid}/**`: item, geometry, selection and
  lightweight rendering evidence;
- `builtins/window/selection/**`: normalized marquee geometry and incremental
  membership;
- `builtins/window/utils.js`: MFS delta behavior;
- `builtins/media/{uploader,bundle,chunked}/**` and
  `builtins/window/downloader/**`: transfer behavior.

The new implementation intentionally replaces Desk Window Manager/global
selection coupling with Finder-owned state and a thin standalone
Window Manager adapter.
