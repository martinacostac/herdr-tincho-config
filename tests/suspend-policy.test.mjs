import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { LABEL, PI_RECOVERY, SESSION } from "../herdr/mods/tab-tree/recipes.js";

// Mock only the Herdr host: app settings, focus, panes and the process table
// (`ps`). The real rules run unchanged.
let appSettings;
let focus;
let paneList;
let processTable;
let execs;
const hostKey = Symbol.for("herdr.suspend-policy.test-host");
globalThis[hostKey] = {
  settings: () => structuredClone(appSettings),
  focused: () => structuredClone(focus),
  panes: () => structuredClone(paneList),
  exec: async (command, args) => {
    execs.push([command, args]);
    if (command !== "ps") throw new Error(`unexpected exec: ${command}`);
    return processTable();
  },
};
const moduleUrl = (source) => "data:text/javascript," + encodeURIComponent(source);
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "herdr") return { url: moduleUrl(`export const { settings, focused, panes, exec } = globalThis[Symbol.for("herdr.suspend-policy.test-host")];`), shortCircuit: true };
    return next(specifier, context);
  },
});
const { unusedAgent, suspendSettings, NEVER_SUSPEND } = await import("../herdr/mods/tab-tree/suspend-policy.js");
hook.deregister();

const MINUTE = 60_000;
const NOW = 1_800_000_000_000;
const piRecord = JSON.stringify({ version: 1, sessionId: "session-1", sessionFile: "/sessions/one.jsonl", cwd: "/project", args: [] });

// A Pi agent that hc started directly (its main program is the agent), idle
// for an hour, in tab "tab-2" while "tab-1" is focused.
const pi = (extra = {}) => ({
  address: "t7", state: "live", pid: 100, argv: ["pi"],
  foreground: { pid: 100, argv: ["pi", "", ""], cwd: "/project" },
  program: { key: "pi", agent: true, shell: false }, report: { app: "pi", state: "idle" },
  status: "idle", status_ms: NOW - 60 * MINUTE,
  labels: { [LABEL]: "pi", [PI_RECOVERY]: piRecord }, ...extra,
});
// The same agent's process table: an MCP server (and its own child) under pi.
const table = (rows) => async () => ({ code: 0, stdout: rows.map(([pid, ppid, command]) => `${pid} ${ppid} ${command}`).join("\n") + "\n", stderr: "" });
const piProcesses = [
  [1, 0, "/sbin/launchd"],
  [90, 1, "/Applications/Herdr.app/Contents/MacOS/hc server"],
  [100, 90, "pi"],
  [101, 100, "npm exec shadcn@latest mcp"],
  [102, 101, "node /Users/me/.npm/_npx/abc/node_modules/.bin/shadcn mcp"],
];

function reset() {
  appSettings = {};
  focus = { space: "space-1", tab: "tab-1", pane: "pane-1", terminal: "t1", shown: null, agent: null, cwd: "/", selection: null };
  paneList = [
    { pane: "pane-1", terminal: "t1", tab: "tab-1", focused: true },
    { pane: "pane-2", terminal: "t7", tab: "tab-2", focused: false },
  ];
  processTable = table(piProcesses);
  execs = [];
}

test("an idle, resumable Pi agent past the threshold is an unused agent", async () => {
  reset();
  assert.deepEqual(await unusedAgent(pi(), { now: NOW }), { unused: true, agent: "pi" });
});

// A Claude agent inside fish: the shell is the main program, Claude in front.
const claude = (extra = {}) => pi({
  pid: 200, argv: ["fish"], foreground: { pid: 201, argv: ["claude"], cwd: "/project" },
  program: { key: "claude", agent: true, shell: false }, report: { app: "claude-code", state: "idle" },
  labels: { [LABEL]: "claude", [SESSION]: "claude-session" }, ...extra,
});
const claudeProcesses = [[1, 0, "/sbin/launchd"], [200, 1, "fish"], [201, 200, "claude"]];

test("a Claude agent with its session label is resumable", async () => {
  reset();
  processTable = table(claudeProcesses);
  assert.deepEqual(await unusedAgent(claude(), { now: NOW }), { unused: true, agent: "claude" });
  // As hc get describes it: no program, the report in status.
  const fromCore = claude({ program: undefined, report: undefined, status: { app: "claude-code", state: "idle" } });
  assert.deepEqual(await unusedAgent(fromCore, { now: NOW }), { unused: true, agent: "claude" });
});

test("an agent that cannot be started again from its session is not resumable", async () => {
  reset();
  const cases = [
    claude({ labels: { [LABEL]: "claude" } }),
    claude({ labels: { [LABEL]: "claude", [SESSION]: "" } }),
    claude({ labels: { [LABEL]: "claude", [PI_RECOVERY]: piRecord } }),
    pi({ labels: { [LABEL]: "pi" } }),
    pi({ labels: { [LABEL]: "pi", [PI_RECOVERY]: "not json" } }),
    pi({ labels: { [LABEL]: "pi", [SESSION]: "claude-session" } }),
    pi({ program: { key: "codex", agent: true, shell: false }, report: { app: "codex", state: "idle" }, labels: { [SESSION]: "s", [PI_RECOVERY]: piRecord } }),
    pi({ program: { key: "shell", agent: false, shell: true }, report: null, status: null }),
    pi({ labels: undefined }),
  ];
  for (const terminal of cases) {
    assert.deepEqual(await unusedAgent(terminal, { now: NOW }), { unused: false, reason: "not-resumable" }, JSON.stringify(terminal));
  }
});

test("working and blocked agents are never unused, each with its own reason", async () => {
  reset();
  assert.deepEqual(await unusedAgent(pi({ status: "working" }), { now: NOW }), { unused: false, reason: "working" });
  assert.deepEqual(await unusedAgent(pi({ status: "blocked" }), { now: NOW }), { unused: false, reason: "blocked" });
  assert.deepEqual(await unusedAgent(pi({ status: null }), { now: NOW }), { unused: false, reason: "not-idle" });
});

test("done counts as idle, and hc get's status object reads like the app's status word", async () => {
  reset();
  assert.deepEqual(await unusedAgent(pi({ status: "done" }), { now: NOW }), { unused: true, agent: "pi" });
  const fromCore = pi({ program: undefined, report: undefined });
  for (const [state, expected] of [["idle", { unused: true, agent: "pi" }], ["done", { unused: true, agent: "pi" }], ["working", { unused: false, reason: "working" }], ["blocked", { unused: false, reason: "blocked" }]]) {
    assert.deepEqual(await unusedAgent({ ...fromCore, status: { app: "pi", state } }, { now: NOW }), expected, state);
  }
});

test("the idle clock counts from the status time when no focus time is known (after an app restart)", async () => {
  reset();
  assert.deepEqual(await unusedAgent(pi({ status_ms: NOW - 30 * MINUTE }), { now: NOW }), { unused: true, agent: "pi" });
  assert.deepEqual(await unusedAgent(pi({ status_ms: NOW - 30 * MINUTE + 1 }), { now: NOW }), { unused: false, reason: "recent" });
  assert.deepEqual(await unusedAgent(pi({ status_ms: NOW - 30 * MINUTE + 1 }), { now: NOW, focusedAt: null }), { unused: false, reason: "recent" });
});

test("the idle clock counts from the later of the status time and the last focus time of its tab", async () => {
  reset();
  const idleAnHour = pi({ status_ms: NOW - 60 * MINUTE });
  assert.deepEqual(await unusedAgent(idleAnHour, { now: NOW, focusedAt: NOW - 10 * MINUTE }), { unused: false, reason: "recent" });
  assert.deepEqual(await unusedAgent(idleAnHour, { now: NOW, focusedAt: NOW - 30 * MINUTE }), { unused: true, agent: "pi" });
  // An old focus never makes a recent status count as older.
  assert.deepEqual(await unusedAgent(pi({ status_ms: NOW - 10 * MINUTE }), { now: NOW, focusedAt: NOW - 90 * MINUTE }), { unused: false, reason: "recent" });
});

test("an agent without a status time is never idle long enough", async () => {
  reset();
  for (const status_ms of [undefined, null, "1", NaN]) {
    assert.deepEqual(await unusedAgent(pi({ status_ms }), { now: NOW }), { unused: false, reason: "recent" }, String(status_ms));
  }
});

test("without the settings key, suspension is on after 30 minutes with MCP servers as helpers", () => {
  reset();
  assert.deepEqual(suspendSettings(), { auto: true, afterMinutes: 30, helpers: ["mcp"] });
  appSettings = { "tincho.suspend": null, font_size: 12 };
  assert.deepEqual(suspendSettings(), { auto: true, afterMinutes: 30, helpers: ["mcp"] });
});

test("the settings key sets the threshold and the helper allow-list; missing or invalid fields keep their defaults", () => {
  reset();
  const read = (value) => { appSettings = { "tincho.suspend": value }; return suspendSettings(); };
  assert.deepEqual(read({ after_minutes: 5, helpers: ["mcp", "language-server"] }), { auto: true, afterMinutes: 5, helpers: ["mcp", "language-server"] });
  assert.deepEqual(read({ after_minutes: 0.5 }), { auto: true, afterMinutes: 0.5, helpers: ["mcp"] });
  assert.deepEqual(read({ helpers: [] }), { auto: true, afterMinutes: 30, helpers: [] });
  assert.deepEqual(read({ after_minutes: 10 }), { auto: true, afterMinutes: 10, helpers: ["mcp"] });
  for (const after_minutes of ["10", -5, NaN, Infinity, null, true]) {
    assert.deepEqual(read({ after_minutes }), { auto: true, afterMinutes: 30, helpers: ["mcp"] }, String(after_minutes));
  }
  for (const helpers of ["mcp", null, 7, [1], ["mcp", 2]]) {
    assert.deepEqual(read({ helpers }), { auto: true, afterMinutes: 30, helpers: ["mcp"] }, JSON.stringify(helpers));
  }
  for (const value of [true, "on", 30, []]) {
    assert.deepEqual(read(value), { auto: true, afterMinutes: 30, helpers: ["mcp"] }, JSON.stringify(value));
  }
});

test("an empty helper entry is dropped, so it never matches every command line", () => {
  reset();
  appSettings = { "tincho.suspend": { helpers: ["", "mcp"] } };
  assert.deepEqual(suspendSettings().helpers, ["mcp"]);
});

test("false or after_minutes 0 turns automatic suspension off but keeps the helper allow-list for manual suspension", () => {
  reset();
  appSettings = { "tincho.suspend": false };
  assert.deepEqual(suspendSettings(), { auto: false, afterMinutes: null, helpers: ["mcp"] });
  appSettings = { "tincho.suspend": { after_minutes: 0, helpers: ["lsp"] } };
  assert.deepEqual(suspendSettings(), { auto: false, afterMinutes: null, helpers: ["lsp"] });
});

test("automatic suspension uses the configured threshold", async () => {
  reset();
  appSettings = { "tincho.suspend": { after_minutes: 5 } };
  assert.deepEqual(await unusedAgent(pi({ status_ms: NOW - 5 * MINUTE }), { now: NOW }), { unused: true, agent: "pi" });
  assert.deepEqual(await unusedAgent(pi({ status_ms: NOW - 4 * MINUTE }), { now: NOW }), { unused: false, reason: "recent" });
});

test("while automatic suspension is off, no agent is unused automatically", async () => {
  reset();
  for (const value of [false, { after_minutes: 0 }]) {
    appSettings = { "tincho.suspend": value };
    assert.deepEqual(await unusedAgent(pi(), { now: NOW }), { unused: false, reason: "off" }, JSON.stringify(value));
  }
});

test("the manual mode skips only the threshold, also while automatic suspension is off", async () => {
  reset();
  const justIdle = pi({ status_ms: NOW });
  for (const value of [undefined, false, { after_minutes: 0 }]) {
    appSettings = value === undefined ? {} : { "tincho.suspend": value };
    assert.deepEqual(await unusedAgent(justIdle, { now: NOW, focusedAt: NOW, manual: true }), { unused: true, agent: "pi" }, JSON.stringify(value));
    assert.deepEqual(await unusedAgent(pi({ status: "working" }), { now: NOW, manual: true }), { unused: false, reason: "working" });
    assert.deepEqual(await unusedAgent(pi({ status: null }), { now: NOW, manual: true }), { unused: false, reason: "not-idle" });
    assert.deepEqual(await unusedAgent(pi({ labels: {} }), { now: NOW, manual: true }), { unused: false, reason: "not-resumable" });
  }
});

test("a pinned agent is never unused, also in the manual mode", async () => {
  reset();
  assert.equal(NEVER_SUSPEND, "herdr.never-suspend");
  const pinned = pi({ labels: { ...pi().labels, "herdr.never-suspend": "1" } });
  assert.deepEqual(await unusedAgent(pinned, { now: NOW }), { unused: false, reason: "pinned" });
  assert.deepEqual(await unusedAgent(pinned, { now: NOW, manual: true }), { unused: false, reason: "pinned" });
  // Only the value 1 pins (the menu clears the pin by removing or changing it).
  assert.deepEqual(await unusedAgent(pi({ labels: { ...pi().labels, "herdr.never-suspend": "0" } }), { now: NOW }), { unused: true, agent: "pi" });
});

test("an agent on a remote machine is never unused, also in the manual mode", async () => {
  reset();
  const remote = pi({ address: "mini/t7" });
  paneList.push({ pane: "mini/pane-3", terminal: "mini/t7", tab: "mini/tab-3", focused: false });
  assert.deepEqual(await unusedAgent(remote, { now: NOW }), { unused: false, reason: "remote" });
  assert.deepEqual(await unusedAgent(remote, { now: NOW, manual: true }), { unused: false, reason: "remote" });
  assert.deepEqual(execs, []);
});

test("an agent in the focused tab is never unused, also in the manual mode", async () => {
  reset();
  // Another pane of the same tab has the keyboard.
  focus = { ...focus, tab: "tab-2", pane: "pane-9", terminal: "t9" };
  assert.deepEqual(await unusedAgent(pi(), { now: NOW }), { unused: false, reason: "focused" });
  assert.deepEqual(await unusedAgent(pi(), { now: NOW, manual: true }), { unused: false, reason: "focused" });
});

test("an agent shown or focused outside a tab pane counts as focused", async () => {
  reset();
  for (const where of [{ terminal: "t7", pane: null }, { shown: "t7" }, { agent: "t7" }]) {
    focus = { ...focus, ...where };
    assert.deepEqual(await unusedAgent(pi(), { now: NOW }), { unused: false, reason: "focused" }, JSON.stringify(where));
    reset();
  }
});

test("an agent in no pane (a sub-agent's terminal) is not focused", async () => {
  reset();
  paneList = paneList.filter((p) => p.terminal !== "t7");
  assert.deepEqual(await unusedAgent(pi(), { now: NOW }), { unused: true, agent: "pi" });
  focus = null;
  assert.deepEqual(await unusedAgent(pi(), { now: NOW }), { unused: true, agent: "pi" });
});

test("with the default allow-list, MCP servers and their own children are helpers", async () => {
  reset();
  assert.deepEqual(await unusedAgent(pi(), { now: NOW }), { unused: true, agent: "pi" });
});

test("a descendant process that is not a helper keeps the agent in use, also in the manual mode", async () => {
  reset();
  for (const extra of [
    [[103, 100, "npm run dev"]],
    [[103, 100, "npm run dev"], [104, 103, "node node_modules/.bin/vite"]],
    // A grandchild under an MCP server that is not a helper itself.
    [[103, 102, "sleep 600"]],
  ]) {
    processTable = table([...piProcesses, ...extra]);
    assert.deepEqual(await unusedAgent(pi(), { now: NOW }), { unused: false, reason: "background" }, JSON.stringify(extra));
    assert.deepEqual(await unusedAgent(pi(), { now: NOW, manual: true }), { unused: false, reason: "background" }, JSON.stringify(extra));
  }
});

test("a custom allow-list marks other command lines as helpers by containment, and replaces the default", async () => {
  reset();
  processTable = table([...piProcesses, [103, 100, "/usr/local/bin/typescript-language-server --stdio"]]);
  appSettings = { "tincho.suspend": { helpers: ["mcp", "language-server"] } };
  assert.deepEqual(await unusedAgent(pi(), { now: NOW }), { unused: true, agent: "pi" });
  appSettings = { "tincho.suspend": { helpers: ["language-server"] } };
  assert.deepEqual(await unusedAgent(pi(), { now: NOW }), { unused: false, reason: "background" });
  appSettings = { "tincho.suspend": { helpers: [] } };
  processTable = table(piProcesses);
  assert.deepEqual(await unusedAgent(pi(), { now: NOW }), { unused: false, reason: "background" });
});

test("only the agent's own descendants count: the shell that hosts it and other processes do not", async () => {
  reset();
  processTable = table([...claudeProcesses, [202, 200, "vim notes.md"], [300, 1, "npm run dev"]]);
  assert.deepEqual(await unusedAgent(claude(), { now: NOW }), { unused: true, agent: "claude" });
  processTable = table([...claudeProcesses, [203, 201, "npm run dev"]]);
  assert.deepEqual(await unusedAgent(claude(), { now: NOW }), { unused: false, reason: "background" });
});

test("child terminals do not prevent eligibility", async () => {
  reset();
  // The child terminal's agent runs under the core, not under its parent agent.
  paneList.push({ pane: "pane-3", terminal: "t8", tab: "tab-3", focused: false });
  processTable = table([...piProcesses, [110, 90, "pi"], [111, 110, "npm run dev"]]);
  assert.deepEqual(await unusedAgent(pi({ children: ["t8"] }), { now: NOW }), { unused: true, agent: "pi" });
});

test("when the agent's processes cannot be read, it is not unused", async () => {
  reset();
  const cases = [
    [pi(), async () => { throw new Error("cannot start ps"); }],
    [pi(), async () => ({ code: 1, stdout: "", stderr: "ps: failed" })],
    [pi(), table([[1, 0, "/sbin/launchd"]])],
    [pi({ foreground: null }), table(piProcesses)],
    [pi({ foreground: { pid: 0, argv: ["pi"] } }), table(piProcesses)],
    [pi({ foreground: { pid: "100", argv: ["pi"] } }), table(piProcesses)],
  ];
  for (const [terminal, ps] of cases) {
    processTable = ps;
    assert.deepEqual(await unusedAgent(terminal, { now: NOW }), { unused: false, reason: "processes-unknown" }, JSON.stringify(terminal.foreground));
  }
});

test("a descendant without a command line (a zombie) is not a helper", async () => {
  reset();
  const rows = await table(piProcesses)();
  processTable = async () => ({ ...rows, stdout: rows.stdout + "  103   100\n" });
  assert.deepEqual(await unusedAgent(pi(), { now: NOW }), { unused: false, reason: "background" });
});
