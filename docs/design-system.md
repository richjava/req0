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
- Purple primary actions, status pills, compact 12–16px type
- No Storybook, Tailwind, shadcn, or React rewrite

## Surface layers

| Layer | Token | Light role |
| --- | --- | --- |
| 0 | `--surface-0` | Page canvas (recessed gray) |
| 1 | `--surface-1` | Chrome: sidebar, flush bars |
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
| `--color-status-draft` | amber | Drafting / empty spec |
| `--color-status-ok` | green | Valid / pass |
| `--color-status-bad` | red | Error |
| `--color-status-progress` | purple | In progress (later) |

Space: `--space-1` … `--space-6` (4px grid). Radius: 8px controls, 12px panels, pill 9999px.

## Classes to reuse

| Class | Role |
| --- | --- |
| `.app-shell` | Sidebar + main |
| `.sidebar` / `.nav-item` / `.nav-item.active` | Navigation on `--surface-1` |
| `.topbar` / `.btn-primary` / `.btn-secondary` | Header actions |
| `.status-pill` + `data-state` | Meters |
| `.panel` | `--surface-2` card |
| `.list-row` | Findings / later task-like rows |
| `.input` | `--surface-3` fields |
| `.markdown-editor` / `.md-toolbar` / `.md-menu` / `.md-preview` | Markdown editor: Preview default, Edit source, Split. Sticky toolbar. Heading control is a dropdown. Preview uses `--font-ui`; Edit uses `--font-mono` |
| `.review-diff` / `.review-file` / `.diff-add` / `.diff-del` | Improve patch review; add/del use status ok/bad surfaces |

## Viewport

Desktop: sidebar 248px + main. At `max-width: 768px` the shell stacks. No hamburger framework.
