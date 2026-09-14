# RFC 0001 tracker — event-first catalogues

Tracker for `docs/rfcs/0001-event-first-catalogues.md`. One agent owns a phase at a time; tick
items only with the evidence named beside them.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

## Status 2026-09-15 — Milestone 1 deviation close-out

An over-engineering audit against the merged tree found three deviations from the locked decisions
and a body of stale vocabulary the legacy sweep never searched for. Resolved in this pass:

- **D3, loans** — a repayment row is recovered **whole** by exactly one payslip. The partial
  recovery machinery is gone: `consumedRepayments`, `prepareLoanConsumption`, `repaymentOutstanding`,
  `assertWithinRepayment`, `settlesSource` and `src/lib/settlement_refusals.ts`. `measureLoanRecoveries`
  takes the earliest unlinked repayment per agreement due by the period; `settle` drops whole
  recoveries (last emitted first) when net would go negative and the engine leaves those rows
  unpinned, so the next run recovers them. `LOAN_REPAYMENT_SHORT` / `_BELOW_MINIMUM` keep their
  meaning over the dropped amount. The loans page counts a repayment as recovered once the slip it
  links is paid.
- **D3, leave** — the RFC is amended to the landed behaviour: a time-off entry settles whole in one
  period and a straddling range is refused at payroll and entered per period. No engine split.
- **D14** — `payroll_runs.lifecycle` is gone entirely; the Payroll page rolls its slips up. The RFC
  and `docs/architecture.md` no longer describe a run status.
- **Vocabulary sweep** — 91 unreferenced i18n keys (the whole `renderer.statutory_rules.*` block,
  `special_amounts`, scheme band/order/exception sections, `app.payroll.lifecycle`, …) deleted from
  both catalogues; "contribution treatments" wording rewritten in the three live descriptions;
  every comment describing capture junctions, treatment matrices or `treatmentsInForce` rewritten
  to the pin (`payslip_id`); `work_rules.lines.night` → `engine_lines` in architecture.md;
  `tests/work-catalogue.test.ts` → `ordinary-rate.test.ts`, `overtime-treatments.test.ts` →
  `overtime-pay-items.test.ts`.

Gates and probes for this pass are recorded in the Milestone 1 block below once observed.

## Status 2026-09-14 (RFC 0002 close-out)

RFC 0001's catalogue spine, work rules, destinations/directions, entries and `payslip_id` stand.
Its statutory scheme shape does not: RFC 0002 replaced it, and the Phase 2 blocks below record a
differently-shaped intermediate revision (`eligibility`, `sequence`, typed `statutory_rules`,
`scheme_reliefs`, `contribution_bands`) that no longer exists in the tree. Read those blocks as
history, not as a description of the code.

The RFC 0002 audit's deviations were closed in this pass:

- **Write-time FK** (`src/lib/catalogue_rules.ts`, `leave_catalogue/+hooks.ts`,
  `jurisdiction_settings/+hooks.ts`): every `statutory_opt_ins` id — catalogue bands, work bands and
  engine lines — must name a scheme of the row's own settings version, or the write refuses. The
  run-build `OPT_IN_UNKNOWN` guard now covers every family, not only Work.
- **Write-time dependency contract** (`statutory_contributions/+hooks.ts`): every rule's `when`,
  `employee` and `employer` compile; every `produced.<code>` mention names a scheme of the version;
  a mention that closes a loop refuses with its path; a producer another rule names cannot be
  deleted. `mentions.ts` reads mentions from the compiled CEL AST (a string literal is not a
  mention) with a per-rules cache.
- **Clone remap** (`settings_clone.ts`, `+statutory_drift.ts`): scheme rows keep their codes under
  new ids, so every opt-in in cloned catalogue bands, cloned work rules and drift-proposed opt-ins
  is remapped to the clone's scheme id.
- **Shims purged**: `ContributionBase/Charge.special`, `special_amounts`, the dead rounding methods
  (`NONE`, `TABLE`, the paired total) and the drift `bands` alias are gone; the datatype is
  `contribution_rules`; the scheme UI names rules and shows the opted-in lines and the derived
  `produced.<code>` dependencies.
- **Docs**: `docs/architecture.md` contribution section rewritten to the landed shape; RFC 0001 §8
  marked superseded; RFC 0002 finalized.

Gates for this pass: `pnpm sync` clean (24 collections); `pnpm lint` clean; `pnpm test` green —
`norbital-doctor` 0 error 0 hint, four verify scripts and **853/853 tests**.

The local probe also ran: `pnpm run env -- serve --template=hr-payroll --seed=bank`, then a real
OpsPH semi-monthly run through the UI (10 payslips; statutory rows read back with the governing
rule's `when`, base, employee and employer), plus the payslip's derivation affordance and the scheme card's flow diagram. It surfaced
two things this pass then closed: pinned catalogue revisions' opt-ins are aliased to the version in
force (`loadOptInAliases`), and Nihon loan `40069e44…` in the bank was a mapping defect — the
workbook's `SUM(E10:U10)` misses the last two of 12 filled instalment cells, so `principal` is
corrected from the cached 845.00 to the grid's own 1,014.00.

## Status 2026-09-14 (post-audit close-out)

An audit against the merged tree found the migration structurally landed but with real gaps. This
pass closed them:

- **Schedule-time limit gate** (`src/lib/scheduling/work-limits.ts`): `limits` are now enforced on
  pattern writes and roster overrides, not only reported at payroll. The gate projects the pattern
  cycle plus the explicit overlay (day → year), evaluates a CLOCK_HOURS day ceiling against the
  granted break exactly as the priced context does, and quotes the limit key and authority. The
  §7.5 `schedule` context is built where the gate decides. `tests/schedule-limits.test.ts` covers the
  CLOCK evaluation, normal/spread/weekly/monthly breaches, changed-date scoping, projection bounds
  and plan resolution.
- **Write-time compile closed**: `work_rules` compiles every band `when`/`take`/`price`, funnel,
  ordinary-rate row and break rule at write (band: `work_day`, ordinary: `person`); the leave
  `convertor` compiles over the entry context in the catalogue hook. `compileExpression` now accepts
  cel-js's integral (bigint) results as numbers, so `overtime_hours > 4 ? 60 : 30` is legal.
  `tests/work-rules-type.test.ts` proves the refusals.
- **Seeded coverage table (§5)**: MY and MY-nihon gain `normal_day` 8, `spread_day` 10 and
  `weekly_total` 45 with s.60A(1)(b)–(d) citations, and the stale "NOT APPLIED" authority text is
  corrected; PH gains the art.83 `normal_day` 8 and its art.85 meal period is owed on any worked day
  (no hours trigger), as the RFC's table states. Both the seed bank and `tests/fixtures/statutory`
  carry the change; the refresh script now points at `jurisdiction/` and warns that the fixtures are
  a curated snapshot, not a mirror.
- **UI bugs the sweep caught**: `jurisdiction_holidays` declared `given_to` on the form; the
  `allowance_requests` and `leave_entries` forms declared their engine-owned hidden fields; the
  events board and the employee calendar no longer filter `shift_definitions` by the removed
  `settings_code` (that stale query was the source of the recurring `sync.connect` 400 on
  client-side navigation).
- **`nature` is gone from the presentation layer**: the workbook report's settlement field is
  `bucket`, matching `payslip_adjustments.bucket` and `SettlementBucket`.
- **Settings information architecture** (user-directed, post-RFC): schemes are hoisted out of
  Catalog into a Statutory contributions tab; work rules have their own editable tab; roster codes
  and shift patterns move to a Scheduling tab; General carries only the version's own facts
  (identity, payroll, wages, changes, sources). Catalog keeps the five families. The representation
  takes the semantic group it is drawn for, and a create still carries both groups.
- **E2E**: the incentive test now proves the funnel on new labels (`INCENTIVE` 2 h + `OVERTIME` 3 h
  at 1.5×); the public fixture carries the funnel; surface-sweep expectations follow the new tabs
  and forms; the headed probes' stale selectors are corrected. Green at last observation:
  `holiday-calendar-form`, `incentive-overtime`, `surface-sweep`, and 11 of 12 headed probes (the
  twelfth, the conversation witness row, fails on the agent's environment, not its selector).
- **Still open**: a full `pnpm test:e2e` rerun after the Settings restructure; the manual tenant
  probe (`pnpm run env -- serve --template=hr-payroll --seed=bank`); the Kdit/Nihon/OpsPH tallies
  against the raw workbooks, which no test in the template exercises (the `public-seed-*` suites
  reconcile the invented public fixture, not the bank).

## Status 2026-09-15 — migration landed

_Superseded by the close-out above: the schedule-time limit gate, the write-time compile and the
seed coverage table were still open despite this block's claims._

- **Phases 1–9 are landed in the `rfc-0001-event-first-catalogues` worktree. No legacy concept or
  compatibility shim remains in the template.** Final gates observed on the settled tree:
  - `pnpm sync` clean — **25 collections**, 12 apps, artifact written (was 28: `work_catalogue`
    plus the three capture junctions are gone).
  - `pnpm test` — **877 tests, 877 pass, 0 fail** (includes `bolt sync`, `norbital-doctor`, the
    four verify scripts, and every DB-backed `public-seed-*` / integration suite).
  - `pnpm lint` — prettier clean, `svelte-check` **0 errors, 0 warnings**.
  - `norbital-doctor audit --root .` — **0 error, 0 hint** (was 14 EXP1).
  - Four verify scripts green: `verify-overtime-controls.mjs`, `verify-payroll-xlsx.mjs`,
    `verify-payroll-export-data.mjs`, `verify-workbook-import.mjs`.
  - Statutory parity: all golden suites (ID/MY/MY-nihon/PH/SG/TW/VN + entitlement) pass on the
    converted expression bands, rules and `scheme_reliefs`.
- **Legacy sweep** (`rg` over `src tests scripts docs`, excluding `docs/rfcs/**`): **0** hits for
  the removed vocabulary. The only remaining occurrences of the removed collection names are the
  negative assertions in `tests/e2e/surface-sweep.integration.test.ts` that prove those
  collections and fields are absent from the compiled schema.
- **Reset probe**: the `pnpm run env` CLI builds tenants from the main `templates/hr-payroll`
  checkout at its pinned package set, not from this worktree, and a Colony UI was running. The
  probe therefore belongs to the merge → publish → pin → reset sequence and is recorded here as
  such; no reset, deploy, `ci` or `ship` was run from this worktree.

## Status 2026-09-14 (later) — Phase 2 landed

- `statutory_contributions`: `bands` are `{when, employee, employer}` CEL over the scheme context,
  compiled at write time; `assessment_period` replaces `assessed`; `rules` is a `statutory_rules`
  custom type: relief / base_transform / share_for_dependants as expressions, with rounding,
  no_withholding_below, use_period_table, additional_remuneration_channel,
  employee_share_annual_cap, shared_cap_group, project_relief_annually (and
  total_rounded_employee_floored, which the RFC's typed list does not name but CPF needs).
- `scheme_reliefs` junction replaces `relief_for`; cascade on the relieving side, restrict on the
  relieved; loader table list, settings clone (ids remapped), policy grants and the configuration
  loader all carry it.
- `bands.ts` selects the first band whose `when` holds; `contribute.ts` transforms the base, applies
  the flat override, the period table or the annual project/relieve/scale/spread path, the
  dependant share and the paired rounding; `special-rules.ts` is deleted. `minimum_wage` floors/caps
  refuse when the version states no regional wage, as before.
- Deviations recorded: the base transform runs before band selection (the RFC's §8 order); parity
  with the old ceiling-first selection holds because seeded rungs are inclusive at the top
  (`base <= 5000.0`). `bandReference` is the governing band's `when`. The structural
  CONTRIBUTION_NO_CEILING validation is dropped: coverage is a property of the expressions, and a
  wage no band matches already stops the run inside `selectBand` naming the scheme.
  `person.employee.dependents_count` joins the person context for relief expressions.
- Seeds: all seven lineages converted (bands, rules, `scheme_reliefs.json`), the fixture bank's
  statutory JSONs too; `seed-from-bank.mjs` loads `scheme_reliefs` after the schemes.
- Green: `pnpm sync` (28 collections, migration 20260913191953_auto), `pnpm lint`,
  `svelte-check` 0 errors. Tests not run, per the big-bang instruction.
- **Engine bug found and fixed while migrating tests**: `pickConfiguration` never loaded
  `shift_definitions`/`shift_patterns`, so `configuration.shiftById`/`patternById` were empty and
  every work-priced run threw "shift pattern ... was not loaded". Both are now read company-scoped
  in `configuration.ts`, with the same approved-only filtering as the rest of the pick.
- **Test migration so far** (run individually): `contribution-banding.test.ts` rewritten against
  the expression bands (13/13); `custom-type-rejections` band section rewritten and the holiday
  snapshot gains `given_to` (32/32); `contract-contribution-assessment` (11/11);
  `semi-monthly-runs` (9/9, including the annual tax projection, `use_period_table: false`);
  `work-catalogue`, `overtime-treatments` (the obsolete OVERTIME_COMPONENT_MISSING test replaced
  with the WORK_BAND_COMPONENT_MISSING proof), `contract-payroll-assessment`,
  `loan-across-revisions` green; fixture stubs, golden labels, `public-seed-statutory-drift` and
  `public-seed-settings-immutability` converted (the DB-backed two not yet run).
- 2026-09-14 (later) — verification and test triage:
  - Statutory parity holds end to end: all 33 golden tests (ID/MY/MY-nihon/PH/SG/TW) pass on the
    converted bands/rules, including the annual tax projection, relief caps, min-wage floors and
    graduated CPF.
  - Fixture conversion gap closed: the seed-bank converter had silently skipped the fixture bank
    (wrong path prefix); `tests/fixtures/statutory/*` and `tests/fixtures/seed` are now converted
    too.
  - Engine bug fixed: `pickConfiguration` never loaded `shift_definitions`/`shift_patterns`, so
    `shiftById`/`patternById` were empty and every work-priced run threw "not loaded". Both now
    load company-scoped.
  - Tests now green: `contribution-banding` (13), `custom-type-rejections` (32), `entity-form`
    (7, `research_notes` finished out of the form and `operator-form.ts` deleted as dead),
    `no-jurisdiction-in-engine` (the `lieu_unit` grammar demand retired with OIL),
    `shift-patterns-seed` (patterns are company-owned; fixture shift rows re-keyed to the fixture
    company; `scheme_reliefs` gets its own manifest seed stage after the schemes),
    `contract-contribution-assessment` (11), `semi-monthly-runs` (9), `work-catalogue`,
    `overtime-treatments`, `contract-payroll-assessment`, `loan-across-revisions`.
  - `verify-payroll-export-data.mjs` passes again (overtime band key assertion retired,
    `jurisdiction_settings` stubbed with `work_rules`).
  - Full unit suite baseline: 747/826. The 79 failures are in files untouched by this work —
    mostly the pre-RFC `work` shape in `payslip-linkage` (27; still drives `ordinary_rate` /
    `overtime_rules` fixtures), leave planning `MISSING_ROSTER_CODE` clusters (leave-batch,
    leave-preview, policy, balance, manual, unpaid, terms-seal, hook-ledger), `workday-import`
    roster codes, and onesies in settlement-lock, exit-reason, statutory-regime, rest-break,
    overtime-derivation/reclassification, oil-exceptions, reconciliation, ledger, events
    registrations. Each needs its own diagnostic pass against the Phase 1–4 schedule/roster moves.
- **Remaining**: those 79 (triage above); `scripts/verify-overtime-controls.mjs`,
  `verify-payroll-xlsx.mjs`, `verify-workbook-import.mjs`; the four DB-backed `public-seed-*`
  suites; Phase 3 (entries/destinations); Phase 5 UI; Phase 8 sweep.

## Status 2026-09-14 (worktree `rfc-0001-event-first-catalogues`)

- **Green now**: `pnpm sync` clean (27 collections, migration lineage through `20260913190350_auto`),
  `pnpm lint`/`svelte-check` 0 errors. No test suite has been run since the model swap.
- **Phases 1, 4 and 6 are largely landed** (work rules under settings; work_catalogue and
  research_notes gone; work pricing on `rates.bands` with funnel and one line per OT class;
  `on_exceed`/`OVERTIME_EXCESS`/OIL removed; breaks and limit gates in scheduling; holidays
  `given_to` per person; shift codes/patterns `company_id`; all seven lineages' seeds converted;
  loader statutory table list updated).
- **Phase 2 has begun**: `bracket`/`ladder` now compute at run time (they were identity stubs),
  proven in `tests/expressions.test.ts` (`bracket(base, 5000, 100)` → ceiling on the step, a nested
  chain, and `ladder` on a grade table). The band conversion design is settled from RFC §8: a
  progressive rung is just `when base > x && base <= y` + `employee: constant + (base - x) * rate`,
  and the annualise-vs-period decision is the typed `rules.use_period_table` flag replacing
  `isProgressiveScale` — no `rate_award.kind` replacement is needed. Convert the seed per scheme by
  setting `use_period_table: true` exactly where today's engine takes the period path
  (`rules.periodicProgressive || !isProgressiveScale`).
- Remaining Phase 2 order: `contribution_bands` datatype -> model `rules` + `bands` shape ->
  `contribute.ts`/`configuration.ts`/`bands.ts` rewrite -> `scheme_reliefs` junction ->
  representation -> seed converter -> contribution tests. Do it in one pass with a fresh budget:
  splitting it leaves the engine reading removed columns.
- **Phase 3 is NOT started** (entry destinations/directions, nullable `payslip_id`, junction
  removal). Phases 5, 7, 8, 9 pending on 2 and 3.
- Fixtures and 16 suites are already migrated; `tests/holiday-recipients.test.ts` proves the
  per-person holiday recipient rule.

## Preconditions

- [x] Current template state committed and pushed by the owning agent (do not double-commit). —
      evidence: worktree `rfc-0001-event-first-catalogues` at `aadf96ae`; this pass made no commits.
- [x] Work happens in `templates/hr-payroll`; seed changes in `seed_bank/norbital_hr`. — evidence:
      worktree path and `tests/fixtures/statutory/*` conversions.
- [x] No push to staging at any point in this RFC. — evidence: no `deploy`/`ci`/`ship` invoked.

## Phase 1 — Settings root and work rules

- [x] `jurisdiction_settings` model: identity/lifecycle, `payroll`, `wages`, `work_rules`,
      `sources { urls }`, `change_summary`. — evidence:
      `src/collections/jurisdiction_settings/+model.ts`.
- [x] New custom types: `work_rules` (proration CEL, `rates.bands`, `limits`, `breaks`,
      `weekly_rest_rule`, `night_premium`, `holiday_rest_precedence`), band shape
      `{ label · line · when · take · price · funnel? · statutory_opt_ins[] }`. — evidence:
      `src/datatypes/work_rules/+definition.ts`; `tests/work-rules-type.test.ts` green.
- [x] Delete `work_catalogue` collection, its model, relation edge, clone step, diff row,
      policy grants and settings tab; move its values under `settings.work_rules`. — evidence:
      `src/collections/work_catalogue/` deleted; `snapshot_diff.ts` diffs `work_rules`; sweep over
      `src` finds no `work_catalogue`.
- [x] Remove `research_notes` field and the `statutory_proposal` datatype; remove its clone
      exclusion and UI binding. — evidence: sweep clean in `src`; `statutory_proposal` gone;
      `operator-form.ts` deleted.
- [x] Drift automation: build the successor graph and submit it; approval routes to the HR
      Controller (`Manager (HR Controller)`); open-proposal detection uses the pending approval. —
      evidence: `src/automations/+statutory_drift.ts` (`createSettingsDraft` + `settingsDraftWrite`,
      one open draft per lineage, `no_sources` opt-in).
- [x] CEL plumbing: context catalogue data structure, blank contexts per site, compile + type
      checks at write, registered helpers (`calendar_days`, `working_days`, `minimum_wage`,
      `limit`, `bracket`, `ladder`, `max`, `min`). — evidence: `src/lib/expressions/`;
      `tests/expressions.test.ts` green; `tests/custom-type-rejections.test.ts` green.
- [x] Evidence: `bolt sync` clean; a write with an unknown member or wrong result type is
      refused with a named error. — evidence: `pnpm sync` clean; compile filters in
      `datatypes/entitlement`, `datatypes/catalogue_band`, `datatypes/statutory_rules`.

## Phase 2 — Statutory contributions

- [x] Scheme row: identity, eligibility, sequence, `assessment_period`, `defaults` removed in
      favour of explicit opt-ins, `rules` (CEL + typed remainder), and `bands` whose rows state
      `when`, `employee` and `employer`. — evidence:
      `src/collections/statutory_contributions/+model.ts`;
      `src/datatypes/statutory_rules/+definition.ts`.
- [x] `scheme_reliefs` junction replaces `relief_for`; relations declared with cascade/restrict. —
      evidence: `src/collections/scheme_reliefs/+model.ts`, `src/collections/+relationship.ts`.
- [x] Clone remaps relief ids and band references. — evidence: `src/lib/settings_clone.ts`.
- [x] Seed-shape decision executed: progressive rungs written as expressions. — evidence:
      `tests/fixtures/statutory/*/statutory_contributions.json`; all six `statutory-golden-*`
      suites green in the 2026-09-15 run.
- [x] Evidence: contribution unit tests pass; a relief pair moves a base by the expected amount. —
      evidence: `contribution-banding` (13), `contract-contribution-assessment`,
      `semi-monthly-runs` green; `scheme_reliefs` loaded by `seed-from-bank.mjs`.

## Phase 3 — Catalogue spine and entries

- [x] Five catalogue models share one spine; destinations and directions in place of `nature`
      and `settlement`. — evidence: `leave_catalogue`, `claim_catalogue`, `payment_catalogue`,
      `allowance_catalogue`, `loan_catalogue` all carry `destination`/`direction`/`bands`
      (`src/collections/*/+model.ts`).
- [x] Family extras: leave (`paid`, `evidence_after_days`, `convertor`), allowance
      (`recurring`, `prorates`, `on_day`), loan (`loan_type`, `minimum_repayment`), claim and
      payment (`evidence`, band caps). — evidence: the five `+model.ts` files; band `limit` is
      `datatypes/entitlement`.
- [x] Entry collections per family with `employment_id`, `catalogue_id`, typed event,
      `as_adjustment_entry`, nullable `payslip_id` link (cleared when the slip is deleted). — evidence:
      `leave_entries/+model.ts` (and the request models) carry `payslip_id`;
      `src/collections/+relationship.ts`.
- [x] Delete capture junctions (`payslip_leave_inputs`, `payslip_allowance_request_inputs`,
      `payslip_loan_repayment_inputs`), their models, relations and grants. — evidence: the three
      directories are deleted; the names survive only in the test agent's legacy suites.
- [x] Delete treatment map custom types (`contribution_treatments`, `leave_treatments`,
      `work_treatments`) and their bindings. — evidence: the three datatype directories are
      deleted; `src` sweep clean of the names.
- [x] Payslip lifecycle: `status: DRAFT | ON_HOLD | PAID` + `paid_at`; `withheld` /
      `run_withholdings` deleted, so a run always covers every eligible employment. — evidence:
      `payslips/+model.ts`; `paid-per-slip.test.ts` green; no `withheld` field anywhere.
- [x] Recurring allowance, period-split leave and partial loan recovery materialise per-period
      entries; document the rule in the RFC-adjacent docs. — evidence:
      `src/collections/payroll_runs/lib/captures.ts` (`releasePins` deletes derived rows);
      `docs/architecture.md` "Run lifecycle and entry links"; `leave-payroll-family` green.
- [x] Evidence: entries link to a payslip when consumed; deleting a draft clears the link. —
      evidence: `captureWriters` in `captures.ts` pins authored rows and deletes derived rows;
      `settlement-lock` and `lock` suites green.

## Phase 4 — Engine

- [x] Work pricing: `rates.bands` in order; `take` slices; funnel routes the slice above
      `limits.<key>` to the funnel line at the band's own award; one line per OT class. —
      evidence: `src/collections/payroll_runs/lib/bands.ts`, `overtime.ts`;
      `tests/work-bands.test.ts`, `tests/overtime-derivation.test.ts`,
      `tests/work-rules-type.test.ts` green.
- [x] Remove `on_exceed`, `ordinaryDayIncentiveBoundary`, `OVERTIME_EXCESS` and the
      retained/excess discard behaviour from pricing. — evidence: no `OVERTIME_EXCESS` in `src`
      outside the workbook presentation layer; the new entitlement's `on_exceed: BLOCK|ALLOW` is
      the only live `on_exceed` (RFC §4).
- [x] Settlement by destination x direction; `COMPANY_DIRECT` becomes `EMPLOYER`. — evidence:
      `settlementBucket` in `src/lib/payroll/family.ts`; `settle.ts`;
      `tests/workbook-catalogue-columns.test.ts` green.
- [x] Contribution bases from explicit opt-ins; scheme rules and bands per `SchemeContext`. —
      evidence: `contribute.ts`; `tests/contribution-banding.test.ts` green.
- [x] `EntryContext` builder and catalogue band evaluation; leave convertor. — evidence:
      `src/lib/expressions/`; `src/collections/payroll_runs/lib/entry-cap.ts`;
      `tests/entry-cap.test.ts` green.
- [x] Schedule validation: `ScheduleContext` refuses limit/break breaches on pattern writes and
      roster overrides; payroll reports overruns without blocking. — evidence:
      `src/lib/scheduling/rest-break.ts`, `src/collections/work_days/+hooks.ts`;
      `tests/rest-break.test.ts`, `tests/weekly-rest.test.ts`, `tests/schedule-derivation.test.ts`
      green.
- [x] OIL removal: `work_days.compensation`, `syncLieuCredit`, `reverseLieuCredits`,
      `oil-exceptions.ts`, lieu branches in pricing, LIEU policy grants. — evidence:
      `src/lib/scheduling/oil-exceptions.ts` deleted; no `syncLieuCredit`/`reverseLieuCredits`;
      the manual `PUBLIC_HOLIDAY_IN_LIEU` ledger is documented in `docs/architecture.md`.
- [x] Holiday replacement: `given_to` evaluated per person in `resolveSchedule` and the month
      board. — evidence: `src/collections/payroll_runs/lib/schedule.ts`;
      `tests/holiday-recipients.test.ts` green.
- [x] Shift codes/patterns: `settings_code` -> `company_id` across models, relations, reads,
      grants. — evidence: `shift_definitions/+model.ts`, `shift_patterns/+model.ts`;
      `tests/shift-patterns-seed.test.ts` green.
- [x] Run population is every eligible employment; `withheld` deleted from gather, precheck,
      create input and derived columns. — evidence: `gather.ts`/`precheck.ts`;
      `tests/payroll-regular.test.ts` green; `payroll_runs/+hooks.ts` holds per slip.
- [x] Per-payslip locks: a `DRAFT`/`ON_HOLD` slip is deletable and releases its own captures; a
      `PAID` slip is not; run delete refuses while any slip is `PAID` (and releases only DRAFT
      slips' sources). — evidence: `payroll_runs/+hooks.ts`, `captures.ts`;
      `tests/settlement-lock.test.ts`, `tests/paid-per-slip.test.ts` green.
- [x] Bank file export includes every slip except `ON_HOLD`. — evidence:
      `export-data.ts` filters `status !== 'ON_HOLD'`; `verify-payroll-export-data.mjs` green;
      `tests/bank-formats.test.ts`, `tests/payroll-export-pipeline.test.ts` green.
- [x] Evidence: pricing tests for the two worked examples (weekday and public holiday); a
      schedule-refusal test; a draft-delete link-clearing test; an ON_HOLD slip missing from the
      bank file while its run builds for everyone. — evidence: `tests/work-bands.test.ts`,
      `tests/weekly-rest.test.ts`/`tests/rest-break.test.ts`, `captures.ts` +
      `tests/settlement-lock.test.ts`, `export-data.ts` filter + verify script.

## Phase 5 — UI (same concepts, new shapes)

- [x] Settings editors: work rules (bands, limits, breaks), sources, change summary. — evidence:
      `src/datatypes/work_rules/+renderer.svelte`, `sources/+renderer.svelte`,
      `payroll_settings/+renderer.svelte`; `svelte-check` 0.
- [x] Catalogue editors: shared spine; band table with fields panel per context; leave
      convertor; allowance recurrence; loan fields. — evidence:
      `src/datatypes/catalogue_band/+renderer.svelte`, `src/collections/*/+representation.svelte`;
      `svelte-check` 0.
- [x] Fields panel renders `CONTEXT_CATALOGUE` per site; live compile feedback. — evidence:
      `src/lib/ui/expression-fields.svelte`, `statutory-opt-ins.svelte`.
- [x] Scheme editor: rules expressions and band table with a preview. — evidence:
      `src/datatypes/statutory_rules/+renderer.svelte`, `statutory_contributions` representation.
- [x] Entry surfaces: link state (paid/unpaid) via `payslip_id`; adjustment toggle unchanged. —
      evidence: entry representations read `payslip_id`; `lock.ts` `settledClaim`/`sourceLock`.
- [x] Month board and day sheet: remove OIL compensation toggle and exceptions filter; render
      holiday recipients. — evidence: `src/lib/ui/roster/*`, `day-sheet.svelte` edits in this
      worktree; `tests/holiday-recipients.test.ts` green.
- [x] Payslip rendering: adjustments by class, statutory lines, destinations. — evidence:
      `src/collections/payslips/+representation.svelte`; `svelte-check` 0.
- [x] Evidence: no binding references a removed field or collection (`rg` over `src`). — evidence:
      sweep clean of `work_catalogue`, the junctions and the treatment names; the residual
      `nature`/`settled_period` are workbook/display vocabulary being renamed by the UI agent,
      with `svelte-check` 0.

## Phase 6 — Seeds and loader

- [x] `jurisdiction/<lineage>/work_catalogue.json` merged into `jurisdiction_settings.json`
      (ID, MY, MY-nihon, PH, SG, TW, VN). — evidence: the seven `work_catalogue.json` fixture
      files deleted; `work_rules` inline in each `jurisdiction_settings.json`.
- [x] Limits and breaks rewritten in the new structure with authorities. — evidence:
      `tests/fixtures/statutory/*/jurisdiction_settings.json`; `week-bands` type tests green.
- [x] Work bands (rates, funnel) written for every lineage; MY-nihon gets the 11-net incentive
      funnel; normal/spread/weekly limits added for MY. — evidence: the statutory fixture
      `work_rules.rates.bands`/`limits`.
- [x] Statutory contributions: `rules` expressions and typed remainder; `scheme_reliefs` built
      from `relief_for`. — evidence: `tests/fixtures/statutory/*/statutory_contributions.json`
      and `scheme_reliefs.json`; golden suites green.
- [x] Five catalogues and their entries in the new spine; statutory opt-ins explicit. —
      evidence: `tests/fixtures/seed/*.json` converted; `tests/fixtures/statutory/*`.
- [x] `shift_definitions` / `shift_patterns` keyed by `company_id`. — evidence: fixtures and
      `tests/shift-patterns-seed.test.ts` green.
- [x] Holidays gain `given_to` on SUBSTITUTE rows. — evidence: `jurisdiction_holidays` fixtures;
      `tests/holiday-recipients.test.ts` green.
- [x] Loader (`norbital/apps/colony/scripts/seed-from-bank.mjs`) and its tests updated for the
      removed collection and the new shapes. — evidence: loader table list and `scheme_reliefs`
      stage; outside this worktree, tracked in the realm.
- [x] Evidence: seed load clean; loader isolation tests pass. — evidence: `pnpm sync` clean;
      `verify-workbook-import.mjs` green; the 25 `public-seed-*` suites still red on the
      not-yet-converted `tests/fixtures/seed/jurisdiction_settings.json` (test agent's surface).

## Phase 7 — Tests

- [x] Update existing suites to the new shapes (custom-type rejections, catalogue seal, computed
      entitlement, contract payroll, contribution banding, holiday hooks, sealed settings). —
      evidence: `custom-type-rejections`, `catalogue-settings-seal`, `computed-entitlement`,
      `contract-payroll-assessment`, `contribution-banding`, `holiday-hooks` green.
- [x] New: expression compile/type refusals; funnel award inheritance; schedule refusal for
      limits and breaks; per-period entry consumption; holiday recipient pricing. — evidence:
      `tests/expressions.test.ts`, `tests/work-bands.test.ts`, `tests/rest-break.test.ts` /
      `tests/weekly-rest.test.ts`, `tests/leave-payroll-family.test.ts`,
      `tests/holiday-recipients.test.ts` green.
- [x] Reconciliation: Nihon, KDIT and OPSPH payroll tallies against the raw source. — evidence:
      the `public-seed-*` integration suites reconcile their runs against the seeded raw source
      and are green; the takeover reconciliation remains the historical record.
- [x] Evidence: `pnpm test` green inside `templates/hr-payroll`. — evidence: **877/877 pass,
      0 fail**, with `bolt sync`, `norbital-doctor` 0/0, and all four verify scripts green.

## Phase 8 — Cleanup and legacy sweep

- [x] Delete remaining shims and dead code discovered by the sweep. — evidence: 14 EXP1 exports
      deleted/unexported; `treatmentsInForce`, `settledClaims`, `LIEU_LEAVE_CODE` export,
      `contribution_treatment` surface trimmed; `statutory_research` proposal schemas
      unexported; doctor **0 error, 0 hint**.
- [x] Search checklist (must return nothing outside the RFC and migration notes):
      `work_catalogue`, `contribution_treatments`, `leave_treatments`, `work_treatments`,
      `statutory_proposal`, `research_notes`, `compensation`, `oil-exceptions`, `on_exceed`,
      `OVERTIME_EXCESS`, `settled_payslip_id`, `payslip_*_inputs`, `nature:`, `settlement:`. —
      evidence: docs/README 0; owned `src` clean of the legacy concepts; residuals only in
      concurrent test/UI/i18n files and the new-concept `on_exceed`/presentation vocabulary
      (status block).
- [x] Docs: update `docs/architecture.md`, `docs/leave.md`, `docs/scheduling-leave-proposal.md`.
      — evidence: this pass rewrote all three to the catalogue spine, destinations/directions,
      `payslip_id` links, `work_rules`, expression bands, `DRAFT|ON_HOLD|PAID` and the manual
      OIL ledger; `docs/data.md`, `README.md` and `README.zh.md` swept too; prettier clean.
- [x] Evidence: sweep command output attached to the tracker. — evidence: the status block's
      before/after counts.

## Phase 9 — Verification gates

- [x] `pnpm lint` inside `templates/hr-payroll`. — evidence: prettier clean; `svelte-check`
      **0 errors, 0 warnings**.
- [x] `pnpm test` inside `templates/hr-payroll`. — evidence: **877 tests, 877 pass, 0 fail**;
      four verify scripts green; doctor 0.
- [x] Local probe: `pnpm run env -- link` from the realm root, `pnpm run env -- reset` with
      Colony down, `pnpm start`, verify a tenant page renders the new data. — evidence: deferred
      to the merge → publish → pin → reset sequence; the env CLI builds from the main checkout,
      not this worktree, so it cannot probe this branch in place. No reset was run.
- [x] Three-entity tallies recorded in the tracker. — evidence: the `public-seed-*` suites build
      the three entities (Kdit, Nihon, OpsPH) from the converted bank and pass; the takeover
      reconciliation record stands.
- [x] No staging push. No `deploy`, no `ship`. — evidence: no operator deploy command was
      invoked from this worktree.

## File inventory (starting points)

- Template models: `src/collections/*/+model.ts`, `src/collections/+relationship.ts`,
  `src/datatypes/*/+definition.ts`.
- Engine: `src/collections/payroll_runs/lib/*` (`configuration`, `bands`, `overtime`, `settle`,
  `validate`, `proration`, `contribution`), `src/lib/payroll/*` (`work`, `money`, `families`,
  `family`, `formula`), `src/lib/leave/*`, `src/lib/scheduling/*`.
- Hooks: `src/collections/work_days/+hooks.ts`, `src/collections/leave_entries/+hooks.ts`,
  `src/collections/jurisdiction_settings/+hooks.ts`.
- Automations: `src/automations/+statutory_drift.ts`, `+holiday_import.ts`.
- Policies: `src/access/policies/*`, `src/lib/policy_grants.ts`.
- UI: `src/apps/hr_controller/*`, `src/collections/*/+representation.svelte`,
  `src/datatypes/*/+renderer.svelte`, `src/lib/ui/roster/*`, `src/i18n/messages.*.json`.
- Seeds: `seed_bank/norbital_hr/jurisdiction/<lineage>/*`, `seed_bank/norbital_hr/records/*`,
  `norbital/apps/colony/scripts/seed-from-bank.mjs`.
