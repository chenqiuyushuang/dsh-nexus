window.__ModuleLoader__.load({ id: "@chenqiuyushuang/dsh-nexus", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");
var NAV_LABEL = "\u8BB0\u5FC6";
var SECTION_ID = "memory";
var SECTION_ORDER = 30;
var inject = ["slots"];
function MemorySection() {
  const [height, setHeight] = (0, import_react.useState)(0);
  (0, import_react.useEffect)(() => {
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (data?.type === "nexus-height" && typeof data.height === "number" && data.height > 0) setHeight(data.height);
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, []);
  return (0, import_react.createElement)("iframe", {
    src: "/nexus",
    title: "Nexus \u8BB0\u5FC6\u9762\u677F",
    style: {
      width: "100%",
      height: height > 0 ? Math.min(height, 620) : 480,
      minHeight: 480,
      maxHeight: 620,
      border: "none",
      borderRadius: 0,
      display: "block"
    }
  });
}
function apply(ctx) {
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: SECTION_ID,
    order: SECTION_ORDER,
    label: () => NAV_LABEL
  }, MemorySection));
  ctx.effect(() => {
    patchBrainIcon();
    const observer = new MutationObserver(() => {
      patchBrainIcon();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
    };
  }, "nexus: settings brain icon");
}
function patchBrainIcon() {
  for (const dialog of document.querySelectorAll('[role="dialog"]')) {
    const nav = dialog.querySelector("nav");
    if (nav === null) continue;
    for (const button of nav.querySelectorAll("button")) {
      if (button.getAttribute("data-nexus-icon") === "brain") continue;
      const label = button.querySelector("span");
      if (label === null || (label.textContent ?? "").trim() !== NAV_LABEL) continue;
      const icon = button.querySelector("svg");
      if (icon === null) continue;
      button.replaceChild(brainSvg(), icon);
      button.setAttribute("data-nexus-icon", "brain");
    }
  }
}
var SVG_NS = "http://www.w3.org/2000/svg";
function brainSvg() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const half = (d) => {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    return path;
  };
  svg.append(
    half("M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"),
    half("M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"),
    half("M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4")
  );
  return svg;
}
return module.exports; } });
