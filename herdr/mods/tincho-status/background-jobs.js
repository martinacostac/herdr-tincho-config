// The status-bar popup uses a fixed parent so taking keyboard focus does not
// change its scope. Terminal and pane snapshots stay live; no polling needed.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { terminals, panes, focused, props, closeOverlay, openOverlay, theme } from "herdr";
import { backgroundJobs, jobName, jobStatus } from "./jobs.js";
import { jobPreviewSpec } from "./preview.js";

const ICONS = "mods/workspace-chrome";

export function focusedJobRoot() {
  const focus = focused();
  return focus?.shown ?? focus?.terminal ?? focus?.agent ?? null;
}

export function jobSnapshot(root) {
  const all = terminals();
  const visible = panes().map((p) => p.terminal).filter(Boolean);
  // terminal.show can temporarily display a job in another terminal's pane.
  const shown = focused()?.shown;
  if (shown) visible.push(shown);
  return { root, jobs: backgroundJobs(all, visible, root) };
}

export class BackgroundJobsPopup {
  constructor(root, cx) {
    this.root = root;
    this.selected = null;
    this.handle = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.handle.focus();
  }

  close() {
    this.scroll.release();
  }

  peek(address) {
    // A job may finish or acquire a pane between rendering and clicking.
    if (!jobSnapshot(this.root).jobs.some((t) => t.address === address)) return;
    closeOverlay(props().overlay);
    openOverlay(jobPreviewSpec(address));
  }

  row(t, job) {
    const status = jobStatus(job);
    return h_flex().id(`background-job-${job.address}`).h(42).flex_none().px(8).gap(9).items_center().rounded(6).cursor_pointer()
      .when(job.address === this.selected, (el) => el.bg(t.selected))
      .hover((el) => el.bg(t.hover))
      .tooltip(`Peek at ${jobName(job)} (${job.address})`)
      .child(svg(`${ICONS}/terminal.svg`).size(14).flex_none().text_color(t.muted))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().child(jobName(job)))
        .child(div().text_size(10.5).text_color(t.dim).truncate().child(job.address)))
      .child(h_flex().flex_none().items_center().gap(5).text_size(11).text_color(t[status.color])
        .when(job.status === "working", (el) => el.child(svg(`${ICONS}/spinner.svg`).size(11).spin(900)))
        .child(status.label));
  }

  render() {
    const t = theme();
    const { jobs } = jobSnapshot(this.root);
    if (!jobs.some((job) => job.address === this.selected)) {
      this.selected = jobs[0]?.address ?? null;
      if (jobs.length) this.scroll.scroll_to_item(0);
    }
    // Let the native rounded frame paint the background. A square root fill
    // leaks past its corners because the host only clips rectangular bounds.
    return v_flex().id("background-jobs-popup").size_full().min_h(0).p(6)
      .text_size(12.5).text_color(t.foreground).track_focus(this.handle)
      .on_key_down((event, cx) => {
        if (event.key === "escape") closeOverlay(props().overlay);
        else if (event.key === "enter") { if (this.selected) this.peek(this.selected); }
        else if ((event.key === "up" || event.key === "down") && jobs.length) {
          const index = jobs.findIndex((job) => job.address === this.selected);
          const next = (index + (event.key === "down" ? 1 : jobs.length - 1)) % jobs.length;
          this.selected = jobs[next].address;
          this.scroll.scroll_to_item(next, "center");
          cx.notify();
        }
      })
      .child(jobs.length
        ? v_virtual_list("background-job-list", jobs.length, 44, (i) => jobs[i].address,
          ({ start, end }) => jobs.slice(start, end).map((job) => this.row(t, job)))
          // Popup content is intrinsically sized: flex alone gives a virtual
          // list no viewport. Keep a bounded, explicit height for its rows.
          .h(Math.min(jobs.length, 7) * 44).flex_none().track_scroll(this.scroll)
          .on_item_click((address) => this.peek(address))
        : div().h(44).flex_none().p(12).text_color(t.dim).child("No background jobs."));
  }
}
