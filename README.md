# Req0

A requirement operating system: structured packs, a local Requirement Owner cockpit, Jev judgments, coding-agent implementation, and browser proof.

**Documentation:** [docs/README.md](docs/README.md) — product guides live there. `docs/requirements/` is only for requirement packs (including the golden `invoice-approval` fixture).

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
```

Required sections in a pack’s `requirement.md`: Business Rules, Use Cases, Roles & Permissions. See [docs/grammar.md](docs/grammar.md).

Jev coaching needs `TYPESAFE_API_KEY` (see `.env.example`). Without a key, Ready stays Not yet. Persona blockers still apply. A valid compile writes `derived/implement-brief.md`. `req0 implement` starts a Cursor agent with that brief after Ready (`cursor agent login` first). `--adapter=manual` skips launch.

`req0 prove` (and the cockpit **Prove this requirement** button) runs after Build succeeded when `fixtures/runtime.yaml` is present. Deny cases are deterministic UI checks; allow cases ask Jev whether the page matches the Outcome. Chromium: `npx playwright install chromium`.
