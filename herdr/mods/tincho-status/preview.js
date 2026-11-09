// Same temporary terminal composition as Herdr's terminal.peek, with an inset.
// GPUI overflow_hidden clips rectangles, not rounded corners: keep both the
// header's and terminal's square backgrounds inside the native frame's radius.
export function jobPreviewSpec(address) {
  return {
    kind: "dialog", width: 0.8, height: 0.8,
    layout: {
      type: "column", padding: 8,
      children: [
        { type: "block", size: { px: 34 }, content: { mod: "peek", props: { terminal: address } } },
        { type: "block", content: { terminal: address } },
      ],
    },
  };
}
