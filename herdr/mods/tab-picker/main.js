// ⌘P: go to a tab. Herdr's shipped picker, with the tab-tree sidebar's groups
// and names: tabs grouped by git repo (worktree spaces with their repo, so a
// repo shows once), each named as its sidebar row is (a named tab by its name,
// an agent by its session name), with the program's icon instead of its name.
// It reads "tab-tree.outline", which the tab-tree mod shares; without it
// (another layout), it falls back to one group per space.
// Groups with something running come first, quiet ones fold into "earlier".
// Type to filter, ↑/↓ and Enter to go, ctrl+d to close a tab, Esc to leave.
// Last rows: new work (a tab here, a space on this computer or on each
// connected machine).

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, run, hc, theme, settings, props, closeOverlay, shared } from "herdr";

const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

const fill = (t, c) => (c?.startsWith("#") ? c : (MARK[c] ?? t[c] ?? MARK.ansi6));

// The sidebar's outline, or one group per space when tab-tree isn't running.
function outline() {
  const shared_ = shared("tab-tree.outline");
  if (Array.isArray(shared_) && shared_.length) return shared_;
  const colors = shared("space.colors") ?? {};
  return spaces().map((s) => ({
    key: s.id, name: s.name, space: s.id, color: colors[s.id] ?? "ansi6",
    tabs: s.tabs.map((tab) => ({ id: tab.id, name: tab.name, detail: "", wt: null, kind: "", status: tab.status ?? null, here: Boolean(s.active && tab.active), icon: null, more: tab.panes - 1 })),
  }));
}

export default class TabPicker extends View {
  init(_props, cx) {
    this.filter = "";
    this.input = InputState.new({ placeholder: "Go to a tab, repo or session…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; cx.notify(); });
    this.input.on("submit", () => this.go(this.pickable(this.rows())[this.at]));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.at = null;
    this.scroll = 0;
    this.showEarlier = false;
    this.machines = [];
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => m.state === "connected" && !m.temporary).map((m) => m.name);
      } catch {}
      cx.notify();
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  rows() {
    const f = this.filter.toLowerCase();
    const groups = outline().map((g) => {
      const tabs = g.tabs.filter((x) => !f || [g.name, x.name, x.detail, x.wt].filter(Boolean).join(" ").toLowerCase().includes(f));
      const top = g.tabs.reduce((m, x) => ((RANK[x.status] ?? 0) > (RANK[m] ?? 0) ? x.status : m), null);
      return { g, tabs, top };
    });
    const busy = groups.filter((x) => x.top && x.tabs.length);
    const quiet = groups.filter((x) => !x.top && x.tabs.length);
    busy.sort((a, b) => (b.top === "blocked") - (a.top === "blocked"));
    const out = [];
    const add = (x) => {
      out.push({ kind: "head", g: x.g });
      for (const tab of x.tabs) out.push({ kind: "tab", g: x.g, tab });
    };
    busy.forEach(add);
    if (quiet.length) {
      out.push({ kind: "earlier", count: quiet.length });
      if (this.showEarlier || f) quiet.forEach(add);
    }
    return out;
  }

  // New work, pinned under the list: a tab here, a space here or on each machine.
  actions() {
    return [{ kind: "new" }, { kind: "space", machine: null }, ...this.machines.map((m) => ({ kind: "space", machine: m }))];
  }

  // What ↑/↓ and Enter walk: the list's tabs, then the actions.
  pickable(rows) {
    return [...rows.filter((r) => r.kind === "tab"), ...this.actions()];
  }

  go(r) {
    if (!r) return;
    this.close();
    if (r.kind === "tab") run("tab.select", { id: r.tab.id });
    else if (r.kind === "new") run("tab.new");
    else if (r.kind === "space") run("space.new", r.machine ? { machine: r.machine } : {});
  }

  glyph(t, st) {
    if (st === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    return div().w(12).flex_none().text_color(t[st] ?? t.dim).child(st === "idle" ? "○" : st ? "●" : "·");
  }

  icon(t, tab) {
    const i = tab.icon;
    if (i) return i.tint ? svg(i.path).size(14).flex_none().text_color(tab.kind === "shell" ? t.dim : t.foreground) : image(i.path).w(14).h(14).flex_none();
    return svg(`mods/workspace-chrome/${tab.kind === "mod" ? "square" : "terminal"}.svg`).size(14).flex_none().text_color(t.dim);
  }

  render() {
    const t = theme();
    const rows = this.rows();
    const pickable = this.pickable(rows);
    const actions = pickable.filter((r) => r.kind !== "tab");
    // Opens on where you are.
    if (this.at === null) this.at = Math.max(0, pickable.findIndex((r) => r.kind === "tab" && r.tab.here));
    this.at = Math.min(this.at, pickable.length - 1);
    const sel = pickable[this.at];
    // One continuous strip: each row (and the group title before it) at a fixed
    // y. Scrolling moves the strip only as far as it takes to keep the selected
    // row in view, so the arrows can't run the selection off the list.
    const H = { head: 29, earlier: 35, new: 36, tab: 32, space: 32 };
    const tops = [];
    let y = 0;
    rows.forEach((r) => { tops.push(y); y += H[r.kind] ?? 32; });
    const total = y;
    const height = Math.min(320, this.listHeight ?? 320);
    const fixed = total > height;
    const maxScroll = Math.max(0, total - height);
    this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
    const si = rows.indexOf(sel);
    if (si >= 0) {
      if (tops[si] < this.scroll) this.scroll = tops[si];
      if (tops[si] + (H[sel.kind] ?? 32) > this.scroll + height) this.scroll = tops[si] + (H[sel.kind] ?? 32) - height;
    }
    const place = (el, i) =>
      fixed
        ? el.absolute().left(0).right(0).top(tops[i] - this.scroll).bottom(height - (tops[i] + (H[rows[i].kind] ?? 32) - this.scroll))
        : el;
    const visible = (i) => !fixed || (tops[i] + (H[rows[i].kind] ?? 32) > this.scroll && tops[i] < this.scroll + height);

    const row = (r) => {
      if (r.kind === "head") {
        return h_flex()
          .px(10)
          .pt(10)
          .pb(3)
          .gap(8)
          .items_center()
          .text_size(11)
          .font_semibold()
          .text_color(t.dim)
          .child(h_flex().size(18).rounded(5).bg(fill(t, r.g.color)).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...r.g.name][0]?.toUpperCase() ?? "?"))
          .child(r.g.name);
      }
      if (r.kind === "earlier") {
        return h_flex()
          .id("pk-earlier")
          .mt(6)
          .px(10)
          .py(6)
          .border_t(1)
          .border_color(t.border)
          .text_size(12)
          .text_color(t.dim)
          .cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => {
            this.showEarlier = !this.showEarlier;
            cx.notify();
          })
          .child(`earlier: ${r.count} quiet group${r.count > 1 ? "s" : ""} ${this.showEarlier ? "▴" : "▾"}`);
      }
      const on = r === sel;
      if (r.kind === "new" || r.kind === "space") {
        const label = r.kind === "new" ? "new tab" : r.machine ? `new space on ${r.machine}` : "new space";
        return h_flex()
          .id(r.kind === "new" ? "pk-new" : `pk-space-${r.machine ?? "here"}`)
          .mx(4)
          .px(10)
          .h(32)
          .items_center()
          .rounded(7)
          .gap(8)
          .text_color(t.muted)
          .cursor_pointer()
          .when(on, (el) => el.bg(t.hover))
          .hover((s) => s.bg(t.hover))
          .on_click(() => this.go(r))
          .child(div().w(12).child("+"))
          .child(label);
      }
      const x = r.tab;
      return h_flex()
        .id(`pk-${x.id}`)
        .mx(4)
        .px(10)
        .h(32)
        .rounded(7)
        .gap(10)
        .items_center()
        .cursor_pointer()
        .when(on, (el) => el.bg(t.hover))
        .hover((s) => s.bg(t.hover))
        .on_click(() => this.go(r))
        .child(this.glyph(t, x.status))
        .child(this.icon(t, x))
        .child(h_flex().flex_1().min_w(0).gap(6).items_center()
          .child(div().flex_shrink(1).min_w(0).truncate().text_color(t.foreground).when(x.here, (d) => d.font_semibold()).child(x.name))
          .when(Boolean(x.wt), (el) => el.child(div().flex_none().text_size(11.5).text_color(t.muted).child(`- ${x.wt}`)))
          .when(Boolean(x.detail), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(x.detail))))
        .when(x.status === "blocked", (el) => el.child(div().text_size(11).text_color(t.blocked).child("needs you")))
        .when(x.status === "done", (el) => el.child(div().text_size(11).text_color(t.done).child("finished")))
        .when(x.more > 0, (el) => el.child(div().text_size(11).text_color(t.dim).child(`+${x.more}`)));
    };

    return v_flex()
      .id("picker")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return this.close();
        if (k === "down") this.at = (this.at + 1) % pickable.length;
        else if (k === "up") this.at = (this.at + pickable.length - 1) % pickable.length;
        else if (k === "d" && e.modifiers.control) {
          if (sel?.kind === "tab") {
            this.close();
            run("tab.close", { id: sel.tab.id });
          }
        } else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Go to…")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(
        h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
          .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
      )
      .child(
        v_flex()
          .id("pk-list")
          .on_size_change((size, cx) => {
            this.listHeight = size.height / settings().zoom;
            cx.notify();
          })
          .h(Math.min(320, total))
          .min_h(0)
          .mb(6)
          .when(fixed, (el) =>
            el.overflow_hidden().on_scroll_wheel((e, cx) => {
              this.scroll = Math.max(0, Math.min(this.scroll - e.delta.y, maxScroll));
              // The selection follows the wheel, so the next frame doesn't scroll back to it.
              while (this.at < pickable.length - 1 && tops[rows.indexOf(pickable[this.at])] < this.scroll) this.at++;
              while (this.at > 0 && tops[rows.indexOf(pickable[this.at])] + (H[pickable[this.at].kind] ?? 32) > this.scroll + height) this.at--;
              cx.notify();
            }))
          .children(rows.map((r, i) => (visible(i) ? place(row(r), i) : null)).filter(Boolean)),
      )
      // Pinned: always there, however long the list or the filter.
      .child(v_flex().flex_none().pt(6).border_t(1).border_color(t.border).children(actions.map(row)));
  }
}
