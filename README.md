# Req0

A requirement operating system: structured packs, a local Requirement Owner cockpit, Jev judgments, coding-agent implementation, and browser proof.

**Documentation:** [docs/README.md](docs/README.md). `docs/requirements/` is only for requirement packs (including the golden `invoice-approval` fixture).

## Use it on a product repo

Req0 reads one **requirement pack** inside your product git repo. Run the CLI from that repo (or from the pack folder) so it finds `docs/requirements/`.

```bash
cd /path/to/your-product
npx tsx /path/to/Req0/src/cli.ts create my-requirement
npx tsx /path/to/Req0/src/cli.ts start
```

`create` writes the pack if it is missing. You then fill `requirement.md` and personas. The cockpit is the usual loop: **Check** (Jev) → **Implement** (or skip) → **Prove**.

On an empty product repo, Implement stays off until a stack is recorded in `req0.json`. Use any one of:

1. Write `req0.json` yourself (example below).
2. `npx tsx /path/to/Req0/src/cli.ts implement --stack=nextjs-default` or `--stack=amplify-gen2`.
3. Choose **Next.js default** or **Amplify Gen 2** in the cockpit.

An existing app does not need a choice. Req0 does not guess a stack. Recording `amplify-gen2` writes a names-only `.env.example` if that file is missing. `ampx` does not read `.env` — use `npx ampx configure profile` (or export keys) before Implement.

```json
{
  "stack": {
    "id": "amplify-gen2",
    "label": "Amplify Gen 2, Next.js, Cognito, Data, S3"
  }
}
```

### What must be on disk

**Product repo root** (the folder that contains `docs/`):

| File | Who writes it | Why |
| --- | --- | --- |
| `docs/requirements/<kebab-id>/` | `create`, then you | The pack. Folder name is the requirement id (`invoice-approval`). |
| `req0.json` | You, the cockpit, or `implement --stack=` | Stack (`nextjs-default` or `amplify-gen2`), adapter (`cursor` / `manual`), and `"implement": false` when this repo is built another way. |
| `.env.example` | Req0, if missing, when `amplify-gen2` is recorded | Names only (`AWS_REGION`, `AWS_PROFILE` or access-key names). Copy to `.env` and fill values. Not overwritten. |
| `.env` | You | `TYPESAFE_API_KEY` for Check and allow-proof. For `amplify-gen2` only: copy `.env.example` and fill `AWS_REGION` plus `AWS_PROFILE` or access-key names. `ampx` still needs a profile (`npx ampx configure profile`) or exported keys — it does not open `.env`. Leave `AWS_SESSION_TOKEN` unset for IAM user keys (temporary/SSO creds only). Do not put those values in the Req0 checkout. |

**Inside the pack** (`docs/requirements/<kebab-id>/`):

| File | Who writes it | Why |
| --- | --- | --- |
| `requirement.md` | You | The spec. Required sections: Business Rules, Use Cases, Roles & Permissions. See [docs/grammar.md](docs/grammar.md). |
| `fixtures/personas.yaml` | `create` stubs; you finish | One test user (`email`) per matrix role. Ready stays blocked until every role has one. Never production credentials. |
| `fixtures/runtime.yaml` | `create` / Implement stub; you or the agent finish | Prove needs `baseUrl` and login selectors. Set `startCommand` and `resetCommand` to the app you actually run. |
| `derived/` | Req0 | Compiler output (`spec.json`, `health.json`, briefs, `qa-plan.yaml`, proof report). Do not hand-edit. |

Pack layout and grammar: [docs/grammar.md](docs/grammar.md). Artifact roles: [docs/product.md](docs/product.md).

## Run

```bash
npm install
npm test
npm start
```

`npm start` opens the cockpit (default [http://127.0.0.1:4370](http://127.0.0.1:4370)) for **this** checkout. To use another product repo, `cd` there first and invoke the CLI as above.

```bash
npx tsx src/cli.ts start
npx tsx src/cli.ts compile
npx tsx src/cli.ts create my-requirement
npx tsx src/cli.ts prove
```

Required sections in a pack’s `requirement.md`: Business Rules, Use Cases, Roles & Permissions. See [docs/grammar.md](docs/grammar.md).

Jev coaching needs `TYPESAFE_API_KEY` (see `.env.example`). Without a key, Ready stays Not yet. Persona blockers still apply. After a current Jev run the Ready pill shows pack noul (`Ready · 0.91`); saving the spec invalidates that score until you Check again. A valid compile writes `derived/implement-brief.md`. `req0 implement` starts a Cursor agent with that brief after Ready (`cursor agent login` first). `--adapter=manual` skips launch. After Proof failed or needs review, `req0 implement --from-proof` (cockpit **Fix from proof**) uses the last `proof-report.md` and does not edit `requirement.md`. `--stack=nextjs-default` or `--stack=amplify-gen2` records the stack when the product repo is empty. Create and Implement write `fixtures/runtime.yaml` if it is missing; the agent must finish `baseUrl` / start / reset. Set `"implement": false` in the product-repo `req0.json` to skip that stage. For stack `amplify-gen2`, give the Implement process an AWS identity before Build: `npx ampx configure profile` or export `AWS_REGION` and keys. Putting names in the product `.env` is not enough — `ampx` does not read that file. Leave `AWS_SESSION_TOKEN` unset unless the creds are temporary.

## How an implementation is proven

Prove is not a handwritten test suite. It runs the **same use cases** that are in `requirement.md` against the running product in a browser.

1. **Compile** writes `derived/qa-plan.yaml` from `spec.json` — one case per use case. `Look for …` is **deny**. `Choose …` is **allow**, even if the Outcome then says the control is absent (after success). Without those verbs, an Outcome that the control is absent / unchanged is **deny**. The control name is that label.
2. **Gate:** Prove stays off until Ready is Ready and `fixtures/runtime.yaml` parses (`baseUrl` + login selectors). Build succeeded is also required unless `req0.json` sets `"implement": false` or you **Ignore** a failed Build. Personas (who logs in) stay in `fixtures/personas.yaml`. Optional `resetCommand` runs in the product repo **before each case** so an earlier allow does not poison a later deny.
3. **Drive:** Playwright logs in as the case’s Actor, then follows `Open` / `Select` / `Choose` / `Look for`. Open picks a visible link from the step and preconditions — not product paths or record ids.
4. **Deny:** the control must be absent or disabled. That is the proof. No Jev, no invented HTTP posts.
5. **Allow:** click the control, then Jev (catalog `m4-proof-v1`) scores whether the **page observation** matches the use-case **Outcome**. It judges only what url, text, options, and visible controls can show. noul ≥ **0.75** pass, ≤ **0.15** fail, else needs review.
6. **Record:** `derived/proof-run.json` and `derived/proof-report.md`. The Proof meter is `not_yet` / `passed` / `failed` / `needs_review` / `stale` (spec changed, or a new succeeded build landed when Implement is owned). Re-prove is allowed.

Cockpit **Prove this requirement** is the same path as `req0 prove`. Chromium: `npx playwright install chromium` (system Chrome is used if the bundled browser is missing). Allow cases need `TYPESAFE_API_KEY`.

Granular walkthrough of the first product: [Case study: Invoice Desk](docs/case-study-invoice-desk.md).
