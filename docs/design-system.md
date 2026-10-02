# Design system

Locked visual language for the Requirement Owner cockpit. Inspired by **ClickUp’s product workspace**, not the marketing site. Do not use ClickUp’s logo, wordmark, or illustrations.

Source of tokens: [cockpit/tokens.css](../cockpit/tokens.css). Classes: [cockpit/styles.css](../cockpit/styles.css).

Milestone 2+ screens reuse these classes. Do not invent a second chrome.

## Principles

- App chrome, not a parchment document
- **Light theme is the shipped theme.** Surfaces stack; nothing is hardcoded to a dark sidebar.
- Themes are data: `html[data-theme="light"]` today. Dark token values exist on `[data-theme="dark"]` but are **not wired** (no toggle).
- Components reference semantic names (`--surface-2`, `--text-primary`), never raw hex.
- Sans-serif UI (Inter). Monospace only in `requirement.md`
- Purple primary actions, pipeline node tones from `--color-status-*`, compact 12–16px type
- No Storybook, Tailwind, shadcn, or React rewrite

## Surface layers

| Layer | Token | Light role |
| --- | --- | --- |
| 0 | `--surface-0` | Page canvas (recessed gray) |
| 1 | `--surface-1` | Chrome: nested stage nav, flush bars |
| 2 | `--surface-2` | Raised panels / cards (`--shadow-2`) |
| 3 | `--surface-3` | Inset fields and nested rows |

Also: `--surface-hover`, `--surface-selected`, `--surface-disabled`. Text: `--text-primary`, `--text-secondary`, `--text-muted`. Edges: `--border-subtle`, `--border-strong`.

To ship dark later: fill in more `[data-theme="dark"]` if needed, then set `data-theme="dark"` on `<html>`. Do not add a second stylesheet.

## Brand and status

| Token | Light value | Use |
| --- | --- | --- |
| `--color-primary` | `#7b68ee` | Primary button, active nav |
| `--color-primary-hover` | `#6647f0` | Hover |
| `--color-status-idle` | gray | Not yet |
| `--color-status-draft` | purple | Drafting / not yet |
| `--color-status-ok` | green | Valid / pass |
| `--color-status-bad` | muted coral | Failed / error |
| `--color-status-progress` | purple | In progress (later) |

Space: `--space-1` … `--space-6` (4px grid). Radius: 8px controls, 12px panels, pill 9999px.

## Classes to reuse

| Class | Role |
| --- | --- |
| `.app-shell` | Single-column canvas |
| `.pipeline` / `.pipeline-graph` / `.pipeline-svg` / `.pipeline-node` / `.pipeline-branch` | Flush circle-and-rail graph. SVG draws one rail and the Define bracket. Labels sit above dots. Node `data-tone` is idle / draft / ok / bad / progress |
| `.stage-workspace` / `.stage-nav` / `.nav-mark` / `.nav-badge` / `.nav-chevron` / `.stage-view` | Status tree + content. Define starts open; chevron collapses Spec / Judgment. Selected row uses `--surface-hover`, no purple inset |
| `.topbar` / `.logo-horiz` / `.home-btn` / `.btn-primary` / `.btn-secondary` / `.cta` | Header: wordmark is home, pack copy, primary action. CTAs use an icon + label. Action hints sit on hover (`data-hint`), not beside the button |
| `.pack-home` / `.pack-list` / `.pack-row` / `.pack-meter` | Requirement list home. Row meters use `data-tone` idle / draft / ok / bad / progress |
| `.context-menu` / `.context-menu-item` / `.context-menu-danger` | Right-click menu on a list row. Delete is the only item |
| `.confirm-dialog` | Modal confirm chrome. Ignore (Yes/No/Cancel), Delete (Cancel + danger Confirm), and Stop-and-discard unanswered questions |
| `.pill-btn` | Stage CTAs (Check, Implement, Prove, Stop). Same `.cta` treatment as the header. Stop is a secondary pill. `.cta-danger` is Reject and Delete in a confirm dialog |
| `.stack-gate` / `.stack-choice` | First-run setup: coding choice (manual / Cursor / Copilot) then stack when the repo is empty. Choice cards are reused for agent questions |
| `.list-row` | Spec sections, findings, activity |
| `.status-bar` / `.status-bar-mark` / `.status-bar-meta` | Stage content header: pill bar with tone, title, and icon meta. `data-tone` is idle / draft / ok / bad / progress |
| `.spec-section` | Section checklist rows (present / missing / error) |
| `.proof-report` | QA artifact (`derived/proof-report.md`) |
| `.qa-tab-bar` / `.qa-tab` | QA Activity / Report tabs when a report exists (Activity first and default). Same tabs on Implement for Questions / Activity when questions are open (Questions first and default). Same tabs on Define during AI authoring |
| `.question-panel` / `.question-card` / `.question-choices` | In-stage agent questionnaire on Define (Improve and authoring) and Implement. Free text uses `.input`. Trade-offs use `.stack-choice` cards. First choice may show **Suggested**. Skip is a secondary control on the card |
| `.author-describe` | Post-create description panel on Define before AI authoring starts |
| `.input` | `--surface-3` fields |
| `.markdown-editor` / `.md-toolbar` / `.md-menu` / `.md-preview` | Define-only editor: Preview default, Edit source, Split. Sticky toolbar. Heading control is a dropdown. Preview uses `--font-ui`; Edit uses `--font-mono` |
| `.review-diff` / `.review-file` / `.diff-add` / `.diff-del` | Improve patch review on Define; add/del use status ok/bad surfaces |

Display labels (Define, Implement, QA, Clear) are chrome only. `health.json` keys stay `spec` / `ready` / `build` / `proof`.

## Viewport

Desktop: white canvas, flush graph, then stage nav 15.5rem + content. At `max-width: 768px` the workspace stacks. No hamburger framework.
