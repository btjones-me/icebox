# Local end-to-end development

Run the whole local stack with:

```sh
npm run dev:local
```

This starts three loopback-only services:

- Icebox PWA: `http://127.0.0.1:4173/`
- Local data control: `http://127.0.0.1:4174/`
- Cloudflare-compatible Worker API: `http://127.0.0.1:8787/`

The app and API use the same Worker, D1 queries, R2 object operations, authorization checks, validation, rate limits, and OpenAI label integration intended for Sites. Local D1 and R2 data persist under `.local/`, which is ignored by source control.

The local runner watches Worker code and both migration directories. It restarts the API after a backend change and verifies the restarted process against a source fingerprint before reporting it ready. The data-control status shows the active `local-…` Worker version, making a stale or mixed frontend/backend session visible. Changes to `.env`, dependencies, or the local runner itself still require restarting `npm run dev:local`.

## Local identity

The development runtime supplies one fixed ChatGPT-like identity: Alex Morgan (`alex@example.com`). This is enabled only when the Worker has `LOCAL_DEV_MODE=1` and the request hostname is `127.0.0.1` or `localhost`. A deployed Worker neither sets that binding nor accepts this identity path.

Real dispatch-owned Sign in with ChatGPT cannot be reproduced on localhost. Local development exercises everything after the trusted identity headers have been established.

## Fixture states

Use the data-control app to replace local data with one of three states:

- Demo inventory: Alder House, two freezers, eight drawers, and eight items.
- Empty household: the same freezer structure with no items.
- Fresh onboarding: no local user or household; the next Icebox bootstrap creates Alex and opens induction.

Every fixture switch clears local inventory, memberships, AI usage, backup outbox state, and R2 uploads. Reload Icebox after switching.

## OpenAI labels

`scripts/local-backend.mjs` reads `.env` without copying or printing its values. If `OPENAI_API_KEY` is present, photo uploads and `POST /api/ai/label` use the real server-side Responses API path. The data-control status shows only whether a key is configured.
