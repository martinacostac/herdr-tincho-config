// The stand-in: holds a suspended agent's terminal, collects the messages sent
// to it, never runs them, and wakes the agent with them as its first prompt.
// Started by herdr-shell as `herdr-standin <agent> <address> <name>`.
//
// Everything that touches the process or the terminal goes through System, so
// tests replace it with fakes. The start command comes from the shared recipe
// module that recovery uses; this file builds it into the binary.

import { PI_RECOVERY, SESSION, SUSPENDED, holdsPiSession, piRecovery, recipe, suspension, type Suspension } from "../herdr/mods/tab-tree/recipes.js";
import { createInput, type InputEvent } from "./input";

export interface System {
  env: Record<string, string | undefined>;
  /** Writes to the terminal, synchronously, so nothing is lost on exec. */
  write(text: string): void;
  /** Starts reading the terminal. */
  listen(onData: (chunk: string) => void): void;
  /** Raw mode on while the stand-in reads, off before it hands the terminal over. */
  raw(on: boolean): void;
  hc(args: string[]): Promise<{ code: number; stdout: string }>;
  /** The start of a file, or null when it cannot be read. */
  readHead(path: string): Promise<string | null>;
  /** Writes a private file, creating its folders. */
  save(path: string, text: string): Promise<void>;
  /** Changes the working folder; an error text on failure. */
  chdir(path: string): string | null;
  /** Replaces this process (execvp). Never settles on success; the error text on failure. */
  exec(argv: string[]): Promise<string>;
  now(): number;
  after(ms: number, run: () => void): void;
}

const APP = "herdr-standin";
const BATCH_MS = 500;
const RETRY_MS = 200;
const RETRIES = 10; // about 2 s while the core restarts
// Runs the words it is given, then the user's shell, so exiting the agent returns to a prompt.
const THEN_SHELL = '"$@"; exec "${SHELL:-/bin/sh}"';

// An OSC 7501 status report (fact F5 in plans/agent-suspension.md).
const report = (state: "idle" | "working" | "blocked", msg?: string) =>
  `\x1b]7501;state=${state}:app=${APP}${msg ? `:msg=${Buffer.from(msg).toString("base64")}` : ""}\x1b\\`;
const pad = (n: number) => String(n).padStart(2, "0");
const clock = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
type Suspended = { record: Suspension; labels: Record<string, string> };

const printable = (s: unknown): s is string => typeof s === "string" && s.length > 0 && !/[\x00-\x1f\x7f]/.test(s);

export async function standin(args: string[], sys: System): Promise<void> {
  const [agentArg = "agent", address = "", name = ""] = args;
  const pause = (ms: number) => new Promise<void>((done) => sys.after(ms, done));

  // hc refuses with exit 5 (unavailable) while the core restarts (fact F4 in plans/agent-suspension.md).
  async function hc(words: string[]) {
    for (let attempt = 0; ; attempt++) {
      const result = await sys.hc(words);
      if (result.code !== 5 || attempt >= RETRIES) return result;
      await pause(RETRY_MS);
    }
  }

  async function readLabels(): Promise<Record<string, string> | null> {
    const result = await hc(["get", address, "--json"]);
    if (result.code !== 0) return null;
    try {
      const labels = JSON.parse(result.stdout)?.labels ?? {};
      return typeof labels === "object" && !Array.isArray(labels) ? labels : null;
    } catch { return null; }
  }

  // A stale stand-in: the terminal is not suspended, so it gets the user's shell.
  async function handover() {
    for (const shell of [sys.env.SHELL, "/bin/sh"]) {
      if (!shell) continue;
      const error = await sys.exec([shell]);
      sys.write(`${APP}: cannot start ${shell}: ${error}\r\n`);
    }
  }

  const labels = await readLabels();
  if (labels && !Object.hasOwn(labels, SUSPENDED)) return handover();
  const recordText = labels?.[SUSPENDED];
  const record = suspension(recordText);
  const agent = record?.agent ?? agentArg;
  // Without a readable record the stand-in can only hold the terminal; it never falls back to a shell.
  const suspended: Suspended | { cannotWake: string } = labels === null ? { cannotWake: `hc could not read terminal ${address}` }
    : record === null ? { cannotWake: "its suspension record is unreadable" } : { record, labels };

  // Why the recorded session cannot be resumed, or null. Never a picker or a new conversation.
  async function sessionMissing({ record, labels }: Suspended): Promise<string | null> {
    if (record.agent === "claude") return printable(labels[SESSION]) ? null : "Claude has no session id";
    const recovery = piRecovery(labels[PI_RECOVERY]);
    if (!recovery?.sessionFile) return "Pi has no session file";
    const head = await sys.readHead(recovery.sessionFile);
    return holdsPiSession(head, recovery.sessionId) ? null : `its session file ${recovery.sessionFile} is missing or holds another session`;
  }

  let batch: string[] | null = null; // the messages of the wake being collected
  let windowClosed = false; // the 500 ms after the first message are over
  let waking = false;
  let blocked = false;

  // Returns only when the agent was not woken, with the reason.
  async function tryWake(): Promise<string> {
    if ("cannotWake" in suspended) return suspended.cannotWake;
    const missing = await sessionMissing(suspended);
    if (missing) return missing;
    const { record, labels } = suspended;
    const start = recipe(record.agent, labels, { tab: name || null, picker: false });
    if (!start) return `${agent} has no recipe`;
    sys.write(report("working"));
    sys.write(`waking ${agent}…\r\n`);
    const cwd = start.cwd ?? record.cwd;
    const chdirError = sys.chdir(cwd);
    if (chdirError) return `cannot enter ${cwd}: ${chdirError}`;
    if ((await hc(["label", address, `${SUSPENDED}=`])).code !== 0) return "hc could not remove its suspension label";
    const messages = batch ?? [];
    const words = messages.length ? [...start.argv, "--", messages.join("\n\n")] : start.argv;
    const argv = record.root === "shell" ? ["/bin/sh", "-c", THEN_SHELL, "sh", ...words] : words;
    sys.write("\x1b[?2004l");
    sys.raw(false);
    const error = await sys.exec(argv);
    // Still here: the replacement failed, so the terminal stays suspended.
    sys.raw(true);
    sys.write("\x1b[?2004h");
    await hc(["label", address, `${SUSPENDED}=${recordText}`]);
    return `cannot start ${argv[0]}: ${error}`;
  }

  function undeliveredPath() {
    const state = sys.env.XDG_STATE_HOME?.startsWith("/") ? sys.env.XDG_STATE_HOME : `${sys.env.HOME ?? ""}/.local/state`;
    return `${state}/herdr-tincho-config/undelivered/${address.replace(/[^A-Za-z0-9._-]/g, "_")}-${sys.now()}.txt`;
  }

  // Not woken: keep the messages in a file, say where, and report blocked so
  // hc tells the parent. An empty wake (a focus press) reports only once.
  async function keepUndelivered(messages: string[], reason: string) {
    let note = `${agent} not woken: ${reason}.`;
    let shown = note;
    if (messages.length) {
      const path = undeliveredPath();
      const text = messages.join("\n\n");
      try {
        await sys.save(path, text);
        shown = note += ` Messages saved to ${path}`;
      } catch (error) {
        note += ` Could not save the messages: ${(error as Error).message}`;
        shown = `${note}\n${text}`;
      }
    } else if (blocked) return;
    sys.write(`\r\n💤 ${shown.replace(/\n/g, "\r\n")}\r\n`);
    sys.write(report("blocked", note));
    blocked = true;
  }

  async function wake() {
    waking = true;
    const reason = await tryWake();
    const messages = batch ?? [];
    batch = null;
    windowClosed = false;
    await keepUndelivered(messages, reason);
    waking = false;
    maybeWake();
  }

  function maybeWake() {
    if (windowClosed && !waking && !input.pasting) void wake();
  }

  function onEvent(event: InputEvent) {
    if (batch === null) {
      batch = [];
      sys.after(BATCH_MS, () => { windowClosed = true; maybeWake(); });
    }
    if ("message" in event) batch.push(event.message);
  }

  const input = createInput(onEvent, (text) => sys.write(text));
  sys.raw(true);
  sys.listen((chunk) => { input.feed(chunk); maybeWake(); });
  sys.write("\x1b[?2004h");
  sys.write(`\r\n💤 ${agent} suspended at ${record ? clock(record.since) : "--:--"} · wakes on a message or when focused · Enter wakes it\r\n`);
  if ("cannotWake" in suspended) {
    // Blocked, so hc refuses sends and tells the parent; typed messages are kept in files.
    sys.write(`💤 ${agent} cannot wake: ${suspended.cannotWake}. Typed messages are kept in files.\r\n`);
    sys.write(report("blocked", `${agent} cannot wake: ${suspended.cannotWake}`));
    blocked = true;
  } else {
    sys.write(report("idle"));
  }
}
