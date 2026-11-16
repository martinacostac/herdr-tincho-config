import assert from "node:assert/strict";
import test from "node:test";
import { CLAUDE_OPTIONS, PI_RECOVERY, SESSION, SUSPENDED, holdsPiSession, recipe, recoveryLine, suspension } from "../herdr/mods/tab-tree/recipes.js";

const record = { version: 1, sessionId: "session-123", sessionFile: "/sessions/it's a session.jsonl", cwd: "/project", args: ["--thinking", "high"] };
const pi = (value) => ({ [PI_RECOVERY]: JSON.stringify(value) });

test("Claude starts from its session id, then the tab name, then the picker, in no folder of its own", () => {
  assert.deepEqual(recipe("claude", { [SESSION]: "claude-id" }, { tab: "tab" }), { cwd: null, argv: ["claude", "--resume", "claude-id"] });
  assert.deepEqual(recipe("claude", {}, { tab: "it's a tab" }), { cwd: null, argv: ["claude", "--resume", "it's a tab"] });
  assert.deepEqual(recipe("claude", {}), { cwd: null, argv: ["claude", "--resume"] });
});

test("Claude never reads Pi's record", () => {
  assert.deepEqual(recipe("claude", pi(record)), { cwd: null, argv: ["claude", "--resume"] });
});

const options = (args, version = 1) => ({ [CLAUDE_OPTIONS]: JSON.stringify({ version, options: args }) });

test("Claude starts with its launch options before --resume, so a resumed Claude records them again", () => {
  const labels = { [SESSION]: "claude-id", ...options(["--model", "haiku", "--add-dir", "/it's", "--verbose"]) };
  assert.deepEqual(recipe("claude", labels), { cwd: null, argv: ["claude", "--model", "haiku", "--add-dir", "/it's", "--verbose", "--resume", "claude-id"] });
  assert.deepEqual(recipe("claude", { ...labels, [SESSION]: undefined }, { tab: "tab" }).argv, ["claude", "--model", "haiku", "--add-dir", "/it's", "--verbose", "--resume", "tab"]);
  assert.equal(recoveryLine("claude", labels), "claude '--model' 'haiku' '--add-dir' '/it'\\''s' '--verbose' --resume 'claude-id'");
  assert.equal(recoveryLine("claude", options(["--model", "haiku"])), "claude '--model' 'haiku' --resume");
});

test("Claude starts without options when the options label is malformed or from a future version", () => {
  for (const labels of [{ [CLAUDE_OPTIONS]: "not json" }, options(["--model", "haiku"], 2), options(["--settings", "{}"]), options(["--model", "hai\nku"])]) {
    assert.deepEqual(recipe("claude", { [SESSION]: "claude-id", ...labels }), { cwd: null, argv: ["claude", "--resume", "claude-id"] });
    assert.equal(recoveryLine("claude", { [SESSION]: "claude-id", ...labels }), "claude --resume 'claude-id'");
  }
});

test("Pi never reads Claude's launch options", () => {
  assert.deepEqual(recipe("pi", { ...pi(record), ...options(["--model", "haiku"]) }), recipe("pi", pi(record)));
});

test("Pi starts from its session file anywhere, keeping its launch options as separate words", () => {
  assert.deepEqual(recipe("pi", pi(record)), { cwd: null, argv: ["pi", "--session", "/sessions/it's a session.jsonl", "--thinking", "high"] });
});

test("Pi with only a session id starts in the recorded folder", () => {
  assert.deepEqual(recipe("pi", pi({ ...record, sessionFile: null })), { cwd: "/project", argv: ["pi", "--session", "session-123", "--thinking", "high"] });
});

test("Pi's picker starts in the recorded folder with the launch options", () => {
  assert.deepEqual(recipe("pi", pi(record), { picker: true }), { cwd: "/project", argv: ["pi", "--resume", "--thinking", "high"] });
});

test("Pi without a valid record opens the picker and never reads Claude's session", () => {
  for (const labels of [{}, { [SESSION]: "claude-id" }, { [PI_RECOVERY]: "not json" }, pi({ ...record, version: 2 })]) {
    assert.deepEqual(recipe("pi", labels), { cwd: null, argv: ["pi", "--resume"] });
    assert.deepEqual(recipe("pi", labels, { picker: true }), { cwd: null, argv: ["pi", "--resume"] });
  }
});

test("an agent without a recipe has none", () => {
  assert.equal(recipe("codex", {}), null);
  assert.equal(recipe("toString", {}), null);
});

test("recovery types the start as one shell line: the recipe's words bare, recorded words quoted", () => {
  assert.equal(recoveryLine("claude", { [SESSION]: "claude-id" }, { tab: "tab" }), "claude --resume 'claude-id'");
  assert.equal(recoveryLine("claude", {}, { tab: "it's a tab" }), "claude --resume 'it'\\''s a tab'");
  assert.equal(recoveryLine("claude", {}), "claude --resume");
  assert.equal(recoveryLine("pi", pi(record)), "pi --session '/sessions/it'\\''s a session.jsonl' '--thinking' 'high'");
  assert.equal(recoveryLine("pi", pi({ ...record, sessionFile: null, args: [] })), "cd '/project' && pi --session 'session-123'");
  assert.equal(recoveryLine("pi", pi(record), { picker: true }), "cd '/project' && pi --resume '--thinking' 'high'");
  assert.equal(recoveryLine("pi", {}), "pi --resume");
  assert.equal(recoveryLine("codex", {}), null);
});

const suspended = { version: 1, agent: "pi", root: "shell", cwd: "/project", since: 1763300000000 };

test("a valid suspension record is read back", () => {
  assert.equal(SUSPENDED, "herdr.suspended");
  assert.deepEqual(suspension(JSON.stringify(suspended)), suspended);
  const claude = { version: 1, agent: "claude", root: "agent", cwd: "/", since: 0 };
  assert.deepEqual(suspension(JSON.stringify(claude)), claude);
});

test("malformed, future-version, relative-folder and control-containing suspension records are rejected", () => {
  for (const raw of [undefined, "", "null", "[]", "1", "not json", ...[
    { ...suspended, version: 2 }, { ...suspended, version: "1" }, { ...suspended, version: undefined },
    { ...suspended, agent: "codex" }, { ...suspended, agent: undefined },
    { ...suspended, root: "fish" }, { ...suspended, root: undefined },
    { ...suspended, cwd: "project" }, { ...suspended, cwd: "" }, { ...suspended, cwd: 7 }, { ...suspended, cwd: undefined },
    { ...suspended, cwd: "/pro\nject" }, { ...suspended, cwd: "/pro\x1b[31mject" }, { ...suspended, cwd: "/project\x7f" },
    { ...suspended, since: -1 }, { ...suspended, since: 1.5 }, { ...suspended, since: "1763300000000" }, { ...suspended, since: undefined },
  ].map(JSON.stringify)]) {
    assert.equal(suspension(raw), null, String(raw));
  }
});

test("the suspension record keeps only its own fields", () => {
  assert.deepEqual(suspension(JSON.stringify({ ...suspended, extra: "x" })), suspended);
});

const header = (fields) => JSON.stringify({ type: "session", id: "session-123", version: 3, cwd: "/project", ...fields });

test("a Pi session file holds the recorded session only when its header names it", () => {
  assert.equal(holdsPiSession(header() + "\n{\"type\":\"message\"}\n", "session-123"), true);
  assert.equal(holdsPiSession(header(), "session-123"), true);
  for (const head of ["", " ", "{broken", "{}", "null", header({ id: "another-session" }), header({ type: "message" }), "\n" + header(), undefined, null]) {
    assert.equal(holdsPiSession(head, "session-123"), false, String(head));
  }
});

test("a Pi session check without a recorded id never matches", () => {
  for (const id of [undefined, null, ""]) assert.equal(holdsPiSession(header({ id }), id), false, String(id));
});

test("the shared recipe module imports nothing, so the stand-in can build it without the Herdr host", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../herdr/mods/tab-tree/recipes.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^\s*import\b|\bimport\s*\(|\brequire\s*\(/m);
});
