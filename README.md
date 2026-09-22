# Req0

A requirement operating system: structured packs, a local Requirement Owner cockpit, Jev judgments, coding-agent implementation, and browser proof.

**Documentation:** [docs/README.md](docs/README.md). `docs/requirements/` is only for requirement packs (including the golden `invoice-approval` fixture).

## Run

```bash
npm install
npm test
npm start
```

`npm start` opens the cockpit (default [http://127.0.0.1:4370](http://127.0.0.1:4370)).

```bash
npx tsx src/cli.ts start
npx tsx src/cli.ts compile
npx tsx src/cli.ts create my-requirement
npx tsx src/cli.ts prove
```

Required sections in a pack’s `requirement.md`: Business Rules, Use Cases, Roles & Permissions. See [docs/grammar.md](docs/grammar.md).

Jev coaching needs `TYPESAFE_API_KEY` (see `.env.example`). Without a key, Ready stays Not yet. Persona blockers still apply. A valid compile writes `derived/implement-brief.md`. `req0 implement` starts a Cursor agent with that brief after Ready (`cursor agent login` first). `--adapter=manual` skips launch.

## How an implementation is proven

Prove is not a handwritten test suite. It runs the **same use cases** that are in `requirement.md` against the running product in a browser.

1. **Compile** writes `derived/qa-plan.yaml` from `spec.json` — one case per use case. `Look for …` (or an outcome that the control is absent / unchanged) is **deny**. `Choose …` is **allow**. The control name is that label.
2. **Gate:** Prove stays off until Ready is Ready, Build succeeded, and `fixtures/runtime.yaml` parses (`baseUrl` + login selectors). Personas (who logs in) stay in `fixtures/personas.yaml`. Optional `resetCommand` runs in the product repo **before each case** so an earlier allow does not poison a later deny.
3. **Drive:** Playwright logs in as the case’s Actor, then follows `Open` / `Select` / `Choose` / `Look for`. Open picks a visible link from the step and preconditions — not product paths or record ids.
4. **Deny:** the control must be absent or disabled. That is the proof. No Jev, no invented HTTP posts.
5. **Allow:** click the control, then Jev (catalog `m4-proof-v1`) scores whether the **page observation** matches the use-case **Outcome**. It judges only what url, text, options, and visible controls can show. noul ≥ **0.75** pass, ≤ **0.15** fail, else needs review.
6. **Record:** `derived/proof-run.json`. The Proof meter is `not_yet` / `passed` / `failed` / `needs_review` / `stale` (spec changed since the last run). Re-prove is allowed.

Cockpit **Prove this requirement** is the same path as `req0 prove`. Chromium: `npx playwright install chromium` (system Chrome is used if the bundled browser is missing). Allow cases need `TYPESAFE_API_KEY`.

Granular walkthrough of the first product: [Case study: Invoice Desk](docs/case-study-invoice-desk.md).
