import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
const panelLayout = JSON.parse(readFileSync(new URL("../herdr/layouts/tincho.json", import.meta.url), "utf8"));

// Fluent builder stub: keep actual callbacks and child nodes, ignoring styles.
let deferredRender = false;
function builder(kind) {
  const node = { kind, nodes: [], attrs: {} };
  const proxy = new Proxy(node, { get(target, key) {
    if (key in target) return target[key];
    if (key === "child") return (child) => { node.nodes.push(child); return proxy; };
    if (key === "children") return (children) => { node.nodes.push(...children); return proxy; };
    if (key === "when") return (condition, fn) => condition ? fn(proxy) : proxy;
    return (...args) => {
      assert.ok(!deferredRender || !String(key).startsWith("on_"), "native virtual renderers forbid event handlers");
      node.attrs[key] = args; return proxy;
    };
  } });
  return proxy;
}
const state = {};
const api = {
  View: class {}, div: () => builder("div"), svg: (path) => builder(path),
  h_flex: () => builder("row"), v_flex: () => builder("column"),
  v_virtual_list: (id, count, _size, _key, render) => {
    let rows;
    deferredRender = true;
    try { rows = render({ start: 0, end: count }); }
    finally { deferredRender = false; }
    return builder("virtual-list").id(id).children(rows);
  },
  VirtualListScrollHandle: { new: () => ({
    scroll_to_item: (...args) => state.scrolls.push(args),
    release: () => { state.releases++; },
  }) },
  terminals: () => state.terminals, panes: () => state.panes, focused: () => state.focus,
  props: () => state.props, layout: () => state.layout,
  theme: () => new Proxy({}, { get: (_, key) => String(key) }),
  closeOverlay: (id) => state.calls.push(["close", id]),
  run: (...args) => state.calls.push(["run", ...args]),
  openOverlay: (spec) => { state.calls.push(["open", spec]); return "popup-1"; },
  spaces: () => [], agents: () => [], keys: () => [], window: () => ({ platform: "macos" }),
  shared: () => undefined, setShared: () => {},
  nextCommand: () => new Promise((resolve) => state.commands.push(resolve)),
  exec: () => assert.fail("job popup must not run external commands"),
};
globalThis[Symbol.for("herdr.background-jobs.ui-test")] = api;
const hook = registerHooks({ resolve(specifier, context, next) {
  if (["gpui-kit", "gpui-base", "herdr"].includes(specifier)) {
    const names = Object.keys(api).join(", ");
    return { url: "data:text/javascript," + encodeURIComponent(`export const { ${names} } = globalThis[Symbol.for("herdr.background-jobs.ui-test")];`), shortCircuit: true };
  }
  return next(specifier, context);
} });
const { default: Status } = await import("../herdr/mods/tincho-status/main.js");
hook.deregister();

function reset() {
  Object.assign(state, {
    terminals: [
      { address: "t1", state: "live", name: "Parent" },
      { address: "t2", state: "live", parent: "t1", name: "Tests", status: null },
      { address: "t3", state: "live", parent: "t1", name: "Review", status: "blocked" },
      { address: "t4", state: "live", parent: "t1", name: "Visible" },
      { address: "t5", state: "live", parent: "unrelated", name: "Not ours" },
    ],
    panes: [{ terminal: "t1" }, { terminal: "t4" }],
    focus: { terminal: "t1", pane: null }, props: {}, calls: [], timers: 0,
    commands: [], scrolls: [], releases: 0, layout: structuredClone(panelLayout),
  });
}
const cx = {
  timer: { every: () => { state.timers++; } },
  focus_handle: () => ({ focus: () => {} }), notify: () => {},
  spawn: (fn) => { void fn(); },
};
function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.attrs.id?.[0] === id) return node;
  for (const child of node.nodes) { const found = find(child, id); if (found) return found; }
  return null;
}
function text(node) {
  if (typeof node === "string") return node;
  return node?.nodes?.map(text).join(" ") ?? "";
}
function view() { const result = new Status(); result.init({}, cx); return result; }
function expectedPreview(address) {
  return ["open", {
    kind: "dialog", width: 0.8, height: 0.8,
    layout: {
      type: "column", padding: 8,
      children: [
        { type: "block", size: { px: 34 }, content: { mod: "peek", props: { terminal: address } } },
        { type: "block", content: { terminal: address } },
      ],
    },
  }];
}

test("status bar counts only hidden descendants and opens a parent-scoped popup", () => {
  reset();
  const status = view();
  const count = find(status.render(cx), "background-job-count");
  assert.equal(text(count), " 2 background jobs");
  assert.equal(count.attrs.text_color[0], "blocked");
  count.attrs.on_click[0]();
  assert.deepEqual(state.calls[0], ["open", {
    mod: "tincho-status", kind: "popup", at: "pointer", width: 420, height: 100,
    props: { backgroundRoot: "t1" },
  }]);
});

test("custom command opens the popup for the current focus", async () => {
  reset();
  view();
  state.commands.shift()("background-jobs");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.calls[0][0], "open");
  assert.deepEqual(state.calls[0][1].props, { backgroundRoot: "t1" });
  state.calls = [];
  state.focus = null;
  state.commands.shift()("background-jobs");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(state.calls, []);
});

test("popup height fits the list and caps long lists at seven rows", () => {
  for (const [count, height] of [[0, 56], [1, 56], [7, 320], [20, 320]]) {
    reset();
    state.terminals = [state.terminals[0], ...Array.from({ length: count }, (_, i) => ({
      address: `job-${i}`, parent: "t1", state: "live",
    }))];
    view().openJobs();
    assert.equal(state.calls[0][1].height, height, `${count} jobs`);
  }
});

test("count updates with focus and disappears without matching jobs", () => {
  reset();
  const status = view();
  state.focus = { terminal: "t3", pane: null };
  assert.equal(find(status.render(cx), "background-job-count"), null);
  state.focus = null;
  assert.equal(find(status.render(cx), "background-job-count"), null);
});

test("popup stays under its opening parent and clicking peeks without creating a pane", () => {
  reset();
  state.props = { backgroundRoot: "t1", overlay: "popup-1" };
  const popup = view();
  assert.equal(state.timers, 0, "popup does not start the status bar's PR polling timer");
  state.focus = { terminal: "t5" };
  const tree = popup.render(cx);
  assert.equal(tree.attrs.bg, undefined, "native rounded frame paints the background; a square child fill leaks outside its corners");
  assert.equal(find(tree, "background-job-list").attrs.h[0], 88, "native popup list needs an explicit viewport height");
  assert.equal(tree.nodes.length, 1, "popup contains only the job list, not header/divider/footer");
  assert.doesNotMatch(text(tree), /Background jobs ·|Under Parent|Click or Enter|Esc to close/);
  const row = find(tree, "background-job-t3");
  assert.ok(row);
  assert.match(text(row), /Needs you/);
  find(tree, "background-job-list").attrs.on_item_click[0]("t3");
  assert.deepEqual(state.calls, [["close", "popup-1"], expectedPreview("t3")]);
});

test("preview keeps full remote addresses in the terminal and standard header", () => {
  reset();
  state.terminals = [
    { address: "host/t1", state: "live" },
    { address: "host/t2", parent: "t1", state: "live", name: "Remote job" },
  ];
  state.focus = { terminal: "host/t1" };
  state.props = { backgroundRoot: "host/t1", overlay: "popup-1" };
  const popup = view();
  find(popup.render(cx), "background-job-list").attrs.on_item_click[0]("host/t2");
  assert.deepEqual(state.calls, [["close", "popup-1"], expectedPreview("host/t2")]);
});

test("stale clicks cannot peek finished jobs or jobs promoted into a pane", () => {
  for (const change of [() => { state.terminals[1].state = "finished"; }, () => { state.panes.push({ terminal: "t2" }); }]) {
    reset();
    state.props = { backgroundRoot: "t1", overlay: "popup-1" };
    const popup = view();
    const list = find(popup.render(cx), "background-job-list");
    change();
    list.attrs.on_item_click[0]("t2");
    assert.deepEqual(state.calls, []);
  }
});

test("popup handles empty lists and keyboard escape", () => {
  reset();
  state.props = { backgroundRoot: "t1", overlay: "popup-1" };
  const popup = view();
  state.terminals = [];
  const tree = popup.render(cx);
  assert.match(text(tree), /No background jobs/);
  tree.attrs.on_key_down[0]({ key: "down" }, cx);
  tree.attrs.on_key_down[0]({ key: "enter" }, cx);
  assert.deepEqual(state.calls, []);
  tree.attrs.on_key_down[0]({ key: "escape" }, cx);
  assert.deepEqual(state.calls, [["close", "popup-1"]]);
});

test("long-list keyboard navigation scrolls selected rows into view and releases its handle", () => {
  reset();
  state.terminals = [state.terminals[0], ...Array.from({ length: 15 }, (_, i) => ({
    address: `job-${String(i).padStart(2, "0")}`, name: `Job ${String(i).padStart(2, "0")}`, parent: "t1", state: "live",
  }))];
  state.props = { backgroundRoot: "t1", overlay: "popup-1" };
  const popup = view();
  const tree = popup.render(cx);
  assert.equal(find(tree, "background-job-list").attrs.h[0], 308, "long lists cap at seven rows");
  assert.deepEqual(state.scrolls, [[0]]);
  tree.attrs.on_key_down[0]({ key: "up" }, cx);
  assert.deepEqual(state.scrolls.at(-1), [14, "center"], "wrap to last row scrolls it into view");
  tree.attrs.on_key_down[0]({ key: "down" }, cx);
  assert.deepEqual(state.scrolls.at(-1), [0, "center"], "wrap to first row scrolls back");
  tree.attrs.on_key_down[0]({ key: "enter" }, cx);
  assert.deepEqual(state.calls.at(-1), expectedPreview("job-00"));
  popup.close();
  assert.equal(state.releases, 1);
});

test("keyboard navigation selects a job for peek", () => {
  reset();
  state.props = { backgroundRoot: "t1", overlay: "popup-1" };
  const popup = view();
  const tree = popup.render(cx);
  tree.attrs.on_key_down[0]({ key: "down" }, cx);
  tree.attrs.on_key_down[0]({ key: "enter" }, cx);
  assert.deepEqual(state.calls, [["close", "popup-1"], expectedPreview("t2")]);
});

function layoutNode(id, node = state.layout) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = layoutNode(id, child); if (found) return found;
  }
}

test("Files and Changes buttons sit after the right-align spacer and open their panel", () => {
  for (const child of ["files", "changes"]) {
    reset(); const status = view(), tree = status.render(cx);
    const group = find(tree, "panel-buttons"), button = find(tree, `panel-${child}`);
    assert.ok(group); assert.ok(text(button).includes(child === "files" ? "Files" : "Changes"));
    assert.ok(tree.nodes.indexOf(group) > tree.nodes.findIndex(node => node.attrs?.flex_1));
    button.attrs.on_click[0]();
    assert.deepEqual(state.calls, [
      ["run", "layout.select", { stack: "panel-body", child }],
      ["run", "layout.show", { id: "panel" }],
    ]);
  }
});

test("panel buttons highlight the visible selection and toggle it closed", () => {
  for (const child of ["files", "changes"]) {
    reset(); layoutNode("panel").hidden = false; layoutNode("panel-body").active = child;
    const tree = view().render(cx), button = find(tree, `panel-${child}`);
    assert.equal(button.attrs.text_color[0], "accent");
    assert.equal(find(tree, `panel-${child === "files" ? "changes" : "files"}`).attrs.text_color[0], "muted");
    button.attrs.on_click[0]();
    assert.deepEqual(state.calls, [["run", "layout.hide", { id: "panel" }]]);
  }
});

test("panel click reads current layout instead of stale render state", () => {
  reset(); const status = view(), tree = status.render(cx);
  layoutNode("panel").hidden = false; layoutNode("panel-body").active = "changes";
  find(tree, "panel-changes").attrs.on_click[0]();
  assert.deepEqual(state.calls, [["run", "layout.hide", { id: "panel" }]]);
  state.calls = [];
  find(tree, "panel-files").attrs.on_click[0]();
  assert.deepEqual(state.calls, [["run", "layout.select", { stack: "panel-body", child: "files" }], ["run", "layout.show", { id: "panel" }]]);
});

test("hidden ancestors have no selected panel button; missing panel is safe", () => {
  reset(); layoutNode("panel").hidden = false; layoutNode("work-body").hidden = true;
  const status = view();
  assert.equal(find(status.render(cx), "panel-files").attrs.text_color[0], "muted");
  state.layout = null;
  find(status.render(cx), "panel-files").attrs.on_click[0]();
  assert.deepEqual(state.calls, []);
});
