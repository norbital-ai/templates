# RFC 0002: One statutory profile per payroll run

- Status: Implemented
- Scope: `templates/hr-payroll`
- Created: 2026-08-30
- Predecessor: payslip input/output separation (implemented; folded into `docs/architecture.md`)

## Summary

A payroll run is governed by several independent catalogues — pay components, contribution schemes
and rates — that must agree with the immutable law snapshot the run cites. Leave follows the same
law-version principle but uses the sealed account/ledger architecture in [`docs/leave.md`](../../leave.md).

This RFC makes the **statutory profile the single source of a run's nature**:

1. **One profile = one immutable statutory version.** The law, statutory leave floors, pay
   components, schemes and rates are scoped to the profile and sealed with it. Company leave types
   instead belong to an effective-dated `leave_plan`; each yearly account records both governing IDs.
2. **Lifecycle: DRAFT → SEALED → VOIDED.** Drafts are prepared by the HR controller (or the drift
   automation) and sealed on HR Manager approval. Sealed profiles are frozen and are the only ones
   that govern runs. Voided profiles are retired but keep the runs that cite them.
3. **Changes are new versions, never edits.** Sealing a successor preserves old runs and accounts.
   The leave reconciler appends the applicable statutory adjustment or prepares the next leave year.
4. **Corrections to money are next-cycle entries** — the immutability model already in force.
5. **Employee self-service gains a leave balance panel** derived only from sealed yearly accounts,
   posted ledger entries and held applications.

KIV (explicitly deferred): a frozen YTD in/out chain. YTD stays derived from prior paid payslips.

## The gap

- **Statutory leave floors** must be versioned with the law rather than copied into company policy.
- **Pay components** must not float independently of the profile a run cites.
- **Laws that scale leave on children** have no fact to compute against.

## Decision

### 1. The profile is the configuration version

`jurisdictions` rows become versioned configuration sets. New members: `lifecycle`
(`DRAFT`/`SEALED`/`VOIDED`), `void_reason`, `successor_profile_id` (self-FK), and the
`statutory_leave` member (§3).

| Lifecycle | Who                                                  | What it means                                                 |
| --------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| DRAFT     | HR controller creates/edits; drift automation stages | Editable, not pickable by runs                                |
| SEALED    | approved by **HR Manager** (Senior Mgmt supersedes)  | Fully frozen; the only profile picks pickable; runs cite it   |
| VOIDED    | raised by controller, approved by HR Manager         | Retired; keeps run citations; never picked; successor enacted |

An automation can stage a draft but can never seal — the approval flow has no automation arm.

### 2. Catalogues are profile-scoped

`pay_components`, `statutory_contributions` and `contribution_rates` carry the required
`statutory_profile_id` FK. `leave_types` belong to company `leave_plans`; `leave_accounts` retain the
opening statutory profile and opening plan. Consequences:

- **The profile's period replaces per-row effective dating.** `effective_range` is dropped from
  these catalogues, as are the per-code no-overlap exclusions — versioning does that job. Within a
  profile, one row per code (unique).
- **Sealing the profile freezes every linked row.** No create/update/delete against a sealed
  profile's catalogues. This replaces member-level sealing with one rule: sealed means sealed.
- **Copy-on-write for changes.** Enacting a successor version copies the linked rows forward;
  edits happen on the copies in DRAFT; sealing freezes the new set. Old versions and their rows
  are untouched, so old runs read exactly what governed them.
- **Where possible** — the catalogue surfaces listed above. Person data (`employees`,
  `employment_terms`, `employment_statutory_facts`, `employee_children`) and operational data
  (`work_days`, `leave_requests`, `component_entries`) stay employment-scoped: they are inputs,
  not configuration.

### 3. Statutory leave: floors and child scaling

The profile carries `statutory_leave` per stable uppercase kind (`ANNUAL`, `SICK`, `MATERNITY`,
`SHARED_PARENTAL`, …). The vocabulary is open so a new enacted category is data, not a code release:

```text
days:        { base, per_child?, max? }
child_rule?: { age_limit, min_children }   — when the law conditions the kind on children
service_ladder: band_from months → days    — where the law ladders by service
account_basis: YEAR | EVENT
qualifying_service_months: integer
eligibility: employment/person predicates
vesting: UPFRONT | MONTHLY
rounding: HALF_DAY | WHOLE_DAY_HALF_UP
event?: { window_months, allocation: INDIVIDUAL | HOUSEHOLD,
          unit: DAYS | WEEKS, weekly_index_cap? }
authority:   the citation
```

`leave_types` gain `statutory_kind` (a nullable link to one canonical kind). The entitlement merge:

```text
entitlement(D) = max( profile.statutory_leave[kind].floor(D),
                      organisation service band )
```

The floor is versioned with the law and sealed with the profile. Company generosity, accrual,
carry and payroll effect live in independently versioned company leave plans.

An `EVENT` account is the approved allocation fact for one qualifying event. It records the actual
event date, independently reviewed statutory cohort date, normalized household/event reference,
evidence, allocated units, weekly index, calculated workday portion and bounded window, then uses the
same append-only ledger as yearly leave. Effective profile selection uses the statutory cohort
date, so a request filed later cannot move an older birth/adoption into a newer statutory cohort.

### 4. Children facts — not dependents

Laws that scale leave by children compute against a fact, and children are not dependents:

|             | `employees.dependents_count`                | `employee_children` (new)                                                                                    |
| ----------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Serves      | Tax relief — PCB `childRelief × dependents` | Statutory leave floors — `statutory_leave.child_rule`                                                        |
| Shape       | Scalar count maintained by HR               | One row per child: immutable birth date, relationship, effective range (adoption/guardianship), supersede FK |
| Time        | Read as-of the run                          | Age cutoffs **computed** from the birth date as of each date                                                 |
| Corrections | Edit the count                              | Append a superseding row — never edit                                                                        |

The counts can legitimately disagree (a 20-year-old is a tax dependent but counts zero for a
childcare floor). **Neither derives from the other, neither migrates into the other.**
`dependents_count` stays the PCB input; a facts-derived relief is follow-up — MY child relief
carries per-child nuances a count cannot state.

`employee_children` is append-only: employment FK, immutable birth date, relationship, effective
range for legal events, supersede FK. A paid run's floor is reconstructable from immutable facts
as of its own date.

### 5. When a correction leaves leave over-taken

An approved statutory or company successor can reduce an account target below leave already taken.
The reconciler appends a signed adjustment; it never rewrites the opening receipt or prior entries.
A corrected personal fact alone does not recalculate the sealed receipt: an authorised current-year
correction is a reviewed `MANUAL_ADJUSTMENT`, while the next account compiles the corrected fact.
The resulting balance may be negative. Recovery is chosen by the employer:

| Path                          | Mechanic                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| Offset against future accrual | Do nothing — later positive entries reduce the negative balance. Default.                        |
| Deduct next cycle             | Arrears/deduction entry valued at the excess days; the negative-net guard bounds and spreads it. |
| Forgive at year rollover      | Append a dated `MANUAL_ADJUSTMENT`; carry reconciliation still transfers no negative balance.    |

**Leaver edge**: the exit encashment hook encashes positive balances only. A negative balance is
recovered — if at all — by a deduction entry captured in the final run itself, or written off.
Whether statutory leave taken in good faith under a mis-stated fact may be recovered is an
employer-counsel question; the system provides the mechanics and takes no side on the law.

### 6. Voiding

A void answers "this profile is wrong for its period" without touching history:

```text
VOID(profile P, reason):
  P.lifecycle = VOIDED; P.void_reason = reason
  P.successor_profile_id = S   — a new DRAFT copy of P for the same period
```

Runs citing P keep the FK — traceability. S is corrected, approved, and picked by every run that
has not yet been paid. The void action relaxes the per-code uniqueness between P and S by
voiding first, which is the ordering that makes the successor enactable. Money corrections after a
void are next-cycle entries, never edits of a paid run.

### 7. Consolidations

- **`accrual_key.FLAT`** ≡ `SERVICE_MONTHS band_from: 0` — drop the arm.
- **`leave_types.aggregates_with`** — authored, displayed, read by nothing: delete.
- **`effective_range` + no-overlap exclusions** on `leave_types` / `pay_components` /
  `statutory_contributions` / `contribution_rates` — superseded by profile versioning; drop.
- `payslip_adjustments.period` / junction `period` denormalizations **stay**: lock refusals must
  name the period without a `payroll_runs` read grant.

## Immutability matrix

| Surface                                      | Create                | Update                                | Delete                          |
| -------------------------------------------- | --------------------- | ------------------------------------- | ------------------------------- |
| Payroll run, PAID                            | —                     | refuse outright                       | refuse                          |
| Payroll run, DRAFT                           | engine-only payload   | engine recalculation only             | allowed (the only release)      |
| Payslip / adjustment / capture junctions     | engine-only           | refuse outright                       | only while run is DRAFT         |
| Work day / leave request / entry / repayment | per policy            | refuse once captured                  | refuse once captured            |
| Profile, DRAFT                               | controller/automation | editable                              | allowed                         |
| Profile, SEALED/VOIDED                       | —                     | lifecycle transitions only (approved) | refuse                          |
| Catalogue rows of a SEALED profile           | ✚ refuse              | ✚ refuse                              | ✚ refuse                        |
| Catalogue rows of a DRAFT profile            | ✚ allowed             | ✚ allowed                             | ✚ allowed                       |
| `statutory_profile_id` link                  | set at creation       | ✚ refuse once the profile is sealed   | with the row                    |
| `employee_children`                          | per policy            | ✚ append supersede only               | refuse once cited by a paid run |

Catalogue-row create/update/delete run through the profile's lifecycle: the sealing hooks refuse
whenever the linked profile is SEALED or VOIDED. No user policy grants writes on engine-owned
surfaces (payslips, adjustments, junctions) — the hooks are the second lock.

## Implementation order

1. Profile lifecycle: members, hooks, approval flow, pick gate.
2. Payroll catalogue scoping by `statutory_profile_id`.
3. `statutory_leave` + `employee_children` + child-scaled floors + `statutory_kind`.
4. Company leave plans, sealed yearly accounts and append-only entries (`docs/leave.md`).

## Migration

Cut-over, no tenant data: the seed bank is restructured — one SEALED profile per seeded
jurisdiction revision, catalogue rows re-linked to it, `employee_children` seeded where the source
workbook states them, `FLAT`/`aggregates_with`/per-catalogue `effective_range` removed. Migration
lineage is regenerated without editing existing history.

## Test plan

- **Lifecycle**: a DRAFT profile is never picked; sealing requires HR Manager approval; a
  SEALED profile and all its catalogue rows refuse writes; a VOIDED profile keeps run citations
  and is never picked.
- **Copy-on-write**: enacting a successor copies the catalogue; editing the copy does not touch
  the sealed original; old runs still resolve every row through the old profile.
- **Floors**: account creation selects the greater of the sealed statutory floor and the company
  service band, then records the calculation receipt.
- **Child scaling**: `per_child` floors compute against `employee_children` at account creation or
  an explicit successor reconciliation; old entries remain unchanged.
- **Over-taken leave**: the request guard refuses further leave; a recovery entry in the next
  draft is bounded by the negative-net guard; the exit encashment skips negative balances.
- **Balance panel**: panel figures equal the signed account ledger minus held applications,
  including mid-year adjustments and carry expiry.
- **Event cohorts**: qualifying date selects the old/new statutory profile, shared allocations sum
  across both parents, the event window may cross January, and only one opening entry is posted.
- **Consolidations**: `FLAT` authoring refuses with a pointer to `band_from: 0`;
  `aggregates_with` and per-catalogue effective dating are absent.

## Rejected alternatives

- **Status quo** — statutory floors as company-catalogue layers: no linkage, no seal, drift by
  design.
- **Member-level sealing**: mutable statutory members cannot reconstruct a historical run or account.
- **Mutable YTD accumulator** — a second representation of what the payslips prove. KIV'd: the
  frozen in/out chain.
- **Void by deletion** — resets YTD, consumption ceilings and single-use guards, orphans payment
  evidence. Voiding keeps the record and enacts a successor.
- **JSON linkage inside catalogue payloads** — a relationship the database cannot enforce.

## Acceptance criteria

- [x] A payroll run's statutory configuration resolves through its snapshot; a leave account
      separately records its opening statutory profile and company plan.
- [ ] Profiles carry `lifecycle`; only SEALED profiles are picked; sealing requires HR Manager
      approval; an automation can stage but never seal.
- [ ] SEALED profile catalogue rows refuse create/update/delete; VOIDED profiles keep run
      citations and record reason + successor.
- [x] `statutory_leave` lives on the profile with child scaling; company leave types link by
      `statutory_kind`; account creation takes `max(profile floor, company service band)`.
- [x] `employee_children` facts exist (append-only, supersede flow); successor reconciliation
      records any changed entitlement as a new entry.
- [ ] Recovery for over-taken leave is offset, bounded next-cycle deduction, or year-rollover
      forgiveness — never an edit of a paid run.
- [x] Employee app shows the sealed account and signed ledger balance per type.
- [ ] `FLAT` key, `aggregates_with`, and per-catalogue effective dating are gone from schema,
      authoring, and seeds.
- [ ] All existing immutability guards (paid runs, payslips, adjustments, junctions, captures)
      remain in force and are re-verified against the matrix.
