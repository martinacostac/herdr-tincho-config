// The real System for the stand-in: the terminal on stdin/stdout, hc on PATH,
// the file system, the clock, and execvp. Kept thin: no stand-in logic here.

import { mkdirSync, readdirSync, writeFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { execvp, unsetenv } from "./libc";
import type { System } from "./standin";

export function system(): System {
  const stdin = process.stdin;
  return {
    env: process.env,
    platform: process.platform,
    unsetenv(name) { unsetenv(name); delete process.env[name]; },
    write: (text) => { writeSync(1, text); },
    listen(onData) {
      stdin.setEncoding("utf8");
      stdin.on("data", (chunk: string) => onData(chunk));
      stdin.on("end", () => process.exit(0)); // the terminal went away
    },
    raw(on) { if (stdin.isTTY) stdin.setRawMode(on); },
    async hc(args) {
      try {
        const child = Bun.spawn(["hc", ...args], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
        const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
        return { code, stdout };
      } catch {
        return { code: 127, stdout: "" };
      }
    },
    async background(argv) {
      await Bun.spawn(argv, { stdin: "ignore", stdout: "inherit", stderr: "ignore", detached: true }).exited;
    },
    async list(dir) {
      try { return readdirSync(dir); } catch { return []; }
    },
    async readHead(path) {
      try { return await Bun.file(path).slice(0, 4096).text(); } catch { return null; }
    },
    async save(path, text) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, text, { mode: 0o600 });
    },
    chdir(path) {
      try { process.chdir(path); return null; } catch (error) { return (error as Error).message; }
    },
    exec: async (argv) => execvp(argv),
    now: () => Date.now(),
    after: (ms, run) => { setTimeout(run, ms); },
    onError(handler) {
      let alive: ReturnType<typeof setInterval> | null = null;
      const stayAlive = (error: unknown) => {
        alive ??= setInterval(() => {}, 2 ** 30); // nothing else may be left to keep the process alive
        try { handler(error); } catch { /* the handler failed too: stay alive anyway */ }
      };
      process.on("uncaughtException", stayAlive);
      process.on("unhandledRejection", stayAlive);
    },
  };
}
