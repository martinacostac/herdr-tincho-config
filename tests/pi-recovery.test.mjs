import assert from "node:assert/strict";
import test from "node:test";
import { homedir } from "node:os";
import extension from "../pi/extensions/herdr-recovery/index.js";
import { recoveryArgs } from "../pi/extensions/herdr-recovery/args.js";

const cwd = "/projects/example";

test("preserves reusable options, aliases, repetitions and relative resource paths", () => {
  assert.deepEqual(recoveryArgs([
    "--provider", "openai", "--model", "model", "--thinking", "high",
    "-t", "-write", "-xt", "bash", "-e", "./custom.ts", "-e", "builtin:mcp",
    "--skill", "~/skills", "--theme", "dark.json", "--prompt-template", "prompts",
    "--session-dir", "sessions", "-ne", "-nbt", "--no-mcp", "-na", "--offline",
  ], cwd), [
    "--provider", "openai", "--model", "model", "--thinking", "high",
    "--tools", "-write", "--exclude-tools", "bash", "--extension", `${cwd}/custom.ts`, "--extension", "builtin:mcp",
    "--skill", `${homedir()}/skills`, "--theme", `${cwd}/dark.json`, "--prompt-template", `${cwd}/prompts`,
    "--session-dir", `${cwd}/sessions`, "--no-extensions", "--no-builtin-tools", "--no-mcp", "--no-approve", "--offline",
  ]);
});

test("does not replay prompts, attachments, old selectors or names", () => {
  assert.deepEqual(recoveryArgs([
    "--session", "old", "--session-id", "old-id", "--fork", "parent", "--name", "old-name",
    "--continue", "-r", "--no-session", "do the task", "@input.md", "--thinking", "high",
    "--", "--model", "this is a prompt",
  ], cwd), ["--thinking", "high"]);
});

test("omits credentials and inline system prompts without leaking flag-like values", () => {
  const result = recoveryArgs(["--api-key", "--model", "--system-prompt", "private", "--append-system-prompt", "private2", "--thinking", "high"], cwd);
  assert.deepEqual(result, ["--thinking", "high"]);
});

test("unknown flags and trust approvals stop capture rather than guessing arity", () => {
  for (const flag of ["--custom-token", "--custom-token=secret", "--approve", "-a"]) {
    assert.deepEqual(recoveryArgs(["--offline", flag, "--model", "secret"], cwd), ["--offline"]);
  }
});

test("rejects control characters and missing values", () => {
  assert.deepEqual(recoveryArgs(["--model", "bad\nvalue", "--thinking"], cwd), []);
});

function harness({ terminal = "t42", argv = [], exec } = {}) {
  const handlers = new Map();
  const calls = [];
  const notices = [];
  const oldArgv = process.argv;
  const oldTerminal = process.env.HC_TERMINAL_ID;
  process.argv = ["node", "pi", ...argv];
  if (terminal === null) delete process.env.HC_TERMINAL_ID;
  else process.env.HC_TERMINAL_ID = terminal;
  try {
    extension({
      on: (event, fn) => handlers.set(event, fn),
      exec: async (...args) => { calls.push(args); return exec ? exec(...args) : { code: 0 }; },
    });
  } finally {
    process.argv = oldArgv;
    if (oldTerminal === undefined) delete process.env.HC_TERMINAL_ID;
    else process.env.HC_TERMINAL_ID = oldTerminal;
  }
  const ctx = {
    mode: "tui", cwd,
    sessionManager: { getSessionFile: () => "/sessions/current.jsonl", getSessionId: () => "current" },
    ui: { notify: (...args) => notices.push(args) },
  };
  return { handlers, calls, notices, ctx, emit: (event, data = {}) => handlers.get(event)?.(data, ctx) };
}

test("records both labels with one shell-free command and bounded timeout", async () => {
  const h = harness({ argv: ["--thinking", "high", "original task"] });
  await h.emit("session_start", { reason: "startup" });
  const [command, args, options] = h.calls[0];
  assert.equal(command, "hc");
  assert.deepEqual(args.slice(0, 3), ["label", "t42", "herdr.last-agent=pi"]);
  assert.deepEqual(JSON.parse(args[3].slice("herdr.pi-recovery=".length)), {
    version: 1, sessionId: "current", sessionFile: "/sessions/current.jsonl", cwd, args: ["--thinking", "high"],
  });
  assert.equal(options.timeout, 3000);
  await h.emit("agent_start");
  assert.equal(h.calls.length, 1, "unchanged metadata does not cause a subprocess on every turn");
  assert.equal(h.handlers.has("session_shutdown"), false, "exit must leave recovery metadata intact");
});

test("preserves --no-sandbox and following options without a warning", async () => {
  const argv = ["--no-sandbox", "--model", "some-model", "--thinking", "high"];
  assert.deepEqual(recoveryArgs(argv, cwd), argv);
  const h = harness({ argv });
  await h.emit("session_start", { reason: "startup" });
  const saved = JSON.parse(h.calls[0][1][3].slice("herdr.pi-recovery=".length));
  assert.deepEqual(saved.args, argv);
  assert.deepEqual(h.notices, []);
});

test("omitted launch options do not produce a warning on startup or reload", async () => {
  for (const argv of [["--custom-option", "value"], ["--api-key", "secret"], ["--system-prompt", "private"], ["--approve"]]) {
    const h = harness({ argv });
    await h.emit("session_start", { reason: "startup" });
    await h.emit("session_start", { reason: "reload" });
    const saved = JSON.parse(h.calls[0][1][3].slice("herdr.pi-recovery=".length));
    assert.deepEqual(saved.args, []);
    assert.deepEqual(h.notices, []);
  }
});

test("new, resume, fork and reload update the session reference", async () => {
  const h = harness();
  for (const reason of ["startup", "new", "resume", "fork", "reload"]) {
    h.ctx.sessionManager.getSessionId = () => reason;
    h.ctx.sessionManager.getSessionFile = () => `/sessions/${reason}.jsonl`;
    await h.emit("session_start", { reason });
    assert.equal(JSON.parse(h.calls.at(-1)[1][3].slice("herdr.pi-recovery=".length)).sessionId, reason);
  }
  assert.equal(h.calls.length, 5);
});

test("ephemeral sessions clear a previous recovery label", async () => {
  const h = harness();
  await h.emit("session_start");
  h.ctx.sessionManager.getSessionFile = () => undefined;
  await h.emit("session_start", { reason: "new" });
  assert.equal(h.calls.at(-1)[1][3], "herdr.pi-recovery=");
});

test("does nothing outside Herdr or in nested non-interactive Pi modes", async () => {
  assert.equal(harness({ terminal: null }).handlers.size, 0);
  const h = harness();
  for (const mode of ["print", "json", "rpc"]) {
    h.ctx.mode = mode;
    await h.emit("session_start");
    await h.emit("agent_start");
  }
  assert.equal(h.calls.length, 0);
});

test("failed saves warn without exposing output and retry on the next turn", async () => {
  let attempt = 0;
  const h = harness({ exec: () => {
    if (++attempt === 1) throw new Error("private output");
    return { code: attempt === 2 ? 1 : 0, stderr: "private output" };
  } });
  await h.emit("session_start");
  await h.emit("agent_start");
  await h.emit("agent_start");
  await h.emit("agent_start");
  assert.equal(h.calls.length, 3);
  assert.equal(h.notices.length, 1);
  assert.equal(JSON.stringify(h.notices).includes("private output"), false);
});
