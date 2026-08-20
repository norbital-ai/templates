import { defineModel, enums, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * Everything one payslip consumed: one row per source record a payroll run priced.
 *
 * ## What this is, and what it is not
 *
 * `norbital_approval_id` is the **approval lock**. The platform owns it, stamps it while an approval
 * request is open, and clears it when the request settles. It answers "is this write still waiting
 * for a person to decide?" and nothing in this workspace writes it.
 *
 * This collection is the **settlement lock**. The workspace owns it. A row here says "this payslip
 * consumed record X of collection C", which is a different fact with a different lifetime: it is
 * taken when the run persists and released when the payslip is deleted, and an approval decision
 * never touches it.
 *
 * It replaced `payroll_settlements`, which hung the same claims off `payroll_run_id`. Hanging them
 * off the **payslip** instead makes the release free: deleting a payslip drops its claims by
 * cascade, and deleting a run drops its payslips by cascade, so one statement releases everything
 * a run ever priced — no hook loop, no release path that can half-run.
 *
 * ## Why a stored claim rather than the date arithmetic it replaces
 *
 * Settlement used to be inferred: a record was frozen if its date fell inside the
 * `attendance_from … attendance_to` window of a run whose `lifecycle` was `PAID`. That was wrong in
 * both directions. A DRAFT run that had already written payslips citing a time entry left that entry
 * editable underneath it, and a record merely *dated* inside a paid window was frozen even when no
 * payslip had ever consumed it, which froze arrears entries the run had deliberately pushed into the
 * next period.
 *
 * The window arithmetic is kept, because the scheduling board asks a question about *days* and this
 * answers a question about *records*. See `src/lib/scheduling/lock.ts`, which states the division in
 * one line: a RECORD is governed by the claim held over it; a DAY WITH NO RECORD is governed by the
 * window, because there is no claim to ask.
 *
 * ## What a payslip consumes, and why the uniqueness is per payslip
 *
 * PERSIST writes a source row for every record the payslip's own lines and claims name: time entries
 * and leave requests by measured span (`claimsForBundle`), component entries and pay components off
 * the lines, and repayment agreements off loan-instalment lines. The last three are the reason the
 * unique index is `(payslip_id, source_collection, source_record_id)` rather than the global
 * `(source_collection, source_record_id)` the old table carried: a pay component is consumed by
 * every run that prices it and a repayment agreement by every instalment, so the same record is
 * legitimately held by many payslips. The single-consumption guarantee for component entries lives
 * where it always has, in the partial unique index on `payslip_lines (component_entry_id) WHERE
 * component_entry_usage = 'SINGLE_USE'`.
 *
 * ## Release, performed by the database
 *
 * `payslip_id` is declared `cascade(...)` in `+relationship.ts`, and that declaration reaches the
 * DDL — `src/compiler/model-fields.ts` detects the `cascade(` wrapper and
 * `schema-migrations.ts` emits `ON DELETE CASCADE`, as it does for `payslips.payroll_run_id` and
 * `payslip_lines.payslip_id`. Deleting a draft run therefore releases its claims in one statement,
 * performed by the database. `payroll_runs/+hooks.ts` refuses the delete once `lifecycle = 'PAID'`,
 * so a paid run's claims are permanent and corrections use adjustment entries.
 *
 * A rebuild clears the run's payslips explicitly before writing new ones, so the cascade releases
 * the old claims in the same step — a rebuild never re-claims against its own stale rows.
 *
 * ## Why the source is a name and an id rather than five nullable foreign keys
 *
 * Five collections are settled today and the union arms of `payslip_lines` already show why a sixth
 * arrives eventually. Five nullable uuid columns with a "exactly one is set" check is the shape that
 * rots: every query grows a `COALESCE`, and the check is the first thing to be forgotten. A
 * `(collection, record)` pair is one index and one lookup shape that every source hook shares
 * verbatim.
 *
 * The trade is a claim the database cannot enforce referentially — a deleted time entry leaves its
 * claim behind. That is acceptable here and only here: a settled record cannot be deleted, because
 * the very hook that reads this collection refuses it.
 */
export default defineModel(
	{
		payslip_id: uuid().notNull(),
		/**
		 * The collection the consumed record lives in.
		 *
		 * An enum rather than free text so a typo is a write failure instead of a lock that silently
		 * matches nothing — a settlement lock that fails open is worse than no lock at all, because
		 * the calendar stripes would still say the day was settled.
		 */
		source_collection: enums([
			'time_entries',
			'component_entries',
			'leave_requests',
			'pay_components',
			'repayment_agreements'
		]).notNull(),
		source_record_id: uuid().notNull(),
		/**
		 * The run's period, copied at the moment the claim is taken.
		 *
		 * Denormalized on purpose. The refusal message has to name the period that owns the record, and
		 * it is composed inside a `before` hook under the editing person's own subject — a supervisor
		 * has no `payroll_runs` read grant, so joining to the run to fetch its period would turn an
		 * explanation into an access denial. The value cannot drift: `payroll_runs/+hooks.ts` lists
		 * `period` among the engine-owned columns and refuses to let anybody edit it.
		 */
		period: text().notNull()
	},
	{
		description:
			'One source record consumed by one payslip. Taken when the run persists, released when the payslip (and so the run) is deleted; a PAID run is never deleted, so its claims are permanent and corrections use adjustment entries.',
		recordLabel: ['period', 'source_collection'],
		icon: 'lucide:link',
		indexes: [
			// The lock itself: one indexed lookup for every source hook, scoped to the payslip that
			// holds the claim. The release path needs no index at all — the cascade walks payslips.
			{
				columns: ['payslip_id', 'source_collection', 'source_record_id'],
				unique: true
			},
			// The claim lookup from the record side: every source hook asks
			// `source_collection + source_record_id` to find the claim held over its record.
			{ columns: ['source_collection', 'source_record_id'] }
		]
	}
);
