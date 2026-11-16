import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { LABEL, SUSPENDED } from "../herdr/mods/tab-tree/recipes.js";

// What the sidebar shows for a suspended or waking agent (ticket 08). The host
// and the element builders are fakes at the module boundary; each element
// records its calls and children, so a test reads what a row shows.
const NODE = Symbol("node");
function element(arg) {
  const node = { arg, calls: [], kids: [] };
  const proxy = new Proxy({}, { get: (_, method) => {
    if (method === NODE) return node;
    return (...args) => {
      node.calls.push([method, ...args]);
      if (method === "when" && args[0]) args[1](proxy);
      if (method === "child") node.kids.push(args[0]);
      if (method === "children") node.kids.push(...args[0]);
      return proxy;
    };
  } });
  return proxy;
}
const host = {
  hc: async () => ({ code: 0, stdout: "{}" }), exec: async () => ({ code: 0, stdout: "" }),
  spaces: () => [], panes: () => [], terminals: () => [], machines: () => [],
  run() {}, openOverlay() {}, theme: () => ({}), shared() {}, setShared() {}, home: () => "/home", layout: () => null,
  focused: () => null, settings: () => ({}), readTextFile: async () => null,
};
globalThis[Symbol.for("herdr.sidebar-suspension.test-host")] = { host, element };
globalThis.localStorage = { getItem: () => null, setItem() {} };
const hook = registerHooks({ resolve(specifier, context, next) {
  const prelude = 'const { host, element } = globalThis[Symbol.for("herdr.sidebar-suspension.test-host")];';
  const sources = {
    herdr: `${prelude} export const { ${Object.keys(host).join(", ")} } = host;`,
    "gpui-kit": `${prelude} export class View {} export const div = element, image = element, svg = element;`,
    "gpui-base": `${prelude} export const v_flex = element, h_flex = element;`,
  };
  if (sources[specifier]) return { url: "data:text/javascript," + encodeURIComponent(sources[specifier]), shortCircuit: true };
  return next(specifier, context);
} });
const { default: TabTree } = await import("../herdr/mods/tab-tree/main.js");
hook.deregister();

const theme = { dim: "DIM", foreground: "FG", muted: "MUTED", working: "WORKING", blocked: "BLOCKED", idle: "IDLE", done: "DONE", hover: "HOVER", selected: "SELECTED", raised: "RAISED", input: "INPUT", accent: "#123456" };
const nodes = (root) => {
  const all = [];
  const walk = (x) => { const n = x?.[NODE]; if (!n) return; all.push(n); n.kids.forEach(walk); };
  walk(root);
  return all;
};
const texts = (root) => nodes(root).flatMap((n) => n.kids.filter((k) => typeof k === "string"));
const ids = (root) => nodes(root).flatMap((n) => n.calls.filter(([m]) => m === "id").map(([, id]) => id));
const colorOf = (root, text) => {
  const n = nodes(root).find((x) => x.kids.includes(text));
  return n?.calls.filter(([m]) => m === "text_color").at(-1)?.[1];
};

const record = JSON.stringify({ version: 1, agent: "pi", root: "agent", cwd: "/home/project", since: 1 });
// A stand-in holds the terminal: it reports as the herdr-standin app.
const standin = (status = "idle") => ({ pane: "p7", terminal: "t7", tab: "tab7", title: "Fix the parser", cwd: "/home/project", status, app: "herdr-standin", program: { key: "agent", name: "herdr-standin", icon: null, tint: false, agent: false, shell: false } });
const agent = (status = "idle") => ({ ...standin(status), app: "pi", program: { key: "pi", name: "Pi", icon: "icons/pi.svg", tint: true, agent: true, shell: false } });
const shell = () => ({ ...standin(), title: "fish", status: null, app: null, program: { key: "shell", name: "fish", icon: null, tint: false, agent: false, shell: true } });

function row(p, labels, { collapsed = false, hovered = false } = {}) {
  const view = new TabTree();
  view.folded = new Set();
  view.labels = new Map([["t7", labels]]);
  view.hovered = hovered ? "tab7" : null;
  return view.tabRow(theme, { active: false }, { id: "tab7", named: false }, { p, kids: [] }, collapsed, "project", null);
}
const suspended = { [LABEL]: "pi", [SUSPENDED]: record };

test("a suspended agent's row shows a dimmed name and 💤", () => {
  const r = row(standin(), suspended);
  assert.ok(texts(r).includes("Fix the parser"));
  assert.equal(colorOf(r, "Fix the parser"), "DIM");
  assert.ok(texts(r).includes("💤"));
  // An agent that runs shows its name in full color, and no 💤.
  const live = row(agent(), { [LABEL]: "pi" });
  assert.equal(colorOf(live, "Fix the parser"), "FG");
  assert.ok(!texts(live).includes("💤"));
});

test("a suspended agent's row in the narrow sidebar shows 💤 and a dimmed icon", () => {
  const r = row(standin(), suspended, { collapsed: true });
  assert.ok(texts(r).includes("💤"));
  assert.ok(nodes(r).some((n) => n.calls.some(([m, v]) => m === "opacity" && v < 1)));
  assert.ok(!texts(row(agent(), { [LABEL]: "pi" }, { collapsed: true })).includes("💤"));
});

test("a suspended agent without a title goes by its agent, not by the stand-in", () => {
  const r = row({ ...standin(), title: "" }, suspended);
  assert.ok(texts(r).includes("pi"));
  assert.ok(!texts(r).includes("herdr-standin"));
});

test("a stand-in that cannot wake still says it needs you", () => {
  const r = row(standin("blocked"), suspended);
  assert.ok(texts(r).includes("Needs you"));
});

test("a waking agent shows waking… from the stand-in's working report until the woken agent reports", () => {
  // The stand-in reports working, then removes its label and replaces itself.
  for (const labels of [suspended, { [LABEL]: "pi" }]) {
    const r = row(standin("working"), labels);
    assert.ok(texts(r).includes("waking…"));
    assert.ok(!texts(r).includes("💤"));
  }
  // The woken agent reported its own status.
  const woken = row(agent("working"), { [LABEL]: "pi" });
  assert.ok(!texts(woken).includes("waking…"));
});

test("↻ is never offered on a suspended terminal, but a kept terminal back at a shell still offers it", () => {
  assert.ok(!ids(row(standin(), suspended, { hovered: true })).includes("tab-resume-tab7"));
  // herdr-shell, before the stand-in reports: a shell with the label.
  assert.ok(!ids(row(shell(), suspended, { hovered: true })).includes("tab-resume-tab7"));
  // An agent that crashed after its first suspension: kept, at a shell, no label.
  assert.ok(ids(row(shell(), { [LABEL]: "pi" }, { hovered: true })).includes("tab-resume-tab7"));
});
