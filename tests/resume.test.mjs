import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { spawnSync } from "node:child_process";
import { PI_RECOVERY, RECIPES, piRecovery, shellQuote } from "../herdr/mods/tab-tree/recipes.js";

const record = { version: 1, sessionId: "session-123", sessionFile: "/sessions/it's a session.jsonl", cwd: "/project", args: ["--thinking", "high", "--extension", "/project/custom.ts"] };

test("Pi prefers the absolute session file and preserves argument boundaries", () => {
  const recovery = piRecovery(JSON.stringify(record));
  assert.deepEqual(recovery, record);
  assert.equal(RECIPES.pi({ recovery }), "pi --session '/sessions/it'\\''s a session.jsonl' '--thinking' 'high' '--extension' '/project/custom.ts'");
  assert.equal(RECIPES.pi({ recovery: { ...record, sessionFile: null } }), "cd '/project' && pi --session 'session-123' '--thinking' 'high' '--extension' '/project/custom.ts'");
  assert.equal(RECIPES.pi({ recovery: null }), "pi --resume");
});

test("missing, malformed, future-version and control-containing records fall back", () => {
  for (const raw of [undefined, "", "null", "[]", "not json", ...[
    { ...record, version: 2 }, { ...record, sessionId: "--bad" },
    { ...record, sessionFile: "relative.jsonl" }, { ...record, sessionFile: "/bad\npath" },
    { ...record, cwd: "relative" }, { ...record, args: [123] },
    { ...record, args: ["--model", "bad\x1bvalue"] }, { ...record, args: {} },
  ].map(JSON.stringify)]) {
    assert.equal(piRecovery(raw), null, String(raw));
  }
});

test("Claude still uses its session id, then tab name, then the picker", () => {
  assert.equal(RECIPES.claude({ session: "claude-id", tab: "tab" }), "claude --resume 'claude-id'");
  assert.equal(RECIPES.claude({ tab: "it's a tab" }), "claude --resume 'it'\\''s a tab'");
  assert.equal(RECIPES.claude({}), "claude --resume");
});

test("shell quoting round-trips literals in installed supported shells", () => {
  const values = ["a b", "it's", "$(exit 3); `exit 4`", "back\\slash", "double\\\\slash", "\\'", "a\"b", ""];
  let checked = 0;
  for (const shell of ["sh", "bash", "zsh", "fish"]) {
    const result = spawnSync(shell, ["-c", `printf '%s\\n' ${values.map(shellQuote).join(" ")}`], { encoding: "utf8" });
    if (result.error?.code === "ENOENT") continue;
    assert.equal(result.status, 0, `${shell}: ${result.stderr}`);
    assert.equal(result.stdout, values.join("\n") + "\n", shell);
    checked++;
  }
  assert.ok(checked > 0);
});

// The mod's host module exists only in Herdr. Route that import to a stub;
// all production command construction and queue logic runs unchanged.
let calls = [];
let current;
let fileCode;
let fileContent;
const hostKey = Symbol.for("herdr.recovery.test-host");
globalThis[hostKey] = {
  hc: async (args) => {
    calls.push(["hc", args]);
    if (args[0] === "get") return { code: 0, stdout: JSON.stringify(current) };
    return { code: 0, stdout: "" };
  },
  exec: async (...args) => { calls.push(["exec", ...args]); return { code: fileCode, stdout: fileContent }; },
};
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "herdr") return { url: "data:text/javascript," + encodeURIComponent('export const { hc, exec } = globalThis[Symbol.for("herdr.recovery.test-host")];'), shortCircuit: true };
    return next(specifier, context);
  },
});
const { createRecovery } = await import("../herdr/mods/tab-tree/resume.js");
let recovery;
const recover = (...args) => recovery.recover(...args);
hook.deregister();
const cx = { sleep: async () => assert.fail("Pi recovery must not wait for reports or retry") };
function reset() {
  recovery = createRecovery();
  calls = [];
  current = { state: "live", pid: 1, foreground: { pid: 1 } };
  fileCode = 0;
  fileContent = JSON.stringify({ type: "session", id: record.sessionId, version: 3, cwd: record.cwd }) + "\n";
}
const labels = { [PI_RECOVERY]: JSON.stringify(record), "herdr.claude-session": "wrong-agent" };
const sent = () => calls.filter(([kind, args]) => kind === "hc" && args[0] === "send").map(([, args]) => args);

test("Pi recovery sends once, checks the file, and never uses Claude's session or retry", async () => {
  reset();
  await recover(cx, "t42", "pi", labels, "tab name");
  assert.deepEqual(sent(), [["send", "t42", RECIPES.pi({ recovery: record })]]);
  assert.deepEqual(calls[0], ["exec", "sh", ["-c", 'test -f "$1" && head -c 4096 "$1"', "sh", record.sessionFile]]);
});

test("Claude recovery types its launch options before --resume", async () => {
  reset();
  current = { ...current, reported: true };
  const claude = { "herdr.claude-session": "claude-id", "herdr.claude-options": JSON.stringify({ version: 1, options: ["--model", "haiku", "--permission-mode", "plan"] }) };
  await recover(cx, "t42", "claude", claude, "tab name");
  await recover(cx, "t43", "claude", { "herdr.claude-session": "claude-id" }, "tab name");
  assert.deepEqual(sent(), [["send", "t42", "claude '--model' 'haiku' '--permission-mode' 'plan' --resume 'claude-id'"], ["send", "t43", "claude --resume 'claude-id'"]]);
});

test("missing file or metadata opens the picker without timeout or /exit", async () => {
  reset();
  fileCode = 1;
  await recover(cx, "t42", "pi", labels, null);
  await recover(cx, "t43", "pi", {}, null);
  assert.deepEqual(sent(), [["send", "t42", RECIPES.pi({ recovery: record, picker: true })], ["send", "t43", "pi --resume"]]);
  assert.match(sent()[0][2], /^cd '\/project' && pi --resume /, "picker keeps the folder and launch restrictions");
});

test("does not type into a terminal that is gone or no longer at a shell", async () => {
  for (const state of [null, { state: "finished" }, { state: "live", pid: 1, foreground: { pid: 2 } }]) {
    reset();
    current = state;
    await recover(cx, "t42", "pi", labels, null);
    assert.deepEqual(sent(), []);
  }
});

test("ID-only metadata restores in the recorded cwd without probing a guessed filename", async () => {
  reset();
  const idOnly = { ...record, sessionFile: null };
  await recover(cx, "t42", "pi", { [PI_RECOVERY]: JSON.stringify(idOnly) }, null);
  assert.equal(calls.some(([kind]) => kind === "exec"), false);
  assert.deepEqual(sent(), [["send", "t42", RECIPES.pi({ recovery: idOnly })]]);
  assert.match(sent()[0][2], /^cd '\/project' && pi --session 'session-123'/);
});

test("ID-only replay changes directory before Pi resolves the ID", async () => {
  const { tmpdir } = await import("node:os");
  const { realpath } = await import("node:fs/promises");
  const folder = await realpath(tmpdir());
  const command = RECIPES.pi({ recovery: { ...record, cwd: folder, sessionFile: null, args: [] } });
  const result = spawnSync("sh", ["-c", `pi() { pwd; printf '%s\\n' "$@"; }; ${command}`], { cwd: "/", encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${folder}\n--session\nsession-123\n`);
});

test("empty, corrupt and replaced session files open the picker, never a new conversation", async () => {
  for (const content of ["", " ", "{broken", "{}", JSON.stringify({ type: "session", id: "another-session" }), JSON.stringify({ type: "message", id: record.sessionId })]) {
    reset();
    fileContent = content;
    await recover(cx, "t42", "pi", labels, null);
    assert.deepEqual(sent(), [["send", "t42", RECIPES.pi({ recovery: record, picker: true })]]);
  }
});

test("session header probe rejects real empty/missing files and bounds reads", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "pi-header-test-"));
  try {
    reset();
    await recover(cx, "t42", "pi", labels, null);
    const [, command, args] = calls[0];
    const path = join(dir, "session ' quote.jsonl");
    const probe = () => spawnSync(command, [...args.slice(0, -1), path], { encoding: "utf8" });
    assert.notEqual(probe().status, 0);
    await writeFile(path, "");
    assert.equal(probe().stdout, "");
    await writeFile(path, fileContent + "x".repeat(10000));
    const result = probe();
    assert.equal(result.status, 0);
    assert.equal(Buffer.byteLength(result.stdout), 4096);
    assert.equal(JSON.parse(result.stdout.split("\n")[0]).id, record.sessionId);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
