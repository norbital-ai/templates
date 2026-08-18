import { defineModel, enums, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * The settlement lock: one row per source record a payroll run consumed.
 *
 * ## What this is, and what it is not
 *
 * `norbital_approval_id` is the **approval lock**. The platform owns it, stamps it while an approval
 * request is open, and clears it when the request settles. It answers "is this write still waiting
 * for a person to decide?" and nothing in this workspace writes it.
 *
 * This collection is the **settlement lock**. The workspace owns it. A row here says "payroll run R
 * consumed record X of collection C", which is a different fact with a different lifetime: it is
 * taken when the run persists and released when the run is deleted, and an approval decision never
 * touches it.
 *
 * They were conflated before this collection existed. `gather.ts` filters every source query on
 * `norbital_approval_id IS NULL` and calls that *live*, while `src/lib/scheduling/lock.ts` read the
 * same column as a write lock — so one column was answering both "may payroll consume this row" and
 * "may anybody edit this row". Storing settlement there would have made the second build of a
 * period unable to see the rows the first build consumed: the run would quietly recompute itself
 * down to nothing, and an unrelated approval would release a settled payroll record as a side
 * effect.
 *
 * ## Why a stored claim rather than the date arithmetic it replaces
 *
 * Settlement used to be inferred: a record was frozen if its date fell inside the
 * `attendance_from … attendance_to` window of a run whose `lifecycle` was `PAID`. That was wrong in
 * both directions. A DRAFT run that had already written payslips citing a time entry left that entry
 * editable underneath it — the owner's case exactly, "when payroll runs, and if it's taken into
 * consideration already, then it should be locked". And a record merely *dated* inside a paid window
 * was frozen even when no payslip had ever consumed it, which froze arrears entries the run had
 * deliberately pushed into the next period.
 *
 * The window arithmetic is kept, because the scheduling board asks a question about *days* and this
 * answers a question about *records*.
 *
 * ## Release, and the one part of it that does not yet run
 *
 * The release is `cascade` on `payroll_run_id` in `+relationship.ts`: deleting the run drops its
 * claims, in the same statement, performed by the database. That is deliberate rather than
 * convenient — a hook release would have to page through the claims and delete them, and
 * `api.db.<collection>.delete(identifiers)` deletes `identifiers[0]` and nothing else at the current
 * runtime boundary, so a hand-written release would free one row out of eight hundred and report
 * success. `payroll_runs/+hooks.ts` refuses the delete once `lifecycle = 'PAID'`, so the cascade can
 * only ever release a draft's claims.
 *
 * **It does not cascade yet, and neither does anything else in this workspace.** `cascade()` marks a
 * relationship with a symbol that has exactly one occurrence in the whole of the bolt package — its
 * own definition. No compiler and no runtime reads it, and the baseline migration contains zero
 * occurrences of `CASCADE`: every foreign key the lineage emits is `NO ACTION`. So the claim below
 * is what this workspace *declares*, and it is the same declaration `payslips` already makes against
 * the same parent. Until the marker is honoured, deleting a draft run is refused by its own foreign
 * keys — which is already true today for a run that has written payslips, and is not a condition
 * this collection introduces. It is reported rather than worked around, because the two workarounds
 * available are worse: dropping the relation would leave orphaned claims locking records forever,
 * and releasing from `delete.before` is impossible because that phase's api has no delete at all.
 *
 * A rebuild of a draft clears the run's settlements explicitly first, beside its payslips, so the
 * unique index below cannot refuse the rebuild's own re-claim.
 *
 * ## Why the source is a name and an id rather than four nullable foreign keys
 *
 * Three collections are settled today and the union arms of `payslip_lines` already show why a
 * fourth arrives eventually. Four nullable uuid columns with a "exactly one is set" check is the
 * shape that rots: every query grows a `COALESCE`, and the check is the first thing to be forgotten.
 * A `(collection, record)` pair is one index, one unique constraint, and one lookup shape that every
 * source hook shares verbatim.
 *
 * The trade is a claim the database cannot enforce referentially — a deleted time entry leaves its
 * claim behind. That is acceptable here and only here: a settled record cannot be deleted, because
 * the very hook that reads this collection refuses it.
 */
export default defineModel(
	{
		payroll_run_id: uuid().notNull(),
		/**
		 * The collection the claimed record lives in.
		 *
		 * An enum rather than free text so a typo is a write failure instead of a lock that silently
		 * matches nothing — a settlement lock that fails open is worse than no lock at all, because
		 * the calendar stripes would still say the day was settled.
		 */
		source_collection: enums(['time_entries', 'component_entries', 'leave_requests']).notNull(),
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
			'One source record consumed by one payroll run. Taken when the run persists, released when the run is deleted; a PAID run is never deleted, so its claims are permanent and corrections use adjustment entries.',
		recordLabel: ['period', 'source_collection'],
		icon: 'lucide:lock',
		indexes: [
			// The release path: every claim one run holds, in one index scan.
			{ columns: ['payroll_run_id'] },
			/**
			 * The lock itself, and the reason it is `unique`.
			 *
			 * Two runs cannot both hold the same record. Without this the guarantee would live only in
			 * the engine's arithmetic, and a rebuild that failed halfway through its clear would leave a
			 * record claimed twice — after which deleting one of the two runs would release a lock the
			 * other still needs. It is the same guarantee, in the same place, as the unique index on
			 * `payslip_lines (component_entry_id) WHERE component_entry_usage = 'SINGLE_USE'`.
			 */
			{ columns: ['source_collection', 'source_record_id'], unique: true }
		]
	}
);
