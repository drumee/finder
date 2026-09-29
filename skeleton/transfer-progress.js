"use strict";

module.exports = function transferProgressSkeleton(view) {
  const { Skeletons } = view.runtime;
  return Skeletons.Box.X({
    className: `drumee-finder__transfer drumee-finder__transfer--${view.transfer_kind}`,
    kids: [
      Skeletons.Note({ className: "drumee-finder__transfer-label", sys_pn: "transfer-label", partHandler: view, content: `${view.transfer_kind} idle` }),
      Skeletons.Button.Label({ className: "drumee-finder__transfer-cancel", content: "Cancel", service: "cancel", uiHandler: view, partHandler: view, tagName: "button", attributes: { type: "button" } })
    ]
  });
};
