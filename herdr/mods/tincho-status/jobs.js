// Pure selectors: terminal addresses, not local IDs, identify jobs and parents.
const cleanTitle = (title = "") => (title ?? "").trim().replace(/^[^\p{L}\p{N}]+/u, "").trim();
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function jobName(terminal) {
  return terminal.name?.trim() || cleanTitle(terminal.title) || terminal.program?.name?.trim()
    || terminal.argv?.[0]?.split(/[\\/]/).pop() || terminal.address;
}

export function jobStatus(terminal) {
  switch (terminal.status) {
    case "blocked": return { label: "Needs you", color: "blocked" };
    case "error": return { label: "Error", color: "blocked" };
    case "working": return { label: "Working", color: "working" };
    case "done": return { label: "Done", color: "done" };
    case "idle": return { label: "Idle", color: "dim" };
    default: return terminal.program?.shell
      ? { label: "Shell", color: "dim" }
      : { label: "Running", color: "working" };
  }
}

export function backgroundJobs(all, visibleAddresses, root) {
  // Keep the first snapshot of each address, including finished ancestors.
  const terminals = new Map();
  for (const terminal of all) if (terminal.address && !terminals.has(terminal.address)) terminals.set(terminal.address, terminal);
  if (!root || !terminals.has(root)) return [];

  const children = new Map();
  for (const terminal of terminals.values()) {
    let parent = terminal.parent;
    if (!parent) continue;
    const slash = terminal.address.lastIndexOf("/");
    if (slash !== -1 && !parent.includes("/")) parent = terminal.address.slice(0, slash + 1) + parent;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(terminal);
  }

  const visible = new Set(visibleAddresses);
  const seen = new Set([root]);
  const queue = [root];
  const jobs = [];
  for (let i = 0; i < queue.length; i++) {
    for (const terminal of children.get(queue[i]) ?? []) {
      if (seen.has(terminal.address)) continue;
      seen.add(terminal.address);
      queue.push(terminal.address);
      if (terminal.state === "live" && !visible.has(terminal.address)) jobs.push(terminal);
    }
  }
  const priority = (terminal) => ({ blocked: 0, working: 1, done: 2, dim: 3 })[jobStatus(terminal).color];
  return jobs.sort((a, b) => priority(a) - priority(b)
    || compare(jobName(a), jobName(b))
    || compare(cleanTitle(a.title), cleanTitle(b.title))
    || compare(a.address, b.address));
}
