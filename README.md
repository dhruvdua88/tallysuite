# TallySuite

> The audit layer Tally never shipped. A browser-only audit workbench for
> TallyPrime exports — **offline-first, data never leaves the device.**

Built by a CA, for CAs. Drop a Tally export ZIP and everything runs in the tab:
no server, no upload, no telemetry. DeepSeek is an optional enhancement, never a
dependency.

## Status

| Module | State |
|---|---|
| **Ingestion core** — ZIP → NormalizedDataset, zod validation, sign self-test, integrity checks | ✅ done, verified on real data |
| **Trial Balance engine** — shared spine (opening/movement/closing, group rollup) | ✅ done |
| **Dashboard** — data-smell scan, ingestion health, voucher mix | ✅ done |
| **M2 Version Diff** — Differential Trial Balance, voucher add/delete/modify, risk flags | ✅ done, golden-tested |
| **M3 Consolidation + Schedule III** — group→Sch III mapping, multi-branch consol, check battery, Excel | ✅ done, balances to the paise |
| **M4 Year-on-Year** — BS/P&L deltas, 5 ratios, movers/new/closed, Excel | ✅ done |
| **M1 Confirmations** — billwise-vs-ledger grid + validation, docx letters + tracker | ✅ done |
| **M5 Sch III Reviewer** — deterministic rule engine, CARO 2020, Auditor's Report docx, optional DeepSeek | ✅ done |

All six modules run **offline**. DeepSeek (M5 AI review) is the only optional online call.

See [SPEC.md](./SPEC.md) for the full engineering specification.

## Architecture (ports & adapters)

```
src/core/   PURE TypeScript — no React, no DOM, no fetch. All accounting logic.
src/io/     adapters — File→bytes, sha-256, Excel/Word export, DeepSeek client.
src/state/  zustand store — dataset slots + navigation.
src/ui/     React — renders core results, owns zero business logic.
```

Every amount is an integer of **paise** (no float money). Numbers reconcile to
`mst_ledger` closing balances via a runtime **sign self-test**, so the suite is
robust to exporter sign-convention changes.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc + vite build → dist/ (static, host anywhere)
npm test           # vitest (core + golden tests on real fixtures)
npm run typecheck
```

## M2 — Differential Trial Balance (the idea)

Two snapshots of the same company. Because every Tally voucher nets to zero, any
add/delete/edit moves ≥2 ledgers equal-and-opposite. So "what changed" is best
read as a **Trial Balance of Differences**:

```
Δ(L) = Σ V2.movement[L] − Σ V1.movement[L]      invariant:  Σ Δ = 0
```

Δ≠0 rows pinpoint exactly which ledgers moved and by how much; click through to
the contributing vouchers and their field-level diffs. Deterministic risk flags
(cash/bank touched, date moved across a period end, deleted sales/purchase,
post-period inserts, round-figure changes) — no AI required.

## Fixtures & tests

`fixtures/real/` holds (gitignored) real exports for local testing.
`scripts/mutate-fixture.mjs` scripts a tamper scenario (1 delete, 1 amount edit,
1 date move, 2 inserts) into `scaffhire-v2.zip` — the mutations *are* the test
that M2 catches them and `Σ Δ = 0`.

## Privacy

`index.html` ships a CSP locking egress to `'self'` + `https://api.deepseek.com`
only. Stage demos run in airplane mode; the architecture is the pitch.
