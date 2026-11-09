import assert from "node:assert/strict";
import test from "node:test";
import { backgroundJobs, jobName, jobStatus } from "../herdr/mods/tincho-status/jobs.js";

const terminal = (address, parent = null, extra = {}) => ({ address, parent, state: "live", ...extra });
const addresses = (jobs) => jobs.map((job) => job.address);

test("selects only hidden live descendants, preserving original objects and inputs", () => {
  const root = terminal("t1");
  const child = terminal("t2", "t1");
  const nested = terminal("t3", "t2");
  const visible = terminal("t4", "t1");
  const all = Object.freeze([root, child, nested, visible, terminal("t5"), terminal("t6", "t5")].map(Object.freeze));
  const shown = Object.freeze(["t1", "t4"]);
  const result = backgroundJobs(all, shown, "t1");
  assert.deepEqual(result, [child, nested]);
  assert.strictEqual(result[0], child);
  assert.strictEqual(result[1], nested);
  assert.deepEqual(addresses(all), ["t1", "t2", "t3", "t4", "t5", "t6"]);
  assert.deepEqual(backgroundJobs(all, ["t2", "t3", "t4"], "t1"), []);
});

test("traverses visible and finished ancestors without including them", () => {
  const all = [terminal("t1"), terminal("t2", "t1"), terminal("t3", "t2", { state: "finished" }), terminal("t4", "t3"), terminal("t5", "t1", { state: "unknown" })];
  assert.deepEqual(addresses(backgroundJobs(all, ["t2"], "t1")), ["t4"]);
  assert.deepEqual(addresses(backgroundJobs(all, [], "t3")), ["t4"], "a finished root still anchors ancestry");
});

test("missing roots and unknown ancestry never include unrelated jobs", () => {
  const all = [terminal("t1"), terminal("t2", "missing"), terminal("t3", "t2"), terminal("t4")];
  for (const root of [null, undefined, "", "missing", "t99", "t1"]) {
    assert.deepEqual(backgroundJobs(all, [], root), [], String(root));
  }
  assert.deepEqual(backgroundJobs([], [], "t1"), []);
});

test("scopes raw remote parents to their machine and keeps qualified parents unchanged", () => {
  const all = [
    terminal("t1"), terminal("t2", "t1"),
    terminal("host/t1"), terminal("host/t2", "t1"), terminal("host/t3", "host/t2"),
    terminal("elsewhere/t1"), terminal("elsewhere/t2", "t1"),
    terminal("elsewhere/t3", "host/t2"), terminal("t4", "host/t1"),
  ];
  assert.deepEqual(addresses(backgroundJobs(all, [], "t1")), ["t2"]);
  assert.deepEqual(addresses(backgroundJobs(all, [], "host/t1")), ["elsewhere/t3", "host/t2", "host/t3", "t4"]);
  assert.deepEqual(addresses(backgroundJobs(all, ["host/t2"], "host/t1")), ["elsewhere/t3", "host/t3", "t4"]);
  assert.deepEqual(addresses(backgroundJobs(all, ["t2"], "elsewhere/t1")), ["elsewhere/t2"]);
  assert.deepEqual(backgroundJobs([terminal("t1"), terminal("host/t7", "t1")], [], "t1"), [], "a missing remote parent does not resolve locally");
});

test("cycles terminate, exclude the root, and do not admit disconnected cycles", () => {
  const all = [terminal("t1", "t3"), terminal("t2", "t1"), terminal("t3", "t2"), terminal("t4", "t4"), terminal("t5", "t6"), terminal("t6", "t5")];
  assert.deepEqual(addresses(backgroundJobs(all, [], "t1")), ["t2", "t3"]);
  assert.deepEqual(backgroundJobs(all, [], "t4"), []);
  assert.deepEqual(addresses(backgroundJobs(all, [], "t5")), ["t6"]);
});

test("duplicate addresses use the first record and return each job once", () => {
  const child = terminal("t2", "t1");
  const all = [terminal("t1"), child, child, terminal("t2", "unrelated"), terminal("t3", "t2", { state: "finished" }), terminal("t3", "t1"), terminal("t4", "t3")];
  const result = backgroundJobs(all, [], "t1");
  assert.deepEqual(addresses(result), ["t2", "t4"]);
  assert.strictEqual(result[0], child);
});

test("orders urgency first, then display name, cleaned title and full address", () => {
  const all = [
    terminal("t1"),
    terminal("idle", "t1", { status: "idle", name: "A" }),
    terminal("shell", "t1", { program: { shell: true }, name: "B" }),
    terminal("done", "t1", { status: "done", name: "A" }),
    terminal("working", "t1", { status: "working", name: "B" }),
    terminal("running", "t1", { name: "A" }),
    terminal("blocked", "t1", { status: "blocked", name: "B" }),
    terminal("error", "t1", { status: "error", name: "A" }),
    terminal("tie-b", "t1", { status: "blocked", name: "C", title: "● Beta" }),
    terminal("tie-a2", "t1", { status: "blocked", name: "C", title: "✓ Alpha" }),
    terminal("tie-a1", "t1", { status: "blocked", name: "C", title: "Alpha" }),
  ];
  const expected = ["error", "blocked", "tie-a1", "tie-a2", "tie-b", "running", "working", "done", "idle", "shell"];
  assert.deepEqual(addresses(backgroundJobs(all, [], "t1")), expected);
  assert.deepEqual(addresses(backgroundJobs([...all].reverse(), [], "t1")), expected);
});

test("jobName follows safe display fallbacks and cleans leading title glyphs", () => {
  const job = terminal("host/t7", null, { name: " Named job ", title: " ● ✓ Session title ", program: { name: "Pi" }, argv: ["/usr/local/bin/pi", "private prompt", "--token=secret"] });
  assert.equal(jobName(job), "Named job");
  assert.equal(jobName({ ...job, name: " " }), "Session title");
  assert.equal(jobName({ ...job, name: null, title: "✓ ● " }), "Pi");
  assert.equal(jobName({ ...job, name: null, title: null, program: null }), "pi");
  assert.equal(jobName({ ...job, name: null, title: "", program: { name: " " }, argv: ["C:\\bin\\worker.exe", "secret"] }), "worker.exe");
  for (const argv of [undefined, [], [""]]) assert.equal(jobName(terminal("host/t7", null, { argv })), "host/t7");
  assert.equal(jobName(terminal("t8", null, { title: "★ 日本語 task" })), "日本語 task");
});

test("jobName never reads command arguments, prompts or credentials", () => {
  const argv = ["/private/path/worker"];
  Object.defineProperty(argv, 1, { get() { assert.fail("must not inspect arguments after the executable"); } });
  const job = terminal("t2", "t1", { argv, prompt: "secret prompt", credentials: "secret credentials" });
  assert.equal(jobName(job), "worker");
  assert.equal(JSON.stringify(jobStatus(job)), '{"label":"Running","color":"working"}');
  assert.strictEqual(backgroundJobs([terminal("t1"), job], [], "t1")[0], job);
});

test("jobStatus maps reports to Herdr theme keys and distinguishes plain programs from shells", () => {
  const cases = [
    ["blocked", "Needs you", "blocked"], ["error", "Error", "blocked"],
    ["working", "Working", "working"], ["done", "Done", "done"], ["idle", "Idle", "dim"],
  ];
  for (const [status, label, color] of cases) {
    assert.deepEqual(jobStatus(terminal("t1", null, { status })), { label, color });
    assert.deepEqual(jobStatus(terminal("t1", null, { status, program: { shell: true } })), { label, color }, "reports override shell fallback");
  }
  for (const status of [undefined, null, ""]) {
    assert.deepEqual(jobStatus(terminal("t1", null, { status, program: { name: "Server", shell: false } })), { label: "Running", color: "working" });
    assert.deepEqual(jobStatus(terminal("t1", null, { status, program: { name: "zsh", shell: true } })), { label: "Shell", color: "dim" });
  }
});
