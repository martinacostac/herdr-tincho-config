// The stand-in's keyboard and paste parser. Raw bytes in, messages out: each
// bracketed paste is one message, each typed line confirmed with Enter is one
// message, and an Enter on an empty line is a wake with no message. Keys that
// are not text (arrows, Ctrl-C, other escape sequences) are dropped, and
// nothing typed or pasted is ever run.

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

export type InputEvent = { message: string } | { enter: true };

// The length of the escape sequence at s[i], or 0 when it continues in the next read.
function escapeLength(s: string, i: number): number {
  const kind = s[i + 1];
  if (kind === undefined) return 0;
  if (kind === "[") {
    for (let j = i + 2; j < s.length; j++) {
      const code = s.charCodeAt(j);
      if (code >= 0x40 && code <= 0x7e) return j - i + 1;
      if (code < 0x20 || code > 0x7e) return j - i; // malformed: drop what came before
    }
    return 0;
  }
  if (kind === "]") { // a terminal reply: ends with BEL or ESC \
    for (let j = i + 2; j < s.length; j++) {
      if (s[j] === "\x07") return j - i + 1;
      if (s[j] === "\x1b") return s[j + 1] === undefined ? 0 : j - i + (s[j + 1] === "\\" ? 2 : 0);
    }
    return 0;
  }
  if (kind === "O") return s[i + 2] === undefined ? 0 : 3;
  return 2; // Alt with a key
}

// How much of the end of s could be the start of the paste end marker.
function markerTail(s: string): number {
  for (let n = Math.min(PASTE_END.length - 1, s.length); n > 0; n--) if (PASTE_END.startsWith(s.slice(-n))) return n;
  return 0;
}

export function createInput(emit: (event: InputEvent) => void, echo: (text: string) => void) {
  let pending = ""; // an escape sequence or marker split across reads
  let paste: string | null = null;
  let line = "";

  function feed(chunk: string) {
    const s = pending + chunk;
    pending = "";
    let i = 0;
    while (i < s.length) {
      if (paste !== null) {
        const end = s.indexOf(PASTE_END, i);
        if (end < 0) {
          const keep = markerTail(s.slice(i));
          paste += s.slice(i, s.length - keep);
          pending = s.slice(s.length - keep);
          return;
        }
        // Terminals send a pasted line break as CR. NUL cannot be part of a command word.
        const text = (paste + s.slice(i, end)).replace(/\r\n?/g, "\n").replaceAll("\0", "");
        paste = null;
        i = end + PASTE_END.length;
        if (text) emit({ message: text });
        continue;
      }
      const c = s[i];
      if (c === "\x1b") {
        const length = escapeLength(s, i);
        if (length === 0) { pending = s.slice(i); return; }
        if (s.startsWith(PASTE_START, i)) paste = "";
        i += length;
        continue;
      }
      i += 1;
      if (c === "\r" || c === "\n") {
        if (c === "\r" && s[i] === "\n") i += 1;
        if (line.trim()) { echo("\r\n"); emit({ message: line }); }
        else emit({ enter: true });
        line = "";
      } else if (c === "\x7f" || c === "\b") {
        if (line) { line = Array.from(line).slice(0, -1).join(""); echo("\b \b"); }
      } else if (c >= " ") {
        line += c;
        echo(c);
      }
    }
  }

  return { feed, get pasting() { return paste !== null; } };
}
