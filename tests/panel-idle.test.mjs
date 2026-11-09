import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";

// Exercise the actual View modules; only the native host is replaced.
const state = {};
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function builder() {
  const node = { nodes: [], attrs: {} };
  const proxy = new Proxy(node, { get(target, key) {
    if (key in target) return target[key];
    if (key === "child") return child => { node.nodes.push(child); return proxy; };
    if (key === "children") return children => { node.nodes.push(...children); return proxy; };
    if (key === "when") return (condition, fn) => condition ? fn(proxy) : proxy;
    return (...args) => { node.attrs[key] = args; return proxy; };
  } });
  return proxy;
}
function result(stdout = "", code = 0) { return { code, stdout, stderr: "" }; }
function reply(command, args, options) {
  if (command === "sh") return result("d\0src\0f\0a.txt\0f\0b.txt\0");
  if (args.includes("--show-toplevel")) return result(options.cwd + "\n");
  if (args.includes("status")) return result(" M a.txt\0 M b.txt\0");
  if (args.includes("--numstat")) return result("1\t0\ta.txt\0" + "1\t0\tb.txt\0");
  if (args.includes("diff")) return result("@@ -1 +1 @@\n-old\n+new\n");
  return result();
}
const api = {
  View: class {}, div: builder, svg: builder, h_flex: builder, v_flex: builder,
  InputState: { new: () => ({ handlers: {}, text: "", on(name, fn) { this.handlers[name] = fn; }, value() { return this.text; }, set_value(value) { if (this.released) state.releasedWrites++; this.text = value; }, release() { this.released = true; state.releases++; } }) },
  Input: { new: builder }, Editor: { new: builder },
  EditorState: { new: options => ({ options, release() { state.releases++; } }) },
  Scrollbar: { vertical: id => builder().scroll_target(id) }, v_virtual_list: builder,
  theme: () => new Proxy({}, { get: (_, key) => String(key) }), settings: () => ({}),
  window: () => ({ platform: "macos" }),
  spaces: () => [{ id: "s1", active: true, folder: state.cwd, machine: state.on }],
  focused: () => ({ pane: "p1", cwd: state.cwd }), panes: () => [{ pane: "p1", cwd: state.cwd }],
  layout: () => state.layout,
  exec: (command, args, options) => {
    state.io.push({ kind: "exec", command, args, options });
    if (state.hold?.(command, args)) { const request = deferred(); state.requests.push(request); return request.promise; }
    return Promise.resolve(state.reply ? state.reply(command, args, options) : reply(command, args, options));
  },
  readTextFile: (path, options) => {
    state.io.push({ kind: "read", path, options });
    if (state.holdRead) { const request = deferred(); state.requests.push(request); return request.promise; }
    return Promise.resolve("file contents\n");
  },
  watchFolder: path => { state.io.push({ kind: "watch", path }); const request = deferred(); state.watches.push(request); return request.promise; },
};
globalThis[Symbol.for("herdr.panel-idle.test")] = api;
const hook = registerHooks({ resolve(specifier, context, next) {
  if (["gpui-kit", "gpui-base", "herdr"].includes(specifier)) return {
    url: "data:text/javascript," + encodeURIComponent(`export const { ${Object.keys(api).join(", ")} } = globalThis[Symbol.for("herdr.panel-idle.test")];`), shortCircuit: true,
  };
  return next(specifier, context);
} });
const { default: Files } = await import("../herdr/mods/tincho-files/main.js");
const { default: Changes } = await import("../herdr/mods/tincho-changes/main.js");
hook.deregister();

function reset(active, hidden = false, on = null) {
  Object.assign(state, { cwd: "/repo", on, io: [], requests: [], watches: [], tasks: [], timers: [], notifications: 0, releases: 0, releasedWrites: 0, hold: null, holdRead: false, reply: null, errors: [],
    layout: { id: "root", type: "column", hidden, children: [{ id: "panel", type: "stack", active, children: [
      { id: "files", type: "block", content: { mod: "tincho-files" } },
      { id: "changes", type: "block", content: { mod: "tincho-changes" } },
    ] }] },
  });
}
function timer(ms, fn, repeat = false) {
  const task = { ms, fn, repeat, cancelled: false, cancel() { this.cancelled = true; } };
  state.timers.push(task); return task;
}
// Each callback gets a new cx; retaining an event context across a callback is an error.
function context() {
  let alive = true;
  const check = () => assert.ok(alive, "callback context must not be retained");
  return { expire: () => { alive = false; },
    timer: { after: (ms, fn) => { check(); return timer(ms, fn); }, every: (ms, fn) => { check(); return timer(ms, fn, true); } },
    notify: () => { check(); state.notifications++; }, focus_handle: () => { check(); return { focus() {} }; },
    spawn: fn => {
      check(); const task = Promise.resolve().then(async () => {
        const cx = context(); try { await fn(cx); } finally { cx.expire(); }
      }).catch(error => state.errors.push(error));
      state.tasks.push(task); return { cancel() {} };
    },
  };
}
function invoke(fn) { const cx = context(); try { return fn(cx); } finally { cx.expire(); } }
async function settle() {
  for (let i = 0; i < 80; i++) await Promise.resolve();
  assert.deepEqual(state.errors, []);
}
async function tick() {
  const timers = state.timers.filter(t => !t.cancelled); state.timers = [];
  for (const task of timers) { invoke(cx => task.fn(cx)); if (task.repeat && !task.cancelled) state.timers.push(task); }
  await settle();
}
function mount(Type) {
  const view = new Type(); invoke(cx => view.init({}, cx)); invoke(cx => view.render(cx)); return view;
}
function text(node) {
  return typeof node === "string" ? node : node?.nodes?.map(text).join(" ") ?? "";
}
function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.attrs.id?.[0] === id) return node;
  for (const child of node.nodes) { const result = find(child, id); if (result) return result; }
  return null;
}

test("Changes: file list owns a flex viewport and scrollbar for empty, short and long lists", async () => {
  for (const count of [0, 2, 50, 1000]) {
    reset("changes"); const view = mount(Changes); await settle();
    view.files = Array.from({ length: count }, (_, i) => ({ path: `file-${i}.txt`, status: "M", add: 1, del: 0 }));
    const tree = invoke(cx => view.render(cx));
    const viewport = tree.nodes.find(node => node?.nodes?.some(child => child?.attrs?.id?.[0] === "changes-list"));
    assert.ok(viewport, "list needs its own sized wrapper, not overflow_y_scrollbar's implicit wrapper");
    assert.ok(viewport.attrs.flex_1);
    assert.deepEqual(viewport.attrs.min_h, [44]);
    assert.deepEqual(viewport.attrs.max_h, [count * 28 + 12], "no fixed 200px cap");
    const list = find(tree, "changes-list");
    assert.ok(list.attrs.absolute); assert.ok(list.attrs.inset_0); assert.ok(list.attrs.overflow_y_scroll);
    assert.equal(list.attrs.overflow_y_scrollbar, undefined);
    const scrollbar = viewport.nodes.find(node => node.attrs?.scroll_target?.[0] === "changes-list");
    assert.ok(scrollbar?.attrs.absolute); assert.ok(scrollbar.attrs.inset_0);
    assert.ok(find(tree, "commit-message")); assert.ok(find(tree, "commit"));
    if (count) {
      const path = `file-${count - 1}.txt`;
      invoke(cx => find(tree, `change-${path}`).attrs.on_click[0](null, cx)); await settle();
      assert.equal(view.open, path, "last file retains its selection handler");
      assert.ok(state.io.some(call => call.args?.includes("diff") && call.args.at(-1) === path));
    } else assert.match(text(list), /No uncommitted changes/);
    invoke(cx => view.close(cx));
  }
});

test("standalone panel mods keep identical helpers inside their application directories", async () => {
  for (const name of ["files", "changes"]) {
    const source = await readFile(new URL(`../herdr/mods/tincho-${name}/main.js`, import.meta.url), "utf8");
    assert.match(source, /from "\.\/work\.js"/);
    assert.doesNotMatch(source, /from "\.\.\//);
  }
  assert.equal(
    await readFile(new URL("../herdr/mods/tincho-files/work.js", import.meta.url), "utf8"),
    await readFile(new URL("../herdr/mods/tincho-changes/work.js", import.meta.url), "utf8"),
  );
});

test("Files: hidden preview result is discarded, reveal reloads, close releases editor", async () => {
  reset("files"); const view = mount(Files); await settle(); state.holdRead = true;
  const tree = invoke(cx => view.render(cx));
  invoke(cx => find(tree, "file-a.txt").attrs.on_click[0](null, cx)); await settle();
  state.layout.hidden = true; const count = state.io.length, redraws = state.notifications;
  state.requests[0].resolve("stale contents"); await settle();
  assert.equal(view.code, null); assert.equal(state.io.length, count); assert.equal(state.notifications, redraws);
  state.layout.hidden = false; state.holdRead = false;
  invoke(cx => view.render(cx)); await settle();
  assert.equal(view.code.options.value, "file contents\n");
  invoke(cx => view.close(cx)); assert.equal(state.releases, 1);
});

test("Changes: hidden untracked preview cannot mutate line counts or rows", async () => {
  reset("changes"); state.holdRead = true;
  state.reply = (command, args, options) => args.includes("status") ? result("?? fresh.txt\0") : reply(command, args, options);
  const view = mount(Changes); await settle();
  assert.equal(state.requests.length, 1); state.layout.hidden = true;
  const count = state.io.length, redraws = state.notifications;
  state.requests[0].resolve("stale\nline\n"); await settle();
  assert.deepEqual(view.rows, []); assert.equal(view.files[0].add, 0);
  assert.equal(state.io.length, count); assert.equal(state.notifications, redraws);
  state.layout.hidden = false; state.holdRead = false; invoke(cx => view.render(cx)); await settle();
  assert.equal(view.files[0].add, 1); assert.equal(view.rows[1].text, "file contents");
});

test("Files: a failed remote sh request cannot start PowerShell after hide", async () => {
  reset("files", false, "windows-host"); state.hold = command => command === "sh";
  mount(Files); await settle(); state.layout.hidden = true;
  state.requests[0].reject(new Error("cannot start sh: program not found")); await settle();
  assert.equal(state.io.length, 1); assert.equal(state.notifications, 0);
});

test("Changes: a requested commit completes while hidden without background refresh", async () => {
  reset("changes"); const view = mount(Changes); await settle();
  view.input.set_value("Keep my commit"); invoke(cx => view.input.handlers.change(null, cx));
  state.hold = (_command, args) => args[0] === "add";
  const tree = invoke(cx => view.render(cx));
  invoke(cx => find(tree, "commit").attrs.on_click[0](null, cx)); await settle();
  state.layout.hidden = true; const count = state.io.length, redraws = state.notifications;
  state.requests[0].resolve(result()); await settle();
  assert.equal(state.io.length, count + 1, "only the explicit commit may follow add");
  assert.deepEqual(state.io.at(-1).args, ["commit", "-m", "Keep my commit"]);
  assert.equal(state.notifications, redraws); assert.equal(view.message, "");
  state.layout.hidden = false; invoke(cx => view.render(cx)); await settle();
  assert.ok(state.io.length > count + 1); assert.equal(view.busy, false);
});

test("Changes: finishing a commit after close does not use the released input", async () => {
  reset("changes"); const view = mount(Changes); await settle();
  view.input.set_value("Finish commit"); invoke(cx => view.input.handlers.change(null, cx));
  state.hold = (_command, args) => args[0] === "commit";
  const tree = invoke(cx => view.render(cx));
  invoke(cx => find(tree, "commit").attrs.on_click[0](null, cx)); await settle();
  invoke(cx => view.close(cx)); const redraws = state.notifications;
  state.requests[0].resolve(result()); await settle();
  assert.equal(state.releasedWrites, 0); assert.equal(state.notifications, redraws);
});

test("Changes: restored untracked line count redraws after an intermediate render", async () => {
  reset("changes");
  state.reply = (command, args, options) => args.includes("status") ? result("?? fresh.txt\0") : reply(command, args, options);
  const view = mount(Changes); await settle();
  assert.match(text(invoke(cx => view.render(cx))), /\+1/);
  state.holdRead = true; state.watches[0].resolve(["/repo/fresh.txt"]); await settle();
  assert.match(text(invoke(cx => view.render(cx))), /\+0/);
  const redraws = state.notifications;
  state.requests[0].resolve("file contents\n"); await settle();
  assert.equal(state.notifications, redraws + 1);
  assert.match(text(invoke(cx => view.render(cx))), /\+1/);
});

test("Files: restored truncation notice redraws after an intermediate render", async () => {
  reset("files");
  const directory = Array.from({ length: 501 }, (_, i) => `f\0file-${i}\0`).join("");
  state.reply = (command, args, options) => command === "sh" ? result(directory) : reply(command, args, options);
  const view = mount(Files); await settle();
  assert.match(text(invoke(cx => view.render(cx))), /File list limited/);
  state.hold = command => command === "sh";
  state.watches[0].resolve(["/repo"]); await settle();
  assert.doesNotMatch(text(invoke(cx => view.render(cx))), /File list limited/);
  const redraws = state.notifications;
  state.requests[0].resolve(result(directory)); await settle();
  assert.equal(state.notifications, redraws + 1);
  assert.match(text(invoke(cx => view.render(cx))), /File list limited/);
});

test("Changes: unchanged refresh redraws a commit button rendered disabled while loading", async () => {
  reset("changes"); const view = mount(Changes); await settle();
  view.input.set_value("Commit this"); invoke(cx => view.input.handlers.change(null, cx));
  state.hold = (_command, args) => args.includes("status");
  state.watches[0].resolve(["/repo/a.txt"]); await settle();
  assert.equal(find(invoke(cx => view.render(cx)), "commit").attrs.bg[0], "raised");
  const redraws = state.notifications;
  state.requests[0].resolve(result(" M a.txt\0 M b.txt\0")); await settle();
  assert.equal(state.notifications, redraws + 1);
  assert.equal(find(invoke(cx => view.render(cx)), "commit").attrs.bg[0], "solid");
});

for (const [name, Type] of [["files", Files], ["changes", Changes]]) {
  test(`${name}: hiding during a request discards its result and starts no follow-up`, async () => {
    for (const stage of name === "files" ? ["sh", "--show-toplevel", "status"] : ["--show-toplevel", "status", "--verify", "--numstat", "--no-ext-diff"]) {
      reset(name);
      state.hold = (command, args) => command === stage || args.includes(stage);
      const view = mount(Type); await settle();
      assert.equal(state.requests.length, 1, stage);
      state.layout.hidden = true; // Hidden copies need not render.
      const count = state.io.length, redraws = state.notifications;
      state.requests[0].resolve(result(stage === "sh" ? "f\0stale.txt\0" : "/stale\n"));
      await settle(); await tick();
      assert.equal(state.io.length, count, stage + ": no follow-up I/O");
      assert.equal(state.notifications, redraws, stage + ": no stale redraw");
      state.hold = null; state.layout.hidden = false;
      view.render(context()); await settle();
      assert.ok(state.io.length > count, stage + ": reveal refreshes");
    }
  });

  test(`${name}: unchanged watcher and fallback snapshots do not redraw`, async () => {
    reset(name); const view = mount(Type); await settle(); view.render(context());
    const redraws = state.notifications;
    assert.equal(state.watches.length, 1);
    assert.equal(state.timers.filter(t => !t.cancelled)[0].ms, 60000);
    state.watches[0].resolve(["/repo/a.txt"]); await settle();
    assert.equal(state.notifications, redraws, "unchanged watcher snapshot");
    assert.equal(state.watches.length, 2, "watch rearmed while visible");
    await tick();
    assert.equal(state.notifications, redraws, "unchanged fallback snapshot");
  });

  test(`${name}: inactive stack tab stays idle and resumes its selection`, async () => {
    reset(name); const view = mount(Type); await settle();
    if (name === "files") {
      find(view.render(context()), "file-src").attrs.on_click[0](null, context()); await settle();
      find(view.render(context()), "file-b.txt").attrs.on_click[0](null, context()); await settle();
    } else {
      find(view.render(context()), "change-b.txt").attrs.on_click[0](null, context()); await settle();
    }
    state.layout.children[0].active = name === "files" ? "changes" : "files";
    const count = state.io.length, redraws = state.notifications;
    state.watches[0].resolve(["/repo/a.txt"]); await settle(); await tick();
    assert.equal(state.io.length, count); assert.equal(state.notifications, redraws);
    assert.equal(state.timers.filter(t => !t.cancelled).length, 0);
    state.layout.children[0].active = name;
    view.render(context()); await settle();
    assert.ok(state.io.length > count);
    if (name === "files") { assert.equal(view.file, "b.txt"); assert.ok(view.folders.has("src")); assert.ok(view.code); }
    else assert.equal(view.open, "b.txt");
  });

  test(`${name}: focus change replaces in-flight work without accepting stale data`, async () => {
    reset(name); state.hold = (_command, args) => args.includes("--show-toplevel");
    const view = mount(Type); await settle();
    const stale = state.requests[0]; state.cwd = "/other"; state.hold = null;
    view.render(context()); await settle(); const count = state.io.length, redraws = state.notifications;
    assert.equal(view.root, "/other");
    stale.resolve(result("/stale\n")); await settle();
    assert.equal(view.root, "/other"); assert.equal(state.io.length, count); assert.equal(state.notifications, redraws);
  });

  test(`${name}: stale watcher rejection cannot disable a new context's watcher`, async () => {
    reset(name); const view = mount(Type); await settle(); const stale = state.watches[0];
    state.cwd = "/other"; view.render(context()); await settle();
    const count = state.io.length, redraws = state.notifications;
    stale.reject(new Error("old watch failed")); await settle();
    assert.equal(state.io.length, count); assert.equal(state.notifications, redraws);
    assert.equal(state.timers.filter(t => !t.cancelled)[0].ms, 60000);
    state.watches[1].resolve(["/other/a.txt"]); await settle();
    assert.ok(state.io.length > count);
  });

  test(`${name}: failed local watches retry with bounded polling, then slow down`, async () => {
    reset(name); mount(Type); await settle();
    state.watches[0].reject(new Error("watch limit")); await settle();
    assert.equal(state.timers.filter(t => !t.cancelled)[0].ms, 10000);
    const count = state.io.length; await tick();
    assert.ok(state.io.length > count); assert.equal(state.watches.length, 2);
    assert.equal(state.timers.filter(t => !t.cancelled)[0].ms, 60000);
  });

  test(`${name}: remote fallback retains remote exec routing and stops while hidden`, async () => {
    reset(name, false, "host"); const view = mount(Type); await settle();
    assert.equal(state.watches.length, 0);
    assert.equal(state.timers.filter(t => !t.cancelled)[0].ms, 10000);
    assert.ok(state.io.every(call => call.options.on === "host"));
    const count = state.io.length; await tick(); assert.ok(state.io.length > count);
    state.layout.hidden = true; const hiddenCount = state.io.length;
    await tick(); await tick(); assert.equal(state.io.length, hiddenCount);
    state.layout.hidden = false; view.render(context()); await settle(); assert.ok(state.io.length > hiddenCount);
  });

  test(`${name}: close invalidates pending watches and timers`, async () => {
    reset(name); const view = mount(Type); await settle();
    const count = state.io.length, redraws = state.notifications;
    view.close(context()); state.watches[0].resolve(["/repo/a.txt"]);
    await settle(); await tick();
    assert.equal(state.io.length, count); assert.equal(state.notifications, redraws);
    assert.equal(state.timers.filter(t => !t.cancelled).length, 0);
  });

  test(`${name}: watcher events during refresh coalesce into one follow-up`, async () => {
    reset(name); mount(Type); await settle();
    state.hold = (_command, args) => args.includes("status");
    state.watches[0].resolve(["/repo/a.txt"]); await settle();
    assert.equal(state.requests.length, 1);
    state.watches[1].resolve(["/repo/b.txt"]); await settle();
    state.watches[2].resolve(["/repo/b.txt"]); await settle();
    const count = state.io.filter(call => call.args?.includes("status")).length;
    state.hold = null; state.requests[0].resolve(result(" M a.txt\0 M b.txt\0")); await settle();
    assert.equal(state.io.filter(call => call.args?.includes("status")).length, count + 1);
  });

  test(`${name}: brief unobserved hide/reveal remains bounded by its fallback`, async () => {
    reset(name, false, "host"); const view = mount(Type); await settle();
    const count = state.io.length;
    state.layout.hidden = true; state.layout.hidden = false;
    // The native host does not call JS render on hide. No API reports this
    // interval if no outstanding callback wakes during it.
    invoke(cx => view.render(cx)); await settle(); assert.equal(state.io.length, count);
    assert.equal(state.timers.filter(t => !t.cancelled)[0].ms, 10000);
    await tick(); assert.ok(state.io.length > count);
  });

  test(`${name}: reused same-root wait refreshes the current generation once`, async () => {
    reset(name); const view = mount(Type); await settle(); const stale = state.watches[0];
    state.layout.hidden = true; await tick();
    state.layout.hidden = false; invoke(cx => view.render(cx)); await settle();
    const count = state.io.length, redraws = state.notifications;
    const refreshes = state.io.filter(call => call.args?.includes("status")).length;
    stale.resolve(["/repo/a.txt"]); await settle();
    assert.equal(state.io.filter(call => call.args?.includes("status")).length, refreshes + 1);
    assert.equal(state.notifications, redraws, "unchanged snapshot still does not redraw");
    assert.equal(state.watches.length, 2);
    state.watches[1].resolve(["/repo/b.txt"]); await settle(); assert.ok(state.io.length > count);
  });

  test(`${name}: rejected watch while hidden causes no retry until reveal`, async () => {
    reset(name); const view = mount(Type); await settle();
    state.layout.hidden = true; const count = state.io.length;
    state.watches[0].reject(new Error("watch failed while hidden")); await settle(); await tick();
    assert.equal(state.io.length, count); assert.equal(state.timers.filter(t => !t.cancelled).length, 0);
    state.layout.hidden = false; invoke(cx => view.render(cx)); await settle();
    assert.ok(state.io.length > count); assert.equal(state.watches.length, 2);
  });

  test(`${name}: repeated quiet hide/reveal reuses one outstanding native watch`, async () => {
    reset(name); const view = mount(Type); await settle();
    for (let i = 0; i < 5; i++) {
      state.layout.hidden = true; await tick();
      state.layout.hidden = false; invoke(cx => view.render(cx)); await settle();
      assert.equal(state.watches.length, 1, `quiet reveal ${i + 1}`);
      assert.equal(state.timers.filter(t => !t.cancelled)[0].ms, 60000);
    }
  });

  test(`${name}: returning to a quiet root reuses its wait without losing its event`, async () => {
    reset(name); const view = mount(Type); await settle();
    state.layout.hidden = true; await tick();
    state.cwd = "/other"; state.layout.hidden = false; invoke(cx => view.render(cx)); await settle();
    assert.equal(state.watches.length, 2);
    state.cwd = "/repo"; invoke(cx => view.render(cx)); await settle();
    assert.equal(state.watches.length, 2, "original root reuses its outstanding wait");
    const refreshes = state.io.filter(call => call.args?.includes("status")).length;
    state.watches[0].resolve(["/repo/a.txt"]); await settle();
    assert.equal(state.io.filter(call => call.args?.includes("status")).length, refreshes + 1);
    assert.equal(state.io.filter(call => call.args?.includes("status")).at(-1).options.cwd, "/repo");
    assert.equal(state.watches.length, 3, "only the active original root rearms");
    const count = state.io.length;
    state.watches[1].resolve(["/other/a.txt"]); await settle();
    assert.equal(state.io.length, count, "retired other-root wait does not steal or refresh current work");
  });

  test(`${name}: quiet folder churn bounds outstanding waits and polls overflow`, async () => {
    reset(name); const view = mount(Type); await settle();
    for (let i = 1; i <= 8; i++) {
      state.cwd = `/repo-${i}`; invoke(cx => view.render(cx)); await settle();
    }
    assert.equal(state.watches.length, 4, "at most four uncancellable waits per copy");
    assert.equal(state.timers.filter(t => !t.cancelled)[0].ms, 10000);
    const count = state.io.length; await tick(); assert.ok(state.io.length > count);
    state.watches[0].resolve(["/repo/a.txt"]); await settle();
    await tick(); assert.equal(state.watches.length, 5, "a freed slot can watch the current root");
    assert.equal(state.timers.filter(t => !t.cancelled)[0].ms, 60000);
  });

  test(`${name}: a changed displayed snapshot still redraws after refresh`, async () => {
    reset(name); const view = mount(Type); await settle(); invoke(cx => view.render(cx));
    state.reply = (command, args, options) => {
      if (command === "sh") return result("f\0after.txt\0");
      if (args.includes("status")) return result(" M after.txt\0");
      return reply(command, args, options);
    };
    const redraws = state.notifications;
    state.watches[0].resolve(["/repo/after.txt"]); await settle();
    assert.equal(state.notifications, redraws + 1);
    assert.ok(find(invoke(cx => view.render(cx)), `${name === "files" ? "file" : "change"}-after.txt`));
  });

  test(`${name}: unchanged empty refresh clears a rendered loading indicator`, async () => {
    reset(name);
    state.reply = (command, args, options) => command === "sh" || args.includes("status") ? result() : reply(command, args, options);
    const view = mount(Type); await settle(); invoke(cx => view.render(cx));
    state.hold = (_command, args) => args.includes("status");
    state.watches[0].resolve(["/repo"]); await settle();
    invoke(cx => view.render(cx)); // loading is now displayed, with unchanged content.
    const redraws = state.notifications;
    state.requests[0].resolve(result()); await settle();
    assert.equal(state.notifications, redraws + 1);
    assert.equal(view.loading, false);
  });

  test(`${name}: unrelated native renders do not serialize the whole displayed content`, async () => {
    reset(name);
    state.reply = (command, args, options) => {
      if (name === "files" && command === "sh") return result(Array.from({ length: 300 }, (_, i) => `f\0file-${i}-${"x".repeat(40)}\0`).join(""));
      if (name === "changes" && args.includes("--no-ext-diff")) return result("@@ -1 +1 @@\n" + ("+" + "x".repeat(100) + "\n").repeat(200));
      return reply(command, args, options);
    };
    const view = mount(Type); await settle();
    const stringify = JSON.stringify; let largeSerializations = 0;
    JSON.stringify = (...args) => {
      const result = stringify(...args);
      if (result?.length > 10000) largeSerializations++;
      return result;
    };
    try { for (let i = 0; i < 5; i++) invoke(cx => view.render(cx)); }
    finally { JSON.stringify = stringify; }
    assert.equal(largeSerializations, 0);
  });

  test(`${name}: first-hidden panel starts no I/O or recurring timer`, async () => {
    for (const ancestorHidden of [true, false]) {
      reset(ancestorHidden ? name : name === "files" ? "changes" : "files", ancestorHidden); mount(Type); await settle(); await tick();
      assert.deepEqual(state.io, []);
      assert.equal(state.notifications, 0);
      assert.equal(state.timers.filter(t => !t.cancelled).length, 0);
    }
  });
}
