# Automation Opportunity Report

Shows a head of support, from their own ticket history, which customer requests an AI agent could resolve, what that is worth, and what to fix first.

**Live:** https://automation-report-iota.vercel.app

## The pain

Support leaders keep asking how much AI deflection really handles, and every vendor counts "automated resolution" differently. The only number worth trusting comes from your own tickets, scored against a strict bar: resolved means the request was answered without escalating to a person.

## What it does

- **Import** Zendesk (JSON or CSV), Intercom (CSV or API JSON), Freshdesk CSV or any CSV. The format is detected, columns are mapped, and you get a validation report with line numbers.
- Importers are tested against fixtures laid out like each vendor's documented export (Zendesk's 40-column ticket CSV, Zendesk Tickets API with sideloaded metric sets, Intercom Conversations API, Freshdesk CSV with day-first dates and hh:mm:ss durations).
- **Redact first**: emails, phone numbers, Luhn-valid card numbers, IPv4 and IPv6 addresses, street addresses, postal codes and self-introduced names are removed before anything else, with a before/after preview. Signatures, quoted replies, HTML and disclaimers are stripped.
- **Discover intents** in the browser: all-MiniLM-L6-v2 embeddings (transformers.js in a Web Worker), seeded k-means with k chosen by silhouette, c-TF-IDF keywords and subject-line names. Rename, merge, split, with undo.
- **Score automatability** from repetition, information vs account action, agent answer consistency, reopens, time to resolve, sentiment and escalations. Spam and empty "ok/thanks/test" clusters are recognised and kept out of the ROI. Every factor is explained and every verdict can be overridden (automatable / needs action API / human only).
- **Knowledge gaps**: fetch a public Zendesk Help Center or upload articles, match them to intents by embedding similarity, and get a content brief for the gaps.
- **ROI**: your cost per ticket, your per-resolution price, a ramp curve, and conservative/base/optimistic ranges with payback.
- **Outputs**: a printable, shareable executive report, a now/next/later roadmap (Markdown), and an intent catalogue (CSV/JSON) with example phrasings, answer outlines and required APIs.
- **Snapshots and compare**: import every month into the same intent catalogue and see which topics shrank.
- **Local-first workspace** in IndexedDB. Optional email/password account syncs derived reports only (never ticket text) across devices.

Includes a synthetic e-commerce sample (2,550 tickets over two months, 15 intents, noise and planted PII) with a precomputed embedding cache so the demo is instant.

### What redaction does and does not catch

Detection is heuristic pattern matching, so it is not complete and should not be treated as a guarantee.

- **Where it runs:** subject, message, agent replies, channel and tags. A ticket id that contains personal data becomes a neutral id (`redacted-<line>`); duplicate ids are detected on the original value first, so two different people never merge into one ticket. Validation messages never repeat file contents. Tags are read for escalation before they are redacted.
- **Detected:** emails (Unicode letters allowed), phone numbers, Luhn-valid card numbers, IPv4 and IPv6 addresses (times, MAC addresses and version numbers are not treated as addresses), North American street addresses and postal codes, and names after a cue such as "my name is" or "Name:" in any capitalization when the name starts with a capital letter, so "my name is wrong on the invoice" is left alone.
- **Not detected:** names without a self-introduction cue, other address formats, government ids such as SSNs, usernames, account or order numbers, and personal data in columns the importer does not read.
- **Shown unredacted on purpose:** the column-mapping preview and the "Original" pane of the redaction preview display your own file in your browser. They are never stored or synced.

## Run locally

```bash
npm ci             # or npm install
npm run dev        # http://localhost:4333
npm test           # engine tests
npm run build
npm run test:e2e   # builds, then runs the Playwright (Chromium) suite against `vite preview`
npm run cache      # regenerate public/emb/*.bin after changing the sample generator
```

The first time, run `npx playwright install chromium` to download the browser the E2E suite uses. The suite runs signed out with all external network requests blocked and does not download the embedding model. A committed `.npmrc` sets `onnxruntime-node-install-cuda=skip`, so `npm ci` works on Linux without CUDA downloads (the app only runs the model in the browser).

Cloud sync needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env`; without them the app runs fully local.

Built by Aryan Kansagara.
