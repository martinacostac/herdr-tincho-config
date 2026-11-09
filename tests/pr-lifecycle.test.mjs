import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

// Exercise the real mod with only its native host and process boundaries mocked.
function builder(kind) {
  const node = { kind, nodes: [], attrs: {} };
  const proxy = new Proxy(node, { get(target, key) {
    if (key in target) return target[key];
    if (key === "child") return (child) => { node.nodes.push(child); return proxy; };
    if (key === "children") return (children) => { node.nodes.push(...children); return proxy; };
    if (key === "when") return (condition, fn) => condition ? fn(proxy) : proxy;
    return (...args) => { node.attrs[key] = args; return proxy; };
  } });
  return proxy;
}
const KEY = "tincho-status.pr-enabled";
const state = {};
const api = {
  View: class {}, div: () => builder("div"), svg: (path) => builder(path),
  h_flex: () => builder("row"), v_flex: () => builder("column"),
  v_virtual_list: () => builder("list"),
  VirtualListScrollHandle: { new: () => ({ scroll_to_item() {}, release() {} }) },
  terminals: () => [], panes: () => state.panes, focused: () => state.focus,
  spaces: () => state.spaces, agents: () => [], keys: () => [],
  props: () => state.props, theme: () => new Proxy({}, { get: (_, key) => String(key) }),
  window: () => ({ platform: "macos" }), layout: () => null,
  run() {}, openOverlay() {}, closeOverlay() {},
  shared: (key) => state.shared.get(key),
  setShared: (key, value) => { state.shared.set(key, value); state.invalidated = true; },
  nextCommand: () => new Promise((resolve) => state.commands.push(resolve)),
  exec: (command, args, options) => new Promise((resolve, reject) => {
    state.requests.push({ command, args, options, resolve, reject });
  }),
};
globalThis[Symbol.for("herdr.pr.lifecycle-test")] = api;
const hook = registerHooks({ resolve(specifier, context, next) {
  if (["gpui-kit", "gpui-base", "herdr"].includes(specifier)) {
    return { url: "data:text/javascript," + encodeURIComponent(`export const { ${Object.keys(api).join(", ")} } = globalThis[Symbol.for("herdr.pr.lifecycle-test")];`), shortCircuit: true };
  }
  return next(specifier, context);
} });
const { default: Status } = await import("../herdr/mods/tincho-status/main.js");
hook.deregister();

function reset(value) {
  Object.assign(state, {
    shared: new Map(value === undefined ? [] : [[KEY, value]]), props: {},
    panes: [{ pane: "p1", cwd: "/repo", branch: "feature/focused" }],
    focus: { pane: "p1" }, spaces: [{ active: true, branch: "space-branch", machine: "remote" }],
    timers: [], tasks: [], requests: [], commands: [], invalidated: false,
  });
}
function task() {
  return { cancelled: false, done: false, cancel() { this.cancelled = true; }, is_done() { return this.done; } };
}
function context() {
  return {
    timer: { every(ms, callback) {
      const t = Object.assign(task(), { ms, fire() { if (!this.cancelled) callback(context()); } });
      state.timers.push(t); return t;
    } },
    spawn(fn) {
      const t = task(); state.tasks.push(t);
      // Deliberately let cancelled continuations finish: exec itself cannot be killed.
      t.promise = Promise.resolve(fn(context())).finally(() => { t.done = true; });
      return t;
    },
    notify() {}, focus_handle: () => ({ focus() {} }),
  };
}
function view() { const status = new Status(); status.init({}, context()); return status; }
function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.attrs.id?.[0] === id) return node;
  for (const child of node.nodes) { const found = find(child, id); if (found) return found; }
  return null;
}
function text(node) { return typeof node === "string" ? node : node?.nodes?.map(text).join(" ") ?? ""; }
function render(status) { return status.render(context()); }
function toggle(status) { find(render(status), "pr-toggle").attrs.on_click[0]({}, context()); }
const flush = () => new Promise((resolve) => setImmediate(resolve));
const activeTimers = () => state.timers.filter((t) => !t.cancelled);

const response = (value) => ({ code: 0, stdout: JSON.stringify(value) });
const prResponse = (number = 42) => response({
  number, url: `https://github.com/owner/repo/pull/${number}`, state: "OPEN", author: { login: "author" },
  statusCheckRollup: [{ name: "tests", status: "COMPLETED", conclusion: "SUCCESS" }], reviews: [],
});
const threadsResponse = response({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } });

for (const stage of ["pr", "missing-pr", "check-runs", "graphql"]) {
  test(`disable during ${stage} suppresses follow-ups and stale rendering`, async () => {
    reset(true);
    const status = view();
    render(status);
    if (stage === "check-runs") {
      state.requests[0].resolve({ code: 1, stdout: "no PR" });
      await flush();
      assert.match(state.requests[1].args[1], /check-runs/);
    } else if (stage === "graphql") {
      state.requests[0].resolve(prResponse());
      await flush();
      assert.equal(state.requests[1].args[1], "graphql");
    }
    const pending = state.requests.at(-1);
    const count = state.requests.length;
    toggle(status);
    pending.resolve(stage === "pr" ? prResponse() : stage === "missing-pr" ? { code: 1, stdout: "no PR" }
      : stage === "check-runs" ? response({ check_runs: [] }) : threadsResponse);
    await flush();
    assert.equal(state.requests.length, count, "no gh follow-up after disable");
    assert.doesNotMatch(text(render(status)), /#42|PR…|CI|CodeRabbit|Copilot/);
    assert.match(text(render(status)), /feature\/focused/);
    assert.equal(activeTimers().length, 0);
    status.close();
  });
}

test("rapid off/on cannot resume an old lookup or overwrite the new generation", async () => {
  reset(true);
  const status = view(); render(status);
  const oldView = state.requests[0];
  toggle(status); toggle(status);
  assert.equal(state.requests.length, 2);
  oldView.resolve(prResponse(1));
  await flush();
  assert.equal(state.requests.length, 2, "old generation cannot start GraphQL after re-enable");
  state.requests[1].resolve(prResponse(2));
  await flush();
  state.requests[2].resolve(threadsResponse);
  await flush();
  assert.match(text(render(status)), /#2/);
  assert.doesNotMatch(text(render(status)), /#1(?:\s|$)/);
  status.close();
});

// A fresh context is supplied to every event/timer/task, like the native host.
test("persisted on starts immediately; toggle persists and owns only one timer", () => {
  reset(true);
  const status = view();
  assert.equal(state.requests.length, 1, "enabled initialization looks up the focused branch immediately");
  assert.deepEqual(state.requests[0].args.slice(0, 3), ["pr", "view", "feature/focused"]);
  assert.deepEqual(state.requests[0].options, { cwd: "/repo", on: "remote" });
  for (let i = 0; i < 5; i++) render(status);
  assert.equal(activeTimers().length, 1);
  assert.equal(activeTimers()[0].ms, 60000);
  assert.equal(state.requests.length, 1, "renders cannot duplicate an in-flight lookup");
  toggle(status);
  assert.equal(state.shared.get(KEY), false);
  assert.equal(activeTimers().length, 0, "disable cancels timer immediately");
  assert.equal(text(find(render(status), "pr-toggle")), "PR off");
  toggle(status);
  assert.equal(state.shared.get(KEY), true);
  assert.equal(state.requests.length, 2, "re-enable starts a fresh lookup without waiting for the old exec");
  for (let i = 0; i < 5; i++) render(status);
  assert.equal(activeTimers().length, 1);
  status.close();
  assert.equal(activeTimers().length, 0);
  assert.ok(state.tasks.every((t) => t.cancelled || t.done), "close retains no running task handles");
});

test("shared invalidation synchronizes live copies and external setting changes", () => {
  reset();
  const first = view(), second = view();
  toggle(first);
  assert.equal(state.invalidated, true, "toggle writes shared state so the host invalidates all copies");
  render(second);
  assert.equal(text(find(render(second), "pr-toggle")), "PR on");
  assert.equal(activeTimers().length, 2, "each live copy owns at most one timer");
  assert.equal(state.requests.length, 2);
  api.setShared(KEY, false);
  render(first); render(second);
  assert.equal(activeTimers().length, 0);
  assert.equal(text(find(render(second), "pr-toggle")), "PR off");
  api.setShared(KEY, true);
  render(first); render(second);
  assert.equal(activeTimers().length, 2);
  assert.equal(state.requests.length, 4, "external enable immediately looks up both focused branches");
  api.setShared(KEY, "true");
  render(first); render(second);
  assert.equal(activeTimers().length, 0, "malformed external settings disable all copies");
  first.close(); second.close();
});

test("external disable blocks gh continuation even before the next render", async () => {
  reset(true);
  const status = view();
  api.setShared(KEY, false);
  state.requests[0].resolve(prResponse());
  await flush();
  assert.equal(state.requests.length, 1);
  assert.doesNotMatch(text(render(status)), /#42|PR…|CodeRabbit/);
  assert.equal(activeTimers().length, 0);
  status.close();
});

test("old GraphQL and status responses cannot replace newly enabled PR data", async () => {
  for (const stage of ["graphql", "status"]) {
    reset(true);
    const status = view();
    state.requests[0].resolve(stage === "graphql" ? prResponse(1) : { code: 1, stdout: "no PR" });
    await flush();
    if (stage === "status") {
      state.requests[1].resolve(response({ check_runs: [] }));
      await flush();
      assert.match(state.requests[2].args[1], /\/status$/);
    }
    const stale = state.requests.at(-1);
    toggle(status); toggle(status);
    state.requests.at(-1).resolve(prResponse(2));
    await flush();
    state.requests.at(-1).resolve(threadsResponse);
    await flush();
    stale.resolve(stage === "graphql" ? threadsResponse : response({ statuses: [{ context: "bad", state: "failure" }] }));
    await flush();
    const tree = render(status);
    assert.match(text(tree), /#2/);
    assert.doesNotMatch(text(tree), /#1(?:\s|$)|no PR|failed/);
    status.close();
  }
});

test("refresh tick uses one timer, avoids overlapping lookups and tracks focus", async () => {
  reset(true);
  const status = view();
  const timer = activeTimers()[0];
  timer.fire(); timer.fire();
  assert.equal(state.requests.length, 1, "slow lookup cannot overlap itself");
  state.requests[0].resolve(prResponse());
  await flush();
  state.requests[1].resolve(threadsResponse);
  await flush();
  assert.match(text(render(status)), /#42.*CI.*CodeRabbit/);
  timer.fire();
  assert.equal(state.requests.length, 3, "60-second tick starts a refresh even without unrelated invalidation");
  state.panes = [{ pane: "p2", cwd: "/elsewhere", branch: "next-branch" }];
  state.focus = { pane: "p2" };
  assert.match(text(render(status)), /next-branch/);
  assert.deepEqual(state.requests.at(-1).options, { cwd: "/elsewhere", on: "remote" });
  assert.equal(state.requests.at(-1).args[2], "next-branch");
  assert.equal(activeTimers().length, 1);
  toggle(status);
  timer.fire();
  assert.equal(state.requests.length, 4, "cancelled timer does not run");
  assert.match(text(render(status)), /next-branch/);
  status.close();
});

test("no-PR branch checks retain encoded refs, remote execution and CI rendering", async () => {
  reset(true);
  const status = view();
  state.requests[0].resolve({ code: 1, stdout: "no PR" });
  await flush();
  assert.match(state.requests[1].args[1], /feature%2Ffocused\/check-runs/);
  assert.deepEqual(state.requests[1].options, { cwd: "/repo", on: "remote" });
  state.requests[1].resolve(response({ check_runs: [{ name: "tests", status: "completed", conclusion: "success" }] }));
  await flush();
  assert.match(state.requests[2].args[1], /feature%2Ffocused\/status$/);
  state.requests[2].resolve(response({ statuses: [] }));
  await flush();
  assert.match(text(render(status)), /no PR.*CI/);
  toggle(status);
  assert.doesNotMatch(text(render(status)), /no PR|CI/);
  status.close();
});

test("close cancels tasks and prevents pending requests from continuing; fresh copy restarts", async () => {
  reset(true);
  const old = view();
  old.close(); old.close();
  assert.equal(activeTimers().length, 0);
  assert.ok(state.tasks.every((t) => t.cancelled || t.done));
  const fresh = view();
  state.requests[0].resolve(prResponse(1));
  await flush();
  assert.equal(state.requests.length, 2, "old closed copy cannot launch GraphQL");
  assert.equal(activeTimers().length, 1);
  fresh.close();
});

test("jobs popup skips PR initialization even with persisted PR enabled", () => {
  reset(true);
  state.props = { backgroundRoot: "t1", overlay: "popup-1" };
  const popup = view();
  const tree = render(popup);
  assert.equal(state.requests.length, 0);
  assert.equal(state.timers.length, 0);
  assert.equal(state.tasks.length, 0);
  assert.equal(find(tree, "pr-toggle"), null);
  popup.close();
});

test("toggle remains available without a focused repository", () => {
  reset();
  state.focus = null;
  state.panes = [];
  const status = view();
  assert.equal(text(find(render(status), "pr-toggle")), "PR off");
  toggle(status);
  assert.equal(text(find(render(status), "pr-toggle")), "PR on");
  assert.equal(state.requests.length, 0);
  status.close();
});

for (const value of [undefined, false, null, "true", 1, {}, { enabled: true }]) {
  test(`PR defaults off for absent or invalid setting ${JSON.stringify(value)}`, () => {
    reset(value);
    const status = view();
    const tree = render(status);
    assert.equal(state.requests.length, 0, "disabled PR must not start gh");
    assert.equal(state.timers.length, 0, "disabled PR must not create a polling timer");
    assert.equal(text(find(tree, "pr-toggle")), "PR off");
    assert.match(text(tree), /feature\/focused/);
    assert.doesNotMatch(text(tree), /space-branch|PR…|CodeRabbit|Copilot/);
    status.close();
  });
}
