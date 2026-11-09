// The status bar of the tincho layout: the shipped workspace-status (machine,
// branch, agents, palette hint) plus the GitHub PR of the focused pane's branch:
// a link to it, where each review bot stands (CodeRabbit, Cursor, Copilot,
// SonarQube Cloud) and whether a person approved it or asked for changes.
//
// GitHub is reached only through `gh`, run in the pane's folder (on its machine):
//   gh pr view <branch> --json ...       the PR, its checks and all its reviews
//   gh api graphql (reviewThreads)       which bot's threads are still open
// A branch is looked up again when it changes and every REFRESH_MS while shown.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, panes, focused, theme, run, window, keys, exec, props, openOverlay, nextCommand, shared, setShared } from "herdr";
import { BackgroundJobsPopup, focusedJobRoot, jobSnapshot } from "./background-jobs.js";
import { panelButtons } from "./panel-buttons.js";

const ICONS = "mods/workspace-chrome";
const REFRESH_MS = 60000;
const PR_ENABLED_KEY = "tincho-status.pr-enabled";
const prEnabled = () => shared(PR_ENABLED_KEY) === true;

// Review bots by login, as resolve-ticket's watch-lib names them.
const BOTS = [
  [/^coderabbitai(\[bot\])?$/i, "coderabbit"],
  [/^(copilot-pull-request-reviewer|copilot)(\[bot\])?$/i, "copilot"],
  [/^cursor(\[bot\])?$/i, "cursor"],
  [/^sonarqubecloud(\[bot\])?$/i, "sonar"],
];
const botOf = (login = "") => BOTS.find(([re]) => re.test(login))?.[1] ?? (/\[bot\]$|^github-actions$/i.test(login) ? "bot" : null);

const THREADS = `query($owner:String!,$repo:String!,$pr:Int!){ repository(owner:$owner,name:$repo){ pullRequest(number:$pr){
  reviewThreads(first:100){ nodes{ isResolved comments(first:1){ nodes{ author{ login } } } } } } } }`;

// A pushed branch with no PR: the checks on its newest commit on GitHub, in
// statusCheckRollup's shape. Not pushed (or not on GitHub): [].
async function branchChecks(branch, cwd, on, current) {
  if (!current()) return [];
  const ref = encodeURIComponent(branch);
  const runs = await exec("gh", ["api", `repos/{owner}/{repo}/commits/${ref}/check-runs?per_page=100`], { cwd, on }).catch(() => null);
  if (!current() || runs?.code !== 0) return [];
  const up = (v) => String(v ?? "").toUpperCase();
  const out = [];
  try {
    for (const r of JSON.parse(runs.stdout).check_runs ?? []) out.push({ __typename: "CheckRun", name: r.name, status: up(r.status), conclusion: up(r.conclusion), startedAt: r.started_at });
  } catch { return []; }
  const st = await exec("gh", ["api", `repos/{owner}/{repo}/commits/${ref}/status`], { cwd, on }).catch(() => null);
  try {
    if (st?.code === 0) for (const c of JSON.parse(st.stdout).statuses ?? []) out.push({ __typename: "StatusContext", context: c.context, state: up(c.state), startedAt: c.updated_at });
  } catch { /* statuses are optional */ }
  return out;
}

async function lookup(branch, cwd, on, current) {
  if (!current()) return null;
  const view = await exec("gh", ["pr", "view", branch, "--json", "number,url,state,isDraft,author,statusCheckRollup,reviews"], { cwd, on });
  if (!current()) return null;
  if (view.code !== 0) return { none: true, checks: await branchChecks(branch, cwd, on, current) };
  const pr = JSON.parse(view.stdout);
  const [, owner, repo] = pr.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\//) ?? [];
  const open = {}; // source -> unresolved threads it started
  const openBy = {}; // person -> unresolved threads they started (sources other than bots)
  const q = await exec("gh", ["api", "graphql", "-f", `query=${THREADS}`, "-F", `owner=${owner}`, "-F", `repo=${repo}`, "-F", `pr=${pr.number}`], { cwd, on }).catch(() => null);
  if (q?.code === 0) {
    for (const t of JSON.parse(q.stdout).data?.repository?.pullRequest?.reviewThreads?.nodes ?? []) {
      if (t.isResolved) continue;
      const login = t.comments?.nodes?.[0]?.author?.login ?? "ghost";
      const src = botOf(login) ?? "human";
      open[src] = (open[src] ?? 0) + 1;
      if (src === "human") openBy[login] = (openBy[login] ?? 0) + 1;
    }
  }
  return { pr, open, openBy, threads: q?.code === 0 };
}

// The CI item: every check but the review bots', newest run per name; null when there are none.
function ciItem(checks) {
  // Skipped and neutral don't count.
  const latest = new Map();
  for (const c of checks) {
    const name = c.name ?? c.context ?? "";
    if (/coderabbit|sonar/i.test(name)) continue;
    const at = String(c.startedAt ?? c.completedAt ?? "");
    if (!latest.has(name) || at > latest.get(name).at) latest.set(name, { name, at, c });
  }
  const outcome = ({ c }) => {
    if (c.__typename === "StatusContext") return c.state === "PENDING" || c.state === "EXPECTED" ? "run" : c.state === "SUCCESS" ? "ok" : "fail";
    if (c.status && c.status !== "COMPLETED") return "run";
    if (["SUCCESS"].includes(c.conclusion)) return "ok";
    if (["SKIPPED", "NEUTRAL", "STALE", ""].includes(c.conclusion ?? "")) return "skip";
    return "fail";
  };
  const ci = [...latest.values()].map((x) => ({ name: x.name, st: outcome(x) })).filter((x) => x.st !== "skip");
  if (!ci.length) return null;
  const failed = ci.filter((x) => x.st === "fail").map((x) => x.name);
  const pending = ci.filter((x) => x.st === "run").map((x) => x.name);
  const passed = ci.length - failed.length - pending.length;
  if (failed.length) return { key: "ci", label: "CI", st: "warn", text: `${failed.length} failed`, tip: `Failed: ${failed.join(", ")}${pending.length ? ` · running: ${pending.join(", ")}` : ""}` };
  if (pending.length) return { key: "ci", label: "CI", st: "run", text: `${passed}/${ci.length}`, tip: `Running: ${pending.join(", ")}` };
  return { key: "ci", label: "CI", st: "ok", tip: `All ${ci.length} checks passed` };
}

// SonarQube Cloud's check, when the repo runs it; null otherwise.
function sonarItem(checks) {
  const run = (c) => c && !["COMPLETED", ""].includes(c.status ?? "COMPLETED") && !c.conclusion && c.state !== "SUCCESS" && c.state !== "FAILURE";
  const sq = checks.filter((c) => /sonar/i.test(c.name ?? c.context ?? "")).sort((a, b) => String(b.startedAt ?? "").localeCompare(String(a.startedAt ?? "")))[0];
  if (!sq) return null;
  const c = sq.conclusion || sq.state;
  if (run(sq)) return { key: "sonar", label: "Sonar", st: "run", tip: "Analyzing" };
  if (c === "SUCCESS") return { key: "sonar", label: "Sonar", st: "ok", tip: "Quality gate passed" };
  return { key: "sonar", label: "Sonar", st: "warn", tip: `Quality gate: ${String(c).toLowerCase()}` };
}

// One item's state: "run" (in progress), "ok", "warn" (needs work), "none" (hasn't run).
function summarize({ pr, open, openBy = {}, threads }) {
  const checks = pr.statusCheckRollup ?? [];
  const check = (re) => checks.find((c) => re.test(c.name ?? c.context ?? ""));
  const running = (c) => c && !["COMPLETED", ""].includes(c.status ?? "COMPLETED") && !c.conclusion && c.state !== "SUCCESS" && c.state !== "FAILURE";
  // A reviewer's standing is its last verdict; a plain comment posted after it
  // (CodeRabbit replying to a thread, say) doesn't change it. GitHub's
  // latestReviews keeps only the newest review, comment or not, so it can't be used.
  const reviews = (pr.reviews ?? []).slice().sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
  const VERDICT = ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"];
  const standing = (rs) => rs.filter((r) => VERDICT.includes(r.state)).at(-1)?.state ?? (rs.length ? "COMMENTED" : null);
  const review = (src) => standing(reviews.filter((r) => botOf(r.author?.login) === src));
  const threadNote = (n) => (threads ? `${n} open thread${n === 1 ? "" : "s"}` : "threads unknown");
  const items = [];

  const ci = ciItem(checks);
  if (ci) items.push(ci);

  const cr = check(/^coderabbit$/i), crr = review("coderabbit"), crn = open.coderabbit ?? 0;
  if (running(cr)) items.push({ key: "coderabbit", label: "CodeRabbit", st: "run", tip: "Reviewing" });
  else if (crn) items.push({ key: "coderabbit", label: "CodeRabbit", st: "warn", text: String(crn), tip: threadNote(crn) });
  else if (crr === "CHANGES_REQUESTED") items.push({ key: "coderabbit", label: "CodeRabbit", st: "warn", text: "changes", tip: "Changes requested and not approved since (no open threads)" });
  else if (crr || cr?.conclusion === "SUCCESS") items.push({ key: "coderabbit", label: "CodeRabbit", st: "ok", tip: crr === "APPROVED" ? "Approved" : "No open threads" });
  else items.push({ key: "coderabbit", label: "CodeRabbit", st: "none", tip: cr?.conclusion === "SKIPPED" ? "Skipped this PR" : "Hasn't reviewed" });

  for (const [src, label] of [["cursor", "Cursor"], ["copilot", "Copilot"]]) {
    const n = open[src] ?? 0;
    if (n) items.push({ key: src, label, st: "warn", text: String(n), tip: threadNote(n) });
    else if (review(src)) items.push({ key: src, label, st: "ok", tip: "Reviewed, no open threads" });
    else items.push({ key: src, label, st: "none", tip: "Hasn't reviewed" });
  }

  const sq = sonarItem(checks);
  if (sq) items.push(sq);


  const byPerson = new Map(); // people other than the PR's author, whose thread replies count as reviews
  for (const r of reviews) if (!botOf(r.author?.login) && r.author?.login !== pr.author?.login) byPerson.set(r.author.login, [...(byPerson.get(r.author.login) ?? []), r]);
  const people = [...byPerson].map(([login, rs]) => ({ login, state: standing(rs) }));
  const asked = people.filter((r) => r.state === "CHANGES_REQUESTED").map((r) => r.login);
  const approved = people.filter((r) => r.state === "APPROVED").map((r) => r.login);
  const hn = open.human ?? 0;
  // Open threads per person, most first, for the tooltip: "andrew: 7, GustavoEmmel: 3".
  const who = Object.entries(openBy).sort((a, b) => b[1] - a[1]).map(([login, n]) => `${login}: ${n}`).join(", ");
  const more = hn ? ` · ${threadNote(hn)}${who ? ` (${who})` : ""}` : "";
  const count = hn ? ` · ${hn} open` : "";
  if (asked.length) items.push({ key: "human", label: "Review", st: "warn", text: `changes${count}`, tip: `Changes requested by ${asked.join(", ")}${more}` });
  else if (approved.length) items.push({ key: "human", label: "Review", st: "ok", text: `approved${count}`, tip: `Approved by ${approved.join(", ")}${more}` });
  else items.push({ key: "human", label: "Review", st: "none", text: `${people.length ? "commented" : "none"}${count}`, tip: people.length ? `Comments from ${people.map((r) => r.login).join(", ")}${more}` : "No one has reviewed it yet" });
  return items;
}

export default class TinchoStatus extends View {
  init(_props, cx) {
    if (props()?.backgroundRoot) {
      this.jobsPopup = new BackgroundJobsPopup(props().backgroundRoot, cx);
      return;
    }
    this.cache = new Map(); // `${machine}|${cwd}|${branch}` -> { at, data } (data null while the first look runs)
    this.loading = new Set();
    this.prTasks = new Set();
    this.generation = 0;
    this.enabled = false;
    this.closed = false;
    this.syncPr(cx);
    this.commandTask = cx.spawn(async () => {
      while (!this.closed) {
        const command = await nextCommand();
        if (this.closed) return;
        if (command === "background-jobs") this.openJobs();
      }
    });
  }

  close() {
    this.closed = true;
    this.jobsPopup?.close();
    this.commandTask?.cancel();
    this.commandTask = null;
    if (this.prTasks) this.stopPr();
  }

  stopPr() {
    this.generation++;
    this.refreshTask?.cancel();
    this.refreshTask = null;
    for (const task of this.prTasks) task.cancel();
    this.prTasks.clear();
    this.loading.clear();
    this.cache.clear();
  }

  // Shared writes invalidate every live copy. Reconcile on each render as well
  // as clicks/ticks; never retain a callback's cx to synchronize another copy.
  syncPr(cx) {
    const enabled = !this.closed && prEnabled();
    if (enabled === this.enabled) return;
    this.stopPr();
    this.enabled = enabled;
    if (!enabled) return;
    this.refreshTask = cx.timer.every(REFRESH_MS, (cx) => {
      this.syncPr(cx);
      if (!this.enabled) return;
      this.pr(cx, spaces().find((s) => s.active), true);
      cx.notify();
    });
    this.pr(cx, spaces().find((s) => s.active));
  }

  openJobs() {
    const background = jobSnapshot(focusedJobRoot());
    if (!background.root) return;
    openOverlay({
      mod: "tincho-status", kind: "popup", at: "pointer", width: 420,
      height: 12 + Math.max(1, Math.min(background.jobs.length, 7)) * 44,
      props: { backgroundRoot: background.root },
    });
  }

  // The palette key as actually bound (from the shipped workspace-status).
  hint() {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  // The focused pane's PR, looked up when missing or older than REFRESH_MS.
  pr(cx, space, refresh = false) {
    if (!this.enabled || this.closed || !prEnabled()) return null;
    const f = focused();
    const p = f?.pane ? panes().find((x) => x.pane === f.pane) : null;
    if (!p?.cwd || !p.branch) return null;
    const on = space?.machine ?? null;
    const key = `${on ?? ""}|${p.cwd}|${p.branch}`;
    const hit = this.cache.get(key);
    if ((refresh || !hit || Date.now() - hit.at >= REFRESH_MS) && !this.loading.has(key)) {
      this.loading.add(key);
      if (!hit) this.cache.set(key, { at: Date.now(), data: null });
      const generation = this.generation;
      const current = () => !this.closed && this.enabled && prEnabled() && generation === this.generation;
      const task = cx.spawn(async (cx) => {
        try {
          if (!current()) return;
          const data = await lookup(p.branch, p.cwd, on, current).catch(() => hit?.data ?? { none: true });
          if (!current()) return;
          this.cache.set(key, { at: Date.now(), data });
          this.loading.delete(key);
          cx.notify();
        } finally {
          this.prTasks.delete(task);
        }
      });
      this.prTasks.add(task);
    }
    return { branch: p.branch, data: this.cache.get(key)?.data ?? null };
  }

  item(t, it) {
    const color = { run: t.working, ok: t.done, warn: t.blocked, none: t.dim }[it.st];
    const mark = it.st === "run"
      ? svg(`${ICONS}/spinner.svg`).size(11).text_color(color).spin(900)
      : it.st === "ok" ? svg(`${ICONS}/check.svg`).size(11).text_color(color)
      : div().size(6).rounded(3).bg(color);
    return h_flex().id(`pr-${it.key}`).gap(4).items_center().tooltip(`${it.label}: ${it.tip}`)
      .child(it.label)
      .child(mark)
      .when(Boolean(it.text), (el) => el.child(div().text_color(it.st === "warn" ? t.blocked : t.dim).child(it.text)));
  }

  prSection(t, info) {
    if (!info) return [];
    const { data } = info;
    if (!data) return [div().text_color(t.dim).child("PR…")];
    if (data.none) { // no PR: the pushed branch's CI, if it has any
      const found = [ciItem(data.checks ?? []), sonarItem(data.checks ?? [])].filter(Boolean);
      return found.length ? [div().text_color(t.dim).child("no PR"), ...found.map((it) => this.item(t, it))] : [];
    }
    const pr = data.pr;
    const state = pr.isDraft ? "draft" : pr.state === "OPEN" ? "" : pr.state.toLowerCase();
    const link = h_flex().id("pr-link").gap(5).items_center().cursor_pointer().text_color(t.foreground)
      .hover((el) => el.text_color(t.accent))
      .tooltip(`Open ${pr.url}`)
      .on_click(() => { exec("open", [pr.url]).catch(() => null); })
      .child(svg(`${ICONS}/git-compare.svg`).size(13))
      .child(`#${pr.number}`)
      .when(Boolean(state), (el) => el.child(div().text_color(t.dim).child(state)));
    return [link, ...summarize(data).map((it) => this.item(t, it))];
  }

  render(cx) {
    if (this.jobsPopup) return this.jobsPopup.render();
    const t = theme();
    const space = spaces().find((s) => s.active);
    const list = agents();
    const needs = list.filter((a) => a.status === "blocked").length;
    const background = jobSnapshot(focusedJobRoot());
    const jobNeeds = background.jobs.some((job) => job.status === "blocked" || job.status === "error");
    this.syncPr(cx);
    const info = this.pr(cx, space);
    const pane = panes().find((p) => p.pane === focused()?.pane);
    const branch = pane?.branch ?? space?.branch;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`${ICONS}/${icon}.svg`).size(13)).child(text);
    return h_flex().id("tincho-status").size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(branch), (el) => el.child(label("branch", branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, (el) => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .when(background.jobs.length > 0, (el) => el.child(h_flex().id("background-job-count").gap(6).items_center().cursor_pointer()
        .text_color(jobNeeds ? t.blocked : t.muted)
        .hover((el) => el.text_color(t.accent))
        .tooltip("Background jobs under the focused terminal · click to peek")
        .on_click(() => this.openJobs())
        .child(svg(`${ICONS}/terminal.svg`).size(13))
        .child(`${background.jobs.length} background ${background.jobs.length === 1 ? "job" : "jobs"}`)))
      .child(div().id("pr-toggle").cursor_pointer().text_color(prEnabled() ? t.accent : t.dim)
        .tooltip("Toggle GitHub PR, CI and reviews globally")
        .on_click((_event, cx) => {
          setShared(PR_ENABLED_KEY, !prEnabled());
          this.syncPr(cx);
          cx.notify();
        })
        .child(prEnabled() ? "PR on" : "PR off"))
      .child(h_flex().gap(12).items_center().children(this.prSection(t, info)))
      .child(div().flex_1())
      .child(panelButtons(t))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint()));
  }
}
