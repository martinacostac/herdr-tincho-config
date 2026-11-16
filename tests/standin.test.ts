import { describe, expect, test } from "bun:test";
import { standin, type System } from "../suspend/standin";

// Fakes only at the boundary: the terminal, hc, the file system, the clock
// and the process replacement. The stand-in logic runs unchanged.

const SESSION_FILE = "/sessions/pi.jsonl";
const PI_RECORD = JSON.stringify({ version: 1, sessionId: "pi-id", sessionFile: SESSION_FILE, cwd: "/recorded", args: ["--model", "m"] });
const SINCE = new Date(2026, 10, 16, 14, 5).getTime();
const suspended = (root: "shell" | "agent", agent = "pi") => JSON.stringify({ version: 1, agent, root, cwd: "/project", since: SINCE });
const piLabels = (root: "shell" | "agent" = "agent") => ({ "herdr.suspended": suspended(root), "herdr.pi-recovery": PI_RECORD });
const claudeLabels = (root: "shell" | "agent" = "agent") => ({ "herdr.suspended": suspended(root, "claude"), "herdr.claude-session": "claude-id" });

type Options = { labels?: Record<string, string> | null; files?: Record<string, string>; env?: Record<string, string | undefined>; exec?: (argv: string[]) => string | null; hc?: (args: string[]) => { code: number; stdout: string } | undefined };

function fake(options: Options = {}) {
  const writes: string[] = [];
  const steps: string[] = [];
  const execs: string[][] = [];
  const saved: Record<string, string> = {};
  const timers: { at: number; run: () => void }[] = [];
  let now = SINCE + 60_000;
  let onData: ((chunk: string) => void) | null = null;
  const sys: System = {
    env: { HOME: "/home/me", SHELL: "/bin/fish", ...options.env },
    write: (text) => { writes.push(text); },
    listen: (handler) => { onData = handler; },
    raw: (on) => { steps.push(`raw ${on}`); },
    hc: async (args) => {
      steps.push(`hc ${args.join(" ")}`);
      const answer = options.hc?.(args);
      if (answer) return answer;
      if (args[0] === "get") return options.labels === null ? { code: 3, stdout: "" } : { code: 0, stdout: JSON.stringify({ address: args[1], labels: options.labels ?? piLabels() }) };
      return { code: 0, stdout: "{}" };
    },
    readHead: async (path) => options.files && path in options.files ? options.files[path] ?? null : (path === SESSION_FILE ? '{"type":"session","id":"pi-id"}\n{"type":"message"}' : null),
    save: async (path, text) => { steps.push(`save ${path}`); saved[path] = text; },
    chdir: (path) => { steps.push(`chdir ${path}`); return null; },
    exec: (argv) => {
      steps.push(`exec ${argv[0]}`);
      execs.push(argv);
      const error = options.exec?.(argv) ?? null;
      return error === null ? new Promise<string>(() => {}) : Promise.resolve(error);
    },
    now: () => now,
    after: (ms, run) => { timers.push({ at: now + ms, run }); },
  };
  const settle = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
  return {
    sys, writes, steps, execs, saved,
    screen: () => writes.join(""),
    // The handover never returns, as a real exec never does: do not wait for it.
    async start(args = ["pi", "t7", "worker"]) { void standin(args, sys); await settle(); },
    async input(chunk: string) { onData!(chunk); await settle(); },
    async tick(ms: number) {
      const until = now + ms;
      await settle();
      for (;;) {
        const due = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        now = due.at;
        due.run();
        await settle();
      }
      now = until;
      await settle();
    },
  };
}

const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;
const report = (state: string, msg?: string) => `\x1b]7501;state=${state}:app=herdr-standin${msg ? `:msg=${Buffer.from(msg).toString("base64")}` : ""}\x1b\\`;
const reports = (screen: string) => [...screen.matchAll(/\x1b\]7501;state=(\w+)/g)].map((m) => m[1]);
const PI_WAKE = ["pi", "--session", SESSION_FILE, "--model", "m"];

describe("start", () => {
  test("shows the suspension line, turns on bracketed paste and reports idle", async () => {
    const t = fake();
    await t.start();
    expect(t.steps).toContain("hc get t7 --json");
    expect(t.steps).toContain("raw true");
    expect(t.screen()).toContain("\x1b[?2004h");
    expect(t.screen()).toContain("💤 pi suspended at 14:05 · wakes on a message or when focused · Enter wakes it");
    expect(t.screen().endsWith(report("idle"))).toBe(true);
    expect(t.execs).toEqual([]);
  });

  test("without its suspension label it hands the terminal to $SHELL", async () => {
    const t = fake({ labels: { "herdr.last-agent": "pi" } });
    await t.start();
    expect(t.execs).toEqual([["/bin/fish"]]);
    expect(t.steps).not.toContain("raw true");
    expect(reports(t.screen())).toEqual([]);
  });

  test("the stale-label handover uses /bin/sh when $SHELL is unset", async () => {
    const t = fake({ labels: {}, env: { SHELL: undefined } });
    await t.start();
    expect(t.execs).toEqual([["/bin/sh"]]);
  });

  test("retries hc while the core restarts, and never starts a shell when hc fails", async () => {
    let tries = 0;
    const t = fake({ labels: {}, hc: (args) => (args[0] === "get" && ++tries < 3 ? { code: 5, stdout: "" } : undefined) });
    await t.start();
    await t.tick(1000);
    expect(tries).toBe(3);
    expect(t.execs).toEqual([["/bin/fish"]]);

    const broken = fake({ labels: null });
    await broken.start();
    expect(broken.execs).toEqual([]);
    expect(reports(broken.screen())).toEqual(["blocked"]);
  });
});

describe("input", () => {
  test("a pasted block is one message, and its Enter adds nothing", async () => {
    const t = fake();
    await t.start();
    await t.input(paste("hello there"));
    await t.tick(200);
    await t.input("\r");
    await t.tick(300);
    expect(t.execs).toEqual([[...PI_WAKE, "--", "hello there"]]);
  });

  test("a paste keeps its newlines and escape sequences, even split across reads", async () => {
    const t = fake();
    await t.start();
    const text = "line one\r\nline two\rline \x1b[31mred\x1b[0m and \x1b[A arrow";
    const whole = paste(text);
    await t.input(whole.slice(0, 3));
    await t.input(whole.slice(3, 20));
    await t.input(whole.slice(20, whole.length - 3));
    await t.input(whole.slice(whole.length - 3));
    await t.tick(500);
    expect(t.execs).toEqual([[...PI_WAKE, "--", "line one\nline two\nline \x1b[31mred\x1b[0m and \x1b[A arrow"]]);
  });

  test("a typed line followed by Enter is one message; keys and control characters are not text", async () => {
    const t = fake();
    await t.start();
    await t.input("helo");
    await t.input("\x7flo\x1b[D\x03 you");
    await t.input("\r");
    await t.tick(500);
    expect(t.execs).toEqual([[...PI_WAKE, "--", "hello you"]]);
    expect(t.screen()).toContain("helo");
  });

  test("an empty Enter wakes the agent with no prompt", async () => {
    const t = fake();
    await t.start();
    await t.input("\r");
    await t.tick(500);
    expect(t.execs).toEqual([PI_WAKE]);
  });

  test("input is never run before the agent wakes", async () => {
    const t = fake();
    await t.start();
    await t.input(paste("rm -rf ~"));
    await t.input("echo hi\r");
    expect(t.execs).toEqual([]);
  });
});

describe("batching", () => {
  test("waits 500 ms after the first message, then wakes once with all messages joined by blank lines", async () => {
    const t = fake();
    await t.start();
    await t.input(paste("first"));
    await t.tick(300);
    await t.input(paste("second\nwith two lines"));
    await t.tick(100);
    await t.input("third\r");
    await t.tick(99);
    expect(t.execs).toEqual([]);
    await t.tick(1);
    expect(t.execs).toEqual([[...PI_WAKE, "--", "first\n\nsecond\nwith two lines\n\nthird"]]);
  });

  test("an empty Enter opens the same window, so a message right after it is delivered", async () => {
    const t = fake();
    await t.start();
    await t.input("\r");
    await t.tick(250);
    await t.input(paste("late"));
    await t.tick(250);
    expect(t.execs).toEqual([[...PI_WAKE, "--", "late"]]);
  });

  test("a paste still arriving when the window ends is waited for", async () => {
    const t = fake();
    await t.start();
    await t.input(paste("one"));
    await t.input("\x1b[200~long");
    await t.tick(500);
    expect(t.execs).toEqual([]);
    await t.input(" paste\x1b[201~");
    expect(t.execs).toEqual([[...PI_WAKE, "--", "one\n\nlong paste"]]);
  });
});

describe("status reports", () => {
  test("idle on start, working once the wake begins", async () => {
    const t = fake();
    await t.start();
    expect(reports(t.screen())).toEqual(["idle"]);
    await t.input(paste("go"));
    expect(reports(t.screen())).toEqual(["idle"]);
    await t.tick(500);
    expect(reports(t.screen())).toEqual(["idle", "working"]);
    expect(t.screen()).toContain(report("working"));
  });

  test("blocked, with the reason, when the session is missing", async () => {
    const t = fake({ files: { [SESSION_FILE]: '{"type":"session","id":"another"}' } });
    await t.start();
    await t.input(paste("go"));
    await t.tick(500);
    expect(reports(t.screen())).toEqual(["idle", "blocked"]);
    expect(t.screen()).toMatch(/\x1b\]7501;state=blocked:app=herdr-standin:msg=[A-Za-z0-9+/=]+\x1b\\/);
  });
});

describe("wake", () => {
  test("root=agent: enters the recorded folder, removes the label, then replaces itself with the recipe", async () => {
    const t = fake({ labels: piLabels("agent") });
    await t.start(["pi", "t7", "worker"]);
    await t.input(paste("-starts with a dash"));
    await t.tick(500);
    expect(t.execs).toEqual([[...PI_WAKE, "--", "-starts with a dash"]]);
    const wake = t.steps.slice(t.steps.indexOf("chdir /project"));
    expect(wake).toEqual(["chdir /project", "hc label t7 herdr.suspended=", "raw false", "exec pi"]);
    expect(t.screen().lastIndexOf("\x1b[?2004l")).toBeGreaterThan(t.screen().lastIndexOf("\x1b[?2004h"));
  });

  test("root=shell: runs the recipe under /bin/sh -c, then returns to $SHELL", async () => {
    const t = fake({ labels: claudeLabels("shell") });
    await t.start(["claude", "t9", "worker"]);
    await t.input(paste("hi"));
    await t.tick(500);
    expect(t.execs).toHaveLength(1);
    const [sh, flag, script, name, ...command] = t.execs[0];
    expect([sh, flag, name]).toEqual(["/bin/sh", "-c", "sh"]);
    expect(command).toEqual(["claude", "--resume", "claude-id", "--", "hi"]);
    expect(t.steps).toContain("hc label t9 herdr.suspended=");
    expect(t.steps.indexOf("hc label t9 herdr.suspended=")).toBeLessThan(t.steps.indexOf("exec /bin/sh"));
    // The script runs the words it is given, then the user's shell.
    const run = Bun.spawnSync(["/bin/sh", "-c", script, name, "printf", "%s|", "a b", "--", "it's\nmultiline"], { env: { SHELL: "/bin/echo" } });
    expect(run.stdout.toString()).toBe("a b|--|it's\nmultiline|\n");
  });

  test("Claude wakes from its recorded session id, in the record's folder", async () => {
    const t = fake({ labels: { ...claudeLabels("agent"), "herdr.claude-session": "abc" } });
    await t.start(["claude", "t9", "worker"]);
    await t.input("\r");
    await t.tick(500);
    expect(t.execs[0].slice(0, 3)).toEqual(["claude", "--resume", "abc"]);
    expect(t.steps).toContain("chdir /project");
  });

  test("a failed replacement puts the label back and keeps the messages", async () => {
    const t = fake({ exec: () => "No such file or directory" });
    await t.start();
    await t.input(paste("keep me"));
    await t.tick(500);
    expect(t.steps).toContain(`hc label t7 herdr.suspended=${suspended("agent")}`);
    expect(Object.values(t.saved)).toEqual(["keep me"]);
    expect(reports(t.screen()).at(-1)).toBe("blocked");
    expect(t.screen()).toContain("No such file or directory");
  });
});

describe("missing session", () => {
  const missing = async (options: Options, args = ["pi", "t1/x", "worker"]) => {
    const t = fake({ env: { XDG_STATE_HOME: "/state" }, ...options });
    await t.start(args);
    await t.input(paste("first"));
    await t.input("second\r");
    await t.tick(500);
    return t;
  };

  for (const [name, options] of [
    ["the Pi session file is absent", { files: { [SESSION_FILE]: undefined as unknown as string } }],
    ["the Pi session file holds another id", { files: { [SESSION_FILE]: '{"type":"session","id":"other"}' } }],
    ["the Pi record has no session file", { labels: { "herdr.suspended": suspended("agent"), "herdr.pi-recovery": JSON.stringify({ version: 1, sessionId: "pi-id", cwd: "/r", args: [] }) } }],
    ["there is no Pi record", { labels: { "herdr.suspended": suspended("agent") } }],
    ["Claude has no session id", { labels: { "herdr.suspended": suspended("agent", "claude") } }],
  ] as [string, Options][]) {
    test(`${name}: messages saved, path shown, blocked reported, no wake`, async () => {
      const t = await missing(options);
      expect(t.execs).toEqual([]);
      expect(t.steps).not.toContain("hc label t1/x herdr.suspended=");
      const paths = Object.keys(t.saved);
      expect(paths).toHaveLength(1);
      expect(paths[0]).toMatch(/^\/state\/herdr-tincho-config\/undelivered\/t1_x-\d+\.txt$/);
      expect(t.saved[paths[0]]).toBe("first\n\nsecond");
      expect(t.screen()).toContain(paths[0]);
      expect(reports(t.screen()).at(-1)).toBe("blocked");
    });
  }

  test("the undelivered folder defaults to ~/.local/state", async () => {
    const t = fake({ labels: { "herdr.suspended": suspended("agent", "claude") } });
    await t.start(["claude", "t3", "worker"]);
    await t.input(paste("hi"));
    await t.tick(500);
    expect(Object.keys(t.saved)[0]).toMatch(/^\/home\/me\/\.local\/state\/herdr-tincho-config\/undelivered\/t3-\d+\.txt$/);
  });
});
