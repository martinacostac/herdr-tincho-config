// The libc calls Bun has no API for, through bun:ffi: replacing this process.
// libc.dylib on macOS, libc.so.6 on Linux. Opened on first use only.

import { dlopen, FFIType, ptr, read, type Pointer } from "bun:ffi";

const darwin = process.platform === "darwin";
const ERRNO = darwin ? "__error" : "__errno_location";
const SIG_IGN = 1;

let lib: ReturnType<typeof open> | null = null;
function open() {
  return dlopen(darwin ? "libc.dylib" : "libc.so.6", {
    execvp: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    signal: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
    strerror: { args: [FFIType.i32], returns: FFIType.cstring },
    [ERRNO]: { args: [], returns: FFIType.ptr },
  });
}

/** Replaces this process with argv, looked up on PATH. Returns only on failure, with the error text. */
export function execvp(argv: string[]): string {
  lib ??= open();
  const { symbols } = lib;
  const words = argv.map((word) => Buffer.from(`${word}\0`));
  const table = new BigUint64Array(words.length + 1); // NULL-terminated char *argv[]
  words.forEach((word, i) => { table[i] = BigInt(ptr(word)); });
  // Ignored signals survive exec, and Bun ignores SIGPIPE: the agent and the
  // shell after it must start with the default. Handlers reset by themselves.
  const ignored: number[] = [];
  for (let signal = 1; signal < 32; signal++) {
    const previous = symbols.signal(signal, null);
    if (previous === SIG_IGN) ignored.push(signal);
    else if (previous) symbols.signal(signal, previous as Pointer);
  }
  symbols.execvp(ptr(words[0]), ptr(table));
  const errno = read.i32(symbols[ERRNO]() as Pointer, 0);
  for (const signal of ignored) symbols.signal(signal, SIG_IGN as never);
  return String(symbols.strerror(errno));
}
