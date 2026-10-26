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

The 29 record models live in `src/data/model/<name>/+model.ts`. Each model declares its fields, relationships,
per-verb write callbacks and queries inline; its companion `+representation.svelte` renders the record.
Business operations are ordinary automations under `src/automation/`.

What each jurisdiction configures is tracked in the [jurisdiction trackers](docs/inventory/README.md); the latest
research notes are in [docs/audit](docs/audit/). These dated notes record their research baseline, not current
automated jurisdiction coverage.

## Automations

| Automation            | Trigger                                                                 | Result                                                                                                                                  |
| --------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `behaviour_taps`      | Row events on runs, payslips, contracts, profiles, entities and entries | Applies the version's behaviour rules: each reads its declared rows and returns the writes.                                             |
| `statutory_drift`     | Every Saturday 03:00 UTC; also **Run now**                              | Researches every sealed in-force lineage (or the one `code` given), one lineage at a time; a verified change becomes an unsealed draft. |
| `late_arrival_notice` | Every five minutes                                                      | One reminder per person-day when a rostered shift has no clock-in after the entity's grace.                                             |
| `calendar_tick`       | Daily                                                                   | Runs the behaviour rules for every employment in force, so date-driven duties raise tasks.                                              |
| `invitation_profile`  | Staff invited; staff user created or contact changed                    | Creates employment profiles for invited staff and links their identities after acceptance.                                              |

Any automation that needs no input can be started by hand from **Settings → Automations → Run now**.

### Statutory research

One `statutory_drift` run prepares and researches one in-force lineage at a time, keeping one full snapshot in its
128 MiB cell. Each lineage's six agents run their multi-step `ctx.ai.sys_2.infer` calls side by side. A lineage that
fails is reported in the output's `failed` list without stopping the others. It never seals.

- **Tools:** `web_search` and the confined browser (`browser_navigate`, `browser_snapshot`, `browser_act`; a PDF
  linked from a source page opens as its extracted text, page by page), granted by the `statutory_drift_automation` policy;
  `steps: 1000`, then one tool-less turn to submit.
- **Draft:** each agent's draft contains only its own snapshot sections; the other lists are empty, and only the
  settings agent carries settings. The automation merges the agents' owned rows into the complete snapshot.
  Every list is keyed by `code`, so the draft tools (`read`,
  `find`, `edit`, `diff`, `submit`) address rows as `/snapshot/<section>/<code>/<field>`, never by position. The
  research registry (`settings.sources`) is not in the draft: its entries reach the model as entry points and remain
  the browsing and citation allowlist. Sources are live official pages, never document links; each agent may
  replace, add or remove its own entries in `sources`, and a new one is kept only when it reads as a live page on a
  registered official site.
- **Evidence:** every changed or added row cites, in its own `references`, an allowed official `url` and the exact
  `quote`. The automation diffs the draft against the original (`jsonDiff`), refetches each cited page and drafts only
  when every changed row carries a fresh quote that re-appears on its page. Removed rows, settings and suspension-kind
  edits are never drafted; they stay in `unresolved`.
- **Coverage:** the draft lists `wage_hours`, `leave`, `contributions`, `tax`, `filings` and `records` as `pending`;
  a CEL rule refuses submission until each is `verified` or `unverified`. A run that ends with a pending scope is
  reported as `<CODE>: incomplete — …` in `failed`; `changed: false` with every scope resolved is a verified no-change.
- **Change summary:** composed from the diff (rows added and changed per section, with field names) plus the model's
  one-paragraph `summary`.
- **Out of scope:** public holidays — per-entity rows published separately, never researched.

Every tool step is recorded on the run as an `infer.tool` event in the workspace's runtime log.

Bolt admits workspace automations through four lanes. Each automation's declared concurrency governs its own
runs; the default is one. A statutory sweep does not occupy every lane, so other admitted automations can progress
alongside it.

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

## Known gaps

- **TW §34 bonus premium** is netted per run, not per month.
- **SG part-time** hourly encashment and leave qualifying service, and the **CN** per-employee year-end payout skip,
  need engine support.
- **Anonymising** a former employee blanks the profile but keeps contract-term facts (now holding dependants, spouse
  status and similar inputs).

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
pnpm install --frozen-lockfile
pnpm exec bolt check   # declarations, TypeScript and Svelte
pnpm test              # standalone core mechanisms and edge cases; no Colony or private bank
```

Tests use small synthetic fixtures for payroll mechanisms, guarded writes, state and failure paths. They do not
certify seeded legal values, repeat jurisdiction/version matrices or assert UI layouts.
