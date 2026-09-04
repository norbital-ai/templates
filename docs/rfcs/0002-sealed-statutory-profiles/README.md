# RFC 0002: One statutory profile per payroll run

- Status: Implemented
- Scope: `templates/hr-payroll`
- Created: 2026-08-30
- Predecessor: payslip input/output separation (implemented; folded into `docs/architecture.md`)

## Summary

A payroll run is governed by several independent, editable catalogues today — leave types, pay
components, contribution schemes and rates — each with its own effective dating, none linked to
each other or to the law snapshot the run cites. Nothing seals them.

This RFC makes the **statutory profile the single source of a run's nature**:

1. **One profile = one immutable configuration version.** The law (regime, statutory leave floors)
   and the catalogues that implement it — leave types, pay components, schemes, rates — are all
   scoped to the profile and sealed with it. A run picks one profile; that one FK determines
   everything the run is made of.
2. **Lifecycle: DRAFT → SEALED → VOIDED.** Drafts are prepared by the HR controller (or the drift
   automation) and sealed on HR Manager approval. Sealed profiles are frozen and are the only ones
   that govern runs. Voided profiles are retired but keep the runs that cite them.
3. **Changes are new versions, never edits.** Enacting a successor copies the catalogue forward;
   edits happen in the draft copy; sealing freezes it. Old runs keep citing the old version.
4. **Corrections to money are next-cycle entries** — the immutability model already in force.
5. **Employee self-service gains a leave balance panel** (per-leave-type: accrued, carried,
   taken, encashed, remaining), derived from the same pure functions the engine uses.

KIV (explicitly deferred): a frozen YTD in/out chain. YTD stays derived from prior paid payslips.

## The gap

- **Statutory leave floors** are hand-typed `STATUTORY` layers inside company-owned `leave_types`
  rows — no linkage to any law revision, no seal, no validation against the snapshot a run cites.
- **Leave types and pay components** float free: effective-dated independently of the profile, so
  a run can cite a frozen regime while its catalogue has drifted since.
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

`leave_types`, `pay_components`, `statutory_contributions` and `contribution_rates` gain a
required `statutory_profile_id` FK. Consequences:

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

The profile carries `statutory_leave` — per canonical kind (`ANNUAL`, `SICK`, `MATERNITY`,
`PATERNITY`, `HOSPITALIZATION`, `CHILDCARE`, …; a closed literal set, schema-level vocabulary like
overtime day types):

```text
days:        { base, per_child?, max? }
child_rule?: { age_limit, min_children }   — when the law conditions the kind on children
service_ladder: band_from months → days    — where the law ladders by service
authority:   the citation
```

`leave_types` gain `statutory_kind` (a nullable link to one canonical kind). The entitlement merge:

```text
entitlement(D) = max( profile.statutory_leave[kind].floor(D),
                      organisation layers,
                      employee layers )
```

The floor is now versioned with the law and sealed with the profile. Company generosity
(org/employee layers), accrual, carry and payroll effect remain per-profile company content.

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

A fact correction or a new sealed version can leave an employee having taken more leave than the
corrected entitlement allows. The derived balance goes **negative immediately** — no ledger
surgery; the days were genuinely taken, only the entitlement moved. Recovery is chosen by the
employer:

| Path                          | Mechanic                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Offset against future accrual | Do nothing — the negative balance plus the request guard ration the leave. Default.                                                       |
| Deduct next cycle             | Arrears/deduction entry valued at the excess days; the negative-net guard bounds and spreads it.                                          |
| Forgive at year rollover      | A negative closing posts a carry of zero with the negative kept in `closing` (`process_leave_year` clamps the movement, never the books). |

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

1. Leave balance panel (independent; ships immediately).
2. Profile lifecycle: members, hooks, approval flow, pick gate.
3. Catalogue scoping: `statutory_profile_id`, copy-on-write successor action, drop per-row
   effective dating.
4. `statutory_leave` + `employee_children` + child-scaled floors + `statutory_kind`.
5. Consolidations (`FLAT` key, `aggregates_with`, effective ranges, exclusions).

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
- **Floors**: the merged entitlement equals the profile floor when most generous, the
  organisation layer when it exceeds it; sealing refuses a profile that cannot answer a linked
  leave type's `statutory_kind`.
- **Child scaling**: `per_child` floors compute against `employee_children` as of each date; a
  child crossing the age limit drops out on the right day; a superseding fact correction
  re-derives past periods and surfaces over-taken leave as a negative balance.
- **Over-taken leave**: the request guard refuses further leave; a recovery entry in the next
  draft is bounded by the negative-net guard; the exit encashment skips negative balances.
- **Balance panel**: panel figures equal `leaveBalance` composition for seeded scenarios,
  including mid-year joiners and carry-expiry.
- **Consolidations**: `FLAT` authoring refuses with a pointer to `band_from: 0`;
  `aggregates_with` and per-catalogue effective dating are absent.

## Rejected alternatives

- **Status quo** — statutory floors as company-catalogue layers: no linkage, no seal, drift by
  design.
- **Member-level sealing** (the first draft of this RFC): seal only law-bearing members, keep
  company members editable — workable, but it keeps per-row effective dating and per-member guard
  logic, and leaves the question "which profile does this row belong to?" open. Profile-scoped
  rows answer it structurally.
- **Mutable YTD accumulator** — a second representation of what the payslips prove. KIV'd: the
  frozen in/out chain.
- **Void by deletion** — resets YTD, consumption ceilings and single-use guards, orphans payment
  evidence. Voiding keeps the record and enacts a successor.
- **JSON linkage inside catalogue payloads** — a relationship the database cannot enforce.

## Acceptance criteria

- [ ] A run's entire governing configuration — law, floors, leave types, components, schemes,
      rates — resolves through its `statutory_snapshot_id` FK alone.
- [ ] Profiles carry `lifecycle`; only SEALED profiles are picked; sealing requires HR Manager
      approval; an automation can stage but never seal.
- [ ] SEALED profile catalogue rows refuse create/update/delete; VOIDED profiles keep run
      citations and record reason + successor.
- [ ] `statutory_leave` lives on the profile with child scaling; leave types link by
      `statutory_kind`; the floor merges as `max(profile floor, organisation, employee)`.
- [ ] `employee_children` facts exist (append-only, supersede flow); age cutoffs compute from
      birth dates; fact corrections re-derive entitlement and surface over-taken leave as a
      negative balance.
- [ ] Recovery for over-taken leave is offset, bounded next-cycle deduction, or year-rollover
      forgiveness — never an edit of a paid run.
- [ ] Employee app shows the derived leave balance per type.
- [ ] `FLAT` key, `aggregates_with`, and per-catalogue effective dating are gone from schema,
      authoring, and seeds.
- [ ] All existing immutability guards (paid runs, payslips, adjustments, junctions, captures)
      remain in force and are re-verified against the matrix.
