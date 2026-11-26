# 0012 — Inner Mechanisms & Architecture Diagrams

Visual reference for every runtime, data, calculation, ledger, attendance, compliance, and access-control mechanism in the HRMS workspace.

> **Fixed design notice:** Read [Section 0 of the architecture](0001-hrms-calculation-architecture.md#0-the-design-is-fixed) first. That section is the owner's fixed design and governs every mechanism documented here. Every model, field, state, service module, and formula below is verified directly against `src/`.

## Contents

1. [System Topology & Runtime Architecture](#1-system-topology--runtime-architecture)
2. [Data Model & Ownership ER Diagram (30 Models)](#2-data-model--ownership-er-diagram-30-models)
3. [Dated Resolution & Patch Fold (`dated.ts`)](#3-dated-resolution--patch-fold-datedts)
4. [Payroll Run Admission, Batch Loading & Atomic Sealing](#4-payroll-run-admission-batch-loading--atomic-sealing)
5. [Linear Subtotal Chain, Rate Basis & Statutory Dependency DAG](#5-linear-subtotal-chain-rate-basis--statutory-dependency-dag)
6. [Cross-Period Amendments, Balance Unwinding & Back-Pay Loop](#6-cross-period-amendments-balance-unwinding--back-pay-loop)
7. [Append-Only Ledger, Four-Part Keys & Entitlement Sync](#7-append-only-ledger-four-part-keys--entitlement-sync)
8. [Employment Stints, Transfers, Exit Settlement & Loan Recovery](#8-employment-stints-transfers-exit-settlement--loan-recovery)
9. [Kiosk Biometrics, Attendance Matching & Roster Validation](#9-kiosk-biometrics-attendance-matching--roster-validation)
10. [Registered Rules, Effects & Statutory Research / Filing Pipeline](#10-registered-rules-effects--statutory-research--filing-pipeline)
11. [State Machines, Locks, Exports & Access-Control Matrix](#11-state-machines-locks-exports--access-control-matrix)
12. [Verified Source Inventory](#12-verified-source-inventory)

---

## 1. System Topology & Runtime Architecture

The workspace comprises **9 apps**, **30 models**, **3 custom fields**, **6 automations**, and **2 file syncs**, running on Bolt's host runtime (`UTC` server storage, bilingual `en` / `zh` UI, `embeddings: ['default']`). Large client-side ML weights (`@vladmandic/human@3.3.6` and `onnxruntime-web` WASM) load from pinned CDNs rather than shipping inside the workspace bundle; only compact audio clips (`assets/kiosk-voice/{en,zh}/*.mp3`) and the workspace anti-spoof model (`minifasnet.onnx`) stay in `assets/`.

```text
+==============================================================================================+
|                               CLIENT SURFACES (9 BOLT APPS)                                  |
+==============================================================================================+
|  [HR Controller Group: src/app/hr_controller/]                                               |
|   +-- dashboard   (approvals, unpaid runs, open obligations, proposed statutory findings)    |
|   +-- entities    (legal entities, dated changes, pay groups, shifts, patterns, holidays)    |
|   +-- people      (workforce 12m turnover/hire chart, employee profiles & stints)            |
|   +-- events      (7 pages: work board, leave, claims, adhoc, loans, cases, work_events)     |
|   +-- payroll     (on-cycle & off-cycle runs, payslips, salary listing & OT report exports)  |
|   +-- obligations (statutory compliance tasks & reminders)                                   |
|   +-- settings    (jurisdiction law-on-a-day editor, change log, manual research trigger)    |
|                                                                                              |
|  [Employee Self-Service: src/app/hr_employee/]                                               |
|   +-- self_service (work calendar, leave/claim requests, loans, docs, payslips, face enroll) |
|                                                                                              |
|  [Attendance Kiosk Shell: src/app/attendance/  (shell: 'kiosk', policies: ['kiosk'])]        |
|   +-- clock        (720p camera -> Human WebGL/WASM + MiniFASNet ONNX -> cosine match ->     |
|                     roster_entry punch; manual fallback; bilingual voice narration)          |
+==============================================+===============================================+
                                               |
         ctx.query / ctx.act / ctx.run         |    Client-side ExcelJS & File Syncs
         (named outputs: default, run,         |     - Imports: Data Request, Holidays,
          self_service, kiosk)                 |       Roster, Leave, Claims, Ad Hoc,
                                               |       Loans, Repayments, Cases
                                               |     - Exports: Salary Listing (.xlsx),
                                               |       Overtime Report (.xlsx)
                                               v
+==============================================================================================+
|                           BOLT HOST ENGINE & MODEL LAYER (30 MODELS)                         |
+==============================================================================================+
|  Access Control (9 seeded teams, 10 policies; 2-step requestReview approval flow)            |
|  Model Transforms & Effects (src/data/model/**/service/)                                     |
|   +-- Dated Fold (lib/dated.ts)          : law.ts, company.ts, person.ts                     |
|   +-- Payroll Engine (payroll_run/svc)   : run_loader -> amended -> run_calc -> engine       |
|   +-- Single Ledger Writer (balance/svc) : core, entitlement, guards, postings, sync         |
|   +-- Rules & Effects (jurisdiction/svc) : configuration, expressions, registrations, taps   |
|   +-- Attendance & Loans                 : attendance, time_evidence, warnings, loan_sched   |
+======================+===============================================+=======================+
                       |                                               |
         Scheduled / Event Triggers                       File Syncs (payroll_run)
                       v                                               v
+----------------------------------------------+   +-------------------------------------------+
|         6 BACKGROUND AUTOMATIONS             |   |          BANK PAYMENT FILE SYNCS          |
+----------------------------------------------+   +-------------------------------------------+
| 1. ledger              (cron Jan 1 + events) |   | +metro_bank.sync.ts -> Metrobank (.txt)   |
| 2. registered_effects  (leave/claim/profile) |   | +ocbc_fast.sync.ts  -> OCBC FAST (.txt)   |
| 3. late_notice         (roster_entry writes) |   +-------------------------------------------+
| 4. statutory_research  (Sat 03:00 UTC + HR)  |
| 5. statutory_filing    (serialized max: 1)   |   +-------------------------------------------+
| 6. invitation_profile  (sys_user writes)     |   |   EXTERNAL SOURCES (Research Policy Only) |
+----------------------------------------------+   |   web_search + browser on official HTTPS  |
                                                   |   gov/tax/social-security authorities     |
                                                   +-------------------------------------------+
```

---

## 2. Data Model & Ownership ER Diagram (30 Models)

Folder layout under `src/data/model/` mirrors ownership. Every fact has exactly one owner: nothing copies law rates onto contracts or derives balances outside `employee_balance`.

```text
  [JURISDICTION LAW (4 models)]                  [LEGAL ENTITY & WORK PLANS (6 models)]
  +--------------------+                         +--------------------+
  |   jurisdiction     | (code UNIQUE)           |       entity       | (code UNIQUE)
  | currency, tz,      |                         | settings_code, tz, |
  | tax_year_start_mo  |                         | bank, late_notice* |
  +---------+----------+                         +---+----+----+---+--+
            | (jurisdiction_code)           cascade  |    |    |   |
            v                                        v    |    |   +---------------+
  +--------------------+                 +---------------+ |   v                   v
  | jurisdiction_change|                 | entity_change | | +-----------+  +---------------+
  | effective_from,    |                 | effective_from| | | pay_group |  | shift_pattern |
  | law (JSON patch)   |                 | pay_methods,  | | | schedule  |  | days | cycle  |
  +--------------------+                 | loan_floor_%, | | | (ent,name)|  +-------+-------+
            ^ finding_id                 | statutory_p., | | +-----+-----+          |
            |                            | clears        | |       |                |
  +---------+----------+                 +---------------+ |       |        +-------v--------+
  | statutory_finding  |                                   |       |        |shift_definition|
  | (code,instrument)  |   +------------------+            v       |        | day_type, time |
  | state: PROPOSED -> |   | statutory_source |       +---------+  |        | breaks, untimed|
  | CONFIRMED/REJECTED |   | (code, url) UNIQ |       | holiday |  |        +-------+--------+
  +--------------------+   | PROPOSED/ACTIVE/ |       | kind,   |  |                |
                           | RETIRED          |       | replaces|  |                |
                           +------------------+       +---------+  |                |
                                                                   | (restrict)     |
  [PERSON & EMPLOYMENT (7 models)]                                 |                |
  +-------------------------+   1:1     +--------------------+     |                |
  |    employee_profile     +---------->|  employee_balance  |     |                |
  | number (seq HR-{0000}), |           | (employee_id UNIQ) |     |                |
  | DOB, gender, bank,      |           | account (JSON map) |     |                |
  | face_embedding (1024d), |           +---------+----------+     |                |
  | user_id/invitation_id   |                     | 1:N            |                |
  +----+---------------+----+                     v                |                |
       | cascade       | 1:N            +--------------------+     |                |
       v               v                |    ledger_entry    |     |                |
  +-----------+  +---------------+      | append-only rows:  |     |                |
  | dependant |  |  employment   |      | ADD|DEDUCT, 4-key, |     |                |
  | relation, |  | entity_id,    |      | amount>=0, source  |     |                |
  | born_on,  |  | no_overlap,   |      +--------------------+     |                |
  | allocs    |  | effective_rng |                                 |                |
  +-----------+  | events[],     |                                 |                |
                 | exit_ground,  |                                 |                |
                 | encash_leave  |                                 |                |
                 +---+---+-------+                                 |                |
                     |   |                                         |                |
            cascade  |   +-----------------------+                 |                |
                     v                           v                 |                |
            +-----------------+        +----------------------+    |                |
            | contract_terms  |        | statutory_parameters |    |                |
            | (emp,eff) UNIQ  |        | (emp,eff) UNIQ       |    |                |
            | pay_group_id ---+--------+----------------------+----+                |
            | rate, hours,    |        | parameters (JSON),   |                     |
            | signed_on,      |        | clears               |                     |
            | allowances,     |        +----------------------+                     |
            | clears          |                                                     |
            +-----------------+                                                     |
                                                                                    | (restrict)
  [DATED ACTIVITY ENTRIES (9 models)] (each links employment_id, except work_event) v
  +-----------------------+    +---------------------+   +----------------------------+
  |  leave_catalog_entry  |    | claim_catalog_entry |   |        roster_entry        |
  |  catalog_code,        |    | catalog_code, qty,  |   | (employment_id, work_date) |
  |  encashment, run_id*  |    | incurred_on, run_id*|   | UNIQUE (import_key),       |
  +----------+------------+    +---------------------+   | shift_def_id (restrict),   |
             | owned cascade                             | planned_ot, actual_worked, |
             v                 +---------------------+   | findings[], consent, run*  |
  +-----------------------+    | adhoc_catalog_entry |   +----------------------------+
  |leave_catalog_entry_day|    | catalog_code, desc, |
  | (entry,date,part)UNIQ |    | qty, unit, run_id*  |   +----------------------------+
  | part: AM|PM, run_id*  |    +---------------------+   |         work_event         |
  +-----------------------+                              | entity_id, optional emp_id,|
                               +---------------------+   | catalog_code, from..to     |
  +-----------------------+    |   workplace_case_   |   +----------------------------+
  |  loan_catalog_entry   |    |    catalog_entry    |
  | quantity, recovered   |    | kind, severity,     |   [PAYROLL & DUTIES (4 models)]
  | (sum), repay_period   |    | opened_on, inputs   |   +----------------------------+
  +----------+------------+    | LOCKED when run_id! |   |        payroll_run         |
             | cascade         +---------------------+   | run_number (seq), kind,    |
             v                                           | (pay_group,period) UNIQUE  |
  +-----------------------+                              | where ON_CYCLE,            |
  | loan_catalog_entry_   |                              | state: UNPAID -> PAID(LOCK)|
  |      repayment        |                              +--+-----------+-------------+
  | amount, paid_on, run* |                                 | cascade   | set_null (seals*)
  +-----------------------+                                 v           v
                                                 +------------+  +--------------------+
  +-----------------------------------------+    |  payslip   |  |   pay_amendment    |
  |               obligation                |    | (run,emp,  |  | (emp,group,period) |
  | occurrence_key UNIQUE (import_key),     |    | ent) UNIQ  |  | UNIQUE while open  |
  | state: OPEN <-> WAIVED, OPEN -> FULFILL |    | read-only  |  | (run_id IS NULL)   |
  +-----------------------------------------+    +------------+  +--------------------+

  * Every `payroll_run_id` seal reference uses `on_delete: 'set_null'` so deleting an
    UNPAID run releases every sealed entry, slot, repayment, case, roster, and amendment.
```

**Custom fields (3):**

- `bank` (`src/data/custom_field/bank/`): `{ bank_name, bank_code, bank_account_number, bank_account_name }`; requires non-blank `bank_name` and `bank_account_number`. Used on `entity.bank` and `employee_profile.bank`.
- `reads` (`src/data/custom_field/reads/`): declarative batch read specification (`READS_SHAPE`) for registered rules and effects; requires `limit >= 1` per layer.
- `references` (`src/data/custom_field/references/`): legal instrument citations (`REFERENCES_SHAPE`); requires non-blank `title` and `http(s)://` URL when present.

---

## 3. Dated Resolution & Patch Fold (`dated.ts`)

Jurisdiction law (`jurisdiction_change`), company methods/parameters (`entity_change`), contract terms (`contract_terms`), and employee statutory parameters (`statutory_parameters`) all share one deterministic patch-fold engine in `src/lib/dated.ts`.

```text
  Dated Change Rows (sorted by effective_from ASC, id ASC)
  ========================================================
  [Row 1: 2025-12-01]  Full baseline (or stint first day)
          |
          v  applied(state, patch, depth)
  [Row 2: 2026-01-01]  Partial patch (keys set replace; key: null deletes; `clears` -> null)
          |
          v  applied(state, patch, depth)
  [Row 3: 2026-07-01]  Partial patch (effective_from <= target day? YES -> apply)
          |
          x  STOP: [Row 4: 2027-01-01] has effective_from > target day (enacted ahead, dormant)
          |
          v
  +-------------------------------------------------------------------------------------+
  |  inForce(rows, day, depth) -> { state, set_by }                                     |
  +-------------------------------------------------------------------------------------+
  |  Fold Depth by Family:                                                              |
  |   * jurisdiction_change : LAW_DEPTH = 3 keys (family / code / field)                |
  |                           + 4th key inside `<family>/<code>/lookup/<key>`           |
  |                           (only standing rows: finding_id == null OR CONFIRMED)     |
  |   * entity_change       : COMPANY_DEPTH = 2 keys inside `pay_methods` and           |
  |                           `statutory_parameters`; 1 key for top-level fields        |
  |   * contract_terms      : depth 1 (`clears[]` -> null; filtered by `termsBy` when   |
  |                           `conversions.back_pay` checks `signed_on <= payDate`)     |
  |   * statutory_parameters: depth 1 on `parameters` record (`clears[]` -> null)       |
  +-------------------------------------------------------------------------------------+
          |
          +---> EDIT MODE A: "Always so" -> corrected(rows, set_by, patch, depth)
          |       Writes each modified leaf back onto the row in `set_by[path]`
          |       (or first change if unset). Removes nullified paths from all rows.
          |
          +---> EDIT MODE B: "Changes from <date>" -> patchOf(before, after, depth)
          |       Creates or updates the change row dated `<date>` with minimal diff.
          |
          +---> AMENDMENT REACH: reachOf(others, before, after, depth, pricedFilter)
                  Computes `[min(oldDate, newDate) .. dayBefore(nextRowSettingSamePath)]`
                  (or `null` if open-ended). Non-priced paths (references, description,
                  name, parameter declarations, job_title, department, worksite,
                  notice_period) produce no reach and trigger zero pay amendments.
```

**Caching inside one invocation (`law.ts`):** `lawsWith` / `lawsAt` caches fetched laws per `ctx.query` reader in a `WeakMap<Reader, Map<code, Deferred<Laws>>>`. Concurrent callers share the in-flight `Deferred`; each stretch between two change dates folds once (`${code}/${appliedCount}`).

---

## 4. Payroll Run Admission, Batch Loading & Atomic Sealing

Creating a `payroll_run` calculates every payslip, validates every guard, seals every consumed input row at its optimistic revision, posts ledger movements, and raises any deferred amendments or leaver recovery obligations inside one atomic write.

```text
  HR submits payroll_run.create
  ({ entity_id, pay_group_id?, period, kind, adhoc?, claim?, amendments? })
          |
          v
  [1] INITIAL METADATA READ (1 batch query)
      pay_group, entity, existing ON_CYCLE payroll_runs, open pay_amendments,
      existing `recovery:%` obligations, already-attached adhoc/claim ids
          |
          v
  [2] SCHEDULE & CHRONOLOGICAL ADMISSION GATES (pay_cycle.ts + payroll_run/+model.ts)
      * Resolve pay_group (explicit or company's sole group)
      * Derive cycle window via `cycleOf(schedule, period)`
      * ON_CYCLE guards:
          - cycleStarted(cycle, today) must hold (`cycle.from <= today`)
          - No later ON_CYCLE period already exists for this pay_group
          - No salary_coverage overlap with another ON_CYCLE run of this pay_group
          - pay_date = payDateOf(schedule, period) (business_day adjusted)
          - attendance = attendanceOf(schedule, cycle) (cutoff-aware window)
      * OFF_CYCLE guards:
          - Must name at least one `pays` (adhoc/claim) or `carries` (open pay_amendment)
          - Named items must be unsealed / amendments must still be open
          - pay_date = ctx.today; attendance = cycle
          |
          v
  [3] PARALLEL BATCH LOAD + REGISTERED RULES (Effect.all unbounded)
      +----------------------------------------+   +--------------------------------------+
      | validateRegistered('payroll_run', ...) |   | loadRun(read, run, frame, code)      |
      +----------------------------------------+   |  1 query (named `run` output):       |
                                                   |   - law (via lawsWith cache)         |
                                                   |   - entity, entity_change, pay_group |
                                                   |   - shift_def, shift_pattern, holiday|
                                                   |   - work_event, employment (stints)  |
                                                   |   - contract_terms, statutory_params |
                                                   |   - dependant, profile, balance      |
                                                   |   - roster, leave+days, claim, adhoc |
                                                   |   - loan+repayments, open cases      |
                                                   |  + claimsAsPosted (if capped claims) |
                                                   +------------------+-------------------+
                                                                      |
                                                                      v
  [4] CALCULATION & CROSS-PERIOD RECALCULATION (amendedRun -> calculateRun -> calculatePayroll)
      * Refuses if any priced leave/claim/adhoc entry has `$approval != null`
      * Refuses OFF_CYCLE if non-`off_cycle_eligible` adhoc or claim was named, if active
        employee's carry takes back net < 0, or if employee moved company mid-period
      * Produces: payslips[], attaches{leave,leave_day,claim,adhoc,repayment,case,roster},
        taken[] (carried amendment ids), deferred[] (net<0 active staff), leaving[] (exits)
          |
          v
  [5] PARALLEL REVISION READ + LEDGER PLAN (Effect.all unbounded)
      +----------------------------------------+   +--------------------------------------+
      | Read current `revision` of every row   |   | runPostings(read, made, laws)        |
      | in attaches{} + taken[] (chunked 1000) |   | Validates every posted code against  |
      | (concurrent edit -> conflict error)    |   | law on pay_date; builds ledger_entry |
      +-------------------+--------------------+   | + employee_balance revision updates  |
                          |                        +------------------+-------------------+
                          +---------------------+---------------------+
                                                |
                                                v
  [6] SINGLE ATOMIC COMMIT (`payroll_run.create` returns `{ sets, on_approved }`)
      sets        : payroll_run (state: UNPAID) + child payslips[] + revision-linked seals
                    (leave, leave_day, claim, adhoc, repayment, case, roster_entry, amendments)
      on_approved : ledger_entry.create + employee_balance.update
                    + deferred pay_amendment.create (active staff with RECOVERY_CARRIED)
                    + obligation.create (`recovery:<employment>:<period>[:<run>]` for leavers)
          |
          v
  [7] POST-COMMIT EFFECT
      * tap('create', 'payroll_run') + tap('create', 'payslip') -> obligation.import
      * syncLatePosted -> re-schedules `ledger` if exit cash-out/time-off touched closed window
```

**Marking PAID & Deleting UNPAID:**

- `payroll_run.update` (`state: UNPAID -> PAID`): locks the run permanently (`paid_run`), fires `tap('update', 'payroll_run')`, and schedules `ledger` sync for all paid employees (updating service bands/anniversaries).
- `payroll_run.delete` (only allowed while `UNPAID`): checks no later `run_number` has a payslip for any shared employee (`payroll_run_counted_later`). On delete: cascades `payslips`, releases every `payroll_run_id` seal via `on_delete: 'set_null'` (including reopening carried `pay_amendment` rows), and carries `undone('payroll_run:<id>')` inverse ledger movements.

---

## 5. Linear Subtotal Chain, Rate Basis & Statutory Dependency DAG

Inside `calculatePayroll` (`engine.ts` + `rates.ts`), every employee is priced in one pure deterministic pass with zero database I/O.

```text
  INPUTS: law (folded on pay_date), employer (folded on coverage.to), employment (folded on
          stretch), balance view (ytd, statutory_contribution, month[12m], years), work days,
          unsealed entries, optional back_pay[], optional carried{}
          |
          v
  [A] PRE-CHAIN BASIS (computed once per person; work days also compute per-day-month rates)
      * withCompanyPaidLeave: employer `pay_methods.paid_leave[]` overrides `paid_share` -> ''
      * month_wage = monthly_salary + sum(terms.allowances[c] where row.include_in_rate == true)
      * day_rate   : DAILY -> rate | HOURLY -> rate * hrs/day | MONTHLY -> conversions.day:
                     CALENDAR_DAYS | WORKING_DAYS | YEAR (x12/(52*days)) |
                     YEAR_REST_DAYS (x12/(365-52*rest)) | HOUR (hr*hrs/day) | FIXED (days)
      * hour_rate  : HOURLY -> rate | DAILY -> rate/hrs | MONTHLY -> conversions.hour:
                     CONTRACT_HOURS (day/hrs) | CONTRACT_WEEKLY (x12/(52*wkHrs)) | FIXED (hrs)
      * overtime_hour_rate = round(max(hour_rate, company CONTRACT_WEEKLY hour if enabled))
      * unpaidByDate: (1 - paid_share)/2 per leave slot + 1.0 per ABS day
      * proration_amount = min(periodBasic, unemployedDays * dayPrice(unit) + midPeriodDelta)
      * abs_amount       = min(periodBasic - proration_amount, sum(ABS days * perDay(unit)))
          |
          v
  [B] LINEAR SUBTOTAL CHAIN PASS (1..N, strict predecessor order; cycles/branches refused)
      +-----------------------------------------------------------------------------------+
      | 1. BASIC       : openingPay (contract salary or daily/hourly * working days/hrs)  |
      | 2. PRORATED    : BASIC - proration_amount - abs_amount                            |
      | 3. PAID_BASIC  : PRORATED - NPL / partial paid_share leave lines (grouped by      |
      |                  month + unit rate before rounding; floored so checkpoint >= 0)   |
      | 4..K. Subsequent checkpoints (e.g. ORDINARY_WAGES -> ADDITIONAL_WAGES -> GROSS):  |
      |    For each subtotal S:                                                           |
      |      + subtotal.calculation(ctx)                                                  |
      |      + allowance_catalog lines targeting S (on-cycle only; reads ctx.paid_share)  |
      |      + overtime_catalog lines targeting S  (on-cycle only; grouped by day rate)   |
      |      + leave_catalog cash-out lines targeting S (encashment / exit take_back)     |
      |      + claim_catalog lines targeting S     (on-cycle; capped quantity from ledger)|
      |      + adhoc_catalog lines targeting S     (off-cycle only if off_cycle_eligible; |
      |                                             accumulates ctx.posted.<SCHEME>.<side>|
      |                                             when lookup.accounts targets stat.)   |
      |      + loan_catalog_entry_repayment lines  (on-cycle only; paid_on <= coverage.to)|
      |    S.value = round(prev.value + computed + sum(signed EMPLOYEE lines on S))       |
      +-----------------------------------------+-----------------------------------------+
                                                |
                                                v
  [C] BACK-PAY INJECTION (if input.back_pay[] present from later-signed terms)
      * conversions.back_pay == true           -> each line keeps its own subtotal
      * conversions.back_pay == "<SUBTOTAL>"   -> lines below floor move up to that subtotal
      * Accumulates cumulative `backPayAt` per checkpoint -> exposed as `ctx.back_pay`
      * Shifts affected checkpoint values forward before statutory schemes evaluate
          |
          v
  [D] STATUTORY DEPENDENCY DAG (statutoryOrder: DFS topological sort on `depends_on`)
      Example:   [EPF / CPF / SSS] ----+----> [INCOME TAX / PCB / IIT]
                 [SOCSO / EIS    ] ----+
      For each scheme in topological order:
        * If scheme.assessed == 'PAID' and input.carried exists:
            ctx.subtotals adds cumulative `input.carried` into each checkpoint
        * Context exposes: subtotals, back_pay, statutory (earlier schemes only), posted,
          encashment, overtime, leave, balances, work, work_events
        * Check eligibility -> evaluate `employee_amount` & `employer_amount`
        * Below zero: if `lookup.below_zero == 'REFUND'`, emit refund line (flip direction);
                      otherwise clamp to 0 (next run nets YTD)
        * Emit EMPLOYEE line on `scheme.subtotal` + EMPLOYER line on `employer_cost_subtotal`
          |
          v
  [E] CHECKPOINT REBUILD & FINAL GUARDS
      * Re-sum every subtotal in chain order including statutory EMPLOYEE lines (nothing
        re-evaluated). Last checkpoint value = `net_pay`.
      * If `net_pay < 0` and any `loan_catalog_entry_repayment` line is present -> REFUSE.
      * `employer_cost` = sum of signed EMPLOYER lines.
      * `time_off` = days with `time_off_hours > 0` mapped to the law's single HOUR leave row
        marked `lookup.overtime_as_time_off: true`.
```

**Deterministic Expression Sandbox (`expressions.ts` + `programs.ts`):**

- Parsed once via Acorn (ECMA 2022, cached in `parsed` Map; max 64 KiB source).
- Bounded AST interpreter: **50,000 step limit** (`tick()`), immutable array methods only (mutators like `push`/`sort`/`splice` rejected at parse time), prototype keys blocked, `new`/`while`/`try`/`async`/`this` disallowed.
- Arithmetic runs on Effect `BigDecimal` (`+`, `-`, `*`, exact `/` rounded at scale 24 `half-from-zero`, comparisons via `BigDecimal.Order`).
- Every catalogue family declares its exact allowed `ctx.*` root list in `PROGRAMS` (`programs.ts`), verified at `jurisdiction_change` write time by `checkLaw`.

---

## 6. Cross-Period Amendments, Balance Unwinding & Back-Pay Loop

Paid payslips are immutable forever. Every correction happens in place on the source record, which stamps an open `pay_amendment` row in the same commit. The next run recalculates affected paid periods within their tax year and carries only the line-by-line delta.

```text
  PART 1: WRITE-TIME AMENDMENT CAPTURE (amendments.ts)
  ====================================================
  Source write on any `RUN_INPUTS[model] == 'amends'` record
  (roster, leave, claim, adhoc, repayment, employment, contract_terms, statutory_parameters,
   dependant, holiday, work_event, entity_change, jurisdiction_change, shift*, profile)
          |
          v
  [1] Compute touched `[from .. to]` span(s) (plus `run` seal id if moving a sealed date)
  [2] Check payslips of touched employees/entities (padded +/- 62 days for cutoff overlap):
          |
          +--> Any UNPAID run holding employee with `touch.from <= window.to` (non-soft)?
          |      YES -> REFUSE ("Run N holds this person and is not paid yet.")
          |
          +--> For each PAID ON_CYCLE run overlapping touched span (no existing open row):
                 Emit `pay_amendment.create { employee_id, pay_group_id, period }`
                 in `on_approved` (atomic with write, or with approving decision!).
                 Hard safety cap: REACH = 10,000 person-periods per single save.

  Note: `RUN_INPUTS` marks `jurisdiction` (currency/tz/tax_year_start) and `pay_group`
        (schedule pace) as `refuses` once any PAID run exists under them.
```

```text
  PART 2: RUN-TIME RECALCULATION & CARRY LOOP (amended.ts + history_slice.ts)
  ===========================================================================
  New Run (ON_CYCLE for pay_group, OR OFF_CYCLE carrying named open pay_amendments)
          |
          v
  [1] COLLECT CANDIDATES:
      (a) Open `pay_amendment` rows for paying people
      (b) Unsealed late claims/adhoc dated `< own.attendance.from`
      (c) `contract_terms` signed in `(lastPayDate .. ownPayDate]`
          with `effective_from < own.coverage.from`
          |
          v
  [2] APPLY BUDGET & BUCKET SPAN LOAD (1 batch query via `loadSpan`)
      * Sort candidates oldest `earliest` first; admit whole people up to
        `RECALCULATED_A_RUN = 240` earlier person-periods (others wait for next run)
      * Merge date spans into at most `MAX_BUCKETS = 12` entry buckets & balance buckets
      * Load historical stints, entries, paid payslips, closed amendments, non-payslip ledger
          |
          v
  [3] EXPAND AMENDED PERIODS PER PERSON (oldest first, within same tax year only)
      For each amended start period P:
        include every paid period Q where `Q.order >= P.order && Q.year == P.year`.
        If `conversions.back_pay` enabled and Q precedes a later-signed terms' signing period S,
        also include S (and S's rest-of-year periods).
          |
          v
  [4] RECALCULATE EACH PERIOD P (oldest first across `turns`)
      +-----------------------------------------------------------------------------------+
      | a) Reconstruct historical balance `accountsAt(employee, P)`:                      |
      |      today's balance                                                              |
      |      - reverse all paid payslips (and their carried postings) with order >= P     |
      |      - reverse non-payslip ledger rows (leave/claim/adhoc) with effective_on > P  |
      |      + apply carried postings already computed by THIS run for periods < P        |
      | b) `sliceOf(span, law(P.payDate), P)` unseals entries belonging to P              |
      | c) If `back_pay` enabled: `backPay(P)` computes `earnedOn(earlier, P.payDate)`    |
      |    minus `earnedOn(earlier, prevPayDate)` -> `BackPayLine[]` (`back_pay_period`)  |
      | d) Run `calculateRun(slice, P.run)` -> `due` breakdown & postings                 |
      | e) Diff `due` minus `paid` (original payslip + prior runs' carried deltas for P): |
      |      * remainderLines(due, paid, P.period) -> tagged with `period: P.period`      |
      |      * postingsBetween(duePostings, paidPostings) -> `carried[]` records          |
      |      * Statutory `assessed == 'EARNED'` (default): carry statutory line & posting |
      |      * Statutory `assessed == 'PAID'` (e.g. MY SOCSO/EIS/SKBBK):                  |
      |          drop statutory diff for P; accumulate carried pay delta into             |
      |          `carriedPay[employee][subtotal]` so THIS run taxes/contributes it!       |
      +-----------------------------------------------------------------------------------+
          |
          v
  [5] CALCULATE CURRENT RUN ON UPDATED BALANCE + `carriedPay` + CURRENT `backPay`
          |
          v
  [6] MERGE CARRIED LINES & APPLY NET-ZERO FLOOR (`RECOVERY_CARRIED`)
      net = current.net_pay + sum(carried ADD) - sum(carried DEDUCT)
      If net < 0:
        * Append line: { code: 'RECOVERY_CARRIED', amount: -net, direction: 'ADD' }
        * Clamp payslip `net_pay = 0`
        * Active employee  -> emit new `pay_amendment` for THIS run's period (next run recovers)
        * Exiting employee -> emit `obligation` (`recovery:<employment>:<period>[:<run>]`);
                              once HR marks that obligation FULFILLED, `settled` suppresses
                              re-taking `RECOVERY_CARRIED` on any future recalculation.
```

---

## 7. Append-Only Ledger, Four-Part Keys & Entitlement Sync

`src/data/model/employee_profile/employee_balance/service/` is the sole writer of `ledger_entry` and `employee_balance`. Every balance key is a 4-tuple `<account>/<code>/<period>/<measure>`, every ledger `amount >= 0`, and remaining entitlement is always derived (`entitled + carried + limit - used`) — never stored.

```text
                       THREE WAYS INTO THE LEDGER (Single Service)
  =======================================================================================
  [1] RECORD / PAYSLIP POSTING        [2] ENTITLEMENT SYNC          [3] MANUAL ADJUSTMENT
      (atomic `on_approved`)             (`ledger` automation)         (HR Controller UI)
      * leave_catalog_entry              * Cron: 0 0 1 1 * (Jan 1)     * ledger_entry.create
        -> leave/<code>/<P>/used         * Scheduled on window turn      with account=leave
        (0.5 DAY or dayHours/2 HOUR)       (`ledger:<boundary>`)         (entitled, 0.5 DAY
      * claim_catalog_entry              * Triggered by stint/terms/     or HOUR) or claim
        -> claim/<code>/<P>/used           params/dependant/profile/     (limit, MONEY)
        (capped at claimLeft)              work_event/law/entity_chg/  * Period & source
      * adhoc_catalog_entry                run PAID/late closed-win      `manual:<id>` derived
        -> lookup.accounts[]             * Batches: SYNC_BATCH=200       by transform; balance
      * payroll_run (payslips)             settle() chunks of 50         updates in same write
        -> pay/<subt>/<Y|M>/total        * Posts leave/*/entitled,     * Immutable; fix via
        -> statutory/<c.p>/<Y|M>/paid      leave/*/carried,              opposite row
        -> leave/<code>/<P>/entitled       claim/*/limit               * Sync NEVER overwrites
           (time_off hours)              * Runs `retire()` on full       manual rows
        -> leave/<code>/<P>/used           workspace pass
           (exit cash_out)
                     \                          |                          /
                      v                         v                         v
  +-------------------------------------------------------------------------------------+
  |  IDEMPOTENT DIFF ENGINE (core.ts + ledger_store.ts)                                 |
  |   1. For each (balance_id, source): aggregate `wanted[]` vs prior `posted[]`        |
  |   2. delta = round(wanted - posted, scale: 8); skip if delta == 0                   |
  |   3. delta > 0 -> ADD |delta|  ;  delta < 0 -> DEDUCT |delta|  (delete: wanted=[])  |
  |   4. Atomically write `ledger_entry.create` + `employee_balance.update` guarded     |
  |      by optimistic `revision` check (prevents lost concurrent balance updates)      |
  +-----------------------------------------+-------------------------------------------+
                                            |
                                            v
  +-------------------------------------------------------------------------------------+
  |  FOUR-PART KEY STRUCTURE & WINDOW TYPES                                             |
  |   <account> / <code> / <scope>.<letter>.<YYYY-MM-DD> / <measure>                    |
  |                                                                                     |
  |   scope  : <JURISDICTION> (or <JURISDICTION>.<entity_id> for pay/statutory when     |
  |            `ledger.ytd_scope == 'EMPLOYER'`, e.g. CN)                               |
  |   letter : Y = Year (tax/calendar/fiscal) | M = Month | S = Service year (+offset)  |
  |            B = Rolling block (N months)   | E = Event (CHILD_BIRTH / stint.events)  |
  |            L = Lifetime                                                             |
  |   measure: entitled | carried | used | limit | total | paid                         |
  |   left   : entitled + carried + limit - used  (derived on read, never persisted)    |
  +-------------------------------------------------------------------------------------+
```

**Closing-Window Settlement & Retention (`posting_plans.ts` + `entitlement_sync.ts`):**

- When a new window opens (`!opened(current)`) and the prior window `last` was opened, sync settles `last` **once** under the law and employment terms in force on `last`'s closing day (`closing` rule), then computes carry-over into the new window (`carriedOf`: `per_months` carries full remainder; `carry.statutory_grant_carries` carries statutory grant in full plus company excess capped by `annual_leave_carry_limit_days`; standard `carry` caps at `min(left, granted, max_days, contract_cap)`).
- Backdated leave/manual/run postings into a window starting `>= 1 year` ago trigger `syncLate` / `syncLatePosted` to re-run `ledger` for that person so carry-over stays accurate.
- Whole-workspace `ledger` runs call `retire()`: removes month keys older than 12+1 months and `Y`/`S` keys older than `YEARS_HELD = 3` years from `employee_balance` via dated balancing ledger entries (preserving `E`, `L`, `B` windows and keeping every `ledger_entry` forever), then schedules the next `ledger:<boundary>` wakeup at the earliest upcoming window boundary across all employees.
- If `ledger` exhausts 8 retries (or hits a non-retryable refusal), `raiseFailure` opens an `obligation` (`ledger-failure:<today>:entitlement sync`) so failures never go silent.

---

## 8. Employment Stints, Transfers, Exit Settlement & Loan Recovery

An `employment` is one continuous stint of one person with one legal entity (`no_overlap` per `employee_id`). Transfers and rehires are new stints; an exit is derived from the stint chain rather than stored as a status flag.

```text
  STINT TIMELINE & SERVICE CALCULATION (person.ts)
  ================================================
  Stint 1 [2024-01-01 .. 2025-06-30] (Entity A, MY)
       |  gap OR next-day transfer (2025-07-01)
       v
  Stint 2 [2025-07-01 .. 2026-10-31] (Entity B, MY)  -->  isExit()?
          |                                                YES iff `to != null` AND no later
          |                                                stint of this person exists under
          v                                                the SAME jurisdiction `settings_code`
  startsOf(stint, chain, lineage, cumulative_service):
   * Contiguous stints (next.from <= prev.to + 1d) under same law merge into one unbroken span.
   * `employment_started_on` = start of current unbroken span.
   * `service_started_on`    = earliest of:
       (a) `stint.service_started_on` (prior credited service), OR
       (b) `currentStart - earlierStintDays` (if `cumulative_service`), else `currentStart`.

  EXIT LIFECYCLE & RECONCILIATION (employment/+model.ts + dependants.ts + run_calculation.ts)
  ===========================================================================================
  Stint `effective_range` written (end date added, moved, cancelled, or new stint created)
          |
          +--> [A] TRANSFORM:
          |        * Moving first day carries first-day `contract_terms` & `statutory_params`
          |        * Checks `assertFactsHold` (no taken event-leave orphaned)
          |        * Emits `pay_amendment` rows for all reached paid periods
          |
          +--> [B] EFFECT (`raiseExits` + `reconcile`):
          |        1. Diff exits before vs after across all stints of person
          |        2. If exit created/moved/cancelled: fire `tap('exit', 'employment')`
          |           with stint folded on its last day -> creates exit `obligation` tasks
          |        3. `reconcile(ctx, people)` keeps non-pay exit state in sync:
          |           * Exit duties (`:exit:` or `exit:`):
          |               OPEN & no longer matching current exit date -> WAIVED (auto reason)
          |               WAIVED (auto reason) & exit stands again    -> REOPENED (OPEN)
          |               (HR-waived duties with custom reason are never touched)
          |           * Cancelled exit with unsealed `Final settlement` loan repayment:
          |               deletes unsealed final settlement -> rebuilds monthly schedule
          |
          +--> [C] FINAL ON-CYCLE PAYSLIP LEAVE SETTLEMENT (run_calculation.ts):
                   On the on-cycle run where `exit == true` and `lastDay in salary_coverage`:
                   For every `leave_catalog` row declaring a non-empty `payout`:
                     Read `latestWindow(balance, 'leave', code, jur)` (rounded to 0.5d):
                     * days > 0 & encash_leave != false & exit_ground != MISCONDUCT_DISMISSAL:
                         emit synthetic encashment line (`payout`) + `cash_out` (+days -> 0)
                     * days < 0 (over-taken beyond earned):
                         ALWAYS recover (`take_back: true` at `payout`) + `cash_out` (-days)
                     * Editing `encash_leave`, moving last day, or cancelling exit amends that
                       period -> next on-cycle or off-cycle carry run settles the difference!
```

**Loan Schedule State Machine & Transfer/Exit Disposition (`loan_schedule.ts`):**

```text
  NO_TERMS --(principal>0 & valid period)--> READY --(generate)--> GENERATED --(seal)--> SEALED
  * `buildLoanSchedule`: sealed repayments stay immutable; remaining principal splits evenly
    across unpaid months (floor to cents; extra cents allocated 1 each to the final months).
  * Transfer (`loanDisposition`):
      same jurisdiction -> CARRY | cross-jurisdiction & target has catalog code -> TRANSFER
      (relocates unsealed repayments in same write) | otherwise -> SETTLE on final pay.
  * Final-pay recovery cap (`loanRecovery`):
      maximum = floor(max(0, expectedPay) * (100 - final_pay_loan_floor_percent) / 100)
      (default floor = 10%, dated on `entity_change`). Loans allocate in id order;
      unrecovered remainder triggers `LOAN_RECOVERY:` obligation notification to HR Controllers.
```

---

## 9. Kiosk Biometrics, Attendance Matching & Roster Validation

```text
  PART 1: ATTENDANCE KIOSK BIOMETRIC & PUNCH PIPELINE (src/app/attendance/)
  =========================================================================
  [Webcam 1280x720] -> [Analyse Canvas 640x480 (100ms spaced loop, no overlap)]
          |
          v
  [@vladmandic/human (WebGL -> WASM fallback; CDN @3.3.6)]
  blazeface (min 80px, straighten) + histogram eq + facemesh + faceres (1024d embedding)
          |
          +--> Single face inside silhouette? (else hint: move_closer / no_face)
          v
  [MiniFASNet Anti-Spoof (onnxruntime-web WASM; assets/models/minifasnet.onnx)]
  Dual edge-shifted BGR crops (scales 2.7x and 4.0x, 80x80 float32) -> real-class probability
          |
          v
  [KioskHold State (hold.ts)]
  * EMA smoothing: liveScore = prev * 0.6 + current * 0.4  (must stay >= KIOSK_LIVE_MIN 0.80)
  * Identity check: cosine faceDistance(hold.probe, curr) <= KIOSK_MATCH_THRESHOLD (0.25)
  * Hold duration: 1 second (`KIOSK_CONFIRMATION_SECONDS = 1`)
          |
          +--> Concurrent lookup (`matchFace`, `output: 'kiosk'`):
          |      Query `employee_profile` where `face_enrollment_status == 'APPROVED'`
          |      Nearest cosine distance <= 0.25 -> check active `employment` in selected entity
          v
  [punchWork(ctx, employment_id, 'FACE' | 'MANUAL')]
  * Resolves local work_date in `entity.time_zone ?? jurisdiction.timezone`
  * Enforces 60s `PUNCH_COOLDOWN_MS` against last punch timestamp
  * No roster row for date -> `roster_entry.create` with `[{ start: now, end: null }]`
  * Open interval exists   -> `roster_entry.update` sets `end: now` (status: 'out')
  * Closed intervals only  -> `roster_entry.update` appends `{ start: now, end: null }` ('in')
  * Speaks bilingual audio clip (`assets/kiosk-voice/{en,zh}/{checked_in,checked_out,...}.mp3`)
          |
          v  (event trigger: roster_entry create/update)
  [late_notice Automation]
  * Filters `work_date >= yesterday` (live alerts only; imports/seals stay silent)
  * If `firstClockIn - shiftStart >= entity.late_notice_minutes` -> notifies
    `entity.late_notice_policies` once per day (`once: late:<roster_entry_id>`)

  Face Enrolment (`face_enroll_flow.svelte`):
  5 guided poses (straight, left, right, up, down) -> `meanEmbedding()` (L2-normalized 1024d)
  + straight JPEG upload -> `employee_profile.update`:
    * Employee self-service (`self: true`) -> status `PENDING` (awaits HR Approve/Reject)
    * HR Controller / Kiosk (`self: false`) -> status `APPROVED` (HR may Suspend/Reinstate)
```

```text
  PART 2: PAYROLL ATTENDANCE MATCHING & ROSTER WARNINGS (run_calculation.ts, attendance.ts)
  =========================================================================================
  For each roster day in attendance window (and up to leaver's last day):
    plan    = scheduled(row, zone, shift)  -> shift spans minus unpaid breaks (or untimed hours)
    clock   = closedSpans(actual_worked_intervals)
    planned = closedSpans(planned_overtime_intervals)

    awarded  = overlapSpans(planned, clock) min / 60   <-- Clock proves presence & awards plan;
    timeOff  = row.overtime_as_time_off ? awarded : 0      clock NEVER invents unapproved OT!
    overtime = awarded - timeOff
    worked   = clock.length == 0 ? 0 : scheduledHours(plan) + overtime
    clocked_shift_hours = floor(overlapSpans(clock, plan.spans) / 30m) / 2

    ABSENCE RULE (Section 0):
      1. Rostered WORK day with `clock.length == 0`, no holiday, no unsealed leave -> ABS
      2. If employee has ANY roster row in the cycle (declaring roster as source of truth), any
         planned work day omitted from the roster (no holiday, no leave) -> synthetic ABS day.
         (Staff with no roster rows in the cycle keep their shift pattern / ordinary-week plan.)

    WRITE-TIME ROSTER CHECKS (`roster_warnings.ts` on roster_entry create/update):
      * Hard refusals: date outside stint, shift from other entity, overlapping/bad intervals.
      * Non-blocking findings stored on `roster_entry.findings[]` (shown on Work month board):
          - Registered rule warnings (`validateRegistered`)
          - Jurisdiction cap warnings (`roster_warnings`): `roster.daily_hours`,
            `roster.daily_overtime`, `roster.monthly_overtime` (optional day_types filter),
            `roster.consecutive_days` (looks back `streak` days), `roster.weekly_rest`.
```

---

## 10. Registered Rules, Effects & Statutory Research / Filing Pipeline

```text
  PART 1: REGISTERED RULES & EFFECTS PIPELINE (registrations.ts + rule_reads.ts)
  ==============================================================================
  Model Write (create / update / delete / exit)
          |
          +--> [BEFORE COMMIT: validateRegistered]
          |      1. `lawsFor` folds law in force on each row's date; `assertPlaced` refuses
          |         unknown `catalog_code` or priced days outside employment range.
          |      2. `subjectsOf` resolves employer/employment/employee snapshots in bulk.
          |      3. `ruleRead` executes ONE typed batch query across all rules' declared `reads`
          |         (validated against fixed `KEYS` allowlist; merges `range`/`set` bounds).
          |      4. Evaluates `condition` -> `validate` in `order` sequence.
          |      5. Owner directive (2026-11-15): failing rules log warning (and attach to
          |         `roster_entry.findings`) without blocking the write.
          |
          +--> [AFTER COMMIT: applyRegisteredEffects]
                 * Direct writers with law access call `tap(ctx, verb, model, changes)`.
                 * Employee/invitation writes (`leave_catalog_entry`, `claim_catalog_entry`,
                   `employee_profile`) trigger `registered_effects` (`payroll_execution`),
                   skipping entries still holding `$approval != null`.
                 * Bulk-reads declared `reads` once -> evaluates `condition` -> `effects` ->
                   writes deduplicated `obligation.import { rows, on_conflict: 'keep' }`
                   keyed by `occurrence_key` (safe to replay).
```

```text
  PART 2: AUTOMATED STATUTORY RESEARCH & HUMAN-VERIFIED FILING PIPELINE
  =====================================================================
  Trigger: Cron Sat 03:00 UTC (`0 3 * * 6`) OR HR manual click in Settings -> Change log
          |
          v
  [1] `statutory_research` (fan-out dispatcher; policy: `configuration_execution`, max: 16)
      Reads distinct `entity.settings_code` in use (or requested `code`)
      Schedules 12 parallel discovery runs per jurisdiction:
        `jurisdiction` + 11 `FAMILIES` (9 catalogues + registered_rule + registered_effect)
          |
          v
  [2] DISCOVERY AGENT RUN (per code/family, read-only -- writes NO models!)
      Loads current law on `ctx.today`, future standing dates (`ahead`), existing findings,
      ACTIVE `statutory_source` URLs (excluding replaced URLs) + official `references` origins.
      Calls `ctx.ai.sys_2.infer({ model: 'strong', tools: ['web_search'], steps: 6 })`
      Audits every rate/ceiling/deadline against official gov/tax/social-security sources.
      Classifies each finding: `fit` (VALUE|ROW|STRUCTURAL), `families[]`, `instrument`, quote.
          |
          v  ctx.schedule('statutory_filing', { code, family, answer })
  [3] `statutory_filing` (serialized writer; `concurrency: { max: 1 }` -> zero write conflicts)
      * Retires replaced `statutory_source` rows; bootstraps `REFERENCE` sources; adds `AGENT`
        proposed sources (must be activated by a human member!); stamps `last_checked_on`.
      * `sortFindings()` deduplicates by normalized `instrumentKey(instrument)`:
          - New -> creates `statutory_finding` in `PROPOSED`
          - Existing `PROPOSED` -> merges new `source_urls`
          - Already `CONFIRMED` or `REJECTED` -> untouched
      * For each fresh non-`STRUCTURAL` finding, fans out 1 drafting run per touched family:
          ctx.schedule('statutory_research', { code, family: touched, finding: id })
          |
          v
  [4] DRAFTING AGENT RUN -> `statutory_filing` (with `finding` id)
      Agent diffs official instrument vs current family rows (`steps: 3`, `web_search` <= 2).
      `planChanges()` deterministically builds one dated `jurisdiction_change` patch per
      `effective_from` (never invents dates: undated items append to `finding.notes`).
      Drafted changes carry `finding_id` -> **DORMANT** (`standing()` is false until CONFIRMED).
          |
          v
  [5] HUMAN VERIFICATION GATE (`statutory_finding.update` -> `CONFIRMED`)
      Refused unless ALL hold:
        1. `ctx.actor.kind === 'member'` (automation cannot self-confirm)
        2. `fit !== 'STRUCTURAL'` (structural changes require code/template work)
        3. At least one `source_url` is official `https://*.gov|go.*` or an ACTIVE source host
        4. `source_quote` is non-empty
        5. At least one drafted `jurisdiction_change` links to this finding
        6. `lawWrite()` passes full `checkLaw()` at change date & every later change date
      On commit: sets `verified_on` & `verified_by`, activates all linked `jurisdiction_change`
      patches, emits `pay_amendment` rows for reached paid periods, and schedules `ledger` sync!
```

---

## 11. State Machines, Locks, Exports & Access-Control Matrix

### State Machines & Lock Constraints

```text
  payroll_run.state:                    obligation.state:
  +--------+   mark paid   +------+     +------+  fulfill  +-----------+
  | UNPAID | ------------> | PAID |     | OPEN | --------> | FULFILLED | [LOCKED]
  +--------+               +------+     +--+---+           +-----------+
   (deletable               [LOCKED]       |  ^
    if not counted                         |  | reopen
    by later run)                          v  |
                                        +------+
                                        |WAIVED| [LOCKED except waiver_reason, state]
                                        +------+

  statutory_finding.status:             statutory_source.status:
  +----------+  confirm   +-----------+ +----------+  activate   +--------+
  | PROPOSED | ---------> | CONFIRMED | | PROPOSED | ----------> | ACTIVE |
  +----+-----+            +-----+-----+ +----+-----+             +--+--+--+
       |  reject     reject     |            | retire     retire |  ^  reactivate
       +---------->+<-----------+            +---------->+<------+  |
                   v                                     v          |
              +----------+                           +---------+    |
              | REJECTED | [LOCKED]                  | RETIRED +----+
              +----------+                           +---------+ [LOCKED except status, notes]
  (CONFIRMED: locked except status, notes)           (AGENT origin: human member activates)

  workplace_case_catalog_entry:         employee_profile.face_enrollment_status:
  Locked once `payroll_run_id != null`  NONE -> PENDING (self) -> APPROVED <-> SUSPENDED
                                        NONE -> APPROVED (HR/kiosk) ; PENDING -> NONE (reject)
```

### Two-Step Self-Service Approval Flow (`requestReview` in `grants.ts`)

```text
  Employee submits leave_catalog_entry (create) or claim_catalog_entry (create / update)
          |
          v  Policy verdict verifies `ownsEmployments(ctx, ...)` -> `requestReview(ctx)`
  +-------------------------------------------------------------------------------------+
  |  PROVISIONAL HOLD (`$approval != null`):                                            |
  |   * Ledger NOT posted yet; pay_amendment NOT written yet; effects NOT fired yet     |
  |   * Pending leave days still count in `leaveShort()` balance guard to block double- |
  |     booking; any payroll_run covering the entry REFUSES until decided               |
  +-----------------------------------------+-------------------------------------------+
                                            |
           +--------------------------------+--------------------------------+
           | Standard Path                  | Supersede Shortcut             |
           v                                | (`superseded_by`)              |
  [Step 1: Supervisor review]               |                                |
   Teams holding `supervisor`               |  Teams holding `hr_manager`    |
          or `manager`                      |         or `senior_management` |
   (no self-approval)                       |  (decides in place of steps)   |
           | approve                        |                                |
           v                                |                                |
  [Step 2: HR review]                       |                                |
   Teams holding `hr_controller`            |                                |
          or `hr_manager`                   |                                |
           | approve                        |                                |
           +----------------+---------------+                                |
                            v                                                |
  [FINAL APPROVING DECISION -- SINGLE ATOMIC WRITE] <-------------------------+
   * Commits entry (`$approval` cleared)
   * Executes `on_approved`: posts `ledger_entry` + `employee_balance` + `pay_amendment`
     (if ledger cannot move, approval fails!)
   * Fires `registered_effects` automation (`payroll_execution`) to raise law obligations

  Note: HR-keyed leave/claims bypass approval and post immediately in their own write.
        Reject restores checkpoint; requester alone may withdraw.
```

### Access-Control Authority Matrix (`src/access_control/policy/`, `seed/public/sys_team.json`)

Teams are `sys_team` rows an administrator edits; these are the seeded ones. A flow's approvers and a notice's readers are the teams holding the named policy.

| Seeded team id          | Display Name            | Policies                        | Apps                           | Key Grants & Boundaries                                                                                                                                                                                                                                       |
| ----------------------- | ----------------------- | ------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `employee`              | Employee                | `employee`                      | `hr_employee`                  | Own profile (`documents` update only), own stints/terms/params/dependants/balances/ledger/payslips/rosters, `entity` (`self_service` output), `holiday`, `jurisdiction*`, `pay_group`, `shift*`; leave create & claim create/update held via `requestReview`. |
| `supervisor`            | Supervisor              | `employee`, `supervisor`        | `hr_employee`                  | Employee grants + Step 1 approval authority on `requestReview`.                                                                                                                                                                                               |
| `production_manager`    | Production Manager      | `employee`, `supervisor`        | `hr_employee`                  | Same as Supervisor.                                                                                                                                                                                                                                           |
| `manager`               | L1 Manager              | `employee`, `manager`           | `hr_employee`                  | Employee grants + Step 1 approval authority on `requestReview`.                                                                                                                                                                                               |
| `hr_controller`         | HQ Payroll HR           | `hr_controller`                 | `hr_controller`, `hr_employee` | Full `READ_ALL` (with history), `HR_OPERATIONS`, `CONFIGURATION`, manual `ledger_entry.create` (exclusive to `hr_controller`), manual start of `ledger` & `statutory_research`, Step 2 HR approval.                                                           |
| `manager_hr_controller` | Manager (HR Controller) | `hr_controller`                 | `hr_controller`, `hr_employee` | Same as HQ Payroll HR.                                                                                                                                                                                                                                        |
| `hr_manager`            | HR Manager              | `hr_manager`                    | `hr_controller`, `hr_employee` | `READ_ALL`, `HR_OPERATIONS`, `CONFIGURATION`, starts `ledger` & `statutory_research`, Step 2 HR approval + `superseded_by` override. No manual `ledger_entry.create`.                                                                                         |
| `senior_management`     | Senior Management       | `senior_management`             | `hr_controller`, `hr_employee` | Same grants as HR Manager + `superseded_by` override.                                                                                                                                                                                                         |
| `attendance_kiosk`      | Attendance Kiosk        | `kiosk`                         | `attendance`                   | `kiosk` named outputs only (`employee_profile`, `employment`, `entity`, `jurisdiction`, `roster_entry`, `sys_file` face_photo meta); `roster_entry` punch create/update; face enrollment `NONE/APPROVED -> APPROVED` only (cannot undo).                      |
| _(system)_              | —                       | `payroll_execution`             | —                              | Held only by `ledger`, `registered_effects`, `late_notice`. Sole direct writer of `employee_balance` & system `ledger_entry`.                                                                                                                                 |
| _(system)_              | —                       | `configuration_execution`       | —                              | Held only by `statutory_research`, `statutory_filing`. Grants `web_search` & `browser` tools + `CONFIGURATION`.                                                                                                                                               |
| _(system)_              | —                       | `invitation_profile_automation` | —                              | Held only by `invitation_profile`. Links/creates `employee_profile` (`user_id`, `invitation_id`) when `sys_user` accepts an internal `sys_invitation`.                                                                                                        |

**Rate limits (`src/+workspace.ts`):** All member policies allow `act: '600/min'`, `read: '600/min'`, `agent: '100/h'`. All automation policies allow `act: '600/min'`, `read: '600/min'`.

### Reporting, Workbook Imports & Bank File Syncs

```text
  CLIENT-SIDE EXCELJS EXPORTS (src/data/model/payroll_run/service/exports/)
  -------------------------------------------------------------------------
  * Salary Listing (`salary_listing_export.ts`): reads saved payslips only (NEVER recalculates).
    1 sheet per selected run (ordered along subtotal chain, signed corrections merged into each
    catalogue column, employee vs employer separated, saved Gross / Tax Withheld / Net / Cost to
    Company totals) + `Line details` sheet preserving each line's own period/back_pay_period.
  * Overtime Report (`overtime_report_export.ts`): evaluates `overtime_catalog` expressions
    over an attendance cutoff window (from Payroll runs or Work month board) -> summary per
    period/pay group + `Daily details` sheet (including `time_off_hours` banked).

  SERVER FILE SYNCS (src/data/model/payroll_run/)
  -----------------------------------------------
  * `+ocbc_fast.sync.ts`  -> Fixed-width `.txt`:
      D | bank_code(8) | acct(20) | cents(15) | name(40) | emp#(20) | ccy(3)
  * `+metro_bank.sync.ts` -> Fixed-width `.txt`:
      PAY | bank_code(4) | acct(18) | cents(12) | ACCT_NAME(30) | emp#(12)

  CLIENT-SIDE WORKBOOK IMPORTS (src/lib/ui/workbook/)
  ---------------------------------------------------
  * Data Request (`data_request_import.ts`):
      Entities -> Pay Groups -> Entity Changes -> Profiles -> Stints / Terms / Params
      (batched by 25; idempotent re-upload skips rows already committed).
  * Holidays (`holiday_workbook.ts`):
      Multi-entity sheets; skips held dates; lands unpublished.
  * Roster (`roster_import.ts`) & Entries (`entry_import.svelte.ts`):
      Work board, Leave, Claims, Ad Hoc, Loans, Repayments, Cases.
```

---

## 12. Verified Source Inventory

- **Models (30):**
  - Person & Employment (7): `employee_profile`, `dependant`, `employee_balance`, `ledger_entry`, `employment`, `contract_terms`, `statutory_parameters`
  - Legal Entity & Plans (6): `entity`, `entity_change`, `pay_group`, `holiday`, `shift_pattern`, `shift_definition`
  - Dated Entries & Events (9): `leave_catalog_entry`, `leave_catalog_entry_day`, `claim_catalog_entry`, `adhoc_catalog_entry`, `loan_catalog_entry`, `loan_catalog_entry_repayment`, `workplace_case_catalog_entry`, `roster_entry`, `work_event`
  - Jurisdiction & Research (4): `jurisdiction`, `jurisdiction_change`, `statutory_finding`, `statutory_source`
  - Payroll & Compliance (4): `payroll_run`, `payslip`, `pay_amendment`, `obligation`
    _(Total: 7 + 6 + 9 + 4 + 4 = 30 models.)_
- **Custom Fields (3):** `bank`, `reads`, `references`
- **Apps (9):** `hr_controller/{dashboard,entities,events,obligations,payroll,people,settings}` (7 apps in 1 group), `hr_employee` (1), `attendance` (1 kiosk shell)
- **Automations (6):** `invitation_profile`, `late_notice`, `ledger`, `registered_effects`, `statutory_filing`, `statutory_research`
- **File Syncs (2):** `payroll_run.metro_bank`, `payroll_run.ocbc_fast`
- **Seeded teams (9, `seed/public/sys_team.json`):** `employee`, `supervisor`, `manager`, `senior_management`, `hr_controller`, `hr_manager`, `manager_hr_controller`, `production_manager`, `attendance_kiosk`
- **Policies (10):** `employee`, `supervisor`, `manager`, `hr_controller`, `hr_manager`, `senior_management`, `kiosk`, `payroll_execution`, `configuration_execution`, `invitation_profile_automation`
- **Public Seed Jurisdictions (9):** `CN`, `ID`, `JP`, `MY`, `PH`, `SG`, `TH`, `TW`, `VN` (under `seed/public/jurisdiction/<CODE>/`, seeded from 2025-12-01 with enacted dated changes)
