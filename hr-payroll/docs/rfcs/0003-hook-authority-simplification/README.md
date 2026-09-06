# RFC 0003: Hook authority simplification

- Status: **Final** — accepted 2026-09-07; implementation not started (Bolt owner review, then the
  sequence in §9)
- Scope: `oss` (Bolt write engine and access layer), then `templates/hr-payroll` and the authoring
  docs; every other template is touched only by the release pin
- Created: 2026-09-07 · Finalised: 2026-09-07
- Predecessors: oss 0.0.14 `91f1bd48` (hook-nested rows authorized as authored work), oss 0.0.15
  `a340218f` (trusted rows ride the root's approval route)
- Incident record: [`learnings-matrix.md`](./learnings-matrix.md) rows 157, 158, 159 and 161

## 1. Summary

A write has two authors: the caller, who submitted a shape, and the workspace, whose hooks read
facts and derive rows from that shape. Today Bolt says "the workspace's rows are not the caller's
claim" through four separate mechanisms — the `trusted` flag threaded through graph preparation,
the `hookRelationNames` set, the `afterHookElevation` predicate swap, and the `'after'`/`'none'`
elevation split in `policyWrite` — and says nothing at all about the workspace's _reads_, which
still carry the caller's grants. The result is that the one write hr-payroll most wanted to nest
(an employment carrying its leave ledger) had to be pushed out of the hook and into an automation
started per record, purely to borrow that automation's policy for the reads.

This RFC replaces the four mechanisms with one rule and closes the read gap:

> **The caller is authorized on what the caller submitted. Everything a hook reads, returns or
> writes during that write is the workspace's own work: it is not checked against the caller, it
> has no approval route of its own, and it commits with the root.**

Hooks declare nothing. No `policies` on a hook, no `writes` list, no edge property, no `api.as(…)`.
Automations keep their declared policies because they run standalone; starting one from a hook is
for deferred or bulk work, never for privilege.

## 2. What is true today (traced)

Every location is in the working tree at oss `a340218f` and templates `461e6d1`.

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Where                                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The root and every nested row the caller submitted go through `policyWrite(subject, …, 'none')`: allow decision, row predicate, submitted-field ⊆ grant fields, the grant's `authorize`, and approval-route resolution.                                                                                                                                                                                                                                                                                                                                           | `runtime/access/invocation.ts:209-249`                                                                                                                              |
| 2   | A row a `before` hook nests is `trusted`. Trust is keyed by _relation name_ — if the hook returned any entry under `R`, every child under `R` is trusted — and is inherited by every descendant and by cascaded omission deletes. A trusted row is prepared with elevation `'after'`, which skips the decision, the predicate (swapped to `unrestricted`), the field check and `authorize`; since 0.0.15 it also resolves no approval route and lands when the root's request is approved and resumed. Its own `prepare`/`before`/`after` hooks still run.        | `write/engine.ts:253-274, 324, 355-364, 456, 468, 494-529, 563-573, 726-732, 827-836`; `write/cascade-delete.ts:21,45`; `access/policy-surface.ts:14-27`            |
| 3   | The same idea is stated in a fourth place for browser base versions: hook-added relations are exempt from base-version fencing.                                                                                                                                                                                                                                                                                                                                                                                                                                   | `write/engine.ts:429-433`; `write/declarative-prepare.ts:214`                                                                                                       |
| 4   | A hook's **reads** bind the caller's subject and there is no way to change it: `buildReadOps(ports, effectId, subject)` closes over one subject; the hook `Api` has four keys (`db`, `automations`, `infer`, `readFileAsset`) and no `as`, `subject` or `elevated`. `before` and `delete.before` apis are built with `elevated: false`; the `after` api with `elevated: true` but the same subject.                                                                                                                                                               | `hooks/boundary.ts:191-205, 207-270`; `collections.ts:1944, 1960, 1985`; `write/settle.ts:76`; `authoring/contracts-schema.ts:859-893`                              |
| 5   | `api.automations.run` drops the caller's identity at the seam by construction and starts a new invocation as `automationSubject`: `automation:<name>`, `teamPath: []`, exactly the declared `policies`, `elevated: false`. It cannot approve anything.                                                                                                                                                                                                                                                                                                            | `hooks/boundary.ts:254-264`; `automations/automations.ts:240-263`; `identity/static-identity.ts:64-81`; `collections.ts:1765-1807`                                  |
| 6   | Verified against the shipped grants: the kiosk device policy creates `employments` and holds **zero** grants on `leave_plans`, `leave_types`, `leave_accounts`, `leave_entries` or `jurisdictions`; it carries a block of masked reads that exist only because hooks read as the caller. The employee policy reads its own accounts and entries and writes neither.                                                                                                                                                                                               | `templates/hr-payroll/src/access/policies/+kiosk.ts:71-115`, `+employee.ts:38-54, 90-114`                                                                           |
| 7   | Consequence of 4–6: hr-payroll's employment hook nests nothing. It is a 26-line `after` hook that starts `leave_ledger_refresh` for one employment; five sibling facts (terms, children, leave requests, event accounts, sealed profiles) do the same. The nested graph the design wants (`leave_account_employment` → accounts → `entry_leave_account`) is written by the automation's library one invocation later, under the automation's policy. Across all four templates exactly one hook still nests rows: `payroll_runs` returning `payslip_payroll_run`. | `templates/hr-payroll/src/collections/employments/+hooks.ts`; `src/lib/leave/entitlements.ts:358-378`; census of 63 `+hooks.ts` files                               |
| 8   | The per-record hop is measurable: six after-hook sites, one automation start per committed record, ~300 ms per employment, a 25-employment slice per run against a 20 s inline dispatch deadline. A 335-employment import starts 335 runs that each re-read their own context.                                                                                                                                                                                                                                                                                    | learnings 161; `+leave_ledger_refresh.ts:12, 68-74`                                                                                                                 |
| 9   | `leave_account_employment` is deliberately not `cascade(...)`: ownership marks delete authority, and the ledger's complete-set restatement must never delete an omitted sibling. The rule is in the file header, not on the edge. No edge property can carry "authorized as the workspace".                                                                                                                                                                                                                                                                       | `templates/hr-payroll/src/collections/+relationship.ts:4-34, 142-146, 236`                                                                                          |
| 10  | Two template comments still say a `before` hook's nested rows are authorized as the requesting subject, and the grants they justify (`payrollRebuildGrants()`, `captureLedgerGrants()`) are held by `hr_controller` and `hr_manager` for that reason. Since 0.0.14 those rows are `trusted`; the comments are stale and the grants are candidates for deletion.                                                                                                                                                                                                   | `src/lib/policy_grants.ts:228-248`; `+hr_controller.ts:35-38`                                                                                                       |
| 11  | No document states the current rule. Bolt's `docs/` has no paragraph on `trusted`, elevation, or hook-nested authorization; the authoring skill's only statement is the clause "after hooks have elevated authority" inside a sentence about method sets. Authors learn the rule from an `AccessDenied` — which is how learnings 157 and 158 happened.                                                                                                                                                                                                            | `oss/packages/bolt/docs/access/README.md`, `docs/collections/README.md:47-51`; `agent-skills/authoring-tenant-workspace/references/collections-and-modeling.md:214` |
| 12  | Three loop guards, all `8`: `HOOK_NESTING_LIMIT` (hook-caused writes inside one invocation), `WRITE_DEPTH_LIMIT` (levels of one graph), `DEFAULT_NESTING_LIMIT` (enqueued automations). `MutateGraph`'s compile-time depth is 5. None bound the breadth of a trusted subtree.                                                                                                                                                                                                                                                                                     | `hooks/boundary.ts:93`; `write/plan.ts:7`; `budget.ts:30`; `contracts-schema.ts:925-934`                                                                            |

## 3. The rule

Two subjects take part in one write: **the caller** and **the workspace**.

1. **The caller is checked on the submitted shape, once, before any hook runs.** The root's own
   columns and every nested row the caller submitted are authorized against the caller's grants:
   allow decision, row predicate, field grant, `authorize`, and the one approval route of the root
   action. Nothing changes here.
2. **Everything a hook does is the workspace's own work.** What a hook reads, what it returns
   (including a relationship it replaced), what it writes through `api.db.*` in any phase, and the
   omission deletes of the relations it returned are authorized as the workspace: no decision, no
   predicate, no field mask, no `authorize`, no approval route of their own. They commit in the
   root's transaction, or on the root's resume when the root is held for review.
3. **Hooks of the workspace's rows still run.** A nested account runs its own `before`; the
   engine's validation, reference checks, cross-parent ownership refusal, non-cascade omission
   refusal, locks, history and version fencing all apply exactly as they do to a caller's row.
4. **Hooks declare nothing and see no subject.** No `policies` key, no `writes` list, no
   `api.as(…)`, no edge property. A hook is a pure function of its input, the batch's prepared
   context and the workspace's data. The one door to background work stays `api.automations.run`.
5. **An automation is a standalone principal.** It keeps its declared `policies`, because it runs
   on a schedule, from a seed or by hand with nobody's write to ride. Starting one from a hook is
   for work that cannot fit the root's transaction — a law family, a month — not for privilege.
6. **Loop guards are unchanged.** The three limits in finding 12 stay as backstops.

The rule is one sentence for an author: _inside a write the caller was allowed to make, a hook is
the workspace; the caller is judged on what they sent, the workspace on nothing._

### 3.1 What the rule changes

| Today                                                                                                                                                                        | After                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hook **writes** (nested or `api.db`) are trusted through `trusted` + `hookRelationNames` (before) or `elevated` (after), each with its own predicate swap.                   | One subject, the workspace, for every hook write.                                                                                                                |
| Hook **reads** carry the caller's grants and masks; a kiosk cannot read the plan its own hire needs.                                                                         | Hook reads are the workspace's. The kiosk's "hook dependency" read grants are deleted.                                                                           |
| Caller-submitted rows under a relation the hook also returned are silently replaced, never judged.                                                                           | The caller's submitted rows are authorized first; a kiosk that submits `payslip_payroll_run` is refused on its own claim instead of having it quietly discarded. |
| An `after` hook's write preserves the caller's approval route (`afterHookElevation` keeps `source.approval`), so a post-commit write can open a review in the caller's name. | An `after` hook's write is the workspace's: it lands, it opens nothing. Reviewed work is a caller action or a row nested under a reviewed root.                  |
| A nested row rides the root's approval only because `trusted` skips `resolveApproval`.                                                                                       | The same, stated by the rule rather than by a flag.                                                                                                              |
| The leave ledger is produced by a per-record automation hop.                                                                                                                 | The employment's `before` hook returns it (§5). The reconciler remains for the schedule, the seed and a sealed law family.                                       |

### 3.2 What the rule does not change

- The **threat model**. Authored code has been trusted code since `automationSubject` and elevated
  after hooks: a template's hooks are reviewed source, the caller is not. Bolt's controls on
  authored code are the transaction, the loop guards and the template gate, not grants.
- **Disclosure.** A hook's refusal sentence and the columns it returns are the author's decision,
  as they are today. What a caller reads back after the commit is masked by the caller's read
  grants, as it is today.
- **Approvals.** One graph, one route, decided at the gate from the root action and the rows the
  caller submitted. A held graph commits whole on `collections.resume`.
- **Ownership.** `cascade(...)` still means delete authority and omission delete. The leave edge
  stays non-cascade and the ledger keeps restating its complete set.

## 4. Decisions on the open questions

**Fail-closed granularity — root-action level.** There is one decision per graph: may this caller
perform this action on this root with these submitted fields and these submitted nested rows. A
per-nested-collection gate would need a declaration of what each hook may derive, which is the
`writes` list the owner rejected: a second place the hook's behaviour is written, kept in sync by
hand, that an author must understand before writing a hook. Authored code's reach is bounded by
its source, and its source is what is reviewed.

**Static auditability — derived from code, never declared.** Two things already make a hook's
reach visible without a declaration. The `MutateGraph` return type is closed over the relations
`+relationship.ts` declares, so a hook cannot nest an undeclared relation and the compiler rejects
a column outside the child's insert shape. And every `api.db.<collection>` access is lexical. The
implementation pass adds one **hint-level doctor rule** that lists, per `+hooks.ts`, the
collections it reads and the relations it nests or writes, so the audit output shows a hook's
blast radius at review time. Nothing to author, nothing to drift.

**Batch-level flush as an interim step — no.** An interim "one automation per commit" is a
second mechanism that would be deleted the moment this lands, against the zero-legacy directive.
The per-record hop stays exactly as it is until the oss change is released, then the six hooks are
deleted in one template commit (§5, §9).

## 5. Authoring samples

Every sample below compiles against today's authoring surface — `Hooks` and `Policy` from the
generated `$types.js`, `refuse` and `approveBy` from `@norbital-ai/bolt/authoring` — because the
rule adds **no** surface. The only things that change in a template are what it can now delete.
Library names (`readLeaveContext`, `leavePlanner`, `reconcileEmploymentLeave`, `leaveEntryIdFor`)
are hr-payroll's today; the one arithmetic change they need is noted where it applies.

### 5.1 An employment carries its leave ledger

`templates/hr-payroll/src/collections/employments/+hooks.ts` — replaces the 26-line automation
starter. `prepare` reads the batch's context once; `before` returns each employment with the
complete set of its accounts, each with its entries, nested under it. The kiosk that enrols a
worker is checked on the `employments` row it submitted and on nothing the hook derived; the plan,
the sealed profile and the ledger are read as the workspace.

```ts
import { Effect } from 'effect';
import type { Hooks } from './$types.js';
import { leaveAsOf, readLeaveContext } from '../../lib/leave/service.js';
import { leavePlanner } from '../../lib/leave/entitlements.js';
import { reconcileEmploymentLeave } from '../../lib/leave/reconcile.js';

/**
 * An employment carries its leave entitlements.
 *
 * `prepare` reads the batch's leave context once — plans, sealed profiles, terms, children,
 * pending requests, the stored accounts and ledger. `before` runs the arithmetic for one
 * employment and returns it with the complete set of its accounts and entries nested under it,
 * under formula ids. The hook reads and derives as the workspace, so a kiosk enrolment lands the
 * same ledger an HR manager's hire does. A write that already carries the ledger keeps it: a
 * sibling fact's hook (a term, a child) states the ledger itself and touches the employment
 * through the same door (§5.2).
 */
export default {
	mutate: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const asOf = yield* leaveAsOf;
				// Creates have no stored employment yet; the context is read by company for those and
				// by employment for updates. This by-company arm is the one library change.
				const context = yield* readLeaveContext(api, {
					employmentIds: inputs.flatMap((one) => (one.id == null ? [] : [one.id])),
					companyIds: inputs.flatMap((one) => (one.company_id == null ? [] : [one.company_id])),
					asOf
				});
				return { asOf, context };
			}),
		perRecord: {
			before: {
				description:
					'Returns the employment with the complete set of its leave accounts and ledger lines, regenerated from the company plan and the sealed statutory profile as of today.',
				handler: ({ input, existing, recordId, relationships, prepared, api }) =>
					Effect.gen(function* () {
						// A sibling fact's hook already stated the ledger for this employment; keep it.
						if (relationships.includes('leave_account_employment')) return input;
						const planner = leavePlanner(prepared.context, api.db.leave_requests.findPending);
						yield* reconcileEmploymentLeave(
							planner.api,
							{ id: recordId, ...existing, ...input },
							prepared.asOf
						);
						// An omitted relationship key is untouched; an included one is the complete set,
						// because `leave_account_employment` is not a cascade and an omitted sibling is refused.
						if (!planner.changed(recordId)) return input;
						return {
							...input,
							leave_account_employment: planner.nestedAccountsOf(recordId),
							payout_employment: planner.nestedPayoutsOf(recordId)
						};
					})
			}
		}
	}
} satisfies Hooks;
```

What lands, for a kiosk enrolment: one `employments` row the kiosk's grant allowed, N
`leave_accounts` rows and their `leave_entries` the workspace derived, in one transaction. The
kiosk's policy holds no grant on any of the derived collections and needs none.

### 5.2 A sibling fact restates the employment's ledger

`templates/hr-payroll/src/collections/employee_children/+hooks.ts` — a child fact changes the
employment's childcare entitlement. The hook computes the ledger with the pending fact in hand and
writes the employment root through `api.db.employments.mutate`. That write is the workspace's,
staged into the same commit; the employment's own `before` (§5.1) sees `leave_account_employment`
among the supplied relationships and keeps it.

```ts
import { Effect } from 'effect';
import type { Hooks } from './$types.js';
import { leaveAsOf, readLeaveContext } from '../../lib/leave/service.js';
import { leavePlanner } from '../../lib/leave/entitlements.js';
import { reconcileEmploymentLeave } from '../../lib/leave/reconcile.js';

/**
 * A child changes what the employment is entitled to, so the fact and the ledger it implies
 * commit together. The planner is given the pending child in memory — it is not stored yet —
 * and the employment root is restated with the complete set of its accounts.
 */
export default {
	mutate: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const asOf = yield* leaveAsOf;
				const context = yield* readLeaveContext(api, {
					employmentIds: [...new Set(inputs.map((one) => one.employment_id))],
					asOf
				});
				return { asOf, context };
			}),
		perRecord: {
			before: {
				description:
					"Restates the employment's leave accounts for the child this fact adds or changes, in the same commit as the fact.",
				handler: ({ input, existing, recordId, prepared, api }) =>
					Effect.gen(function* () {
						const employmentId = input.employment_id ?? existing?.employment_id;
						if (employmentId == null) return input;
						const child = { id: recordId, ...existing, ...input };
						const planner = leavePlanner(
							prepared.context.withPending('employee_children', child),
							api.db.leave_requests.findPending
						);
						yield* reconcileEmploymentLeave(planner.api, employmentId, prepared.asOf);
						if (planner.changed(employmentId))
							yield* api.db.employments.mutate([
								{
									id: employmentId,
									leave_account_employment: planner.nestedAccountsOf(employmentId)
								}
							]);
						return input;
					})
			}
		}
	}
} satisfies Hooks;
```

`context.withPending(collection, row)` is the second and last library change: an overlay of one
uncommitted fact over the stored context. The same shape serves `employment_terms`.

### 5.3 A leave request carries the line it charges

`templates/hr-payroll/src/collections/leave_requests/+hooks.ts` — an employee's request is
gated by `leaveApproval` on the employee's own grant. The `before` returns the request with its
ledger line nested under `leave_entry_request` (a cascade edge: the line is the request's). The
line has no route of its own: it is held with the request and lands on the reviewer's resume, or
lands at once when an HR manager, whose grant carries no approval, files the request directly.
While the request is pending the balance panel shows it as pending from `findPending`, as today,
because the line is not yet committed.

```ts
import { Effect } from 'effect';
import type { Hooks } from './$types.js';
import { leaveEntryIdFor } from '../../lib/leave/identity.js';
import { chargeableDays, resolveAccountFor } from '../../lib/leave/charge.js';

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Returns the request with the ledger line it charges, under the formula id the reconciler uses, so the line is held with the request and lands when it is approved.',
				handler: ({ input, existing, recordId, prepared, api }) =>
					Effect.gen(function* () {
						const request = { id: recordId, ...existing, ...input };
						// The workspace reads the account: an employee holds a read on their own accounts,
						// but the hook does not depend on that — it is not the employee.
						const account = yield* resolveAccountFor(api, request, prepared);
						const days = chargeableDays(request, prepared.calendar);
						const sourceKey = `request:${recordId}`;
						return {
							...input,
							leave_account_id: account.id,
							// The complete set: one line, or none when the request charges nothing.
							leave_entry_request:
								days === 0
									? []
									: [
											{
												id: leaveEntryIdFor(account.id, sourceKey),
												leave_account_id: account.id,
												leave_plan_id: account.opening_plan_id,
												statutory_profile_id: account.opening_statutory_profile_id,
												kind: 'TAKEN',
												effective_on: request.event.range.start.date,
												days: -days,
												source_key: sourceKey
											}
										]
						};
					})
			}
		}
	}
} satisfies Hooks;
```

The line's columns are abbreviated to the ones that name it. The employee policy is unchanged and
that is the point — it reads its own entries and writes none:

```ts
// templates/hr-payroll/src/access/policies/+employee.ts — unchanged
grantOn('leave_entries', 'read', { where: ownLeaveEntry }),
employeeLeaveRequestNewGrant(),   // carries `leaveApproval`; the nested line rides it
```

### 5.4 The payroll run: unchanged hook, smaller policies

`payroll_runs/+hooks.ts` already returns `payslip_payroll_run` from `before` and needs no edit.
What changes is what the grants around it no longer have to say. The comment at
`policy_grants.ts:228-248` ("a `before` hook runs as the requesting subject … without these grants
a run refuses on its own output") is deleted together with the grants it justified:

```ts
// templates/hr-payroll/src/access/policies/+hr_controller.ts — after
grants: mergeGrants(
	referenceGrants('read'),
	…
	payrollGrants('read'),
	grantOn('payroll_runs', 'mutate.new', { approval: payrollRunApprovalFromController })
	// payrollRebuildGrants() and captureLedgerGrants() are gone: the payslips, adjustments and
	// four capture junctions the engine nests are the workspace's rows, and the engine's reads
	// during `prepare` are the workspace's reads. A controller's own grant is the run.
),
```

`captureLedgerGrants()` goes only if no app query reads the junctions as a controller; the
implementation pass checks the app's queries before deleting it.

### 5.5 The kiosk: a policy that says only what the kiosk does

`+kiosk.ts` loses the block that existed because hooks read as the caller:

```ts
// before — +kiosk.ts:91-115
// Hook dependencies, masked to exactly what the guards read. Every attendance write runs
// the day guards as this subject: without these reads a punch on a leave day or inside a
// paid window dies as AccessDenied instead of the refusal that names the cause.
grantOn('leave_requests', 'read', { fields: ['employment_id', 'kind', 'approval_id', …] }),
grantOn('payroll_runs', 'read', { fields: ['company_id', 'period', 'lifecycle', 'attendance_from', 'attendance_to'] }),
grantOn('payslip_work_day_inputs', 'read', { fields: ['work_day_id', 'period'] }),

// after — deleted. The day guards run in `work_days` hooks and read as the workspace.
```

What remains is the kiosk's own surface: one app, masked reads on `employees` and `employments`,
`mutate.new` on both with `authorize: ({ record }) => record.face_enrollment_status === 'PENDING'`,
and `work_days` writes. Every grant now answers "what may the device do", none answers "what does a
hook need".

### 5.6 The reconciler: still an automation, for the work that is not one write

`+leave_ledger_refresh.ts` keeps its policy and its schedule. It loses the `employment_ids` arm
and the six after hooks that fed it; it is started by the schedule, by the seed, by a sealed
statutory profile for its law family, and by hand for one company.

```ts
export default defineAutomation(
	{ schedule: '10 0 1 * *' },
	{
		input: Schema.Struct({
			company_id: Schema.optional(Schema.String),
			jurisdiction_code: Schema.optional(Schema.String),
			/** Where the previous run of this walk stopped; set only by the reconciler itself. */
			cursor: Schema.optional(
				Schema.Struct({ company_id: Schema.String, after: Schema.optional(Schema.String) })
			)
		}),
		// Its own policy, because it runs with nobody's write to ride: on the first of the month,
		// after a seed, and across a law family when a profile seals.
		policies: ['leave_reconciliation_automation'],
		…
	}
);
```

`+leave_reconciliation_automation.ts` is unchanged: `employments: { mutate: { existing: { fields: [] } } }`
is still the zero-field root touch the scheduled walk hangs the nested graph from.

### 5.7 What does not exist

For the avoidance of a future patch, none of these are part of the surface and none will be:

```ts
// ✗ a policy on a hook
export default { policies: ['leave_reconciliation_automation'], mutate: { … } };
// ✗ a declared derivation list
export default { writes: ['leave_accounts', 'leave_entries'], mutate: { … } };
// ✗ a subject switch on the hook api
const plans = yield* api.as('leave_reconciliation_automation').db.leave_plans.findMany(…);
// ✗ an edge property carrying authority
leave_account_employment: derived(r.many.leave_accounts()),
```

Each is a second place a hook's behaviour would be written, and each would need a paragraph to
explain. The rule in §3 needs one sentence.

## 6. Implementation sketch (oss)

The Bolt owner decides the shape; this is the smallest one that satisfies §3.

1. **One workspace subject.** The engine builds every hook api — `before`, `delete.before`,
   `after` — bound to the workspace subject instead of the caller's. `Invocation.write` and the
   read path treat that subject as unrestricted with no approval route: one branch at the top of
   each function. `WriteElevation`, the `elevation` parameter, `afterHookElevation`, the `elevated`
   port flag and the `elevated` argument on `buildOps` are deleted. `unrestricted` stays as the
   workspace's predicate.
2. **Authorize the submitted shape before hooks, whole.** `prepareNode` authorizes the root's own
   columns and every nested row the caller submitted against the caller _before_ `runMutateBefore`,
   using the pre-hook split it already has (`submitted.included`). The post-hook graph is prepared
   as the workspace's. `trusted`, `hookRelationNames`, `PlannedChild.trusted`, the `trusted`
   parameter on `prepareDelete`/`prepareNode`/`prepareOwnedDescendants` and the browser-base-version
   exemption in finding 3 all collapse into "the post-hook graph is the workspace's".
3. **Approval.** `resolveApproval` runs only for the caller's rows, where it runs today for
   untrusted ones. The mixed-route refusal in `declarative-prepare.ts:871-883` is unchanged and can
   now only fire on rows the caller submitted.
4. **Budget.** `engine.ts` is at 844 lines against an 844 budget; this change is a net deletion and
   the budget is lowered to what remains, not held.
5. **Docs.** `docs/access/README.md` gains the §3 rule as one paragraph under policies; the
   authoring skill's clause at `collections-and-modeling.md:214` is rewritten to the same sentence.

### 6.1 Pre-landing checks

- Grep every template's `after` hooks for writes to an approval-gated collection. The census found
  none in hr-payroll (all six after hooks start an automation); crm's 16 hook files and
  field-operations' 8 are checked before the route-preservation branch is deleted.
- Confirm that a `before` hook's staged `api.db.*.mutate` is applied inside the root's transaction
  and that the written root's own hooks receive the supplied relationship names (§5.2 depends on
  both; `hooks/boundary.ts:239-250` and `contracts-schema.ts:995-1017` say they do).
- Confirm `MutateGraph`'s compile-time depth of 5 against `WRITE_DEPTH_LIMIT` 8: the type is the
  stricter and the comment claiming they agree is corrected.

## 7. Acceptance

Rows to add to [`acceptance-matrix.md`](./acceptance-matrix.md) §7 when the implementation pass
opens; each is `pass` only on observed evidence.

| Row  | Assertion                                                                                                                                                                                                                                                               | Harness                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| HA1  | A subject with `mutate.new` on the root and no grant on the child collection lands a root whose `before` nests children; the same subject submitting those children directly is refused on its own claim, and is refused even when the hook also returns that relation. | oss `collections-relationship-reconciliation.integration.test.ts` (replaces the two 0.0.14/0.0.15 tests) |
| HA2  | A `before` hook reads a collection the caller holds no read grant on, unmasked; the caller's read-back of the committed row is masked by the caller's read grant.                                                                                                       | oss integration, kiosk-shaped subject                                                                    |
| HA3  | A reviewed root with a nested child holds as one request, commits both on resume, discards both on rejection.                                                                                                                                                           | oss integration (existing 0.0.15 test, re-stated)                                                        |
| HA4  | An `after` hook writing to an approval-gated collection lands the row and opens no request.                                                                                                                                                                             | oss integration                                                                                          |
| HA5  | A `before` hook's `api.db.<other>.mutate` is in the root's transaction: a refusal in the root's second record leaves neither the staged write nor the first record.                                                                                                     | oss integration                                                                                          |
| HR1′ | Kiosk enrolment, employee-edited child fact and HR hire each commit with the ledger in the same write; `bolt_task` shows no `leave_ledger_refresh` run for any of them; the monthly and sealed-profile runs still walk.                                                 | hr-payroll `public-seed-*-leave` integrations, amended HR1                                               |
| HA6  | The doctor hint rule lists reads and nested relations for every `+hooks.ts` in hr-payroll and reports zero for a hook that nests nothing.                                                                                                                               | doctor rule harness (three-observation floor)                                                            |

Gates, in order, per [`testing.md`](./testing.md) and the standing local loop: `env -- link
--only=bolt` then the full oss suite; then each template's own suite against the linked bolt; then
the release, the template pin, and a hosted reset. A release is never the harness.

## 8. Deletions

Zero legacy: nothing below is shimmed, deprecated or kept behind a flag.

**oss**

- `trusted` parameter and threading (`engine.ts`, `cascade-delete.ts`), `PlannedChild.trusted`
- `hookRelationNames`
- `afterHookElevation`; `WriteElevation` and the `elevation` argument of `policyWrite`
- the `elevated` port flag and `buildOps` argument; `settle.ts:76`'s `true`
- the browser-base-version exemption for hook-added relations (`engine.ts:429-433`)
- the 0.0.14 and 0.0.15 tests, replaced by HA1–HA5

**templates/hr-payroll**

- six `after` hooks that start `leave_ledger_refresh` (employments, employment_terms,
  employee_children, leave_requests, leave_accounts, jurisdictions), replaced by §5.1–5.3 and one
  `jurisdictions` start for the law family
- `employment_ids` arm of `leave_ledger_refresh`
- `payrollRebuildGrants()`; `captureLedgerGrants()` if no app query needs it
- the kiosk's hook-dependency read grants (`+kiosk.ts:91-115`)
- the stale comments at `policy_grants.ts:228-248`, `+hr_controller.ts:35-38`, and the word
  "elevated" in `service.ts:13`; an inline comment is added on `leave_account_employment` stating
  why it is not a cascade, so finding 9 is on the edge and not only in a header

**docs**

- the clause at `collections-and-modeling.md:214`, replaced by the §3 sentence
- learnings row 158's stated cause is no longer true after landing; a new row records the landing,
  the old row is never rewritten

## 9. Sequence

1. Bolt owner reviews §3 and §6; the shape of the workspace subject is theirs to set.
2. oss change lands with HA1–HA5 green and the doctor hint rule; release.
3. hr-payroll pins the release, deletes §8's template items, lands §5.1–5.3 and HR1′; every other
   template pins the release and runs its suite (no template code change expected — the census
   found no other hook that nests or starts an automation from a hook).
4. Docs and the authoring skill are updated in the same template commit.
5. Hosted reset on staging; HR1′ observed on the self-host before the row moves to `pass`.

Until step 2 releases, the per-record automation hop and every grant in §8 stay exactly as they
are. Template work on the settlement union and RFC 0002 follow-ups proceeds independently.
