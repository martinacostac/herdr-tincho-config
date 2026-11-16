// The tab-tree sidebar's right-click menu: Herdr's own `menu` mod (copied from
// herdr-app v0.1.13, defaults/mods/menu) plus "Set tag…" on tabs and panes.
// Herdr's menu has fixed items, so a mod can't add one to it.
// Opened as a popup with props { tab: "pane" | "tab" | "space" | "global", target };
// target.terminal names the terminal to tag (a tab: its primary pane's).
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args];
// a command "worktree" opens the worktree dialog instead, "tag" the tag-prompt one.
// Agent tabs also get "Suspend now" and "Never suspend" (GLOSSARY.md: Suspend,
// Pinned agent): commands "suspend" and "pin", handled here.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes, exec, hc, shared, setShared, notify } from "herdr";

// The suspension policy's entry point (tab-tree's suspend-policy.js:
// SUSPEND_REQUESTS, SUSPEND_STATE and its Outcome reasons). Mods can't import
// each other, so the names, record() and suspendState() (its currentState())
// are repeated here.
// REQUESTS: { [address]: ms }, a manual suspension request per terminal; the
// leader ignores a request older than REQUEST_MS, and its pass removes it.
// STATE: { agents: { [address]: { auto, manual } }, results: { [address]:
// { requested, suspended, reason, at, source, step?, rolledBack? } } },
// written by the leading copy. source: "manual" (a request's result),
// "auto" (a failed automatic suspension) or "repair" (a stale label
// removed); step: where a suspension failed ("keep", "label" or "signal");
// rolledBack: whether the label came off again after a failed signal.
const SUSPEND_REQUESTS = "tincho.suspend.requests";
const SUSPEND_STATE = "tincho.suspend.state";
const REQUEST_MS = 60_000;
const NEVER_SUSPEND = "herdr.never-suspend";
const SUSPENDED = "herdr.suspended";

// Menu text for each reason the policy gives (an unknown one shows as is),
// and "no-answer": no copy of tab-tree handled the request in time.
const REASONS = {
  off: "automatic suspension off",
  remote: "remote terminal",
  suspended: "already suspended",
  "not-resumable": "not resumable",
  pinned: "pinned",
  focused: "focused",
  working: "working",
  blocked: "blocked",
  "not-idle": "not idle",
  recent: "idle too briefly",
  "processes-unknown": "processes unknown",
  background: "background processes",
  "not-installed": "suspension not installed",
  gone: "terminal ended",
  changed: "agent changed",
  failed: "hc command failed",
  closed: "tab tree closed",
  repaired: "stale suspension label removed",
  "no-answer": "no answer from tab tree",
};
// Reasons the policy checks before the pin.
const BEFORE_PIN = new Set(["remote", "suspended", "not-resumable"]);

/** @param {unknown} value @returns {Record<string, any>} */
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? /** @type {any} */ (value) : {};

function suspendState() {
  const value = record(shared(SUSPEND_STATE));
  return { agents: record(value.agents), results: record(value.results) };
}

// Labels live in this machine's core: a remote address carries its machine (mini/t7).
const isLocal = (address) => Boolean(address) && !address.includes("/");
const terminalAt = (address) => terminals().find((t) => t.address === address);
const pinned = (term) => term.labels?.[NEVER_SUSPEND] === "1";

// The local agent a tab shows (also a suspended one), or nothing.
function tabAgent(address) {
  const term = isLocal(address) && terminalAt(address);
  if (!term) return null;
  return term.program?.agent || term.report || Object.hasOwn(term.labels ?? {}, SUSPENDED) ? term : null;
}

// Why "Suspend now" would fail now, or null: the labels first (they change at
// once), then the leader's last pass (every 15 s). That pass skips the process
// rule, so "background" shows only in a request's result.
function suspendReason(term) {
  if (Object.hasOwn(term.labels ?? {}, SUSPENDED)) return "suspended";
  let reason = suspendState().agents[term.address]?.manual ?? null;
  if (reason === "pinned" && !pinned(term)) reason = null; // unpinned since that pass
  if (pinned(term) && !BEFORE_PIN.has(reason)) return "pinned";
  return reason;
}

// Sets or clears the pin (hc label <t> key= removes the label). The menu is
// closed by then, so a failure is a notification.
async function setPin(address, pin) {
  const r = await hc(["label", address, `${NEVER_SUSPEND}=${pin ? "1" : ""}`]).catch((e) => ({ code: -1, stderr: String(e) }));
  if (r?.code === 0) return;
  notify({ title: pin ? "Never suspend failed" : "Removing Never suspend failed", body: String(r?.stderr ?? "").trim() || address, level: "error" });
}

const refusal = (reason) => `Can't suspend: ${REASONS[reason] ?? String(reason)}`;

// The outcome of this menu's request ({ address, at }), or null while it waits.
// A newer request for the same terminal (from another menu) answers it too:
// the leader handles only the latest one. No timer: the check runs on render.
function requestOutcome(request) {
  const result = suspendState().results[request.address];
  if (result?.requested >= request.at) return result.suspended ? "Suspended" : refusal(result.reason);
  return Date.now() - request.at >= REQUEST_MS ? refusal("no-answer") : null;
}

// The suspension items for an agent tab. request: this menu's own request,
// whose outcome replaces the item's text ("Suspending…" while it waits).
function suspendItems(address, request) {
  const term = tabAgent(address);
  if (!term) return [];
  let label;
  if (request?.address === term.address) label = requestOutcome(request) ?? "Suspending…";
  else {
    const reason = suspendReason(term);
    label = reason === null ? "Suspend now" : refusal(reason);
  }
  return [
    [label, "suspend", { terminal: term.address }],
    [pinned(term) ? "Remove Never suspend" : "Never suspend", "pin", { terminal: term.address, pin: !pinned(term) }],
  ];
}

// The tag item for a local terminal, or nothing.
function tagItem(address) {
  if (!isLocal(address)) return [];
  const term = terminalAt(address);
  const value = term?.labels?.tag ?? "";
  return [[value ? `Change tag (${value})…` : "Set tag…", "tag", { terminal: address, value, name: term?.name || term?.title || address }]];
}

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

function items(p, git, request) {
  p = p ?? {};
  const tg = p.target ?? {};
  switch (p.tab) {
    case "pane": {
      // A kept sub-agent can go back under its parent, still running.
      const all = terminals();
      const term = all.find((t) => t.address === tg.terminal);
      const parent = term?.parent && all.find((t) => t.address === term.parent);
      // Once they go to the program, Shift+right-click still opens this menu.
      const toProgram = term?.labels?.["herdr.right-click"] === "program";
      return [
        ["Split right", "pane.split", { direction: "right", pane: tg.pane }],
        ["Split down", "pane.split", { direction: "down", pane: tg.pane }],
        ["Zoom", "pane.zoom", { pane: tg.pane }],
        ...(term
          ? [
              toProgram
                ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }]
                : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }],
            ]
          : []),
        ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
        ...tagItem(tg.terminal),
        ["Close pane", "pane.close", { pane: tg.pane }],
      ];
    }
    case "tab":
      return [
        ["Rename", "tab.rename", { id: tg.id }],
        ...tagItem(tg.terminal),
        ...suspendItems(tg.terminal, request),
        ["New tab", "tab.new", { space: tg.space }],
        ["Close", "tab.close", { id: tg.id }],
      ];
    case "space":
      return [
        ["Rename", "space.rename", { id: tg.id }],
        ...(git ? [["New worktree", "worktree", { space: tg.id, action: "new" }], ["Open worktree", "worktree", { space: tg.id, action: "open" }]] : []),
        ...(git === "linked" ? [["Remove worktree", "worktree", { space: tg.id, action: "remove" }]] : []),
        ["Close", "space.close", { id: tg.id }],
      ];
    default:
      return [
        ["New space", "space.new", {}],
        ["Keybinds", "app.help", {}],
        ["Theme: graphite", "app.theme", { name: "graphite" }],
        ["Theme: ink", "app.theme", { name: "ink" }],
        ["Theme: moss", "app.theme", { name: "moss" }],
        ["Theme: atom one dark", "app.theme", { name: "atom-one-dark" }],
      ];
  }
}

function menuIcon(command) {
  const name = command.endsWith(".close") ? "x" : command.endsWith(".rename") ? "square-pen" : command.endsWith(".new") ? "plus" : command === "worktree" ? "git-branch" : command === "app.help" ? "terminal" : command === "app.theme" ? "settings" : command === "pane.split" ? "panel-right" : command === "pane.zoom" ? "square" : command === "tag" ? "pin" : command === "suspend" ? "clock" : command === "pin" ? "pin" : "terminal";
  return `mods/workspace-chrome/${name}.svg`;
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

export default class Menu extends View {
  init(_props, cx) {
    this.at = 0;
    this.git = null;
    this.request = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = props();
    const space = p?.tab === "space" && spaces().find((s) => s.id === p.target?.id);
    const folder = space && place(space);
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
  }

  choose(i, cx) {
    const it = items(props(), this.git, this.request)[i];
    if (!it) return;
    // The menu stays open to show the result; setShared re-renders it.
    if (it[1] === "suspend") {
      const address = it[2].terminal;
      // A pending request is not sent again (that would hide its result).
      if (this.request?.address === address && requestOutcome(this.request) === null) return;
      this.request = { address, at: Date.now() };
      // Merge: other terminals' requests stay.
      setShared(SUSPEND_REQUESTS, { ...record(shared(SUSPEND_REQUESTS)), [address]: this.request.at });
      cx.notify();
      return;
    }
    closeOverlay(props()?.overlay);
    if (it[1] === "pin") return void setPin(it[2].terminal, it[2].pin);
    if (it[1] === "tag") openOverlay({ mod: "tag-prompt", kind: "dialog", width: 380, props: it[2] });
    else if (it[1] === "worktree") openOverlay({ mod: "worktree", kind: "dialog", ...(it[2].action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: it[2] });
    else run(it[1], it[2]);
  }

  render(cx) {
    const t = theme();
    const list = items(props(), this.git, this.request);
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .when(i > 0 && (it[1].endsWith(".close") || it[1] === "app.help" || (it[1] === "app.theme" && list[i - 1][1] !== "app.theme")), el => el.child(div().mx(7).my(4).h(1).bg(t.border)))
            .child(h_flex()
            .id(`mi-${i}`)
            .h(31)
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .justify_between()
            .text_color(t.foreground)
            .when(i === this.at, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.choose(i, cx))
            .child(svg(menuIcon(it[1])).size(14).flex_none().text_color(t.muted))
            .child(div().flex_1().child(it[0]))
            .child(div().text_size(11).text_color(t.dim).child(shortcut(it[1], it[2])))),
        ),
      );
  }
}
