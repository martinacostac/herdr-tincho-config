import { svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, run } from "herdr";

function find(node, id, visibleOnly = false) {
  if (!node || (visibleOnly && node.hidden)) return null;
  if (node.id === id) return node;
  let children = node.children ?? [];
  if (visibleOnly && node.type === "stack") {
    children = [children.find(child => child.id === node.active) ?? children[0]];
  }
  for (const child of children) {
    const found = find(child, id, visibleOnly);
    if (found) return found;
  }
  return null;
}

function toggle(child) {
  // Read at click time: a palette command may have changed the panel meanwhile.
  const tree = layout(), panel = find(tree, "panel"), stack = find(panel, "panel-body");
  if (!stack?.children?.some(node => node.id === child)) return;
  if (find(tree, child, true)) run("layout.hide", { id: "panel" });
  else {
    // Select first so opening Changes does not briefly initialize Files.
    run("layout.select", { stack: "panel-body", child });
    run("layout.show", { id: "panel" });
  }
}

export function panelButtons(t) {
  const tree = layout();
  return h_flex().id("panel-buttons").flex_none().gap(8).items_center()
    .children([["files", "Files", "files"], ["changes", "Changes", "git-compare"]].map(([id, label, icon]) => {
      const active = Boolean(find(tree, id, true));
      return h_flex().id(`panel-${id}`).flex_none().h(22).px(5).gap(5).items_center().rounded(4).cursor_pointer()
        .text_color(active ? t.accent : t.muted)
        .when(active, el => el.bg(t.accent + "18"))
        .hover(el => el.bg(t.hover).text_color(t.accent))
        .tooltip(`${active ? "Hide" : "Show"} ${label}`)
        .on_click(() => toggle(id))
        .child(svg(`mods/workspace-chrome/${icon}.svg`).size(13))
        .child(label);
    }));
}
