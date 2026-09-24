const els = {
  title: document.getElementById("pack-title"),
  going: document.getElementById("how-going"),
  spec: document.getElementById("meter-spec"),
  ready: document.getElementById("meter-ready"),
  build: document.getElementById("meter-build"),
  proof: document.getElementById("meter-proof"),
  next: document.getElementById("next-action"),
  hint: document.getElementById("next-hint"),
  actionReady: document.getElementById("action-ready"),
  actionBuild: document.getElementById("action-build"),
  actionProof: document.getElementById("action-proof"),
  sections: document.getElementById("sections"),
  findings: document.getElementById("findings"),
  editor: document.getElementById("editor"),
  save: document.getElementById("save-state"),
  createBar: document.getElementById("create-bar"),
  newId: document.getElementById("new-id"),
  createNew: document.getElementById("create-new"),
  createError: document.getElementById("create-error"),
  workspace: document.getElementById("workspace"),
  activityPanel: document.getElementById("activity-panel"),
  workspaceLabel: document.getElementById("workspace-label"),
  reviewActions: document.getElementById("review-actions"),
  reviewDiff: document.getElementById("review-diff"),
  reviewAccept: document.getElementById("review-accept"),
  reviewReject: document.getElementById("review-reject"),
  activity: document.getElementById("activity"),
};

let state = null;
let saveTimer;
let applying = false;
let focusedSection = "Business Rules";
let actionNotice = "";
let actionBusy = false;
let activityLines = [];
let lastActivityKey = "";
let loadInFlight = false;
let loadAgain = false;
let loadTimer;

async function load() {
  if (loadInFlight) {
    loadAgain = true;
    return;
  }
  loadInFlight = true;
  try {
    const res = await fetch("/api/state", { signal: AbortSignal.timeout(8000) });
    state = await res.json();
    if (Array.isArray(state.activity)) activityLines = state.activity;
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

function render() {
  const health = state.health;
  const packId = state.packId;
  els.title.textContent = packId ? packId.replaceAll("-", " ") : "No requirement selected";
  els.going.textContent = health?.howThisIsGoing ?? "Create a requirement pack to begin.";
  els.going.hidden = !els.going.textContent.trim();

  setMeter("spec", health?.spec.state ?? "empty");
  setMeter("ready", health?.ready.state ?? "not_yet", readyLabel(health?.ready));
  const buildOwned = health?.build?.owned !== false;
  const buildCard = document.querySelector('[data-meter="build"]');
  if (buildCard) buildCard.classList.toggle("hidden", !buildOwned);
  if (buildOwned) setMeter("build", health?.build.state ?? "not_yet");
  setMeter("proof", health?.proof.state ?? "not_yet");

  const action = health?.nextAction;
  const review = state.improveReview;
  if (review?.files?.length) actionNotice = "";
  els.next.textContent = actionBusy && !review?.files?.length ? els.next.textContent : action?.label ?? "Create a requirement";
  els.next.disabled = !action || !action.enabled || (actionBusy && !review?.files?.length);
  els.hint.textContent = review ? action?.hint || "" : actionNotice || action?.hint || "";
  setStageButton(els.actionReady, health?.stages?.ready, action?.id);
  setStageButton(els.actionBuild, health?.stages?.build, action?.id);
  setStageButton(els.actionProof, health?.stages?.proof, action?.id);

  const needsNewPack = !packId;
  els.createBar.classList.toggle("hidden", !needsNewPack);
  els.workspace.classList.toggle("hidden", needsNewPack && !state.markdown);

  if (!applying && !state.improveReview) {
    els.editor.value = state.markdown ?? "";
  }

  renderReview();
  renderSections(state.markdown ?? "");
  renderFindings(health?.spec.findings ?? [], health?.ready?.findings ?? [], health?.proof?.findings ?? []);
  renderActivity();
}

function renderReview() {
  const review = state.improveReview;
  const reviewing = Boolean(review);
  const hasDiff = Boolean(review?.files?.length);
  els.workspace?.classList.toggle("is-review", reviewing);
  els.activityPanel?.classList.toggle("is-review-idle", reviewing);
  els.editor.classList.toggle("hidden", reviewing);
  els.editor.hidden = reviewing;
  if (els.save) els.save.classList.toggle("hidden", reviewing);
  if (!els.reviewActions || !els.reviewDiff) return;
  els.reviewActions.classList.toggle("hidden", !reviewing);
  els.reviewDiff.classList.toggle("hidden", !reviewing);
  els.reviewDiff.hidden = !reviewing;
  if (els.workspaceLabel) {
    els.workspaceLabel.textContent = hasDiff ? "Improve patch" : reviewing ? "Waiting for the patch" : "requirement.md";
  }
  const lintOk = review?.lint?.ok !== false;
  if (els.reviewAccept) els.reviewAccept.disabled = !hasDiff || !lintOk || actionBusy;
  if (els.reviewReject) els.reviewReject.disabled = !reviewing || actionBusy;
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

function setMeter(name, value, labelText) {
  const label = value.replaceAll("_", " ");
  els[name].textContent = labelText ?? label.charAt(0).toUpperCase() + label.slice(1);
  const card = document.querySelector(`[data-meter="${name}"]`);
  if (card) card.dataset.state = value;
}

function readyLabel(ready) {
  if (!ready) return "Not yet";
  const state = ready.state === "blocked" ? "Blocked" : ready.state === "ready" ? "Ready" : "Not yet";
  if (ready.jevCurrent && typeof ready.packNoul === "number") {
    return `${state} · ${Number(ready.packNoul).toFixed(2)}`;
  }
  return state;
}

function setStageButton(btn, action, primaryId) {
  if (!btn) return;
  if (!action || action.hidden) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  btn.textContent = action.label;
  btn.disabled = !action.enabled || actionBusy;
  btn.dataset.action = action.id;
  btn.title = action.hint ?? "";
  btn.classList.toggle("pill-btn-primary", Boolean(action.enabled && action.id === primaryId));
}

function renderSections(markdown) {
  const names = [...markdown.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]);
  const unique = names.length ? names : ["Business Rules", "Use Cases", "Roles & Permissions"];
  els.sections.innerHTML = "";
  for (const name of unique) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = name;
    btn.className = "nav-item";
    btn.classList.toggle("active", name === focusedSection);
    btn.addEventListener("click", () => {
      focusedSection = name;
      jumpToSection(name);
      renderSections(els.editor.value);
    });
    els.sections.append(btn);
  }
}

function jumpToSection(name) {
  const marker = `## ${name}`;
  const idx = els.editor.value.indexOf(marker);
  if (idx < 0) return;
  selectInEditor(idx, idx + marker.length);
}

function jumpToSpecId(id) {
  if (!id) return false;
  for (const marker of [`Id: ${id}`, `## ${id}`, id]) {
    const idx = els.editor.value.indexOf(marker);
    if (idx < 0) continue;
    selectInEditor(idx, idx + marker.length);
    return true;
  }
  return false;
}

function renderFindings(specFindings, readyFindings, proofFindings = []) {
  els.findings.innerHTML = "";
  if (!specFindings.length && !readyFindings.length && !proofFindings.length) {
    const li = document.createElement("li");
    li.className = "list-row list-row-ok";
    li.textContent = "No findings.";
    els.findings.append(li);
    return;
  }
  for (const f of specFindings) {
    const li = document.createElement("li");
    li.className = "list-row list-row-bad";
    li.textContent = `L${f.line} ${f.message}`;
    if (f.line) li.addEventListener("click", () => jumpToLine(f.line));
    els.findings.append(li);
  }
  for (const f of readyFindings) {
    const li = document.createElement("li");
    li.className = f.severity === "blocker" ? "list-row list-row-bad" : "list-row list-row-nit";
    li.textContent = f.specId ? `${f.specId} — ${f.message}` : f.message;
    li.addEventListener("click", () => {
      if (f.line) jumpToLine(f.line);
      else jumpToSpecId(f.specId);
    });
    els.findings.append(li);
  }
  for (const f of proofFindings) {
    const li = document.createElement("li");
    li.className = f.severity === "fail" ? "list-row list-row-bad" : "list-row list-row-nit";
    li.textContent = f.specId ? `${f.specId} — ${f.message}` : f.message;
    li.addEventListener("click", () => jumpToSpecId(f.specId));
    els.findings.append(li);
  }
}

function renderActivity() {
  if (!els.activity) return;
  const lines = activityLines.length
    ? activityLines
    : [{ level: "info", message: "No activity yet. Prove writes progress and errors here." }];
  const key = lines.map((line) => `${line.level}\0${line.message}`).join("\n");
  const log = els.activity;
  const pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 16;
  const savedTop = log.scrollTop;
  if (key === lastActivityKey && log.childElementCount === lines.length) return;
  lastActivityKey = key;
  log.innerHTML = "";
  for (const line of lines) {
    const li = document.createElement("li");
    const kind = line.level === "error" ? "bad" : line.level === "ok" ? "ok" : "idle";
    li.className = `list-row list-row-${kind}`;
    li.textContent = line.message;
    log.append(li);
  }
  log.scrollTop = pinned ? log.scrollHeight : savedTop;
}

function appendActivity(line) {
  activityLines = [...activityLines, line].slice(-80);
  if (line.message) {
    actionNotice = line.message;
    els.hint.textContent = line.message;
  }
  renderActivity();
}

function jumpToLine(line) {
  const lines = els.editor.value.split("\n");
  let start = 0;
  for (let i = 0; i < line - 1; i++) start += (lines[i]?.length ?? 0) + 1;
  const end = start + (lines[line - 1]?.length ?? 0);
  selectInEditor(start, end);
}

function selectInEditor(start, end) {
  els.editor.focus();
  els.editor.setSelectionRange(start, end);
  const pre = els.editor.value.slice(0, start);
  const line = pre.split("\n").length;
  els.editor.scrollTop = Math.max(0, (line - 3) * 22);
}

els.editor.addEventListener("input", () => {
  applying = true;
  els.save.textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveMarkdown();
  }, 280);
});

async function saveMarkdown() {
  actionNotice = "";
  const res = await fetch("/api/requirement", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown: els.editor.value }),
  });
  state = await res.json();
  applying = false;
  els.save.textContent = `Compiled · Spec ${state.health?.spec.state ?? ""}`;
  render();
}

els.reviewAccept?.addEventListener("click", () => {
  void runNextAction("Accepting…", "/api/improve/accept");
});
els.reviewReject?.addEventListener("click", () => {
  void runNextAction("Rejecting…", "/api/improve/reject");
});

els.next.addEventListener("click", () => {
  void runStageAction(state.health?.nextAction?.id);
});

els.actionReady?.addEventListener("click", () => void runStageAction(els.actionReady.dataset.action));
els.actionBuild?.addEventListener("click", () => void runStageAction(els.actionBuild.dataset.action));
els.actionProof?.addEventListener("click", () => void runStageAction(els.actionProof.dataset.action));

async function runStageAction(id) {
  actionNotice = "";
  if (id === "create") {
    if (!state.packId) {
      els.createBar.classList.remove("hidden");
      els.newId.focus();
      return;
    }
    const res = await fetch("/api/create-in-place", { method: "POST" });
    state = await res.json();
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
    activityLines = [{ level: "info", message: "Improve started." }];
    actionNotice = "Writing the improve brief…";
    els.hint.textContent = actionNotice;
    renderActivity();
    await runBackgroundAction("Improving…", "/api/improve", { adapter: "cursor" }, "improve");
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
  if (id === "implement") {
    await runNextAction("Launching…", "/api/implement", { adapter: "cursor" });
    return;
  }
  if (id === "prove") {
    activityLines = [{ level: "info", message: "Prove started." }];
    actionNotice = "Prove started.";
    setMeter("proof", "running");
    renderActivity();
    els.hint.textContent = actionNotice;
    await runProveAction();
  }
}

async function runProveAction() {
  actionBusy = true;
  els.next.disabled = true;
  els.next.textContent = "Proving…";
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
    if (Array.isArray(payload.activity) && payload.activity.length) {
      activityLines = payload.activity;
      renderActivity();
    }
    if (!res.ok && !payload.started) {
      actionNotice = payload.error ?? "Prove failed.";
      els.hint.textContent = actionNotice;
      return;
    }
    await waitWhileBusy("prove");
    await load();
  } catch (err) {
    actionNotice = err instanceof Error ? err.message : "Failed to fetch";
    els.hint.textContent = actionNotice;
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
      if (Array.isArray(data.activity)) activityLines = data.activity;
      if (data.improveReview?.files?.length) {
        actionNotice = "";
        render();
        return;
      }
      const last = activityLines[activityLines.length - 1];
      if (last?.message && !data.improveReview) {
        actionNotice = last.message;
        els.hint.textContent = last.message;
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
    if (Array.isArray(data.activity)) activityLines = data.activity;
    if (data.improveReview?.files?.length) actionNotice = "";
    else {
      const last = activityLines[activityLines.length - 1];
      if (last?.message) {
        actionNotice = last.message;
        els.hint.textContent = last.message;
      }
    }
    render();
  } catch {
    // keep the last lines if the poll loses a race with Prove
  }
}

async function runBackgroundAction(busyLabel, url, body, kind) {
  actionBusy = true;
  els.next.disabled = true;
  els.next.textContent = busyLabel;
  setStageButton(els.actionReady, state.health?.stages?.ready, state.health?.nextAction?.id);
  setStageButton(els.actionBuild, state.health?.stages?.build, state.health?.nextAction?.id);
  setStageButton(els.actionProof, state.health?.stages?.proof, state.health?.nextAction?.id);
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
    if (Array.isArray(payload.activity) && payload.activity.length) {
      activityLines = payload.activity;
      renderActivity();
    }
    if (!res.ok && !payload.started) {
      actionNotice = payload.error ?? "Request failed.";
      els.hint.textContent = actionNotice;
      return;
    }
    if (payload.message) {
      actionNotice = payload.message;
      els.hint.textContent = actionNotice;
    }
    if (payload.started || payload.busy === kind) {
      await waitWhileBusy(kind);
      await load();
    }
  } catch (err) {
    actionNotice = err instanceof Error ? err.message : "Request failed.";
    els.hint.textContent = actionNotice;
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
  els.next.disabled = true;
  els.next.textContent = busyLabel;
  setStageButton(els.actionReady, state.health?.stages?.ready, state.health?.nextAction?.id);
  setStageButton(els.actionBuild, state.health?.stages?.build, state.health?.nextAction?.id);
  setStageButton(els.actionProof, state.health?.stages?.proof, state.health?.nextAction?.id);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const payload = await res.json();
    if (payload.health || payload.packId) state = { ...state, ...payload };
    if (Array.isArray(payload.activity)) activityLines = payload.activity;
    if (!res.ok || payload.error) {
      actionNotice = payload.error ?? "Request failed.";
    } else if (payload.message) {
      actionNotice = payload.message;
    }
  } catch (err) {
    actionNotice = err instanceof Error ? err.message : "Request failed.";
  }
  actionBusy = false;
  render();
}

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
  state = body;
  actionNotice = "";
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

void load().finally(() => {
  if (document.visibilityState === "visible") startPolling();
});
