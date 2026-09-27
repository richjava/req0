import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { marked } from "marked";

marked.use({
  gfm: true,
  breaks: true,
  pedantic: false,
});

const req0Theme = EditorView.theme({
  "&": {
    height: "100%",
    minHeight: "28rem",
    fontSize: "var(--text-13)",
    backgroundColor: "var(--surface-3)",
    color: "var(--text-primary)",
    border: "0",
    borderRadius: "0",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.5",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "var(--space-4)",
    caretColor: "var(--color-primary)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--surface-2)",
    color: "var(--text-muted)",
    borderRight: "1px solid var(--border-subtle)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--surface-selected)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--surface-selected)",
    color: "var(--text-primary)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--surface-selected) !important",
  },
});

const FORMAT_ACTIONS = [
  { id: "bold", label: "B", title: "Bold", run: (view) => toggleInline(view, "**") },
  { id: "italic", label: "I", title: "Italic", run: (view) => toggleInline(view, "*") },
  { id: "heading" },
  { id: "quote", label: "“", title: "Quote", run: (view) => toggleLinePrefix(view, "> ") },
  { id: "list", label: "•", title: "Bulleted list", run: (view) => toggleLinePrefix(view, "- ") },
  { id: "ordered", label: "1.", title: "Numbered list", run: (view) => toggleLinePrefix(view, "1. ") },
  { id: "link", label: "↗", title: "Link", run: insertLink },
];

const HEADING_OPTIONS = [
  { level: 1, label: "Heading 1" },
  { level: 2, label: "Heading 2" },
  { level: 3, label: "Heading 3" },
  { level: 4, label: "Heading 4" },
  { level: 5, label: "Heading 5" },
  { level: 6, label: "Heading 6" },
  { level: 0, label: "Paragraph" },
];

const MODES = [
  { id: "preview", label: "Preview" },
  { id: "edit", label: "Edit" },
  { id: "split", label: "Split" },
];

export function createMarkdownEditor(parent, options = {}) {
  const onChange = options.onChange;
  let mode = "preview";

  parent.classList.add("markdown-editor");
  parent.replaceChildren();

  const toolbar = document.createElement("div");
  toolbar.className = "md-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Markdown formatting");

  const formats = document.createElement("div");
  formats.className = "md-toolbar-group";

  const modes = document.createElement("div");
  modes.className = "md-toolbar-group md-toolbar-modes";
  modes.setAttribute("role", "radiogroup");
  modes.setAttribute("aria-label", "Editor mode");

  const body = document.createElement("div");
  body.className = "md-body";

  const source = document.createElement("div");
  source.className = "md-source";

  const preview = document.createElement("div");
  preview.className = "md-preview";
  preview.setAttribute("aria-label", "requirement.md preview");

  body.append(source, preview);
  parent.append(toolbar, body);

  const view = new EditorView({
    state: EditorState.create({
      doc: options.doc ?? "",
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        indentOnInput(),
        bracketMatching(),
        markdown(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([
          { key: "Mod-b", run: () => toggleInline(view, "**") },
          { key: "Mod-i", run: () => toggleInline(view, "*") },
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        req0Theme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          renderPreview();
          onChange?.(update.state.doc.toString());
        }),
      ],
    }),
    parent: source,
  });

  const formatButtons = new Map();
  for (const action of FORMAT_ACTIONS) {
    if (action.id === "heading") {
      formats.append(
        headingMenu((level) => {
          if (mode === "preview") setMode("edit");
          applyHeading(view, level);
          view.focus();
        }),
      );
      continue;
    }
    const button = toolButton(action.label, action.title, () => {
      if (mode === "preview") setMode("edit");
      action.run(view);
      view.focus();
    });
    formatButtons.set(action.id, button);
    formats.append(button);
  }

  const modeButtons = new Map();
  for (const item of MODES) {
    const button = toolButton(item.label, `${item.label} mode`, () => setMode(item.id));
    button.setAttribute("role", "radio");
    modeButtons.set(item.id, button);
    modes.append(button);
  }

  toolbar.append(formats, modes);

  function renderPreview() {
    const markdownSource = view.state.doc.toString();
    preview.innerHTML = markdownSource.trim()
      ? marked.parse(markdownSource, { async: false, html: false })
      : `<p class="md-preview-empty">Nothing in requirement.md yet.</p>`;
  }

  function setMode(next) {
    mode = MODES.some((item) => item.id === next) ? next : "preview";
    parent.dataset.mode = mode;
    for (const [id, button] of modeButtons) {
      const on = id === mode;
      button.setAttribute("aria-checked", on ? "true" : "false");
      button.classList.toggle("is-active", on);
    }
    if (mode !== "preview") view.requestMeasure();
  }

  function getValue() {
    return view.state.doc.toString();
  }

  setMode("preview");
  renderPreview();

  return {
    getValue,
    setValue(text) {
      const next = String(text ?? "");
      if (next === view.state.doc.toString()) {
        renderPreview();
        return;
      }
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
      });
    },
    select(from, to) {
      setMode("edit");
      const max = view.state.doc.length;
      const start = Math.max(0, Math.min(from, max));
      const end = Math.max(start, Math.min(to, max));
      view.dispatch({
        selection: EditorSelection.range(start, end),
        scrollIntoView: true,
      });
      view.focus();
    },
    focus() {
      if (mode === "preview") setMode("edit");
      view.focus();
    },
    setHidden(hidden) {
      parent.hidden = hidden;
      parent.classList.toggle("hidden", hidden);
    },
  };
}

function headingMenu(onPick) {
  const wrap = document.createElement("div");
  wrap.className = "md-menu";

  const toggle = toolButton("H ▾", "Heading", () => {
    const open = wrap.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  toggle.setAttribute("aria-haspopup", "listbox");
  toggle.setAttribute("aria-expanded", "false");

  const list = document.createElement("div");
  list.className = "md-menu-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Heading level");

  for (const option of HEADING_OPTIONS) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `md-menu-item md-menu-h${option.level || "p"}`;
    item.setAttribute("role", "option");
    item.textContent = option.label;
    item.addEventListener("click", () => {
      wrap.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      onPick(option.level);
    });
    list.append(item);
  }

  wrap.append(toggle, list);

  document.addEventListener("pointerdown", (event) => {
    if (wrap.contains(event.target)) return;
    wrap.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    wrap.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  });

  return wrap;
}

function toolButton(label, title, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "md-tool";
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", onClick);
  return button;
}

function toggleInline(view, marker) {
  const main = view.state.selection.main;
  const selected = view.state.sliceDoc(main.from, main.to);
  if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length > marker.length * 2) {
    const inner = selected.slice(marker.length, selected.length - marker.length);
    view.dispatch({
      changes: { from: main.from, to: main.to, insert: inner },
      selection: EditorSelection.range(main.from, main.from + inner.length),
    });
    return true;
  }
  const before = view.state.sliceDoc(Math.max(0, main.from - marker.length), main.from);
  const after = view.state.sliceDoc(main.to, Math.min(view.state.doc.length, main.to + marker.length));
  if (before === marker && after === marker) {
    view.dispatch({
      changes: [
        { from: main.to, to: main.to + marker.length, insert: "" },
        { from: main.from - marker.length, to: main.from, insert: "" },
      ],
      selection: EditorSelection.range(main.from - marker.length, main.to - marker.length),
    });
    return true;
  }
  view.dispatch({
    changes: { from: main.from, to: main.to, insert: `${marker}${selected}${marker}` },
    selection: EditorSelection.range(main.from + marker.length, main.to + marker.length),
  });
  return true;
}

function applyHeading(view, level) {
  if (!level) return stripHeading(view);
  return toggleLinePrefix(view, `${"#".repeat(level)} `, /^#{1,6} /);
}

function stripHeading(view) {
  const main = view.state.selection.main;
  const fromLine = view.state.doc.lineAt(main.from);
  const toLine = view.state.doc.lineAt(main.to > main.from ? main.to - 1 : main.to);
  const changes = [];
  for (let number = fromLine.number; number <= toLine.number; number += 1) {
    const line = view.state.doc.line(number);
    const stripped = line.text.replace(/^#{1,6} /, "");
    if (stripped !== line.text) changes.push({ from: line.from, to: line.to, insert: stripped });
  }
  if (changes.length) view.dispatch({ changes });
  return true;
}

function toggleLinePrefix(view, prefix, strip = null) {
  const main = view.state.selection.main;
  const fromLine = view.state.doc.lineAt(main.from);
  const toLine = view.state.doc.lineAt(main.to > main.from ? main.to - 1 : main.to);
  const changes = [];
  let already = true;
  for (let number = fromLine.number; number <= toLine.number; number += 1) {
    const line = view.state.doc.line(number);
    if (!line.text.startsWith(prefix)) already = false;
  }
  for (let number = fromLine.number; number <= toLine.number; number += 1) {
    const line = view.state.doc.line(number);
    if (already) {
      changes.push({ from: line.from, to: line.from + prefix.length, insert: "" });
      continue;
    }
    const stripped = strip ? line.text.replace(strip, "") : line.text;
    const insertFrom = strip && stripped !== line.text ? line.from : line.from;
    const insertTo = strip && stripped !== line.text ? line.to : line.from;
    changes.push({
      from: insertFrom,
      to: insertTo,
      insert: strip && stripped !== line.text ? `${prefix}${stripped}` : prefix,
    });
  }
  view.dispatch({ changes });
  return true;
}

function insertLink(view) {
  const main = view.state.selection.main;
  const selected = view.state.sliceDoc(main.from, main.to) || "text";
  const insert = `[${selected}](url)`;
  const urlFrom = main.from + selected.length + 3;
  view.dispatch({
    changes: { from: main.from, to: main.to, insert },
    selection: EditorSelection.range(urlFrom, urlFrom + 3),
  });
  return true;
}
