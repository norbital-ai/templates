import { custom, defineModel, sql, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * Attendance and leave records one payslip consumed: one typed source per row.
 *
 * ## What this is, and what it is not
 *
 * `norbital_approval_id` is the **approval lock**. The platform owns it, stamps it while an approval
 * request is open, and clears it when the request settles. It answers "is this write still waiting
 * for a person to decide?" and nothing in this workspace writes it.
 *
 * This collection is the **settlement lock**. The workspace owns it. A row here says which exact
 * attendance or leave record a payslip consumed. `source` is a discriminated union, and its arms are
 * projected below to real, indexed foreign keys — no collection name is interpreted at runtime.
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
 * ## What a payslip consumes
 *
 * PERSIST writes a source row for each time entry and leave request inside the payslip's measured
 * span (`claimsForBundle`). Component entries and loan instalments already have direct foreign keys
 * on `payslip_lines`, so duplicating them here would create two linkage mechanisms for one fact.
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
 * `source` prevents impossible mixed shapes at the write boundary; the generated columns below
 * make its identifiers database-enforced relations. Global partial uniqueness means a concrete
 * time entry or leave request can belong to one payslip only, while one payslip can own any number
 * of input rows.
 */
export default defineModel(
	{
		payslip_id: uuid().notNull(),
		source: custom('payslip_source').notNull(),
		/** Database-enforced projections of the source union. */
		time_entry_id: uuid().generatedAlwaysAs(
			sql`CASE WHEN source ->> 'kind' = 'TIME_ENTRY' THEN (source ->> 'time_entry_id')::uuid END`
		),
		leave_request_id: uuid().generatedAlwaysAs(
			sql`CASE WHEN source ->> 'kind' = 'LEAVE_REQUEST' THEN (source ->> 'leave_request_id')::uuid END`
		),
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
		recordLabel: ['period'],
		icon: 'lucide:link',
		indexes: [
			{ columns: ['payslip_id'] },
			{
				columns: ['time_entry_id'],
				unique: true,
				where: '"time_entry_id" IS NOT NULL'
			},
			{
				columns: ['leave_request_id'],
				unique: true,
				where: '"leave_request_id" IS NOT NULL'
			}
		]
	}
);
