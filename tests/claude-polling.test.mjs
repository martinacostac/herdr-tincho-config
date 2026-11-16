import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { CLAUDE_OPTIONS, LABEL, SESSION } from "../herdr/mods/tab-tree/recipes.js";

// Mock only host boundaries. The real timer callback, selector, probe, and
// label command construction run without Herdr, a UI, or session-file reads.
let listed = [];
let calls = [];
let get;
let readSession;
let label;
const hostKey = Symbol.for("herdr.claude-polling.test-host");
globalThis[hostKey] = {
  terminals: () => structuredClone(listed),
  hc: async (args) => {
    calls.push(["hc", args]);
    if (args[0] === "get") return get(args[1]);
    if (args[0] === "label") return label(args);
    throw new Error(`unexpected hc call: ${args}`);
  },
  exec: async (...args) => { calls.push(["exec", ...args]); return readSession(...args); },
};
const moduleUrl = (source) => "data:text/javascript," + encodeURIComponent(source);
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "herdr") return { url: moduleUrl(`export const { terminals, hc, exec } = globalThis[Symbol.for("herdr.claude-polling.test-host")]; export const spaces = null, panes = null, machines = null, run = null, openOverlay = null, theme = null, shared = null, setShared = null, home = null, layout = null, focused = null, settings = null, readTextFile = null;`), shortCircuit: true };
    if (specifier === "gpui-kit") return { url: moduleUrl("export class View {} export const div = null, image = null, svg = null;"), shortCircuit: true };
    if (specifier === "gpui-base") return { url: moduleUrl("export const v_flex = null, h_flex = null;"), shortCircuit: true };
    return next(specifier, context);
  },
});
const { default: TabTree } = await import("../herdr/mods/tab-tree/main.js");
hook.deregister();

const terminal = (key, extra = {}) => ({
  address: "t1", state: "live", pid: 10, argv: ["zsh"],
  foreground: { pid: 11, argv: [key] },
  program: { key, agent: true, shell: false }, report: { app: key, state: "idle" },
  labels: { [LABEL]: "claude" }, ...extra,
});
const result = (value) => ({ code: 0, stdout: JSON.stringify(value) });
function reset(records) {
  listed = records;
  calls = [];
  get = async (address) => {
    const t = listed.find((t) => t.address === address);
    return result(t && { ...t, program: undefined, report: undefined, status: t.report });
  };
  readSession = async () => result({ sessionId: "session-a" });
  label = async () => ({ code: 0, stdout: "" });
  return new TabTree();
}
function start(view) {
  const jobs = [];
  view.rememberSessions({ spawn: (job) => jobs.push(Promise.resolve().then(job)) });
  return Promise.all(jobs);
}
const probes = () => calls.filter(([kind, args]) => kind === "exec" || args[0] === "get");
const writes = () => calls.filter(([kind, args]) => kind === "hc" && args[0] === "label");
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test("idle and working non-Claude terminals never get or shell-probe, even with old Claude labels", async () => {
  const records = [];
  for (const state of ["idle", "working"]) {
    for (const key of ["pi", "codex", "opencode", "shell"]) {
      records.push(terminal(key, { status: state, report: key === "shell" ? null : { app: key, state }, program: { key, shell: key === "shell", agent: key !== "shell" } }));
    }
    records.push(terminal("claude", { address: "remote/t1", status: state }));
    records.push(terminal("claude", { state: "finished", status: state }));
  }
  const view = reset(records);
  await start(view);
  await start(view);
  assert.deepEqual(probes(), []);
  assert.deepEqual(writes(), []);
  assert.ok(!view.sessionsBusy);
});

test("Claude program, reported app, and reliable command-position argv remain eligible", async () => {
  const cases = [
    terminal("claude", { report: null }),
    terminal("claude", { status: "working", report: { app: "claude-code", state: "working" } }),
    terminal("agent", { report: { app: "claude-code" } }),
    terminal("shell", { report: { app: "claude-code" } }),
    terminal("claude", { program: null, report: null }),
    terminal("agent", { report: null, foreground: { pid: 11, argv: ["/usr/local/bin/claude"] } }),
    terminal("program", { report: null, foreground: { pid: 11, argv: ["node", "/pkg/@anthropic-ai/claude-code/cli.js", "--resume", "old"] } }),
    terminal("program", { report: null, foreground: { pid: 11, argv: ["bun", "/bin/claude.js"] } }),
    terminal("program", { report: null, foreground: { pid: 11, argv: ["zsh", "-ic", '\"$@\"; exec \"$0\" -i', "zsh", "claude"] } }),
    terminal("program", { report: null, foreground: { pid: 11, argv: ["fish", "-ic", "command $argv[2..]; exec $argv[1] -i", "fish", "claude"] } }),
    terminal("agent", { program: null, report: null, foreground: null, argv: ["claude"] }),
  ];
  for (const fixture of cases) {
    const view = reset([fixture]);
    // hc get supplies fresher foreground information than the host snapshot.
    get = async () => result({ ...fixture, program: undefined, report: undefined, status: fixture.report,
      foreground: fixture.foreground ?? { pid: 11, argv: ["claude"] } });
    await start(view);
    assert.equal(calls.filter(([kind]) => kind === "exec").length, 1, JSON.stringify(fixture));
    assert.deepEqual(writes(), [["hc", ["label", "t1", `${SESSION}=session-a`]]]);
  }
});

test("argv fallback cannot turn arguments, stale launch commands, or recovery labels into Claude", async () => {
  const cases = [
    terminal("claude", { report: { app: "pi" } }),
    terminal("pi", { program: null, argv: ["claude"], foreground: null }),
    terminal("codex", { program: null, argv: ["claude"], foreground: null }),
    terminal("shell", { program: null, report: null }),
    terminal("pi", { report: null, argv: ["claude"] }),
    terminal("codex", { report: null, argv: ["claude"] }),
    terminal("shell", { report: null, argv: ["claude"] }),
    terminal("agent", { report: { app: "unrelated" }, argv: ["claude"] }),
    terminal("program", { report: null, foreground: { pid: 11, argv: ["node", "/pkg/pi.js", "claude"] } }),
    terminal("program", { report: null, foreground: { pid: 11, argv: ["echo", "claude"] } }),
    terminal("program", { report: null, foreground: { pid: 11, argv: ["zsh", "-c", "echo claude"] } }),
    terminal("program", { report: null, foreground: { pid: 11, argv: ["node", "--eval", "claude"] } }),
    terminal("program", { report: null, argv: ["claude"], foreground: { pid: 11, argv: [] } }),
    terminal("agent", { report: null, program: null, argv: ["zsh"], foreground: null }),
  ];
  for (const fixture of cases) {
    const view = reset([fixture]);
    await start(view);
    assert.deepEqual(calls, [], JSON.stringify(fixture));
  }
});

test("unchanged sessions skip writes but every pass sees /clear and /resume in the same PID", async () => {
  const view = reset([terminal("claude", { labels: { [SESSION]: "session-a" } })]);
  await start(view);
  await start(view);
  assert.equal(calls.filter(([kind]) => kind === "exec").length, 2);
  assert.deepEqual(writes(), []);
  readSession = async () => result({ sessionId: "after-clear" });
  await start(view);
  listed[0].labels[SESSION] = "after-clear";
  readSession = async () => result({ sessionId: "after-resume" });
  await start(view);
  assert.deepEqual(writes(), [
    ["hc", ["label", "t1", `${SESSION}=after-clear`]],
    ["hc", ["label", "t1", `${SESSION}=after-resume`]],
  ]);
});

test("a foreground replaced during a session read cannot write the old session", async () => {
  for (const replacement of [
    terminal("pi"), terminal("shell", { report: null }),
    terminal("claude", { foreground: { pid: 99, argv: ["claude"] } }),
    terminal("claude", { pid: 20 }), terminal("claude", { state: "finished" }), null,
  ]) {
    const view = reset([terminal("claude")]);
    const reading = deferred();
    const release = deferred();
    readSession = async () => { reading.resolve(); await release.promise; return result({ sessionId: "old-session" }); };
    const pass = start(view);
    await reading.promise;
    listed = replacement ? [replacement] : [];
    release.resolve();
    await pass;
    assert.deepEqual(writes(), [], JSON.stringify(replacement));
    assert.equal(view.sessionsBusy, false);
  }
});

test("a fresh core identity change blocks a stale host snapshot, before and after the file read", async () => {
  for (const changeAfterRead of [false, true]) {
    for (const replacement of [
      { state: "live", pid: 10, status: { app: "pi" }, foreground: { pid: 99, argv: ["pi"] } },
      { state: "live", pid: 10, status: { app: "claude-code" }, foreground: { pid: 99, argv: ["claude"] } },
      { state: "live", pid: 20, status: { app: "claude-code" }, foreground: { pid: 11, argv: ["claude"] } },
    ]) {
      const view = reset([terminal("claude")]);
      let reads = 0;
      get = async () => result(++reads > (changeAfterRead ? 1 : 0) ? replacement
        : { state: "live", pid: 10, status: { app: "claude-code" }, foreground: { pid: 11, argv: ["claude"] } });
      await start(view);
      assert.deepEqual(writes(), [], JSON.stringify({ replacement, changeAfterRead }));
      assert.equal(calls.filter(([kind]) => kind === "exec").length, changeAfterRead ? 1 : 0);
    }
  }
});

test("queued candidates are rechecked before probing and current labels suppress redundant writes", async () => {
  const view = reset([terminal("claude"), terminal("claude", { address: "t2" })]);
  readSession = async () => {
    listed[0].labels[SESSION] = "session-a";
    listed[1] = terminal("pi", { address: "t2" });
    return result({ sessionId: "session-a" });
  };
  await start(view);
  assert.equal(probes().some(([kind, args]) => kind === "hc" && args[1] === "t2"), false);
  assert.deepEqual(writes(), []);
});

test("a slow probe keeps one pass in flight and a later pass still runs", async () => {
  const view = reset([terminal("claude")]);
  const reading = deferred();
  const release = deferred();
  readSession = async () => { reading.resolve(); await release.promise; return result({ sessionId: "session-a" }); };
  const first = start(view);
  await reading.promise;
  assert.equal(view.sessionsBusy, true);
  await start(view);
  assert.equal(calls.filter(([kind]) => kind === "exec").length, 1);
  release.resolve();
  await first;
  assert.equal(view.sessionsBusy, false);
  await start(view);
  assert.equal(calls.filter(([kind]) => kind === "exec").length, 2);
});

test("get, file, and label failures release busy state for the next pass", async () => {
  const reject = async () => { throw new Error("host failure"); };
  for (const fail of [
    () => { get = reject; },
    () => { get = async () => ({ code: 1, stdout: "" }); },
    () => { get = async () => ({ code: 0, stdout: "{broken" }); },
    () => { readSession = reject; },
    () => { readSession = async () => ({ code: 1, stdout: "" }); },
    () => { readSession = async () => ({ code: 0, stdout: "{broken" }); },
    () => { label = reject; },
    () => { label = async () => ({ code: 1, stdout: "" }); },
  ]) {
    const view = reset([terminal("claude")]);
    fail();
    await start(view);
    assert.equal(view.sessionsBusy, false);
    reset([terminal("claude")]);
    await start(view);
    assert.deepEqual(writes(), [["hc", ["label", "t1", `${SESSION}=session-a`]]]);
  }
});

test("invalid session ids and foreground PIDs never write labels", async () => {
  for (const id of [null, undefined, "", 123, {}, "bad\nvalue"]) {
    const view = reset([terminal("claude")]);
    readSession = async () => result({ sessionId: id });
    await start(view);
    assert.deepEqual(writes(), []);
    assert.equal(view.sessionsBusy, false);
  }
  for (const pid of [null, 0, -1, "../../file", 1.5]) {
    const view = reset([terminal("claude", { foreground: { pid, argv: ["claude"] } })]);
    await start(view);
    assert.equal(calls.some(([kind]) => kind === "exec"), false);
    assert.deepEqual(writes(), []);
  }
});

test("a spawn failure cannot leave the poller busy", async () => {
  const view = reset([terminal("claude")]);
  assert.throws(() => view.rememberSessions({ spawn: () => { throw new Error("cannot spawn"); } }), /cannot spawn/);
  assert.equal(view.sessionsBusy, false);
  await start(view);
  assert.equal(writes().length, 1);
});

const optionsLabel = (args) => JSON.stringify({ version: 1, options: args });
const launched = (argv, extra = {}) => terminal("claude", { foreground: { pid: 11, cwd: "/work", argv }, ...extra });

test("the launch options of the Claude process read are written in the same label call as its session", async () => {
  const view = reset([launched(["claude", "--model", "haiku", "--permission-mode", "plan", "--add-dir", "lib", "--", "secret prompt"])]);
  await start(view);
  assert.deepEqual(writes(), [["hc", ["label", "t1", `${SESSION}=session-a`, `${CLAUDE_OPTIONS}=${optionsLabel(["--model", "haiku", "--permission-mode", "plan", "--add-dir", "/work/lib"])}`]]]);
  assert.doesNotMatch(JSON.stringify(writes()), /secret/);
});

test("options are read from the core's process, the same one whose session file was read, in each argv shape", async () => {
  for (const argv of [
    ["claude", "--model", "haiku", "--"],
    ["node", "/pkg/@anthropic-ai/claude-code/cli.js", "--model", "haiku", "--"],
    ["fish", "-ic", "command $argv[2..]; exec $argv[1] -i", "fish", "claude", "--model", "haiku", "--"],
  ]) {
    const view = reset([launched(["claude"])]);
    get = async () => result({ ...launched(argv), program: undefined, report: undefined, status: { app: "claude-code" } });
    await start(view);
    assert.deepEqual(writes(), [["hc", ["label", "t1", `${SESSION}=session-a`, `${CLAUDE_OPTIONS}=${optionsLabel(["--model", "haiku"])}`]]], JSON.stringify(argv));
  }
});

test("unchanged options are not written again, and a changed session alone writes only the session", async () => {
  const value = optionsLabel(["--model", "haiku"]);
  const view = reset([launched(["claude", "--model", "haiku"], { labels: { [SESSION]: "session-a", [CLAUDE_OPTIONS]: value } })]);
  await start(view);
  assert.deepEqual(writes(), []);
  readSession = async () => result({ sessionId: "after-clear" });
  await start(view);
  assert.deepEqual(writes(), [["hc", ["label", "t1", `${SESSION}=after-clear`]]]);
});

test("options change with the process: new options are written, and a Claude without options removes the old label", async () => {
  const view = reset([launched(["claude", "--model", "opus"], { labels: { [SESSION]: "session-a", [CLAUDE_OPTIONS]: optionsLabel(["--model", "haiku"]) } })]);
  await start(view);
  assert.deepEqual(writes(), [["hc", ["label", "t1", `${CLAUDE_OPTIONS}=${optionsLabel(["--model", "opus"])}`]]]);
  for (const labels of [{ [SESSION]: "session-a", [CLAUDE_OPTIONS]: optionsLabel(["--model", "haiku"]) }, { [SESSION]: "session-a", [CLAUDE_OPTIONS]: "{broken" }]) {
    const plain = reset([launched(["claude", "a prompt"], { labels })]);
    await start(plain);
    assert.deepEqual(writes(), [["hc", ["label", "t1", `${CLAUDE_OPTIONS}=`]]]);
  }
});

test("no session id means no options are written either", async () => {
  const view = reset([launched(["claude", "--model", "haiku"])]);
  readSession = async () => ({ code: 1, stdout: "" });
  await start(view);
  assert.deepEqual(writes(), []);
});
