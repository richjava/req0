const els = {
  title: document.getElementById("pack-title"),
  going: document.getElementById("how-going"),
  spec: document.getElementById("meter-spec"),
  ready: document.getElementById("meter-ready"),
  build: document.getElementById("meter-build"),
  proof: document.getElementById("meter-proof"),
  next: document.getElementById("next-action"),
  hint: document.getElementById("next-hint"),
  sections: document.getElementById("sections"),
  findings: document.getElementById("findings"),
  editor: document.getElementById("editor"),
  save: document.getElementById("save-state"),
  createBar: document.getElementById("create-bar"),
  newId: document.getElementById("new-id"),
  createNew: document.getElementById("create-new"),
  createError: document.getElementById("create-error"),
  workspace: document.getElementById("workspace"),
  activity: document.getElementById("activity"),
};

let state = null;
let saveTimer;
let applying = false;
let focusedSection = "Business Rules";
let actionNotice = "";
let actionBusy = false;
let activityLines = [];

async function load() {
  const res = await fetch("/api/state");
  state = await res.json();
  if (Array.isArray(state.activity)) activityLines = state.activity;
  render();
}

function render() {
  const health = state.health;
  const packId = state.packId;
  els.title.textContent = packId ? packId.replaceAll("-", " ") : "No requirement selected";
  els.going.textContent = health?.howThisIsGoing ?? "Create a requirement pack to begin.";
  els.going.hidden = !els.going.textContent.trim();

  setMeter("spec", health?.spec.state ?? "empty");
  setMeter("ready", health?.ready.state ?? "not_yet");
  setMeter("build", health?.build.state ?? "not_yet");
  setMeter("proof", health?.proof.state ?? "not_yet");

  const action = health?.nextAction;
  els.next.textContent = action?.label ?? "Create a requirement";
  els.next.disabled = !action || !action.enabled;
  els.hint.textContent = actionNotice || action?.hint || "";

  const needsNewPack = !packId;
  els.createBar.classList.toggle("hidden", !needsNewPack);
  els.workspace.classList.toggle("hidden", needsNewPack && !state.markdown);

  if (!applying) {
    els.editor.value = state.markdown ?? "";
  }

  renderSections(state.markdown ?? "");
  renderFindings(health?.spec.findings ?? [], health?.ready?.findings ?? [], health?.proof?.findings ?? []);
  renderActivity();
}

function setMeter(name, value) {
  const label = value.replaceAll("_", " ");
  els[name].textContent = label.charAt(0).toUpperCase() + label.slice(1);
  const card = document.querySelector(`[data-meter="${name}"]`);
  if (card) card.dataset.state = value;
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
  els.activity.innerHTML = "";
  const lines = activityLines.length
    ? activityLines
    : [{ level: "info", message: "No activity yet. Prove writes progress and errors here." }];
  for (const line of lines) {
    const li = document.createElement("li");
    const kind = line.level === "error" ? "bad" : line.level === "ok" ? "ok" : "idle";
    li.className = `list-row list-row-${kind}`;
    li.textContent = line.message;
    els.activity.append(li);
  }
  els.activity.scrollTop = els.activity.scrollHeight;
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

els.next.addEventListener("click", async () => {
  const id = state.health?.nextAction?.id;
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
  if (id === "fix-ready") {
    const ready = state.health?.ready;
    if (jumpToSpecId(ready?.nextId)) return;
    const first = ready?.findings?.[0];
    if (first?.line) jumpToLine(first.line);
    else jumpToSpecId(first?.specId);
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
});

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
      if (Array.isArray(data.activity)) {
        activityLines = data.activity;
        const last = activityLines[activityLines.length - 1];
        if (last?.message) {
          actionNotice = last.message;
          els.hint.textContent = last.message;
        }
        renderActivity();
      }
      if (data.health || data.packId) state = { ...state, ...data };
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
    if (!Array.isArray(data.activity)) return;
    activityLines = data.activity;
    const last = activityLines[activityLines.length - 1];
    if (last?.message) {
      actionNotice = last.message;
      els.hint.textContent = last.message;
    }
    renderActivity();
  } catch {
    // keep the last lines if the poll loses a race with Prove
  }
}

async function runNextAction(busyLabel, url, body) {
  actionBusy = true;
  els.next.disabled = true;
  els.next.textContent = busyLabel;
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

let events = null;

function connectEvents() {
  if (events) events.close();
  events = new EventSource("/api/events");
  events.addEventListener("message", (ev) => {
    if (!ev.data || ev.data === ":") return;
    if (ev.data === "reload") {
      if (!applying && !actionBusy) void load();
      return;
    }
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "activity") appendActivity(msg);
      if (msg.type === "done") void refreshActivity();
    } catch {
      if (!applying && !actionBusy) void load();
    }
  });
}

function disconnectEvents() {
  events?.close();
  events = null;
}

window.addEventListener("pagehide", disconnectEvents);
window.addEventListener("pageshow", () => connectEvents());

void load();
