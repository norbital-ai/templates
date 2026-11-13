import { Effect } from 'effect';
import { model } from '../../../../../.norbital/models/jurisdiction_change.ts';
import { lawWrite, syncLedgerOn } from '../../../../lib/payroll_engine/configuration.js';
import { jsonObject } from '../../../../lib/payroll_engine/foundation.js';

export default model({
	description:
		'One dated change to a law. The first holds the whole law; each later one holds only what changed from its date, and a value set to null is taken away. A change may be edited, moved or deleted.',
	icon: 'lucide:calendar-plus',
	record_label: 'record.effective_from',
	fields: {
		jurisdiction_code: { kind: 'text' },
		effective_from: { kind: 'date' },
		/** The research finding that wrote it: in force only while that finding is confirmed. */
		finding_id: {
			kind: 'ref',
			to: 'statutory_finding',
			optional: true,
			inverse: 'law_changes',
			on_delete: 'cascade'
		},
		/** Keyed by family, then by row code, then by field. */
		law: { kind: 'json', shape: { kind: 'record', of: { kind: 'json' } } }
	},
	outputs: { default: { fields: 'all', finding_id: { fields: ['status'] } } },
	// every write is checked on the law it leaves, on its date and at every later change, and carries the amendment
	// rows of the paid periods it reaches
	create: {
		columns: { fields: ['jurisdiction_code', 'effective_from', 'finding_id', 'law'] },
		transform: function* (changes, ctx) {
			const rows = changes.map(({ after }) => after);
			const findings = [...new Set(rows.flatMap((row) => row.finding_id ?? []))];
			const filed =
				findings.length === 0
					? []
					: (yield* ctx.query({
							statutory_finding: {
								where: { id: { in: findings } },
								fields: ['status'],
								limit: 10000
							}
						})).statutory_finding.rows;
			const status = new Map(filed.map((row) => [String(row.id), row.status]));
			return {
				sets: changes.map(({ set }) => set),
				on_approved: yield* lawWrite(
					ctx.query,
					rows.map((row) => row.jurisdiction_code),
					(stored) => [
						...stored,
						...rows.map((row, index) =>
							jsonObject({
								id: `new/${index}`,
								jurisdiction_code: row.jurisdiction_code,
								effective_from: row.effective_from,
								law: row.law,
								finding_id:
									row.finding_id == null
										? null
										: { status: status.get(String(row.finding_id)) ?? null }
							})
						)
					]
				).pipe(
					Effect.catchTag('Refusal', (error) =>
						ctx.refuse('errors.payroll_refused', { values: { message: error.message } })
					)
				)
			};
		},
		effect: function* (changes, ctx) {
			yield* syncLedgerOn(
				ctx,
				changes.map(({ after }) => String(after.effective_from))
			);
		}
	},
	update: {
		columns: { fields: ['effective_from', 'law'] },
		transform: function* (changes, ctx) {
			const written = new Map(changes.map(({ before, after }) => [String(before.id), after]));
			return {
				sets: changes.map(({ set }) => set),
				on_approved: yield* lawWrite(
					ctx.query,
					changes.map(({ before }) => before.jurisdiction_code),
					(stored) =>
						stored.map((row) => {
							const after = written.get(String(row.id));
							return after === undefined
								? row
								: jsonObject({ ...row, effective_from: after.effective_from, law: after.law });
						})
				).pipe(
					Effect.catchTag('Refusal', (error) =>
						ctx.refuse('errors.payroll_refused', { values: { message: error.message } })
					)
				)
			};
		},
		effect: function* (changes, ctx) {
			yield* syncLedgerOn(
				ctx,
				changes.flatMap(({ before, after }) => [
					String(before.effective_from),
					String(after.effective_from)
				])
			);
		}
	},
	delete: {
		transform: function* (changes, ctx) {
			const gone = new Set(changes.map(({ before }) => String(before.id)));
			return {
				on_approved: yield* lawWrite(
					ctx.query,
					changes.map(({ before }) => before.jurisdiction_code),
					(stored) => stored.filter((row) => !gone.has(String(row.id)))
				).pipe(
					Effect.catchTag('Refusal', (error) =>
						ctx.refuse('errors.payroll_refused', { values: { message: error.message } })
					)
				)
			};
		},
		effect: function* (changes, ctx) {
			yield* syncLedgerOn(
				ctx,
				changes.map(({ before }) => String(before.effective_from))
			);
		}
	}
});
