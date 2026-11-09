// A one-line box that sets a terminal's tag: the `tag` label herdr-core keeps
// on it, which the tab-tree sidebar shows as a chip after the row's name.
// Opened by tab-menu (the sidebar's right-click > Set tag…) as a dialog with
// props { terminal, value, name }.
// Enter or Save sets it, an empty box removes it, Esc cancels.
// Shaped like Herdr's own `prompt` mod, which can only run app commands.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { hc, props, closeOverlay, theme } from "herdr";

export const TAG = "tag";

export default class TagPrompt extends View {
  init(_props, cx) {
    this.text = props()?.value ?? "";
    this.input = InputState.new({ value: this.text });
    if (this.text) this.input.set_selected_range({ start: 0, end: this.text.length });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); cx.notify(); });
    this.input.on("submit", () => this.submit());
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  submit() {
    const p = props();
    closeOverlay(p.overlay);
    // `tag=` with nothing after it removes the label.
    hc(["label", p.terminal, `${TAG}=${this.text.trim()}`]).catch(() => null);
  }

  key(e, cx) {
    if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("tag-prompt").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(p.name ? `Tag ${p.name}` : "Tag"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child("Shown next to it in the sidebar. Empty removes it."))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button("tp-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("tp-save", "Save", true, () => this.submit())));
  }
}
