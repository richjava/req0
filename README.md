# Invoice approval

Department managers approve supplier invoices for their own department. A manager may approve only if they are the assigned approver and the invoice belongs to their department. Viewers can read invoices but cannot change status. Admins assign an approver; they cannot approve.

## Stack

Amplify Gen 2 (Cognito Auth, Data, S3) + Next.js App Router.

## Setup

1. Copy `.env.example` to `.env` and set `AWS_REGION` plus `AWS_PROFILE` or access keys. `ampx` does not read `.env` — export the vars or run `npx ampx configure profile`.
2. Deploy the sandbox backend (writes `amplify_outputs.json`):

```bash
npm run sandbox
```

3. In another terminal, seed Cognito personas and fixture data:

```bash
npm run db:seed
```

4. Start the app (restart after `amplify_outputs.json` changes):

```bash
npm run dev
```

Login personas are in `docs/requirements/invoice-approval/fixtures/personas.yaml`.

Req0 runtime: `docs/requirements/invoice-approval/fixtures/runtime.yaml`.

---

## Req0 CLI

This repo also hosts the Req0 requirement operating system. See [docs/README.md](docs/README.md). Req0 CLI build: `npm run build` (uses `tsconfig.cli.json`).
