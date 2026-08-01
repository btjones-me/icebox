# Icebox

Icebox is a private, installable freezer-inventory PWA for households. It uses Sites-owned Sign in with ChatGPT, D1 for authoritative data, private R2 objects for photos, the OpenAI Responses API for editable photo labels, and a private operator-owned Google Sheet as a disaster-recovery mirror.

## Local development

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 4173
```

The Vite-only preview uses realistic local data because authenticated Worker routes are available only in the Sites runtime. Keep secrets in `.env`; the file is ignored. Copy `.env.example` when configuring a new environment.

## Verification

```sh
npm run build
npm test
npm run test:runtime
```

Apply `migrations/0001_initial.sql` to the `DB` D1 binding before running the hosted Worker. The app expects a private R2 binding named `MEDIA`.

## Deployment boundary

This repository is Sites-ready, but it must not be deployed or made public without explicit approval. See `docs/OPERATIONS.md` for secrets, backup setup, reconciliation, recovery, and privacy notes.
