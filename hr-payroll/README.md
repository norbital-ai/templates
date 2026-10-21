# HR & Payroll

![HR & Payroll workspace thumbnail](assets/thumbnail.svg)

A Bolt workspace for employment records, rosters, leave, claims, loans, payroll and statutory contributions
across nine jurisdictions (SG, MY, PH, ID, VN, TW, CN, JP, TH). A payroll run builds one payslip per employment
contract and links it to the records it settled.

## Apps and roles

| Application           | Tasks                                                          |
| --------------------- | -------------------------------------------------------------- |
| Employee self-service | Own schedule, leave, claims and payslips                       |
| Entities              | Legal entities, shift patterns and definitions, holidays       |
| People                | Profiles, employment contracts, face enrolment and offboarding |
| Events                | Roster and attendance, leave, claims, one-time payments, loans |
| Payroll               | Regular and off-cycle runs, payslips and exports               |
| Settings              | Jurisdiction versions, catalogues, rules and behaviours        |

The five HR apps live under `src/app/hr_controller/`; employee self-service is `src/app/hr_employee/`.
Teams (`src/access_control/team/+team.ts`) are source declarations that link these policies:

| Team                                   | Policy              | Apps                          |
| -------------------------------------- | ------------------- | ----------------------------- |
| Employee                               | `employee`          | Employee self-service         |
| Supervisor, Production Manager         | `supervisor`        | Employee self-service, People |
| L1 Manager                             | `manager`           | All HR apps and self-service  |
| Senior Management                      | `senior_management` | All HR apps and self-service  |
| HQ Payroll HR, Manager (HR Controller) | `hr_controller`     | All HR apps and self-service  |
| HR Manager                             | `hr_manager`        | All HR apps and self-service  |
| Attendance Kiosk                       | `kiosk`             | The `attendance` kiosk        |

Automations run as `hr_controller` (`calendar_tick`, `behaviour_taps` with `payslip_hold_automation`) or their own
`*_automation` policy; `src/access_control/policy/grants.ts` holds the grant fragments policies share. Seed packs
carry each staff member's team handle in `sys_user.team`.

**Kiosk.** `attendance` (`/kiosk/attendance`) is the chromeless attendance-capture device for the Attendance Kiosk
team.

## Data model

Country law is data, not code. Each jurisdiction is a lineage of dated, sealed `jurisdiction_settings` versions with
their catalogue rows (`statutory_contribution_catalog`, `leave_catalog`, `claim_catalog`, `adhoc_catalog`,
`loan_catalog`, `allowance_catalog`, `work_catalog`) and `rule_set` rows. Rates, bands, eligibility and pricing are CEL
expressions on those rows; behaviours are event rules on the settings version. The engine in
`src/lib/payroll_engine/` evaluates them and holds no jurisdiction-specific logic. A change of law is a new version,
made without touching source. Jurisdiction versions also own their suspension kinds (a validated custom field).

What each jurisdiction configures is tracked in the [jurisdiction trackers](docs/inventory/README.md); the latest
statutory audit is in [docs/audit](docs/audit/) (see [Compliance audit](#compliance-audit-2026-10-21)).

## Automations

| Automation            | Trigger                                                                 | Result                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `behaviour_taps`      | Row events on runs, payslips, contracts, profiles, entities and entries | Applies the version's behaviour rules: each reads its declared rows and returns the writes.                                   |
| `statutory_drift`     | Every Saturday 03:00 UTC; also **Run now**                              | Researches every sealed in-force lineage (or the one `code` given) concurrently; a verified change becomes an unsealed draft. |
| `late_arrival_notice` | Every five minutes                                                      | One reminder per person-day when a rostered shift has no clock-in after the entity's grace.                                   |
| `calendar_tick`       | Daily                                                                   | Runs the behaviour rules for every employment in force, so date-driven duties raise tasks.                                    |
| `invitation_profile`  | Staff invited; staff user created or contact changed                    | Creates employment profiles for invited staff and links their identities after acceptance.                                    |

Any automation that needs no input can be started by hand from **Settings → Automations → Run now**.

### Statutory research

One `statutory_drift` run maps every in-force lineage onto its own multi-step `ctx.ai.sys_2.infer` call with
`Effect.forEach(..., { concurrency: 'unbounded' })`: the nine lineages research at the same time inside one run, and a
lineage that fails is reported in the output's `failed` list without stopping the others.

- **Tools:** `web_search` (host web search), `web_read` (reads a page or document — PDF, Word, spreadsheet — as text, in
  20,000-character windows or the passages around a phrase) and the confined browser — `browser_navigate`,
  `browser_snapshot`, `browser_act` — granted by the `statutory_drift_automation` policy.
- **Budget:** `steps: 1000` tool turns, then one tool-less turn to submit.
- **Role:** `STATUTORY_RESEARCH_ROLE` in `src/lib/payroll_engine/statutory_snapshot.ts` — build a coverage checklist,
  search, open the governing instrument on a registered official origin, quote it, patch every verified correction,
  submit once. Documents are read with `web_read` (an empty browser page is a document); no URL is opened twice.
- **Gate:** a draft is written only when every changed path is backed by a quote that re-appears on the cited page,
  fetched again by the automation itself (`statutory_drift.ts`).

Every tool step is recorded on the run as an `infer.tool` event (`sys_event`), so each run carries the trail of what
it searched and opened.

Why it used to loop: government instruments are often PDFs, and a browser snapshot of a PDF is empty, so the model
re-opened the same URL turn after turn until the stall guard ended the run. `web_read` returns the document's text, and
read-only draft turns no longer count as stalls while the step budget lasts.

Started, scheduled and cron-driven automations share one lane per workspace, so `calendar_tick` and
`late_arrival_notice` wait while a sweep runs; the sweep itself is one run. Row-event automations (`behaviour_taps`)
run outside that lane.

### Behaviours

Every lineage carries the same ten rules (`behaviours.rules` on the version); what differs per jurisdiction is the
catalogue data they read.

| Rule                         | Event                                   | Effect                                                                          |
| ---------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| `encash-leave-on-exit`       | Contract gets an exit date and ground   | One `ENCASHMENT` leave entry per class with `encash_on_exit`                    |
| `retract-exit-effects`       | The exit is moved or undone             | Withdraws the unsettled encashments and open exit tasks it raised               |
| `encash-leave-at-window-end` | Daily, at a leave window's end          | Encashes the unused balance of classes with `encash_at_window_end` (PH SIL)     |
| `raise-tasks`                | Row events, daily, after exit, calendar | Regulatory tasks from the version's `TASKS` rules (final wages, data disposal…) |
| `raise-obligations`          | Payroll run created                     | Filing and remittance obligations from `OBLIGATIONS` rules                      |
| `pin-settled-entries`        | Payroll run created                     | Links each settled entry to its payslip                                         |
| `hold-payslips`              | Payroll run created with holds          | Moves the held people's payslips to `ON_HOLD`                                   |
| `withdraw-run-duties`        | Payroll run deleted                     | Withdraws that run's obligations                                                |
| `write-public-holidays`      | Entity created / calendar               | Writes the version's public holidays to the entity calendar                     |
| `payroll-run`                | `PAYROLL_CREATE`                        | Admits `REGULAR` and `OFF_CYCLE` runs                                           |

Exit encashment is on for annual leave in every lineage except JP (no statutory payout); TW also encashes rest-day
in-lieu and comp time.

## Payroll

**Regular run.** Payroll → New → period. Pays salary and every approved, unsettled entry dated in the period; one per
period.

**Off-cycle run.** Payroll → New → Kind **Off-cycle**. Pick people and components (multi-select comboboxes) to narrow
the list, then tick the entries to pay. Only approved, unpaid entries of the families the version allows
(`payroll.off_cycle_families`, default ad hoc and claims) can be selected; the run pays those entries and **no
salary**. Statutory contributions settle month to date: whichever order the off-cycle and regular runs come in, the
month's totals equal one combined run.

**Statutory charges are never deferred.** Every run, regular or off-cycle, settles the month to date: the slip line is
the month's charge less what earlier runs of that month already charged. Whether regular pay is still to come is a
person fact in each scheme's CEL (`normal_pending`), not an engine branch, so an off-cycle bonus slip withholds its own
PCB, CPF, SSS… on the spot and the month's total always equals one combined run.

**Jurisdiction inputs.** Inputs only some jurisdictions need (dependants, spouse status, religion, fixed-term flag, a
loan's permitted purpose…) are declared per lineage in `employee_input_schema` and stored as contract-term facts
(`terms.facts.*`) or loan facts (`entry.facts.*`), not as columns every entity carries.

**Re-run.** Delete the unpaid run and create it again. Consumed entries are read-only until then.

**Exports.** Select runs → ⚡:

- **Export salary listing** — one XLSX sheet per run and currency: title, run line, frozen header (`D8`), columns
  grouped by family (basic, allowances, entries, employee statutory, deductions, net, employer statutory) and a final
  Total company payment that reads "Needs confirmation" until bank charges are known.
- **Export bank file** — the paying account's bank layout; refuses until one is configured.

## Import

Events → Work → ⚡:

- **Download template** — the work-day sheet for the selected entity and pay period, prefilled with what is stored
  (employee number, date, shift, clock in/out, OT consent, banked OT, leave, planned and approved OT windows). The file
  appears as a download link when the template run finishes.
- **Import…** — previews first: rule warnings (for example EA s.60A breaks and spread-over) must be accepted with
  **Accept and import**. The import is a set over each person's days in the file: rows are created or updated, unsettled
  days the file leaves out or blanks are deleted, and a settled day may only be restated unchanged.

## Verification (2026-10-21)

Run locally against the private sample pack (local Colony and `env serve`). Names, employee numbers and entity names in
the screenshots are masked; amounts are real.

| Area                        | Proof                                                                                                                                                                           | Status          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Gates                       | `bolt check` ok; `vitest.node.config.ts` 1,096 tests pass (two suites re-run after load timeouts); `bolt test` e2e: see [Checks](#checks)                                       | ✅              |
| Payroll calculation (MY)    | Jan 2026 slip, RM5,944 citizen: EPF 660/720, SOCSO 29.75/104.15, EIS 11.90/11.90, HRDF 59.44, PCB 164.70 — each recomputed by hand from the schedules and the MTD formula       | ✅              |
| Off-cycle, salary unchanged | RM3,000 bonus paid off-cycle in Feb: slip has no salary lines; the later Feb regular slip still pays BASIC 5,644 + allowance 300; month EPF 990/1,080 = 11%/12% of RM9,000 band | ✅              |
| Export                      | `salary-listings.xlsx`: one sheet per run (Jan regular, Feb extra, Feb regular), values equal the payslips                                                                      | ✅              |
| Import                      | Feb template downloaded, two cells edited, re-imported: preview warnings accepted → 2 updated, 0 created, 0 deleted                                                             | ✅              |
| Exit encashment             | Resignation with last day 31 Oct 2026 → `ENCASHMENT` 15 days of annual leave plus `TERMINATION_BENEFITS_FINAL_WAGES` and `PERSONAL_DATA_DISPOSAL` tasks, raised automatically   | ✅              |
| Statutory research          | Started from **Run now**; see [Statutory research run](#statutory-research-run)                                                                                                 | RESEARCH_STATUS |

### Payroll run and payslip

![New run](docs/screenshots/40-run-new-form.png)
![January run](docs/screenshots/42-run-jan-summary.png)

### Off-cycle run

Only the selected entry is paid; the regular run that follows keeps the contractual salary.

![Off-cycle selection](docs/screenshots/52-offcycle-form.png)
![Off-cycle run](docs/screenshots/53-offcycle-run.png)

### Exports

![Export menu](docs/screenshots/70-export-menu.png)

### Work import

![Roster before import](docs/screenshots/81-roster-feb-before.png)
![Import preview](docs/screenshots/83-import-preview.png)
![Import result](docs/screenshots/84-import-result.png)

### Exit encashment

![Encashment entry](docs/screenshots/91-exit-encashment-leave.png)

### Statutory research run

![Run now](docs/screenshots/60-automations-run-now.png)

RESEARCH_TRACE

### Earlier staging walkthrough (2026-10-21)

Loan repayment locks and consumed entries, captured on staging:

![Locked repayment](docs/screenshots/10-loan-view-locked-repayment.png)
![Locked repayment in edit](docs/screenshots/11-loan-edit-locked-row.png)
![Server refusal replay](docs/screenshots/14-loan-server-refusal-replay.png)
![Legacy loan edit refused](docs/screenshots/13-legacy-loan-edit-refused-period.png)
![Consumed days](docs/screenshots/20-roster-jan-padlocks.png)
![Linked claims](docs/screenshots/21-claims-jan-linked.png)
![Consumed claim save refused](docs/screenshots/24-claim-consumed-save-refused.png)
![Consumed leave](docs/screenshots/25-leave-consumed-jan21-feb20.png)
![Consumed ad hoc](docs/screenshots/26-adhoc-consumed-record.png)
![Bank file refused](docs/screenshots/33-bank-file-refused.png)

## Compliance audit (2026-10-21)

One researcher per jurisdiction read the official sources on the web and compared them with the in-force seed. Each
report in [docs/audit](docs/audit/) lists the sources table (reachability, relevance, overlap), uncovered areas, the
findings with citations, and the log of every URL fetched.

| Code | In force  | Compliant | Wrong | Missing | Most severe                                                                                          |
| ---- | --------- | --------- | ----- | ------- | ---------------------------------------------------------------------------------------------------- |
| SG   | version_5 | 41        | 1     | 2       | Carried-forward annual leave not paid on exit (EA s.88A); needs an engine change                     |
| MY   | version_9 | 31        | 0     | 1       | Sabah and Sarawak worksites refused (could be data); substitute holidays only warn                   |
| PH   | version_2 | 23        | 1     | 0       | 2027 additional special non-working days (Proc. 1427: 6 Feb, 27 Mar, 2 Nov, 24 Dec) wrongly left out |
| ID   | version_4 | 44        | 0     | 3       | 2027 national holidays not seeded (SKB signed 15 Sep 2026)                                           |
| VN   | version_4 | 35        | 2     | 4       | Overtime, holiday and night pay priced on base salary only; law includes fixed allowances            |
| TW   | version_4 | 38        | 2     | 2       | Lineage ends 2026-12-31; §32(4) emergency overtime not doubled; wage-arrears levy rounded per worker |
| CN   | version_4 | 34        | 1     | 2       | Shanghai minimum-wage test counts excluded allowances; year-end unused leave not paid at 200% extra  |
| JP   | version_6 | 22        | 1     | 3       | Customer-harassment duty mandatory since 2026-10-01 but only raised for new entities                 |
| TH   | version_4 | 18        | 2     | 2       | Maternity leave counted in working days, law counts calendar days; no holidays after 2026            |

**Resolution (2026-10-22).** Every finding above was fixed in the seed, each in place (a wrong transcription) or as a
new sealed version (a change of law): sources now state the area each covers with no overlap, missing authorities were
added, and every source origin answers an automated reader (unreachable sites were replaced by reachable official
mirrors, for example lawphil.net for PH). The second pass also fixed PH maternity double pay, the TW NHI §34 bonus
base, the VN insurance base, TH child-care leave, CN menstrual leave and the JP year-end double count, and added TW
version_5 (2027). Sample entities observe their jurisdiction's gazetted holidays for the years after the bank's own.
Each report's Resolution section lists the change per finding.

## Known gaps

- **Lane.** One started/cron automation at a time per workspace (see [Statutory research](#statutory-research)).
- **TW §34 bonus premium** is netted per run, not per month.
- **SG part-time** hourly encashment and leave qualifying service, and the **CN** per-employee year-end payout skip,
  need engine support.
- **Anonymising** a former employee blanks the profile but keeps contract-term facts (now holding dependants, spouse
  status and similar inputs).
- **Data still missing** from the sample entities is listed per employee in the HR data request
  (`docs` package sent to the HR lead).

## Seed

- **base** — `seed/jurisdiction/<CODE>/version_*/`: nine sealed jurisdiction lineages with their catalogues and rule
  sets; `seed/overtime_policies.ts` adds each version's overtime rule.
- **sample** (private) — `seed/seed.ts` reads the seed bank tree `norbital_hr` with `bolt build --bank=<checkout>`:
  entities, people, contracts, rosters and their records. A roster day's overtime and incentive derive from its clock
  past the planned shift, so the bank's typed hours are dropped on the way in.

## Payroll hotline

Employees ask about their own payslips on WhatsApp, one number per legal entity. The source role is
`src/agent/envoy/+payroll_hotline.envoy.ts`; its whole authority is the `payroll_hotline` policy.

1. An administrator adds and pairs a WhatsApp instance in Settings, Integrations.
2. On the entity's General tab, HR picks that number as the payroll hotline (`entity.hotline`), saves, and selects
   **Answer payroll questions on this number**.
3. An administrator records each employee's WhatsApp number on their account (Settings, People); an employment profile
   links to the account through `user_id`.

A DM holds `payroll_hotline` alone, even for an administrator: it reads only the sender's own payslips of the entity
written to (`salary_from`, `salary_to`, `status`, `currency`, `gross`, `total_deductions`, `net`, `paid_at`) and writes
nothing. Leave, claims and corrections go to self-service or HR. A number on no account gets one fixed notice; group
messages are ignored. `envoys.receive` allows 10 messages a minute per sender and 300 a minute across every hotline.

## Checks

```bash
pnpm install
pnpm check      # bolt check
pnpm test       # bolt build --bank=$SEED_BANK (default ../../seed_bank), bolt test, then test:node
pnpm test:node  # vitest.node.config.ts: the node-side suites in tests/
pnpm lint       # prettier --check .
```
