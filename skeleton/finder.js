"use strict";

module.exports = function finderSkeleton(finder) {
  const { Skeletons } = finder.runtime;
  const button = (service, label) => Skeletons.Button.Label({ className: `drumee-finder__action drumee-finder__action--${service}`, content: label, service, uiHandler: finder, partHandler: finder, tagName: "button", attributes: { type: "button" } });
  const result = [
    Skeletons.Box.X({ className: "drumee-finder__toolbar", sys_pn: "toolbar", partHandler: finder, kids: [button("back", "Back"), button("forward", "Forward"), button("up", "Up"), button("upload", "Upload"), button("download", "Download")] }),
    Skeletons.Button.Label({ className: "drumee-finder__breadcrumb", sys_pn: "breadcrumb", partHandler: finder, uiHandler: finder, service: "breadcrumb-root", tagName: "button", attributes: { type: "button" }, content: "/" }),
    Skeletons.Box.Y({ className: "drumee-finder__content", sys_pn: "content", partHandler: finder, kids: [
      { kind: "finder_item_list", className: "drumee-finder__items", sys_pn: "item-list", partHandler: finder, finder },
      { kind: "finder_selection_marquee", className: "drumee-finder__marquee", sys_pn: "selection-marquee", partHandler: finder, finder }
    ] })
  ];
  if (finder.upload_controller) result.push({ kind: "finder_transfer_progress", controller: finder.upload_controller, transfer_kind: "upload", finder });
  if (finder.download_controller) result.push({ kind: "finder_transfer_progress", controller: finder.download_controller, transfer_kind: "download", finder });
  return result;
};
