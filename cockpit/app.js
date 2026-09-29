import { createMarkdownEditor } from "./markdown-editor.js";

const els = {
  title: document.getElementById("pack-title"),
  going: document.getElementById("how-going"),
  next: document.getElementById("next-action"),
  hint: document.getElementById("next-hint"),
  graph: document.getElementById("pipeline-graph"),
  stageNav: document.getElementById("stage-nav"),
  viewDefine: document.getElementById("view-define"),
  viewSpec: document.getElementById("view-spec"),
  viewJudgment: document.getElementById("view-judgment"),
  viewImplement: document.getElementById("view-implement"),
  viewQa: document.getElementById("view-qa"),
  specStatus: document.getElementById("spec-status"),
  specSections: document.getElementById("spec-sections"),
  specFindings: document.getElementById("spec-findings"),
  judgmentBadge: document.getElementById("judgment-badge"),
  judgmentFindings: document.getElementById("judgment-findings"),
  implementStatus: document.getElementById("implement-status"),
  qaStatus: document.getElementById("qa-status"),
  implementActivity: document.getElementById("implement-activity"),
  qaActivity: document.getElementById("qa-activity"),
  qaTabs: document.getElementById("qa-tabs"),
  qaTabActivity: document.getElementById("qa-tab-activity"),
  qaTabReport: document.getElementById("qa-tab-report"),
  qaActivityLabel: document.getElementById("qa-activity-label"),
  qaActivityPanel: document.getElementById("qa-activity-panel"),
  qaReportPanel: document.getElementById("qa-report-panel"),
  proofReport: document.getElementById("proof-report"),
  actionReady: document.getElementById("action-ready"),
  actionBuild: document.getElementById("action-build"),
  actionBuildIgnore: document.getElementById("action-build-ignore"),
  actionBuildStop: document.getElementById("action-build-stop"),
  actionProof: document.getElementById("action-proof"),
  actionFixProof: document.getElementById("action-fix-proof"),
  ignoreDialog: document.getElementById("ignore-build-dialog"),
  ignoreYes: document.getElementById("ignore-build-yes"),
  ignoreNo: document.getElementById("ignore-build-no"),
  ignoreCancel: document.getElementById("ignore-build-cancel"),
  editor: document.getElementById("editor"),
  save: document.getElementById("save-state"),
  createBar: document.getElementById("create-bar"),
  newId: document.getElementById("new-id"),
  createNew: document.getElementById("create-new"),
  createError: document.getElementById("create-error"),
  homeBtn: document.getElementById("home-btn"),
  allRequirements: document.getElementById("all-requirements"),
  packHome: document.getElementById("pack-home"),
  packWorkspace: document.getElementById("pack-workspace"),
  packList: document.getElementById("pack-list"),
  packEmpty: document.getElementById("pack-empty"),
  packMenu: document.getElementById("pack-menu"),
  packMenuDelete: document.getElementById("pack-menu-delete"),
  deleteDialog: document.getElementById("delete-pack-dialog"),
  deleteCopy: document.getElementById("delete-pack-copy"),
  deleteCancel: document.getElementById("delete-pack-cancel"),
  deleteConfirm: document.getElementById("delete-pack-confirm"),
  stackGate: document.getElementById("stack-gate"),
  setupTitle: document.getElementById("setup-title"),
  setupCopy: document.getElementById("setup-copy"),
  codingSection: document.getElementById("coding-section"),
  stackSection: document.getElementById("stack-section"),
  stackBar: document.getElementById("stack-bar"),
  stackError: document.getElementById("stack-error"),
  stackNextjs: document.getElementById("stack-nextjs"),
  stackAmplify: document.getElementById("stack-amplify"),
  codingManual: document.getElementById("coding-manual"),
  codingCursor: document.getElementById("coding-cursor"),
  codingCopilot: document.getElementById("coding-copilot"),
  cockpitApp: document.getElementById("cockpit-app"),
  workspace: document.getElementById("view-define"),
  workspaceLabel: document.getElementById("workspace-label"),
  reviewActions: document.getElementById("review-actions"),
  reviewDiff: document.getElementById("review-diff"),
  reviewAccept: document.getElementById("review-accept"),
  reviewReject: document.getElementById("review-reject"),
};

let state = null;
let saveTimer;
let applying = false;

const markdownEditor = createMarkdownEditor(document.getElementById("editor"), {
  onChange: () => {
    if (applying) return;
    applying = true;
    els.save.textContent = "Saving…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void saveMarkdown();
    }, 280);
  },
});
let currentView = "define";
let defineOpen = true;
let focusedSection = "Business Rules";
let actionNotice = "";
let actionBusy = false;
let headerBusyLabel = "";
let implementLines = [];
let proveLines = [];
let lastImplementKey = "";
let lastProveKey = "";
let qaTab = "activity";
let loadInFlight = false;
let loadAgain = false;
let loadTimer;
let stateEpoch = 0;

function applyActivities(payload) {
  if (!payload) return;
  if (Array.isArray(payload.implementActivity)) implementLines = payload.implementActivity;
  if (Array.isArray(payload.proveActivity)) proveLines = payload.proveActivity;
}

function lastBusyMessage(kind) {
  const lines = kind === "prove" ? proveLines : implementLines;
  return lines[lines.length - 1]?.message ?? "";
}

function takeState(next) {
  stateEpoch += 1;
  state = next;
  applyActivities(state);
}

async function load() {
  if (loadInFlight) {
    loadAgain = true;
    return;
  }
  loadInFlight = true;
  const epoch = stateEpoch;
  try {
    const res = await fetch("/api/state", { signal: AbortSignal.timeout(8000) });
    const body = await res.json();
    if (epoch !== stateEpoch) return;
    state = body;
    applyActivities(state);
    render();
  } catch (err) {
    if (els.going) {
      els.going.hidden = false;
      els.going.textContent = err instanceof Error ? err.message : "Could not load the cockpit.";
    }
  } finally {
    loadInFlight = false;
    if (loadAgain) {
      loadAgain = false;
      void load();
    }
  }
}

function scheduleLoad() {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => {
    void load();
  }, 250);
}

let pendingCoding = null;

function recordedAdapter() {
  const repo = state?.productRepo;
  if (!repo?.implement) return "manual";
  if (repo.adapter === "copilot" || repo.adapter === "manual") return repo.adapter;
  return "cursor";
}

function adapterLabel(id) {
  if (id === "copilot") return "Copilot";
  if (id === "manual") return "Manual";
  return "Cursor";
}

function needsSetupGate(snapshot) {
  const repo = snapshot?.productRepo;
  if (!repo?.root) return false;
  if (repo.implement && repo.adapterRecorded === false) return true;
  return Boolean(repo.implement && repo.empty && !repo.recorded);
}

function renderSetupGate(snapshot) {
  const repo = snapshot?.productRepo;
  const needCoding = Boolean(repo?.implement && repo?.adapterRecorded === false);
  const needStack = Boolean(repo?.implement && repo?.empty && !repo?.recorded);
  const showStack = needStack && (!needCoding || Boolean(pendingCoding));
  els.codingSection?.classList.toggle("hidden", !needCoding);
  els.stackSection?.classList.toggle("hidden", !showStack);
  for (const btn of [els.codingManual, els.codingCursor, els.codingCopilot]) {
    if (!btn) continue;
    btn.classList.toggle("is-selected", btn.dataset.coding === pendingCoding);
    btn.disabled = false;
  }
  if (els.stackNextjs) els.stackNextjs.disabled = false;
  if (els.stackAmplify) els.stackAmplify.disabled = false;
  if (els.setupTitle) {
    els.setupTitle.textContent = needCoding ? "Set up this project" : "Choose a stack";
  }
  if (els.setupCopy) {
    els.setupCopy.textContent = needCoding
      ? "Req0 writes your choices to req0.json. You can change them later by editing that file."
      : "This product repo is empty and no stack is recorded yet. Pick one to continue. Amplify also writes a names-only .env.example if that file is missing.";
  }
}

function render() {
  const health = state.health;
  const packId = state.packId;
  const onHome = !packId;
  const packList = Array.isArray(state.packList) ? state.packList : [];
  els.title.textContent = packId ? `Requirement: ${packId.replaceAll("-", " ")}` : "Requirements";
  els.going.textContent = packId
    ? (health?.howThisIsGoing ?? "")
    : packList.length
      ? `${packList.length} requirement${packList.length === 1 ? "" : "s"}`
      : "Create a requirement pack to begin.";
  els.going.hidden = !els.going.textContent.trim();

  const action = health?.nextAction;
  const review = state.improveReview;
  if (review?.files?.length) actionNotice = "";
  const canStop = action?.id === "stop-implement";
  const nextEnabled = Boolean(action?.enabled) && !(actionBusy && !canStop && !review?.files?.length);
  const nextLabel =
    actionBusy && headerBusyLabel && !canStop && !review?.files?.length
      ? headerBusyLabel
      : action?.label ?? "Create a requirement";
  paintActionButton(els.next, {
    id: action?.id ?? "create",
    label: nextLabel,
    hint: review ? action?.hint || "" : actionNotice || action?.hint || "",
    enabled: nextEnabled,
    primary: true,
    hidden: false,
  });
  setStageButtons(health, action?.id);

  const gated = needsSetupGate(state);
  els.stackGate?.classList.toggle("hidden", !gated);
  els.cockpitApp?.classList.toggle("hidden", gated);
  els.next.hidden = gated || onHome;
  els.packHome?.classList.toggle("hidden", !onHome);
  els.packWorkspace?.classList.toggle("hidden", onHome);
  els.allRequirements?.classList.toggle("hidden", onHome);
  els.createBar?.classList.toggle("hidden", !onHome);
  if (!onHome) hidePackMenu();
  if (els.hint) els.hint.hidden = true;
  if (gated) {
    renderSetupGate(state);
    return;
  }

  renderPackList(packList);

  if (onHome) return;

  if (review && currentView !== "define") currentView = "define";
  if (currentView === "implement" && health?.build?.owned === false) currentView = "define";

  if (!applying && !state.improveReview) {
    applying = true;
    markdownEditor.setValue(state.markdown ?? "");
    applying = false;
  }

  renderPipeline();
  renderStageNav();
  showView(currentView);
  renderReview();
  renderSpecPane();
  renderJudgmentPane();
  renderRunStatus();
  renderProofReport();
  renderQaLayout();
  renderActivity();
}

function renderPackList(items) {
  if (!els.packList) return;
  const signature = JSON.stringify(items);
  els.packEmpty?.classList.toggle("hidden", items.length > 0);
  if (els.packList.dataset.sig === signature) return;
  hidePackMenu();
  els.packList.dataset.sig = signature;
  els.packList.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pack-row";
    btn.dataset.id = item.id;
    const copy = document.createElement("span");
    copy.className = "pack-row-copy";
    const title = document.createElement("strong");
    title.textContent = item.title || item.id;
    const id = document.createElement("span");
    id.className = "pack-row-id";
    id.textContent = item.id;
    copy.append(title, id);
    const meters = document.createElement("span");
    meters.className = "pack-row-meters";
    for (const meter of item.meters ?? []) {
      const chip = document.createElement("span");
      chip.className = "pack-meter";
      chip.dataset.tone = meter.tone ?? "idle";
      const name = document.createElement("span");
      name.className = "pack-meter-name";
      name.textContent = meter.label;
      chip.append(name, document.createTextNode(meter.badge ?? ""));
      meters.append(chip);
    }
    btn.append(copy, meters);
    btn.addEventListener("click", () => {
      hidePackMenu();
      void selectPack(item.id);
    });
    btn.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showPackMenu(event, item);
    });
    li.append(btn);
    els.packList.append(li);
  }
}

let pendingDelete = null;

function hidePackMenu() {
  if (!els.packMenu) return;
  els.packMenu.classList.add("hidden");
  els.packMenu.hidden = true;
}

function showPackMenu(event, item) {
  if (!els.packMenu) return;
  pendingDelete = item;
  els.packMenu.classList.remove("hidden");
  els.packMenu.hidden = false;
  els.packMenu.style.left = `${event.clientX}px`;
  els.packMenu.style.top = `${event.clientY}px`;
  const rect = els.packMenu.getBoundingClientRect();
  const left = Math.min(event.clientX, window.innerWidth - rect.width - 8);
  const top = Math.min(event.clientY, window.innerHeight - rect.height - 8);
  els.packMenu.style.left = `${Math.max(8, left)}px`;
  els.packMenu.style.top = `${Math.max(8, top)}px`;
  els.packMenuDelete?.focus({ preventScroll: true });
}

function openDeleteDialog() {
  hidePackMenu();
  if (!pendingDelete || !els.deleteDialog) return;
  const name = pendingDelete.title || pendingDelete.id;
  if (els.deleteCopy) {
    els.deleteCopy.textContent = `Delete “${name}”? The pack folder is removed from this repo.`;
  }
  els.deleteDialog.showModal();
}

let deletingPack = false;

async function confirmDeletePack() {
  const item = pendingDelete;
  if (!item?.id || deletingPack) return;
  deletingPack = true;
  if (els.deleteConfirm) els.deleteConfirm.disabled = true;
  els.deleteDialog?.close();
  try {
    const res = await fetch("/api/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id }),
    });
    const body = await res.json();
    if (!res.ok) {
      if (els.createError) els.createError.textContent = body.error ?? "Could not delete that requirement.";
      return;
    }
    pendingDelete = null;
    takeState(body);
    currentView = "define";
    actionNotice = "";
    render();
  } finally {
    deletingPack = false;
    if (els.deleteConfirm) els.deleteConfirm.disabled = false;
  }
}

async function selectPack(id) {
  const res = await fetch("/api/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const body = await res.json();
  if (!res.ok) {
    if (els.going) els.going.textContent = body.error ?? "Could not open that requirement.";
    return;
  }
  takeState(body);
  currentView = "define";
  qaTab = "activity";
  actionNotice = "";
  render();
}

async function goHome() {
  if (!state?.packId) return;
  const res = await fetch("/api/home", { method: "POST" });
  const body = await res.json();
  if (!res.ok) {
    if (els.going) els.going.textContent = body.error ?? "Could not return to the list.";
    return;
  }
  takeState(body);
  currentView = "define";
  qaTab = "activity";
  actionNotice = "";
  render();
}

function renderReview() {
  const review = state.improveReview;
  const reviewing = Boolean(review);
  const hasDiff = Boolean(review?.files?.length);
  els.workspace?.classList.toggle("is-review", reviewing);
  markdownEditor.setHidden(reviewing);
  if (els.save) els.save.classList.toggle("hidden", reviewing);
  if (!els.reviewActions || !els.reviewDiff) return;
  els.reviewActions.classList.toggle("hidden", !reviewing);
  els.reviewDiff.classList.toggle("hidden", !reviewing);
  els.reviewDiff.hidden = !reviewing;
  if (els.workspaceLabel) {
    els.workspaceLabel.textContent = hasDiff ? "Improve patch" : reviewing ? "Waiting for the patch" : "requirement.md";
  }
  const lintOk = review?.lint?.ok !== false;
  paintActionButton(els.reviewAccept, {
    id: "review-improve",
    label: "Accept",
    hint: lintOk ? "Apply the Improve patch to requirement.md." : (review?.lint?.messages ?? []).join(" "),
    enabled: hasDiff && lintOk && !actionBusy,
    primary: true,
    hidden: !reviewing,
  });
  paintActionButton(els.reviewReject, {
    id: "reject-improve",
    label: "Reject",
    hint: "Restore the snapshot and discard the patch.",
    enabled: reviewing && !actionBusy,
    primary: false,
    hidden: !reviewing,
  });
  if (!reviewing) {
    els.reviewDiff.innerHTML = "";
    return;
  }
  if (!hasDiff) {
    els.reviewDiff.innerHTML = `<p class="review-waiting">The writer has the brief. This updates when requirement.md or fixtures/personas.yaml changes.</p>`;
    return;
  }
  const lint = !lintOk
    ? `<p class="review-waiting review-lint">${(review.lint.messages ?? [])
        .map((message) => escapeHtml(message))
        .join("<br />")}</p>`
    : "";
  els.reviewDiff.innerHTML = `${lint}${review.files.map(renderReviewFile).join("")}`;
}

function renderReviewFile(file) {
  const hunks = (file.hunks ?? []).map(renderHunk).join("");
  return `<article class="review-file">
    <header class="review-file-head">
      <span class="review-file-name">${escapeHtml(file.relative)}</span>
      <span class="review-file-stat">${escapeHtml(file.status)} <span class="add">+${file.additions ?? 0}</span> <span class="del">−${file.deletions ?? 0}</span></span>
    </header>
    <table class="diff-table">${hunks}</table>
  </article>`;
}

function renderHunk(hunk) {
  const rows = (hunk.lines ?? [])
    .map((line) => {
      const kind = line.kind === "add" ? "diff-add" : line.kind === "del" ? "diff-del" : "";
      const mark = line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
      return `<tr class="${kind}">
        <td class="diff-gutter">${line.oldNo ?? ""}</td>
        <td class="diff-gutter">${line.newNo ?? ""}</td>
        <td class="diff-code">${escapeHtml(mark + line.text)}</td>
      </tr>`;
    })
    .join("");
  return `<tr class="diff-hunk"><td class="diff-gutter"></td><td class="diff-gutter"></td><td class="diff-code">${escapeHtml(hunk.header)}</td></tr>${rows}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function iconSvg(paths) {
  return `<svg viewBox="0 0 16 16" aria-hidden="true">${paths}</svg>`;
}

function actionGlyph(id, label = "") {
  if (id === "create") {
    return iconSvg(
      `<path d="M8 3.2v9.6M3.2 8h9.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
    );
  }
  if (id === "fix-spec") {
    return iconSvg(
      `<path d="M3.2 12.8 6 12l6.4-6.4a1.6 1.6 0 0 0-2.2-2.2L3.8 9.8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
    );
  }
  if (id === "check-jev") {
    return iconSvg(
      `<circle cx="7.2" cy="7.2" r="3.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m9.8 9.8 3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
    );
  }
  if (id === "improve") {
    return iconSvg(
      `<path d="M8 2.6 9 6l3.4 1L9 8l-1 3.4L7 8 3.6 7 7 6zM12.4 10.2l.5 1.6 1.6.5-1.6.5-.5 1.6-.5-1.6-1.6-.5 1.6-.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>`,
    );
  }
  if (id === "review-improve") {
    return iconSvg(
      `<path d="M2.8 8.2 6.1 11.4 13.2 4.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  }
  if (id === "reject-improve" || id === "stop-implement") {
    return id === "stop-implement"
      ? iconSvg(`<rect x="4.2" y="4.2" width="7.6" height="7.6" rx="1.2" fill="currentColor"/>`)
      : iconSvg(
          `<path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
        );
  }
  if (id === "implement") {
    return /rebuild/i.test(label)
      ? iconSvg(
          `<path d="M12.6 8A4.6 4.6 0 1 1 10.2 4.1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M10 2.6v2.6h2.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
        )
      : iconSvg(
          `<path d="M5.2 3.6v8.8L13 8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
        );
  }
  if (id === "ignore-build") {
    return iconSvg(
      `<path d="M3.2 4.4 8 8l-4.8 3.6zM8.8 4.4 13.6 8l-4.8 3.6z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
    );
  }
  if (id === "prove") {
    return iconSvg(
      `<path d="M5.2 2.8h5.6L9.2 8.2v4.2l-2.4 1V8.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
    );
  }
  if (id === "fix-from-proof") {
    return iconSvg(
      `<path d="M10.6 3.4a2.2 2.2 0 0 1 2 2.1c0 .6-.2 1.1-.6 1.5L7.4 11.6 4.4 12.6l1-3 4.6-4.6c.4-.4.9-.6 1.5-.6z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>`,
    );
  }
  return iconSvg(
    `<circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="1.5"/>`,
  );
}

function paintActionButton(btn, { id, label, hint, enabled, primary, hidden }) {
  if (!btn) return;
  btn.hidden = Boolean(hidden);
  btn.classList.toggle("hidden", Boolean(hidden));
  if (hidden) return;
  btn.disabled = false;
  btn.dataset.enabled = enabled ? "1" : "0";
  btn.dataset.action = id ?? "";
  if (hint) btn.dataset.hint = hint;
  else delete btn.dataset.hint;
  btn.removeAttribute("title");
  btn.setAttribute("aria-disabled", enabled ? "false" : "true");
  btn.setAttribute("aria-label", hint ? `${label}. ${hint}` : label);
  btn.classList.toggle("is-disabled", !enabled);
  btn.classList.toggle("cta-primary", Boolean(primary && enabled));
  btn.classList.toggle("cta-danger", id === "reject-improve");
  btn.innerHTML = `${actionGlyph(id, label)}<span>${escapeHtml(label)}</span>`;
}

function setActionHint(message) {
  if (els.next) {
    if (message) els.next.dataset.hint = message;
    else delete els.next.dataset.hint;
  }
}

function setMeter() {
  renderPipeline();
}

function readyLabel(ready) {
  if (!ready) return "Not yet";
  const status = ready.state === "blocked" ? "Blocked" : ready.state === "ready" ? "Clear" : "Not yet";
  if (ready.jevCurrent && typeof ready.packNoul === "number") {
    return `${status} · ${Number(ready.packNoul).toFixed(2)}`;
  }
  return status;
}

function setStageButtons(health, primaryId) {
  setStageButton(els.actionReady, health?.stages?.ready, primaryId);
  setStageButton(els.actionBuild, health?.stages?.build, primaryId);
  setStageButton(els.actionBuildIgnore, health?.stages?.ignoreBuild, primaryId);
  setStageButton(els.actionBuildStop, health?.stages?.stopImplement, primaryId);
  setStageButton(els.actionProof, health?.stages?.proof, primaryId);
  setStageButton(els.actionFixProof, health?.stages?.fixFromProof, primaryId);
  hideEmptyWorkspaceHeads();
}

function showView(view) {
  currentView = view;
  if (view === "spec" || view === "judgment") defineOpen = true;
  const views = {
    define: els.viewDefine,
    spec: els.viewSpec,
    judgment: els.viewJudgment,
    implement: els.viewImplement,
    qa: els.viewQa,
  };
  for (const [id, pane] of Object.entries(views)) {
    if (!pane) continue;
    const on = id === view;
    pane.classList.toggle("hidden", !on);
    pane.hidden = !on;
  }
}

function renderPipeline() {
  if (!els.graph) return;
  const pipeline = state?.pipeline;
  const nodes = (pipeline?.nodes ?? []).filter((node) => !node.hidden);
  const signature = nodes
    .map((node) => {
      const kids = (node.id === "define" ? defineChildren(node) : [])
        .map((child) => `${child.id}|${child.tone}|${child.badge ?? ""}|${currentView === child.view ? "1" : "0"}`)
        .join(",");
      return `${node.id}|${node.tone}|${node.badge ?? ""}|${currentView === node.view ? "1" : "0"}|${kids}`;
    })
    .join(";");
  if (els.graph.dataset.sig === signature) {
    paintPipelineRails();
    return;
  }
  els.graph.dataset.sig = signature;
  els.graph.innerHTML = "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("pipeline-svg");
  svg.setAttribute("aria-hidden", "true");
  els.graph.append(svg);
  const trunk = document.createElement("div");
  trunk.className = "pipeline-trunk";
  nodes.forEach((node) => {
    const col = document.createElement("div");
    col.className = "pipeline-col";
    col.dataset.id = node.id;
    col.append(makeGraphNode(node, node.id === "start" || node.id === "end"));
    const children = node.id === "define" ? defineChildren(node) : [];
    if (children.length) {
      col.classList.add("has-children");
      const branch = document.createElement("div");
      branch.className = "pipeline-branch";
      for (const child of children) {
        branch.append(makeGraphNode(child, false));
      }
      col.append(branch);
    }
    trunk.append(col);
  });
  els.graph.append(trunk);
  requestAnimationFrame(paintPipelineRails);
}

function paintPipelineRails() {
  const graph = els.graph;
  if (!graph) return;
  const svg = graph.querySelector(".pipeline-svg");
  if (!svg) return;
  const box = graph.getBoundingClientRect();
  const width = Math.max(1, Math.round(graph.clientWidth));
  const height = Math.max(1, Math.round(graph.clientHeight));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  const center = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 - box.left + graph.scrollLeft,
      y: r.top + r.height / 2 - box.top + graph.scrollTop,
    };
  };
  const trunkDots = [...graph.querySelectorAll(".pipeline-col > .pipeline-node .pipeline-node-dot")];
  const lines = [];
  if (trunkDots.length >= 2) {
    const first = center(trunkDots[0]);
    const last = center(trunkDots[trunkDots.length - 1]);
    lines.push(`<line x1="${first.x}" y1="${first.y}" x2="${last.x}" y2="${last.y}" />`);
  }
  const defineDot = graph.querySelector('.pipeline-node[data-id="define"] .pipeline-node-dot');
  const childDots = [...graph.querySelectorAll(".pipeline-branch .pipeline-node-dot")];
  if (defineDot && childDots.length) {
    const parent = center(defineDot);
    for (const kid of childDots.map(center)) {
      const midY = parent.y + (kid.y - parent.y) / 2;
      lines.push(
        `<path d="M ${parent.x} ${parent.y} C ${parent.x} ${midY}, ${kid.x} ${midY}, ${kid.x} ${kid.y}" />`,
      );
    }
  }
  svg.innerHTML = lines.join("");
}

function makeGraphNode(node, terminal) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `pipeline-node${terminal ? " is-terminal" : ""}`;
  btn.dataset.tone = node.tone;
  btn.dataset.view = node.view;
  btn.dataset.id = node.id;
  btn.classList.toggle("is-active", currentView === node.view && node.id !== "start" && node.id !== "end");
  btn.title = node.badge ? `${node.label} — ${node.badge}` : node.label;
  btn.innerHTML = `<span class="pipeline-node-label">${escapeHtml(node.label)}</span><span class="pipeline-node-dot">${toneGlyph(node.tone, node.mark)}</span>`;
  btn.addEventListener("click", () => {
    if (node.id === "start" && !state?.packId) {
      els.createBar?.classList.remove("hidden");
      els.newId?.focus();
      return;
    }
    showView(node.view);
    renderStageNav();
    renderPipeline();
  });
  return btn;
}

function defineChildren(node) {
  if (node?.children?.length) return node.children;
  const specState = state?.health?.spec?.state ?? "empty";
  const ready = state?.health?.ready;
  const specTone =
    specState === "empty" ? "idle" : specState === "drafting" ? "draft" : specState === "valid" ? "ok" : "draft";
  const specBadge =
    specState === "empty" ? "Empty" : specState === "drafting" ? "Drafting" : specState === "valid" ? "Valid" : specState;
  const judgmentTone =
    ready?.state === "blocked" ? "bad" : ready?.state === "ready" ? "ok" : specState === "valid" ? "draft" : "idle";
  return [
    { id: "spec", label: "Spec", view: "spec", tone: specTone, badge: specBadge },
    {
      id: "judgment",
      label: "Judgment",
      view: "judgment",
      tone: judgmentTone,
      badge: ready ? readyLabel(ready) : "Not yet",
      mark: judgmentTone === "bad" ? "block" : undefined,
    },
  ];
}

function toneGlyph(tone, mark) {
  if (tone === "ok") {
    return `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.4 6.3 4.9 8.7 9.6 3.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if (tone === "bad" && mark === "block") {
    return `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 6h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  }
  if (tone === "bad") {
    return `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.2 3.2 8.8 8.8M8.8 3.2 3.2 8.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  }
  return "";
}

function renderStageNav() {
  if (!els.stageNav) return;
  const owned = state?.pipeline?.implementOwned !== false && state?.health?.build?.owned !== false;
  const byId = Object.fromEntries((state?.pipeline?.nodes ?? []).map((node) => [node.id, node]));
  const defineKids = defineChildren(byId.define);
  const items = [
    {
      view: "define",
      label: "Define",
      child: false,
      tone: byId.define?.tone ?? "idle",
      badge: byId.define?.badge,
      mark: byId.define?.mark,
    },
    ...defineKids.map((child) => ({
      view: child.view,
      label: child.label,
      child: true,
      tone: child.tone,
      badge: child.badge,
      mark: child.mark,
    })),
    ...(owned
      ? [
          {
            view: "implement",
            label: "Implement",
            child: false,
            tone: byId.implement?.tone ?? "idle",
            badge: byId.implement?.badge,
            mark: byId.implement?.mark,
          },
        ]
      : []),
    { view: "qa", label: "QA", child: false, tone: byId.qa?.tone ?? "idle", badge: byId.qa?.badge, mark: byId.qa?.mark },
  ];
  const signature = items
    .map(
      (item) =>
        `${item.view}|${item.child ? "1" : "0"}|${item.tone}|${item.mark ?? ""}|${item.badge ?? ""}|${currentView === item.view ? "1" : "0"}`,
    )
    .join(";") + `|define:${defineOpen ? "1" : "0"}`;
  if (els.stageNav.dataset.sig === signature) return;
  els.stageNav.dataset.sig = signature;
  els.stageNav.innerHTML = "";
  for (const item of items) {
    if (item.child && !defineOpen) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `nav-item${item.child ? " stage-nav-child" : ""}`;
    btn.dataset.tone = item.tone;
    btn.classList.toggle("active", currentView === item.view);
    if (item.view === "define") {
      btn.classList.toggle("is-open", defineOpen);
      btn.setAttribute("aria-expanded", defineOpen ? "true" : "false");
    }
    btn.innerHTML = `<span class="nav-mark">${toneGlyph(item.tone, item.mark)}</span><span class="nav-name">${escapeHtml(item.label)}</span>${
      item.badge ? `<span class="nav-badge">${escapeHtml(item.badge)}</span>` : ""
    }${item.view === "define" ? `<span class="nav-chevron" aria-hidden="true"></span>` : ""}`;
    btn.addEventListener("click", (event) => {
      if (item.view === "define" && event.target.closest(".nav-chevron")) {
        defineOpen = !defineOpen;
        renderStageNav();
        return;
      }
      if (item.view === "spec" || item.view === "judgment") defineOpen = true;
      showView(item.view);
      renderStageNav();
      renderPipeline();
    });
    els.stageNav.append(btn);
  }
}

function setStageButton(btn, action, primaryId) {
  const keepEnabled = action?.id === "stop-implement";
  paintActionButton(btn, {
    id: action?.id,
    label: action?.label ?? "",
    hint: action?.hint ?? "",
    enabled: Boolean(action?.enabled) && (!actionBusy || keepEnabled),
    primary: Boolean(action?.enabled && action.id === primaryId),
    hidden: !action || action.hidden,
  });
}

function headingPresent(markdown, name) {
  return new RegExp(`^##\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(markdown);
}

function statusIcon(name) {
  if (name === "clock") {
    return `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 5.2v3.1l2.1 1.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  }
  if (name === "compile") {
    return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 2.6h5.2L12 5.2v8.2H4.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M9.2 2.6v2.8H12M6 8.2h4.2M6 10.6h3.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
  }
  if (name === "list") {
    return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 4.4h9.6M3.2 8h9.6M3.2 11.6h6.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  }
  if (name === "monitor") {
    return `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.4" y="3.2" width="11.2" height="7.4" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6.2 13h3.6M8 10.6V13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
  }
  return `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
}

function statusMark(tone, mark) {
  const glyph = toneGlyph(tone, mark);
  return glyph || `<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="3.4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
}

function renderStatusBar(el, { tone, title, items, mark }) {
  if (!el) return;
  const meta = items.filter((item) => item?.text);
  const sig = `${tone}|${mark ?? ""}|${title}|${meta.map((item) => `${item.icon}:${item.text}`).join(";")}`;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.dataset.tone = tone;
  el.innerHTML = `<span class="status-bar-lead"><span class="status-bar-mark">${statusMark(tone, mark)}</span><span class="status-bar-title">${escapeHtml(
    title,
  )}</span></span><span class="status-bar-meta">${meta
    .map(
      (item) =>
        `<span class="status-bar-item"><span class="status-bar-icon">${statusIcon(item.icon)}</span><span>${escapeHtml(
          item.text,
        )}</span></span>`,
    )
    .join("")}</span>`;
}

function hideEmptyWorkspaceHeads() {
  for (const head of document.querySelectorAll(".workspace-head")) {
    const actions = head.querySelector(".stage-actions");
    if (!actions) continue;
    const visible = [...actions.querySelectorAll("button")].some((btn) => !btn.hidden);
    actions.classList.toggle("hidden", !visible);
    if (!head.querySelector(".editor-label")) head.classList.toggle("hidden", !visible);
  }
}

function renderSpecPane() {
  if (!els.specSections) return;
  const markdown = state?.markdown ?? markdownEditor.getValue();
  const spec = state?.health?.spec;
  const findings = spec?.findings ?? [];
  const specState = spec?.state ?? "empty";
  const label = specState === "valid" ? "Valid" : specState === "drafting" ? "Drafting" : "Empty";
  const specTone =
    specState === "valid" ? "ok" : findings.some((f) => f.severity === "error") ? "bad" : specState === "drafting" ? "draft" : "idle";
  renderStatusBar(els.specStatus, {
    tone: specTone,
    title: "Spec",
    items: [
      { icon: "clock", text: label },
      { icon: "compile", text: "compile" },
      {
        icon: "list",
        text: findings.length
          ? `${findings.length} finding${findings.length === 1 ? "" : "s"}`
          : "No findings",
      },
    ],
  });
  const catalog = state?.sections ?? [];
  els.specSections.innerHTML = "";
  for (const section of catalog) {
    const present = headingPresent(markdown, section.name);
    const errored = findings.some((f) => f.message.includes(section.name));
    const status = errored ? "error" : present ? "present" : "missing";
    const li = document.createElement("li");
    li.className = "list-row spec-section";
    li.dataset.status = status;
    li.innerHTML = `<div class="spec-section-head"><span class="spec-section-name">${escapeHtml(section.name)}</span><span class="spec-section-mark">${status}</span></div><p class="spec-section-purpose">${escapeHtml(section.purpose)}${section.required ? " Required." : " Optional."}</p>`;
    li.addEventListener("click", () => {
      focusedSection = section.name;
      openDefine();
      jumpToSection(section.name);
    });
    els.specSections.append(li);
  }

  if (!els.specFindings) return;
  els.specFindings.innerHTML = "";
  if (!findings.length) {
    const li = document.createElement("li");
    li.className = "list-row list-row-ok";
    li.textContent = specState === "valid" ? "Grammar is valid." : "No compile findings.";
    els.specFindings.append(li);
    return;
  }
  for (const f of findings) {
    const li = document.createElement("li");
    li.className = "list-row list-row-bad";
    li.textContent = f.line ? `L${f.line} ${f.message}` : f.message;
    if (f.line) {
      li.addEventListener("click", () => {
        openDefine();
        jumpToLine(f.line);
      });
    }
    els.specFindings.append(li);
  }
}

function renderJudgmentPane() {
  const ready = state?.health?.ready;
  const judgmentTone =
    ready?.state === "blocked" ? "bad" : ready?.state === "ready" ? "ok" : state?.health?.spec?.state === "valid" ? "draft" : "idle";
  const blockers = ready?.blockers ?? 0;
  const nits = ready?.nits ?? 0;
  renderStatusBar(els.judgmentBadge, {
    tone: judgmentTone,
    mark: judgmentTone === "bad" ? "block" : undefined,
    title: "Judgment",
    items: [
      { icon: "clock", text: readyLabel(ready) },
      ...(ready && (blockers || nits)
        ? [{ icon: "list", text: `${blockers} blocker${blockers === 1 ? "" : "s"}, ${nits} nit${nits === 1 ? "" : "s"}` }]
        : [{ icon: "list", text: ready?.state === "ready" ? "No findings" : "Not checked" }]),
    ],
  });
  if (!els.judgmentFindings) return;
  const findings = state?.health?.ready?.findings ?? [];
  els.judgmentFindings.innerHTML = "";
  if (!findings.length) {
    const li = document.createElement("li");
    li.className = "list-row list-row-ok";
    li.textContent = state?.health?.ready?.state === "ready" ? "Clear. No Judgment findings." : "No Judgment findings yet. Check when Spec is valid.";
    els.judgmentFindings.append(li);
    return;
  }
  for (const f of findings) {
    const li = document.createElement("li");
    li.className = f.severity === "blocker" ? "list-row list-row-bad" : "list-row list-row-nit";
    li.textContent = f.specId ? `${f.specId} — ${f.message}` : f.message;
    li.addEventListener("click", () => {
      openDefine();
      if (f.line) jumpToLine(f.line);
      else jumpToSpecId(f.specId);
    });
    els.judgmentFindings.append(li);
  }
}

function renderRunStatus() {
  const build = state?.health?.build;
  const buildLabel =
    build?.state === "running"
      ? "Implementing"
      : build?.state === "succeeded"
        ? "Succeeded"
        : build?.state === "failed"
          ? "Failed"
          : build?.state === "stale"
            ? "Stale"
            : "Not yet";
  const buildTone =
    build?.state === "succeeded"
      ? "ok"
      : build?.state === "failed"
        ? "bad"
        : build?.state === "running"
          ? "progress"
          : build?.state === "stale"
            ? "draft"
            : "idle";
  renderStatusBar(els.implementStatus, {
    tone: buildTone,
    mark: buildTone === "bad" ? "fail" : undefined,
    title: "Implement",
    items: [
      { icon: "clock", text: buildLabel },
      ...(build?.ignored ? [{ icon: "list", text: "Ignored" }] : []),
      ...(build?.adapter ? [{ icon: "monitor", text: adapterLabel(build.adapter) }] : []),
    ],
  });

  const proof = state?.health?.proof;
  const proofLabel =
    proof?.state === "passed"
      ? "Passed"
      : proof?.state === "failed"
        ? "Failed"
        : proof?.state === "needs_review"
          ? "Needs review"
          : proof?.state === "stale"
            ? "Stale"
            : "Not yet";
  const proofTone =
    proof?.state === "passed"
      ? "ok"
      : proof?.state === "failed"
        ? "bad"
        : proof?.state === "needs_review" || proof?.state === "stale"
          ? "draft"
          : "idle";
  const counts = [];
  if (typeof proof?.passed === "number") counts.push(`${proof.passed} passed`);
  if (typeof proof?.failed === "number" && proof.failed) counts.push(`${proof.failed} failed`);
  if (typeof proof?.review === "number" && proof.review) counts.push(`${proof.review} review`);
  renderStatusBar(els.qaStatus, {
    tone: proofTone,
    mark: proofTone === "bad" ? "fail" : undefined,
    title: "QA",
    items: [
      { icon: "clock", text: proofLabel },
      { icon: "list", text: counts.length ? counts.join(", ") : proof?.runtime ? "runtime ready" : "No runtime" },
    ],
  });
}

function renderProofReport() {
  if (!els.proofReport) return;
  const report = state?.proofReport?.trim();
  if (!report) {
    els.proofReport.innerHTML = "";
    return;
  }
  els.proofReport.className = "proof-report md-preview";
  els.proofReport.innerHTML = renderProofMarkdown(report);
}

function renderQaLayout() {
  const hasReport = Boolean(state?.proofReport?.trim());
  if (!hasReport) qaTab = "activity";
  els.qaTabs?.classList.toggle("hidden", !hasReport);
  if (els.qaTabs) els.qaTabs.hidden = !hasReport;
  els.qaActivityLabel?.classList.toggle("hidden", hasReport);
  const showReport = hasReport && qaTab === "report";
  els.qaActivityPanel?.classList.toggle("hidden", showReport);
  if (els.qaActivityPanel) els.qaActivityPanel.hidden = showReport;
  els.qaReportPanel?.classList.toggle("hidden", !showReport);
  if (els.qaReportPanel) els.qaReportPanel.hidden = !showReport;
  els.qaTabActivity?.classList.toggle("is-active", qaTab !== "report");
  els.qaTabReport?.classList.toggle("is-active", qaTab === "report");
  els.qaTabActivity?.setAttribute("aria-selected", qaTab !== "report" ? "true" : "false");
  els.qaTabReport?.setAttribute("aria-selected", qaTab === "report" ? "true" : "false");
}

function renderProofMarkdown(source) {
  const blocks = [];
  let list = [];
  const flushList = () => {
    if (!list.length) return;
    blocks.push(`<ul>${list.map((item) => `<li>${inlineMd(item)}</li>`).join("")}</ul>`);
    list = [];
  };
  for (const raw of source.split("\n")) {
    const line = raw.trimEnd();
    if (/^###\s+/.test(line)) {
      flushList();
      blocks.push(`<h3>${inlineMd(line.replace(/^###\s+/, ""))}</h3>`);
    } else if (/^##\s+/.test(line)) {
      flushList();
      blocks.push(`<h2>${inlineMd(line.replace(/^##\s+/, ""))}</h2>`);
    } else if (/^#\s+/.test(line)) {
      flushList();
      blocks.push(`<h1>${inlineMd(line.replace(/^#\s+/, ""))}</h1>`);
    } else if (/^[-*]\s+/.test(line)) {
      list.push(line.replace(/^[-*]\s+/, ""));
    } else if (!line.trim()) {
      flushList();
    } else {
      flushList();
      blocks.push(`<p>${inlineMd(line)}</p>`);
    }
  }
  flushList();
  return blocks.join("");
}

function inlineMd(value) {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function openView(view) {
  showView(view);
  renderStageNav();
  renderPipeline();
}

function openDefine() {
  openView("define");
}

function jumpToSection(name) {
  const marker = `## ${name}`;
  const idx = markdownEditor.getValue().indexOf(marker);
  if (idx < 0) return;
  selectInEditor(idx, idx + marker.length);
}

function jumpToSpecId(id) {
  if (!id) return false;
  for (const marker of [`Id: ${id}`, `## ${id}`, id]) {
    const idx = markdownEditor.getValue().indexOf(marker);
    if (idx < 0) continue;
    selectInEditor(idx, idx + marker.length);
    return true;
  }
  return false;
}

function fillActivityLog(log, lines, emptyMessage, which) {
  if (!log) return;
  const rows = lines.length ? lines : [{ level: "info", message: emptyMessage }];
  const key = rows.map((line) => `${line.level}\0${line.message}`).join("\n");
  const previous = which === "prove" ? lastProveKey : lastImplementKey;
  if (key === previous && log.childElementCount === rows.length) return;
  if (which === "prove") lastProveKey = key;
  else lastImplementKey = key;
  const pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 16;
  const savedTop = log.scrollTop;
  log.innerHTML = "";
  for (const line of rows) {
    const li = document.createElement("li");
    const kind = line.level === "error" ? "bad" : line.level === "ok" ? "ok" : "idle";
    li.className = `list-row list-row-${kind}`;
    li.textContent = line.message;
    log.append(li);
  }
  log.scrollTop = pinned ? log.scrollHeight : savedTop;
}

function renderActivity() {
  fillActivityLog(
    els.implementActivity,
    implementLines,
    "No activity yet. Implement writes progress here.",
    "implement",
  );
  fillActivityLog(els.qaActivity, proveLines, "No activity yet. Prove writes progress here.", "prove");
}

function appendActivity(line, channel) {
  if (channel === "prove") proveLines = [...proveLines, line].slice(-80);
  else implementLines = [...implementLines, line].slice(-80);
  if (line.message) {
    actionNotice = line.message;
    setActionHint(line.message);
  }
  renderActivity();
}

function jumpToLine(line) {
  const lines = markdownEditor.getValue().split("\n");
  let start = 0;
  for (let i = 0; i < line - 1; i++) start += (lines[i]?.length ?? 0) + 1;
  const end = start + (lines[line - 1]?.length ?? 0);
  selectInEditor(start, end);
}

function selectInEditor(start, end) {
  requestAnimationFrame(() => {
    markdownEditor.select(start, end);
  });
}

async function saveMarkdown() {
  actionNotice = "";
  try {
  const res = await fetch("/api/requirement", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: markdownEditor.getValue() }),
  });
  state = await res.json();
  els.save.textContent = `Compiled · Spec ${state.health?.spec.state ?? ""}`;
  render();
  } catch {
    els.save.textContent = "Save failed";
  } finally {
    applying = false;
  }
}

function onEnabledClick(btn, fn) {
  btn?.addEventListener("click", (event) => {
    if (btn.dataset.enabled === "0") {
      event.preventDefault();
      return;
    }
    fn();
  });
}

onEnabledClick(els.reviewAccept, () => {
  void runNextAction("Accepting…", "/api/improve/accept");
});
onEnabledClick(els.reviewReject, () => {
  void runNextAction("Rejecting…", "/api/improve/reject");
});
onEnabledClick(els.next, () => {
  void runStageAction(state.health?.nextAction?.id);
});
onEnabledClick(els.actionReady, () => void runStageAction(els.actionReady.dataset.action));
onEnabledClick(els.actionBuild, () => void runStageAction(els.actionBuild.dataset.action));
onEnabledClick(els.actionBuildIgnore, () => void runStageAction(els.actionBuildIgnore.dataset.action));
onEnabledClick(els.actionBuildStop, () => void runStageAction(els.actionBuildStop.dataset.action));
onEnabledClick(els.actionProof, () => void runStageAction(els.actionProof.dataset.action));
onEnabledClick(els.actionFixProof, () => void runStageAction(els.actionFixProof.dataset.action));
els.ignoreYes?.addEventListener("click", () => closeIgnoreDialog("yes"));
els.ignoreNo?.addEventListener("click", () => closeIgnoreDialog("no"));
els.ignoreCancel?.addEventListener("click", () => closeIgnoreDialog("cancel"));

let ignoreDialogResolve = null;

function closeIgnoreDialog(value) {
  if (els.ignoreDialog?.open) els.ignoreDialog.close(value);
}

function askIgnoreBuild() {
  if (!els.ignoreDialog) return Promise.resolve(null);
  return new Promise((resolve) => {
    ignoreDialogResolve = resolve;
    const onClose = () => {
      els.ignoreDialog.removeEventListener("close", onClose);
      const answer = els.ignoreDialog.returnValue;
      const done = ignoreDialogResolve;
      ignoreDialogResolve = null;
      done?.(answer === "yes" ? true : answer === "no" ? false : null);
    };
    els.ignoreDialog.addEventListener("close", onClose);
    els.ignoreDialog.returnValue = "";
    els.ignoreDialog.showModal();
  });
}

function viewForAction(id) {
  if (id === "check-jev") return "judgment";
  if (id === "improve" || id === "review-improve" || id === "fix-spec" || id === "create") return "define";
  if (id === "implement" || id === "stop-implement" || id === "ignore-build" || id === "fix-from-proof") {
    return state?.health?.build?.owned === false ? null : "implement";
  }
  if (id === "prove") return "qa";
  return null;
}

async function runStageAction(id) {
  actionNotice = "";
  const nextView = viewForAction(id);
  if (nextView) openView(nextView);
  if (id === "create") {
    if (!state.packId) {
      els.createBar.classList.remove("hidden");
      els.newId.focus();
      return;
    }
    const res = await fetch("/api/create-in-place", { method: "POST" });
    takeState(await res.json());
    focusedSection = "Business Rules";
    render();
    jumpToSection("Business Rules");
    return;
  }
  if (id === "fix-spec") {
    const first = state.health?.spec.findings?.[0];
    if (first) jumpToLine(first.line);
    return;
  }
  if (id === "improve") {
    implementLines = [{ level: "info", message: "Improve started." }];
    actionNotice = "Writing the improve brief…";
    setActionHint(actionNotice);
    renderActivity();
    await runBackgroundAction("Improving…", "/api/improve", { adapter: recordedAdapter() }, "improve");
    return;
  }
  if (id === "review-improve") {
    await runNextAction("Accepting…", "/api/improve/accept");
    return;
  }
  if (id === "check-jev") {
    await runNextAction("Checking…", "/api/check-jev");
    return;
  }
  if (id === "stop-implement") {
    actionNotice = "Stopping…";
    setActionHint(actionNotice);
    try {
      const res = await fetch("/api/stop-implement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const payload = await res.json();
      if (payload.health || payload.packId) state = { ...state, ...payload };
      applyActivities(payload);
      actionNotice = payload.error ?? payload.message ?? "Owner stopped Implement.";
    } catch (err) {
      actionNotice = err instanceof Error ? err.message : "Stop failed.";
    }
    setActionHint(actionNotice);
    render();
    return;
  }
  if (id === "implement") {
    implementLines = [{ level: "info", message: "Implement started." }];
    actionNotice = "Implement started.";
    setMeter("build", "running");
    renderActivity();
    setActionHint(actionNotice);
    await runBackgroundAction("Implementing…", "/api/implement", { adapter: recordedAdapter() }, "implement");
    return;
  }
  if (id === "ignore-build") {
    const successful = await askIgnoreBuild();
    if (successful === null) return;
    actionNotice = "Ignoring failed Build…";
    setActionHint(actionNotice);
    const ignored = await runNextAction("Ignoring…", "/api/ignore-build", { successful });
    if (ignored === false) return;
    await runProveAction();
    return;
  }
  if (id === "fix-from-proof") {
    implementLines = [{ level: "info", message: "Fix from proof started." }];
    actionNotice = "Fix from proof started.";
    setMeter("build", "running");
    renderActivity();
    setActionHint(actionNotice);
    await runBackgroundAction(
      "Fixing from proof…",
      "/api/implement",
      { adapter: recordedAdapter(), fromProof: true },
      "implement",
    );
    return;
  }
  if (id === "prove") {
    proveLines = [{ level: "info", message: "Prove started." }];
    qaTab = "activity";
    actionNotice = "Prove started.";
    setMeter("proof", "running");
    renderActivity();
    setActionHint(actionNotice);
    await runProveAction();
  }
}

async function runProveAction() {
  openView("qa");
  qaTab = "activity";
  actionBusy = true;
  headerBusyLabel = "Proving…";
  paintActionButton(els.next, {
    id: "prove",
    label: headerBusyLabel,
    hint: actionNotice,
    enabled: false,
    primary: true,
  });
  const poll = window.setInterval(() => {
    void refreshActivity();
  }, 750);
  try {
    const res = await fetch("/api/prove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const payload = await res.json();
    applyActivities(payload);
    if (Array.isArray(payload.proveActivity) && payload.proveActivity.length) {
      renderActivity();
    }
    if (!res.ok && !payload.started) {
      actionNotice = payload.error ?? "Prove failed.";
      setActionHint(actionNotice);
      return;
    }
    await waitWhileBusy("prove");
    await load();
  } catch (err) {
    actionNotice = err instanceof Error ? err.message : "Failed to fetch";
    setActionHint(actionNotice);
    await refreshActivity();
    await waitWhileBusy("prove");
    await load();
  } finally {
    window.clearInterval(poll);
    actionBusy = false;
    render();
  }
}

async function waitWhileBusy(kind) {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("/api/state");
      const data = await res.json();
      if (data.health || data.packId || data.improveReview) state = { ...state, ...data };
      applyActivities(data);
      if (data.improveReview?.files?.length) {
        actionNotice = "";
        render();
        return;
      }
      const last = lastBusyMessage(kind === "prove" ? "prove" : "implement");
      if (last && !data.improveReview) {
        actionNotice = last;
        setActionHint(last);
      }
      render();
      if (data.busy !== kind) return;
    } catch {
      // keep polling through a brief disconnect
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

async function refreshActivity() {
  try {
    const res = await fetch("/api/state");
    const data = await res.json();
    if (data.health || data.packId || data.improveReview) state = { ...state, ...data };
    applyActivities(data);
    if (data.improveReview?.files?.length) actionNotice = "";
    else {
      const last = lastBusyMessage(data.busy === "prove" ? "prove" : "implement");
      if (last) {
        actionNotice = last;
        setActionHint(last);
      }
    }
    render();
  } catch {
    // keep the last lines if the poll loses a race with Prove
  }
}

async function runBackgroundAction(busyLabel, url, body, kind) {
  actionBusy = true;
  headerBusyLabel = busyLabel;
  paintActionButton(els.next, {
    id: state.health?.nextAction?.id,
    label: busyLabel,
    hint: actionNotice,
    enabled: false,
    primary: true,
  });
  setStageButtons(state.health, state.health?.nextAction?.id);
  const poll = window.setInterval(() => {
    void refreshActivity();
  }, 750);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const payload = await res.json();
    if (payload.health || payload.packId) state = { ...state, ...payload };
    applyActivities(payload);
    if (
      (Array.isArray(payload.implementActivity) && payload.implementActivity.length) ||
      (Array.isArray(payload.proveActivity) && payload.proveActivity.length)
    ) {
      renderActivity();
    }
    if (!res.ok && !payload.started) {
      actionNotice = payload.error ?? "Request failed.";
      setActionHint(actionNotice);
      return;
    }
    if (payload.message) {
      actionNotice = payload.message;
      setActionHint(actionNotice);
    }
    if (payload.started || payload.busy === kind) {
      await waitWhileBusy(kind);
      await load();
    }
  } catch (err) {
    actionNotice = err instanceof Error ? err.message : "Request failed.";
    setActionHint(actionNotice);
    await refreshActivity();
    await waitWhileBusy(kind);
    await load();
  } finally {
    window.clearInterval(poll);
    actionBusy = false;
    render();
  }
}

async function runNextAction(busyLabel, url, body) {
  actionBusy = true;
  headerBusyLabel = busyLabel;
  paintActionButton(els.next, {
    id: state.health?.nextAction?.id,
    label: busyLabel,
    hint: actionNotice,
    enabled: false,
    primary: true,
  });
  setStageButtons(state.health, state.health?.nextAction?.id);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const payload = await res.json();
    if (payload.health || payload.packId) state = { ...state, ...payload };
    applyActivities(payload);
    if (!res.ok || payload.error) {
      actionNotice = payload.error ?? "Request failed.";
      actionBusy = false;
      render();
      return false;
    }
    if (payload.message) actionNotice = payload.message;
    actionBusy = false;
    render();
    return true;
  } catch (err) {
    actionNotice = err instanceof Error ? err.message : "Request failed.";
    actionBusy = false;
    render();
    return false;
  }
}

async function recordSetup(body) {
  if (els.stackError) els.stackError.textContent = "";
  for (const btn of [els.codingManual, els.codingCursor, els.codingCopilot, els.stackNextjs, els.stackAmplify]) {
    if (btn) btn.disabled = true;
  }
  const res = await fetch("/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json();
  if (!res.ok) {
    for (const btn of [els.codingManual, els.codingCursor, els.codingCopilot, els.stackNextjs, els.stackAmplify]) {
      if (btn) btn.disabled = false;
    }
    if (els.stackError) els.stackError.textContent = payload.error ?? "Could not record setup.";
    return;
  }
  pendingCoding = null;
  state = payload;
  actionNotice = "";
  render();
}

async function onCodingChoice(coding) {
  const repo = state?.productRepo;
  const needStack = Boolean(repo?.implement && repo?.empty && !repo?.recorded);
  if (coding === "manual") {
    pendingCoding = null;
    await recordSetup({ coding: "manual" });
    return;
  }
  if (needStack) {
    pendingCoding = coding;
    renderSetupGate(state);
    return;
  }
  await recordSetup({ coding });
}

async function recordStack(id) {
  if (els.stackError) els.stackError.textContent = "";
  const repo = state?.productRepo;
  const needCoding = Boolean(repo?.implement && repo?.adapterRecorded === false);
  if (needCoding || pendingCoding) {
    const coding = pendingCoding ?? "cursor";
    await recordSetup({ coding, stack: id });
    return;
  }
  if (els.stackNextjs) els.stackNextjs.disabled = true;
  if (els.stackAmplify) els.stackAmplify.disabled = true;
  const res = await fetch("/api/stack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const body = await res.json();
  if (!res.ok) {
    if (els.stackNextjs) els.stackNextjs.disabled = false;
    if (els.stackAmplify) els.stackAmplify.disabled = false;
    if (els.stackError) els.stackError.textContent = body.error ?? "Could not record stack.";
    return;
  }
  state = body;
  actionNotice = "";
  render();
}

els.codingManual?.addEventListener("click", () => void onCodingChoice("manual"));
els.codingCursor?.addEventListener("click", () => void onCodingChoice("cursor"));
els.codingCopilot?.addEventListener("click", () => void onCodingChoice("copilot"));
els.stackNextjs?.addEventListener("click", () => void recordStack("nextjs-default"));
els.stackAmplify?.addEventListener("click", () => void recordStack("amplify-gen2"));

els.homeBtn?.addEventListener("click", () => void goHome());
els.qaTabActivity?.addEventListener("click", () => {
  qaTab = "activity";
  renderQaLayout();
});
els.qaTabReport?.addEventListener("click", () => {
  qaTab = "report";
  renderQaLayout();
});
els.allRequirements?.addEventListener("click", () => void goHome());
els.packMenu?.addEventListener("contextmenu", (event) => event.preventDefault());
els.packMenuDelete?.addEventListener("click", () => openDeleteDialog());
els.deleteCancel?.addEventListener("click", () => els.deleteDialog?.close());
els.deleteConfirm?.addEventListener("click", () => void confirmDeletePack());
els.deleteDialog?.addEventListener("cancel", () => els.deleteDialog?.close());
document.addEventListener("pointerdown", (event) => {
  if (els.packMenu?.contains(event.target)) return;
  if (event.button === 2) return;
  hidePackMenu();
});
document.addEventListener("contextmenu", (event) => {
  if (els.packMenu?.contains(event.target)) return;
  if (event.target instanceof Element && event.target.closest(".pack-row")) return;
  hidePackMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hidePackMenu();
});
window.addEventListener("resize", hidePackMenu);
window.addEventListener("scroll", hidePackMenu);

els.createNew.addEventListener("click", async () => {
  els.createError.textContent = "";
  const res = await fetch("/api/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: els.newId.value.trim() }),
  });
  const body = await res.json();
  if (!res.ok) {
    els.createError.textContent = body.error ?? "Could not create.";
    return;
  }
  takeState(body);
  currentView = "define";
  actionNotice = "";
  if (els.newId) els.newId.value = "";
  render();
  jumpToSection("Business Rules");
});

let pollTimer = null;

function startPolling() {
  stopPolling();
  // Poll /api/state. Never EventSource — a hanging stream pins browser refresh.
  pollTimer = window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (applying || actionBusy) return;
    void load();
  }, 2000);
}

function stopPolling() {
  if (pollTimer !== null) window.clearInterval(pollTimer);
  pollTimer = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") stopPolling();
  else {
    startPolling();
    void load();
  }
});
window.addEventListener("pagehide", stopPolling);
window.addEventListener("beforeunload", stopPolling);

if (els.graph) {
  const redraw = () => paintPipelineRails();
  new ResizeObserver(redraw).observe(els.graph);
  window.addEventListener("resize", redraw);
}

void load().finally(() => {
  if (document.visibilityState === "visible") startPolling();
});
