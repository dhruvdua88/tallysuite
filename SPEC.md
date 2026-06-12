# TallySuite — Engineering Specification

**Status:** Draft v1 · **Owner:** Dhruv Dua · **Target:** ICAI Hackathon demo + production use at D D & Co.

A browser-only audit workbench for TallyPrime exports. Five modules over one shared ingestion core.
**Prime directive: every feature works with the network cable unplugged.** DeepSeek is a progressive
enhancement, never a dependency.

---

## 1. Non-negotiable principles

| # | Principle | Concrete meaning |
|---|---|---|
| P1 | **Offline-first** | Every module produces its full output with zero network. AI adds narration/judgement on top, behind an explicit toggle, with visible "AI used" badges on any output it touched. |
| P2 | **Data never leaves the machine** | No telemetry, no upload, no CDN-hosted fonts/scripts at runtime (self-host everything in the bundle). The only permitted egress: user-initiated DeepSeek calls (P1 applies). CSP header enforces this: `connect-src 'self' https://api.deepseek.com`. |
| P3 | **Pure functional core, imperative shell** | All accounting logic = pure TypeScript functions `(NormalizedData, Params) → Result`. No React, no DOM, no fetch, no Date.now() inside `core/`. UI and IO live in the shell. This is what makes the test strategy (§7) possible. |
| P4 | **Determinism** | Same input files → byte-identical results (stable sort orders everywhere, no Map iteration-order leaks, fixed rounding rules). Required for golden-file testing and for audit defensibility. |
| P5 | **Numbers are exact** | All amounts in **paise as integers** (`bigint` if any ledger can exceed ₹92 lakh crore, else `number` — see ADR-002). Never float arithmetic on money. Parse once at ingestion boundary, format only at render/export boundary. |
| P6 | **Fail loud at the boundary** | Zod schemas validate every parsed file. A malformed export produces a precise ingestion report ("trn_accounting row 4 512: amount unparseable: '1,23,45'"), never a silently wrong trial balance. |

---

## 2. Repository layout (architecture = ports & adapters)

```
tallysuite/
├── src/
│   ├── core/                    # PURE. No imports from ui/, io/, react. ESLint-enforced (§8).
│   │   ├── model/               # Domain types + zod schemas
│   │   │   ├── schema.ts        # LedgerRow, VoucherRow, AccountingLine, BillRow… (zod)
│   │   │   ├── money.ts         # Paise type, parse/format/sum, sign conventions
│   │   │   └── dataset.ts       # NormalizedDataset = the one shape all modules consume
│   │   ├── ingest/              # bytes → NormalizedDataset (pure transform; file IO in shell)
│   │   │   ├── xlsxZip.ts       # Tally export ZIP (xlsx tables)
│   │   │   ├── sqlite.ts        # .sqlite via sql.js
│   │   │   └── validate.ts      # cross-table integrity (orphan GUIDs, voucher Σ=0 …)
│   │   ├── tb/                  # trial balance engine (shared by M2, M3, M4)
│   │   │   └── trialBalance.ts  # buildTB(dataset, asOn?) → TBRow[]
│   │   ├── m1-confirmations/
│   │   ├── m2-versiondiff/
│   │   ├── m3-sch3/
│   │   │   ├── mapping.ts       # group → Sch III head (data-driven table, §5.3)
│   │   │   ├── balanceSheet.ts
│   │   │   ├── profitLoss.ts
│   │   │   └── checks.ts        # the 26+ validation checks (§5.4)
│   │   ├── m4-yoy/
│   │   └── m5-review/           # rule engine ported from sch3-reviewer (already pure-ish)
│   ├── io/                      # ADAPTERS (impure)
│   │   ├── files.ts             # File/drag-drop → ArrayBuffer
│   │   ├── excel.ts             # Result → exceljs workbook
│   │   ├── word.ts              # Result → docx (confirmations, audit report)
│   │   └── deepseek/
│   │       ├── client.ts        # hardened client (§6)
│   │       └── prompts/
│   ├── state/                   # zustand stores; holds NormalizedDataset slots
│   └── ui/                      # React. Renders core results. Owns zero business logic.
│       ├── shell/               # layout, cmdk, file slots, theme
│       └── modules/             # one folder per module screen
├── fixtures/                    # test datasets (§7.2) — committed, anonymized
├── tests/
│   ├── unit/                    # vitest, core only
│   ├── golden/                  # golden-file comparisons
│   ├── property/                # fast-check invariant tests
│   └── e2e/                     # playwright: drop file → assert rendered numbers
├── scripts/
│   ├── make-fixture.ts          # anonymizer: real export → fixture (names/PAN/GSTIN scrambled, amounts preserved or scaled)
│   └── parity-check.py          # one-off: compare M3 output vs tally-fin-statements Python output (§7.4)
└── docs/adr/                    # architecture decision records (ADR-001 …)
```

**Rule:** `core/` imports nothing from `io/`, `ui/`, `state/`. Modules depend on `core/model` + `core/tb`, never on each other's internals. Cross-module flows (M3 BS → M5 review) pass through an explicit published interface (`core/m3-sch3/index.ts` exports `Sch3Statements`, M5 accepts it as input type).

---

## 3. Shared ingestion core

### 3.1 Input formats
1. Tally export **ZIP** (xlsx tables — `mst_*`, `trn_*`, `config.xlsx`, README) — primary
2. **.sqlite** companion file (same tables; prefer when present — faster, has `daybook_accounting_lines`)
3. Multiple slots: each loaded file becomes a named **Dataset Slot** (company, period, generated-at, AlterID watermarks parsed from `config.xlsx`). Modules declare arity: M1/M3 take 1..n slots, M2/M4 take exactly 2.

### 3.2 NormalizedDataset (the contract)
```ts
interface NormalizedDataset {
  meta: { company: string; periodFrom: ISODate; periodTo: ISODate;
          generatedAt: string; lastAlterIdMaster?: number; lastAlterIdTransaction?: number;
          sourceFile: string; contentHash: string }          // sha-256 of source bytes
  ledgers: LedgerMaster[]        // name, parent, PAN, GSTIN, opening/closing (paise), addr, bank…
  groups: GroupMaster[]          // with resolved primary_group + affects_gross_profit
  vouchers: VoucherHeader[]      // guid, date, type, number, party, narration…
  lines: AccountingLine[]        // guid (FK voucher), ledger, amountPaise (sign as exported)
  bills: BillAllocation[]        // guid, ledger, billName, amountPaise, billType, creditPeriod
  openingBills: BillAllocation[]
  bank: BankLine[]; inventory: InventoryLine[]; gstRates: GstRateRow[]
}
```
All FK integrity checked at ingest (`validate.ts`): every `line.guid` resolves to a voucher; every
`line.ledger` to a master; **every voucher's lines sum to 0** (Tally invariant — violations go to the
ingestion report, not silently dropped). Ledger names are keys: trim + collapse internal whitespace
at parse, preserve case (Tally is case-preserving but name-unique case-insensitively — normalize key
= `name.toLowerCase()`).

### 3.3 Sign convention (write this once, test it forever)
`trn_accounting.amount` sign is **as exported by Tally** (observed: negative = Debit, positive = Credit
in current exporter — but DO NOT hardcode this belief): ingestion runs a **sign self-test** — compute
`closing = opening + Σlines` for 20 sampled ledgers and compare against `mst_ledger.closing_balance`.
If matches inverted, flip a `signConvention` flag dataset-wide. This makes the suite robust to exporter
version changes. Self-test result shown in ingestion report.

---

## 4. Module M2 — Version Diff (**revised design: Differential Trial Balance**)

### 4.1 Concept
Two snapshots of the same company (V1 = earlier export, V2 = later). Because every voucher nets to
zero, **any voucher added/deleted/edited shifts at least two ledgers in equal and opposite amounts**.
So the most readable summary of "what changed" is not a voucher list — it is a **Trial Balance of
Differences**:

```
for each ledger L:  Δ(L) = Σ V2.lines[L] − Σ V1.lines[L]      (transaction movement only)
TB-Diff invariant:  Σ over all ledgers Δ(L) = 0                (hard assertion; if ≠0 → ingestion bug)
```

### 4.2 Pipeline (all pure, in `core/m2-versiondiff/`)
1. **Guard rails:** same company check (GUID prefix of vouchers — e.g. `23a0a0e3-…` — must match;
   warn + allow override), period overlap report, AlterID watermark banner
   (`lastAlterIdTransaction` V1 vs V2 → "books touched" tripwire before any heavy compute).
2. **Voucher-level diff on GUID** (`diffVouchers`):
   - `added`: GUID in V2 only · `deleted`: GUID in V1 only
   - `modified`: GUID in both but header fields differ OR line multiset differs
     (compare canonicalized lines: sorted by (ledgerKey, amount); field-level diff retained)
   - `unchanged`: identical (skip fast via per-voucher content hash computed at ingest)
3. **Ledger aggregation** (`buildDiffTB`): roll every added/deleted/modified voucher's lines into
   Δ per ledger. Each TBDiff row: `{ ledger, group, v1Movement, v2Movement, delta,
   contributingVouchers: GuidRef[] }`.
4. **Risk annotations** (pure rules, no AI): delta on cash/bank ledgers, vouchers whose date moved
   across a month/period end, deleted Sales/Purchase vouchers, modifications dated near period close,
   round-figure deltas.

### 4.3 UI
- **TB view as primary screen** (this is the user's requested change): ledger rows grouped by
  Sch-III-ish group tree, three numeric columns (V1 movement · V2 movement · **Δ**), Δ≠0 rows
  highlighted (red/green by direction), Δ=0 rows collapsed by default behind a "show unchanged" toggle.
- Footer row proves `ΣΔ = 0.00` — turn this into a UI feature ("differences balance ✓"), it doubles
  as the runtime assertion.
- Click a Δ row → drawer with contributing vouchers → click voucher → side-by-side field diff
  (old/new, changed cells highlighted), tagged added/deleted/modified.
- Counters strip on top: `+12 added · −3 deleted · 9 modified · 4 024 unchanged`.
- Export: Excel workbook — Sheet 1 TB-Diff, Sheet 2 voucher diffs, Sheet 3 risk annotations,
  Sheet 4 metadata (files, hashes, watermarks) — the tamper working paper.
- Optional AI (P1): one button, "narrate top 10 deltas" — output clearly badged.

### 4.4 Tests
- Property test (fast-check): generate random balanced voucher sets, apply random
  add/delete/edit mutations → assert `ΣΔ=0`, assert every mutation surfaces in exactly the right
  ledgers with the right Δ.
- Golden test: `fixtures/scaffhire-v1.zip` + `fixtures/scaffhire-v2.zip` (v2 = scripted mutation of v1:
  1 deleted payment, 1 amount edit, 1 date move, 2 inserts) → TB-Diff output matches committed JSON.
- The mutation script (`scripts/mutate-fixture.ts`) is itself committed = the test documents the attack
  scenarios we claim to catch.

---

## 5. Module M3 — Consolidation + Schedule III (port from `tally-fin-statements`)

### 5.1 Scope of port
Re-implement in TS inside `core/m3-sch3/`: group→head mapping, BS + P&L builders, note schedules,
multi-branch consolidation with **period-match hard gate** (refuse, don't warn, on mismatched
`periodFrom/periodTo` — same behavior as Python v2.0). Projections engine: **out of scope v1** (ADR-004)
— biggest source of Python complexity, zero demo value.

### 5.2 TB engine first
`buildTB(dataset)` = opening + movement + closing per ledger, rolled up the group tree to
`primary_group`. This single function feeds M3 (statements), M4 (comparison) and M2 (diff grouping).
Build and test it before any Sch III work.

### 5.3 Mapping is data, not code
`mapping.ts` exports a declarative table: `primary_group/group name patterns → Sch III line + note`.
Unmapped groups land in a visible "Unmapped" bucket that **blocks export until user assigns them**
(UI dropdown, persisted per-company in localStorage) — never silently bucket into "Other".
Mirror the Python tool's default map as the seed; record deviations in ADR-005.

### 5.4 Offline validation battery (strengthened — runs on every generation, no AI)
Categories, each check = pure function `(Sch3Statements, NormalizedDataset) → CheckResult{pass|fail|warn, detail, drillDown}`:

1. **Structural:** Total Assets = Total Equity+Liabilities (exact, paise); every note total ties to its
   face line; every BS/P&L figure traces to ≥1 ledger (no orphan amounts); consolidated column =
   Σ branch columns per line.
2. **Books tie-out:** BS top-to-bottom vs TB closing (Σ assets − Σ liabilities − Σ equity = 0 against
   TB); P&L profit = movement in surplus before appropriations; closing cash per BS = Σ bank/cash
   ledger closings.
3. **Sign sanity:** no negative gross block, negative cash flagged, debtors credit-balances and
   creditors debit-balances listed (reclassification candidates with one-click reclass).
4. **Master-data:** ledgers with `is_deemedpositive` inconsistent with group; opening_balance ≠
   prior-year closing when YoY slot loaded.
5. **Cross-module:** if billwise present, Σ bills vs ledger closing per party (shared engine with M1).

Results panel = first-class screen (not a toast): grouped pass/warn/fail, every fail row has
drill-down to ledger/voucher level. Export embeds the full check log in the Excel (Validation sheet —
parity with Python tool's 26 checks, then exceed it).

### 5.5 Parity harness (one-time, throwaway, high value)
`scripts/parity-check.py`: run the existing Python tool on the same fixture, dump its BS/P&L numbers
to JSON; vitest golden test asserts TS output matches Python output to the paise on
`fixtures/scaffhire` and `fixtures/nimbus`. Where they intentionally diverge → document in ADR-005.
This is how a port earns trust without re-deriving accounting from scratch.

---

## 6. DeepSeek policy (strictly optional everywhere)

### 6.1 Product rules
- App boots, ingests, runs **all five modules** with no key configured. The key gate of sch3-reviewer
  becomes a **settings panel**, never a launch gate.
- Every AI-capable surface ships its deterministic version first; the AI button sits beside it labeled
  "AI narration (optional)". Outputs touched by AI carry a visible badge + are segregated in exports
  (separate sheet/section "AI-assisted observations").
- M5's Deep Review (73 tests) stays AI-backed by definition — but M5 must be valuable key-less:
  Quick Review rule engine + CARO arithmetic + audit report generator + Excel working paper are all
  deterministic and must run offline. Frame in UI: "Rule Review (always) / AI Review (optional)".

### 6.2 Hardened client (`io/deepseek/client.ts`) — fixes the "fails sometimes"
1. **Structured output:** `response_format: {type:'json_object'}` + zod parse; on parse failure,
   one repair round-trip (send zod error + raw text back); max 2 repairs, then mark batch failed.
2. **Batching:** 73 tests → batches of 8–10 with independent promises; one batch failing ≠ run failing.
   Progress = per-batch chips with individual retry buttons.
3. **Retry/backoff:** 429/5xx/network → exponential backoff (1s/4s/15s, jitter), abort-controller
   timeout 90s per call.
4. **Fallback chain:** `deepseek-v4-pro → deepseek-v4-flash` after 2 consecutive hard failures, with UI
   notice of degraded model.
5. **Cache:** key = sha-256(model + prompt + chunk text) → localStorage/IndexedDB; reruns and demo
   rehearsals cost zero and cannot fail.
6. **Token budget guard:** estimate chunk tokens before send; auto-split over-long chunks rather than
   letting the API truncate silently.
7. Telemetry of failures to console + downloadable diagnostic log only (P2 — nothing phones home).

---

## 7. Test strategy (the answer to "strengthen offline testing")

### 7.1 Pyramid
- **Unit (vitest):** money math, sign convention, mapping table, every check function. Target: `core/` ≥90% line coverage, enforced in CI.
- **Property (fast-check):** invariants — voucher Σ=0 preserved through ingest; `buildTB` closing =
  opening+movement; M2 `ΣΔ=0`; consolidation column additivity; BS balances whenever input TB balances.
- **Golden files:** committed fixture in → committed JSON/Excel-values out; any diff = explicit review.
  Goldens regenerate only via `npm run golden:update` (never auto).
- **E2E (playwright):** drop fixture ZIP → assert on-screen BS total, run M2 → assert Δ counters,
  export → parse the xlsx back and assert cell values. Run headless in CI.
- **Parity:** §5.5 against the Python tool (M3) and against FinAnalyzer-CSV's TSF Compare counts (M2).

### 7.2 Fixtures
- `fixtures/scaffhire/` + `fixtures/nimbus/` — real exports through `make-fixture.ts` anonymizer
  (names→FAKER deterministic seed, PAN/GSTIN→valid-format fakes, amounts kept — amounts are the test).
- `fixtures/micro/` — hand-built 12-voucher company covering every voucher type, billwise, forex line,
  zero-line edge, duplicate ledger-name-casing. Small enough to verify by hand; most unit tests use this.
- `fixtures/hostile/` — malformed: missing columns, unbalanced voucher, orphan GUID, '1,23,45' amounts,
  empty tables. Ingestion must produce the right *errors* (tested), not crash.

### 7.3 CI (GitHub Actions)
`lint (incl. import-boundary rule §8) → typecheck → unit+property → golden → build → e2e`.
PR blocked on any failure. Bundle-size budget check (P2: no runtime CDN, so bundle matters).

---

## 8. Engineering standards

- **TypeScript strict**, `noUncheckedIndexedAccess`. Domain types branded (`Paise`, `LedgerKey`,
  `Guid`) — can't pass a rupee float where paise expected.
- **ESLint `import/no-restricted-paths`** enforces §2 boundaries (core can't import io/ui/state).
  Architecture that isn't lint-enforced erodes by Friday.
- **ADRs** in `docs/adr/` for every decision someone will question later: ADR-001 ports&adapters,
  ADR-002 paise-as-number vs bigint, ADR-003 sql.js vs DuckDB-WASM (start sql.js — files already
  sqlite; revisit if >500k lines), ADR-004 projections out of scope, ADR-005 Python-parity deviations.
- **Conventional commits**, small PRs per module, CHANGELOG per release.
- **Error model:** core functions return `Result<T, DomainError>` (neverthrow or hand-rolled) — no
  throws across the core boundary; UI maps DomainError → human message with drill-down.
- **Performance budget:** 12k-line company ingests <2s, TB <100ms, M2 diff <500ms on M1 MacBook;
  perf test in CI on the scaffhire fixture. Web worker for ingest+diff so UI never janks (worker is
  shell, calls the same pure core).

---

## 9. Build order (revised)

| Phase | Deliverable | Exit test |
|---|---|---|
| 0 | Scaffold, lint boundaries, CI, fixtures pipeline, ingestion + validation report, **TB engine** | golden TB on micro + scaffhire fixtures green |
| 1 | **M2 Differential TB** (full §4) | property + mutation golden green; demo-able |
| 2 | **M3** mapping + BS/P&L + consolidation + check battery | parity harness ≤ paise vs Python; hostile fixtures produce correct errors |
| 3 | **M4** on TB engine (YoY views, period validation) | golden on scaffhire-FY25 vs FY26 synth |
| 4 | **M1** confirmations (billwise/ledger logic + validation grid + docx batch) | golden letter set |
| 5 | **M5** port + M3→M5 pipe + DeepSeek hardening (§6) | key-less run produces full rule review + audit report; AI batch-failure drill passes |
| 6 | Polish: cmdk, animations, smell-scan dashboard, demo dataset, rehearsal | full demo arc offline, airplane mode |

---

## 10. Demo invariant

The entire stage demo runs in airplane mode. One optional moment reconnects wifi for a single
badged DeepSeek narration — then airplane mode again. The architecture *is* the pitch.
