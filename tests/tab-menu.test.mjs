import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

// The tab-menu mod's Suspend now and Never suspend items (GLOSSARY.md:
// Suspend, Pinned agent), with a mocked Herdr host and UI kit. The policy in
// tab-tree is not loaded: the test plays the leader by writing its shared
// state (suspend-policy.js: SUSPEND_REQUESTS, SUSPEND_STATE).
const REQUESTS = "tincho.suspend.requests";
const STATE = "tincho.suspend.state";
const PIN = "herdr.never-suspend";
const SUSPENDED = "herdr.suspended";

// Fluent builder stub: keeps child nodes and click handlers, ignores styles.
function builder() {
  const node = { nodes: [], attrs: {} };
  const proxy = new Proxy(node, { get(target, key) {
    if (key in target) return target[key];
    if (key === "child") return (child) => { node.nodes.push(child); return proxy; };
    if (key === "children") return (children) => { node.nodes.push(...children); return proxy; };
    if (key === "when") return (condition, fn) => condition ? fn(proxy) : proxy;
    return (...args) => { node.attrs[key] = args; return proxy; };
  } });
  return proxy;
}

const state = {};
const host = {
  View: class {}, div: builder, svg: builder, h_flex: builder, v_flex: builder,
  props: () => state.props,
  terminals: () => structuredClone(state.terminals),
  spaces: () => [], panes: () => [], keys: () => [],
  theme: () => new Proxy({}, { get: (_, key) => String(key) }),
  shared: (key) => structuredClone(state.shared.get(key)),
  setShared: (key, value) => { state.shared.set(key, structuredClone(value)); state.calls.push(["setShared", key]); return null; },
  run: (...args) => state.calls.push(["run", ...args]),
  openOverlay: (spec) => { state.calls.push(["open", spec]); return "o2"; },
  closeOverlay: (id) => { state.calls.push(["close", id]); return null; },
  notify: (n) => { state.calls.push(["notify", n]); return "n1"; },
  exec: async () => assert.fail("the menu runs no program for these items"),
  hc: async (args) => { state.calls.push(["hc", ...args]); return state.hcResult; },
};
globalThis[Symbol.for("herdr.tab-menu.test-host")] = host;
const hook = registerHooks({ resolve(specifier, context, next) {
  if (["gpui-kit", "gpui-base", "herdr"].includes(specifier)) {
    const source = `export const { ${Object.keys(host).join(", ")} } = globalThis[Symbol.for("herdr.tab-menu.test-host")];`;
    return { url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true };
  }
  return next(specifier, context);
} });
const { default: Menu } = await import("../herdr/mods/tab-menu/main.js");
hook.deregister();

const agent = (address, labels = {}) => ({
  address, state: "live", name: address, labels, status: "idle", report: { app: "pi", state: "idle" },
  program: { key: "pi", agent: true, shell: false },
});

function reset({ terminals = [agent("t7")], props = { tab: "tab", target: { id: "tab-7", space: "s1", terminal: "t7" } } } = {}) {
  Object.assign(state, {
    terminals, props: { ...props, overlay: "o1" }, shared: new Map(), calls: [], hcResult: { code: 0, stdout: "", stderr: "" },
  });
}

const cx = { focus_handle: () => ({ focus() {} }), notify() {}, spawn() {} };

// The item labels, in order: every non-empty text in the rendered tree.
function labels(view) {
  const out = [];
  const walk = (node) => {
    if (typeof node === "string") { if (node) out.push(node); return; }
    for (const child of node?.nodes ?? []) walk(child);
  };
  walk(view.render(cx));
  return out;
}

function open() {
  const view = new Menu();
  view.init(state.props, cx);
  return view;
}

/** @param {Menu} view @param {string} label */
function choose(view, label) {
  const i = labels(view).indexOf(label);
  assert.ok(i >= 0, `no item ${label} in ${labels(view).join(", ")}`);
  view.choose(i, cx);
}

const leaderSays = (agents = {}, results = {}) => state.shared.set(STATE, { agents, results });

test("an agent tab shows Suspend now and Never suspend", () => {
  reset();
  const items = labels(open());
  assert.ok(items.includes("Suspend now"), items.join(", "));
  assert.ok(items.includes("Never suspend"), items.join(", "));
  assert.equal(items.at(-1), "Close");
});

test("plain tabs, remote agents, panes, spaces and the global menu show neither item", () => {
  const plain = { address: "t8", state: "live", labels: {}, status: null, report: null, program: { key: "fish", agent: false, shell: true } };
  const cases = [
    { terminals: [plain], props: { tab: "tab", target: { id: "tab-8", space: "s1", terminal: "t8" } } },
    { terminals: [agent("mini/t7")], props: { tab: "tab", target: { id: "tab-7", space: "s1", terminal: "mini/t7" } } },
    { terminals: [agent("t7")], props: { tab: "pane", target: { pane: "p7", terminal: "t7" } } },
    { terminals: [agent("t7")], props: { tab: "space", target: { id: "s1" } } },
    { terminals: [agent("t7")], props: { tab: "global", target: {} } },
  ];
  for (const c of cases) {
    reset(c);
    const items = labels(open());
    assert.ok(!items.some((l) => /suspend/i.test(l)), `${c.props.tab}: ${items.join(", ")}`);
  }
});

test("Suspend now requests a manual suspension, keeps other requests, and shows the leader's result", () => {
  reset();
  state.shared.set(REQUESTS, { t9: 123 });
  const view = open();
  const before = Date.now();
  choose(view, "Suspend now");
  const requests = state.shared.get(REQUESTS);
  assert.equal(requests.t9, 123, "another mod's request stays");
  assert.ok(requests.t7 >= before && requests.t7 <= Date.now(), String(requests.t7));
  assert.ok(!state.calls.some(([kind]) => kind === "close"), "the menu stays open for the result");
  assert.ok(labels(view).includes("Suspending…"));
  // A result for an older request is not this one.
  leaderSays({}, { t7: { requested: requests.t7 - 1, suspended: true, reason: null, at: Date.now() } });
  assert.ok(labels(view).includes("Suspending…"));
  leaderSays({}, { t7: { requested: requests.t7, suspended: true, reason: null, at: Date.now() } });
  assert.ok(labels(view).includes("Suspended"), labels(view).join(", "));
});

test("Suspend now shows the leader's reason when the request fails", () => {
  reset();
  const view = open();
  choose(view, "Suspend now");
  const requested = state.shared.get(REQUESTS).t7;
  leaderSays({}, { t7: { requested, suspended: false, reason: "background", at: Date.now() } });
  assert.ok(labels(view).includes("Can't suspend: background processes"), labels(view).join(", "));
});

const TEXTS = {
  off: "automatic suspension off",
  remote: "remote terminal",
  suspended: "already suspended",
  "not-resumable": "not resumable",
  pinned: "pinned",
  focused: "focused",
  working: "working",
  blocked: "blocked",
  "not-idle": "not idle",
  recent: "idle too briefly",
  "processes-unknown": "processes unknown",
  background: "background processes",
  "not-installed": "not installed",
  gone: "terminal ended",
  changed: "agent changed",
  failed: "hc command failed",
  closed: "tab tree closed",
};

test("every reason has readable text, from the shared reasons and from a request's result", () => {
  for (const [reason, text] of Object.entries(TEXTS)) {
    reset({ terminals: [agent("t7", reason === "pinned" ? { [PIN]: "1" } : {})] });
    leaderSays({ t7: { auto: reason, manual: reason } });
    assert.ok(labels(open()).includes(`Can't suspend: ${text}`), `${reason}: ${labels(open()).join(", ")}`);

    reset();
    const view = open();
    choose(view, "Suspend now");
    leaderSays({}, { t7: { requested: state.shared.get(REQUESTS).t7, suspended: false, reason, at: Date.now() } });
    assert.ok(labels(view).includes(`Can't suspend: ${text}`), `${reason} result: ${labels(view).join(", ")}`);
  }
});

test("an unknown reason still shows, as its own word", () => {
  reset();
  leaderSays({ t7: { auto: "solar-flare", manual: "solar-flare" } });
  assert.ok(labels(open()).includes("Can't suspend: solar-flare"));
});

test("a recent process-rule result shows before a new request, other old results do not", () => {
  reset();
  leaderSays({ t7: { auto: "recent", manual: null } }, { t7: { requested: 1, suspended: false, reason: "background", at: Date.now() } });
  assert.ok(labels(open()).includes("Can't suspend: background processes"));
  leaderSays({ t7: { auto: "recent", manual: null } }, { t7: { requested: 1, suspended: false, reason: "focused", at: Date.now() } });
  assert.ok(labels(open()).includes("Suspend now"), "an old focus is no reason now");
});

test("a suspended agent's tab says it is already suspended", () => {
  reset({ terminals: [{ ...agent("t7", { [SUSPENDED]: "{}" }), program: { key: "herdr-standin", agent: false, shell: false }, report: { app: "herdr-standin", state: "idle" } }] });
  const items = labels(open());
  assert.ok(items.includes("Can't suspend: already suspended"), items.join(", "));
  assert.ok(items.includes("Never suspend"));
});

test("Suspend now still requests when a rule failed, to check again", () => {
  reset();
  leaderSays({ t7: { auto: "focused", manual: "focused" } });
  const view = open();
  choose(view, "Can't suspend: focused");
  assert.ok(Number.isFinite(state.shared.get(REQUESTS)?.t7));
  assert.ok(labels(view).includes("Suspending…"));
});

test("Never suspend pins the agent, and the item then offers to remove the pin", async () => {
  reset();
  choose(open(), "Never suspend");
  assert.deepEqual(state.calls.filter(([kind]) => kind === "hc"), [["hc", "label", "t7", `${PIN}=1`]]);
  assert.ok(state.calls.some(([kind, id]) => kind === "close" && id === "o1"));

  reset({ terminals: [agent("t7", { [PIN]: "1" })] });
  const view = open();
  const items = labels(view);
  assert.ok(!items.includes("Never suspend"), items.join(", "));
  assert.ok(items.includes("Can't suspend: pinned"), "the pin shows at once, before the leader's next pass");
  choose(view, "Remove Never suspend");
  assert.deepEqual(state.calls.filter(([kind]) => kind === "hc"), [["hc", "label", "t7", `${PIN}=`]]);
});

test("a pin removed since the leader's last pass no longer holds Suspend now back", () => {
  reset();
  leaderSays({ t7: { auto: "pinned", manual: "pinned" } });
  assert.ok(labels(open()).includes("Suspend now"));
});

test("a failed pin change is reported", async () => {
  reset();
  state.hcResult = { code: 3, stdout: "", stderr: "not_found" };
  choose(open(), "Never suspend");
  await new Promise((resolve) => setImmediate(resolve));
  const note = state.calls.find(([kind]) => kind === "notify");
  assert.ok(note, "a notification");
  assert.equal(note[1].level, "error");
});
