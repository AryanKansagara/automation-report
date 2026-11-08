# Automation Opportunity Report

Shows a head of support, from their own ticket history, which customer requests an AI agent could resolve, what that is worth, and what to fix first.

**Live:** https://automation-report-iota.vercel.app

## The pain

Support leaders keep asking how much AI deflection really handles, and every vendor counts "automated resolution" differently. The only number worth trusting comes from your own tickets, scored against a strict bar: resolved means the request was answered without escalating to a person.

## What it does

- **Import** Zendesk (JSON or CSV), Intercom (CSV or API JSON), Freshdesk CSV or any CSV. The format is detected, columns are mapped, and you get a validation report with line numbers.
- **Redact first**: emails, phone numbers, Luhn-valid card numbers, IP addresses, street addresses, postal codes and self-introduced names are removed before anything else, with a before/after preview. Signatures, quoted replies, HTML and disclaimers are stripped.
- **Discover intents** in the browser: all-MiniLM-L6-v2 embeddings (transformers.js in a Web Worker), seeded k-means with k chosen by silhouette, c-TF-IDF keywords and subject-line names. Rename, merge, split, with undo.
- **Score automatability** from repetition, information vs account action, agent answer consistency, reopens, time to resolve, sentiment and escalations. Every factor is explained and every verdict can be overridden (automatable / needs action API / human only).
- **Knowledge gaps**: fetch a public Zendesk Help Center or upload articles, match them to intents by embedding similarity, and get a content brief for the gaps.
- **ROI**: your cost per ticket, your per-resolution price, a ramp curve, and conservative/base/optimistic ranges with payback.
- **Outputs**: a printable, shareable executive report, a now/next/later roadmap (Markdown), and an intent catalogue (CSV/JSON) with example phrasings, answer outlines and required APIs.
- **Snapshots and compare**: import every month into the same intent catalogue and see which topics shrank.
- **Local-first workspace** in IndexedDB. Optional email/password account syncs derived reports only (never ticket text) across devices.

Includes a synthetic e-commerce sample (2,550 tickets over two months, 15 intents, noise and planted PII) with a precomputed embedding cache so the demo is instant.

## Run locally

```bash
npm install
npm run dev        # http://localhost:4333
npm test           # engine tests
npm run build
npm run cache      # regenerate public/emb/*.bin after changing the sample generator
```

Cloud sync needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env`; without them the app runs fully local.

Built by Aryan Kansagara. Independent project, not affiliated with Ada.
