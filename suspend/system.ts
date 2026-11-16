// The real System for the stand-in: the terminal on stdin/stdout, hc on PATH,
// the file system, the clock, and execvp. Kept thin: no stand-in logic here.

import { mkdirSync, writeFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { execvp } from "./libc";
import type { System } from "./standin";

export function system(): System {
  const stdin = process.stdin;
  return {
    env: process.env,
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
  };
}
