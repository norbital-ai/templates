import { model } from '@norbital-ai/bolt';
import {
	isJsonObject,
	jsonObject,
	type JsonObject
} from '../../../../../../../lib/payroll_engine/foundation.js';
import {
	assertLeft,
	assertOpenPeriod,
	assertCashable,
	assertReversals,
	entriesUndone,
	entryPostings,
	entryRead
} from '../../../../../../../lib/ledger/service.js';
import { tap } from '../../../../../../../lib/payroll_engine/taps.js';

const slots = (days: unknown): Set<string> =>
	new Set(
		(Array.isArray(days) ? days : []).flatMap((day) =>
			isJsonObject(day) ? [`${String(day.date)}:${String(day.part)}`] : []
		)
	);
export default model('leave_catalog_entry', {
	description: 'One leave request: dated half-day slots for an employment.',
	record_label: "record.employment_id.employee_number + ' · ' + record.catalog_id.code",
	fields: {
		entity_id: { kind: 'ref', to: 'entity' },
		employment_id: { kind: 'ref', to: 'employee_contract', inverse: 'leave_catalog_entry' },
		catalog_id: { kind: 'ref', to: 'leave_catalog', onDelete: 'restrict' },
		payroll_run_id: { kind: 'ref', to: 'payroll_run', optional: true, onDelete: 'setNull' },
		evidence_file: {
			kind: 'file',
			accept: ['application/pdf', 'image/*'],
			max: '20MiB',
			optional: true
		},
		reverses: { kind: 'ref', to: 'leave_catalog_entry', optional: true, onDelete: 'restrict' },
		encashment: { kind: 'bool', default: false, hidden: true },
		// the fact that caused a derived entry, `<fact>:<record id>`; only the system names it
		occurrence_key: { kind: 'text', optional: true, hidden: true }
	},
	unique: [
		{ fields: ['reverses'] },
		// one live entry a fact and catalogue row
		{
			fields: ['occurrence_key', 'catalog_id'],
			where: { reverses: { isNull: true }, occurrence_key: { isNull: false } }
		}
	],
	read: {
		leave_catalog_entry: { fields: 'all' },
		'leave_catalog_entry.employment_id': { fields: 'all' },
		'leave_catalog_entry.payroll_run_id': { fields: 'all' },
		'leave_catalog_entry.catalog_id': { fields: 'all' },
		'leave_catalog_entry.leave_catalog_entry_day': { fields: 'all' }
	},
	create: {
		columns: {
			leave_catalog_entry: [
				'entity_id',
				'employment_id',
				'catalog_id',
				'evidence_file',
				'reverses',
				'encashment',
				'occurrence_key'
			],
			'leave_catalog_entry.leave_catalog_entry_day': ['incurred_on', 'part']
		},
		transform: function* (input, ctx) {
			const rows = input;
			const slotsOf = (row: JsonObject) =>
				(Array.isArray(row.leave_catalog_entry_day) ? row.leave_catalog_entry_day : []).flatMap(
					(child) =>
						isJsonObject(child) && typeof child.incurred_on === 'string'
							? [
									{
										date: child.incurred_on,
										part: child.part,
										payroll_run_id: child.payroll_run_id ?? null
									}
								]
							: []
				);
			const entries = rows.map((row) => jsonObject({ ...row, days: slotsOf(row) }));
			// A leave entry is its slots: an entry with none has no day to draw, price or reverse.
			if (entries.some((row) => !Array.isArray(row.days) || row.days.length === 0))
				return yield* ctx.refuse('A leave entry needs at least one day.');
			// the approving decision asks again only for what the entry posts: what it checked stands
			const known = yield* entryRead(
				ctx.db.query,
				'leave_catalog_entry',
				entries,
				ctx.approving ? undefined : 'create'
			);
			if (!ctx.approving) {
				yield* assertCashable(known, entries);
				yield* assertReversals(known, 'leave_catalog_entry', entries);
				yield* assertLeft(known, entries, String(ctx.today));
				yield* assertOpenPeriod(known, entries);
			}
			return { rows, onApproved: yield* entryPostings(known, 'leave_catalog_entry', entries) };
		}
	},
	update: {
		columns: {
			leave_catalog_entry: ['evidence_file', 'payroll_run_id'],
			'leave_catalog_entry.leave_catalog_entry_day': ['incurred_on', 'part']
		},
		transform: function* (changes, ctx) {
			if (
				changes.every(
					(change) =>
						Object.keys(change.set).length === 1 && Object.hasOwn(change.set, 'payroll_run_id')
				)
			)
				return changes.map((change) => change.set);
			const held = yield* ctx.db.query({
				leave_catalog_entry_day: {
					where: { leave_entry_id: { in: changes.map((change) => change.before.id) } },
					fields: ['id', 'leave_entry_id', 'incurred_on', 'part', 'payroll_run_id'],
					limit: 10000
				}
			});
			const slotsByEntry = Map.groupBy(held.leave_catalog_entry_day.rows, (row) =>
				String(row.leave_entry_id)
			);
			const actionsOf = (change: { readonly set: Record<string, unknown> }) =>
				jsonObject(change.set.leave_catalog_entry_day ?? {});
			for (const change of changes) {
				const actions = actionsOf(change);
				const deleted = new Set(Array.isArray(actions.delete) ? actions.delete.map(String) : []);
				const existing = slotsByEntry.get(String(change.before.id)) ?? [];
				if (existing.some((row) => row.payroll_run_id != null && deleted.has(String(row.id))))
					return yield* ctx.refuse(
						'Leave days already paid by a payroll run cannot be removed. Create a reversal for those days.'
					);
			}
			const proposed = changes.map((change) => {
				const actions = actionsOf(change);
				const created = Array.isArray(actions.create) ? actions.create.filter(isJsonObject) : [];
				const deleted = new Set(Array.isArray(actions.delete) ? actions.delete.map(String) : []);
				const existing = slotsByEntry.get(String(change.before.id)) ?? [];
				const days = [
					...existing
						.filter((row) => !deleted.has(String(row.id)))
						.map((row) => ({
							date: row.incurred_on,
							part: row.part,
							payroll_run_id: row.payroll_run_id
						})),
					...created.map((row) => ({ date: row.incurred_on, part: row.part }))
				];
				return jsonObject({
					...change.before,
					...change.set,
					days,
					// rules read the resulting slots, not the change's child actions
					leave_catalog_entry_day: [
						...existing.filter((row) => !deleted.has(String(row.id))),
						...created
					]
				});
			});
			if (proposed.some((row) => !Array.isArray(row.days) || row.days.length === 0))
				return yield* ctx.refuse('A leave entry needs at least one day.');
			const known = yield* entryRead(
				ctx.db.query,
				'leave_catalog_entry',
				proposed,
				ctx.approving ? undefined : 'update'
			);
			if (!ctx.approving) {
				yield* assertLeft(
					known,
					proposed,
					String(ctx.today),
					changes.map((change) => jsonObject(change.before))
				);
				yield* assertOpenPeriod(known, proposed);
			}
			return {
				rows: changes.map((c) => c.set),
				onApproved: yield* entryPostings(known, 'leave_catalog_entry', proposed)
			};
		}
	},
	delete: {
		check: function* (rows, ctx) {
			const entries = rows.map((row) => jsonObject(row));
			const known = yield* entryRead(
				ctx.db.query,
				'leave_catalog_entry',
				entries,
				ctx.approving ? undefined : 'delete'
			);
			const captured = yield* ctx.db.query({
				leave_catalog_entry_day: {
					where: {
						leave_entry_id: { in: rows.map((row) => row.id) },
						payroll_run_id: { isNull: false }
					},
					fields: ['leave_entry_id'],
					limit: 1
				}
			});
			const [paid] = captured.leave_catalog_entry_day.rows;
			if (paid !== undefined)
				return yield* ctx.refuse(
					rows.find((row) => row.id === paid.leave_entry_id)?.reverses != null
						? 'A payroll run has paid this reversal back, so it can no longer be cancelled.'
						: 'Leave days already paid by a payroll run cannot be deleted. Create a reversal for those days.'
				);
			if (!ctx.approving) {
				// a deleted entry takes nothing; a cancelled reversal takes back the half-days it freed
				yield* assertLeft(
					known,
					rows.map((row) =>
						jsonObject({ ...row, reverses: row.reverses == null ? 'delete' : null })
					),
					String(ctx.today)
				);
			}
			return { onApproved: entriesUndone(known, 'leave_catalog_entry', entries) };
		}
	},

	effect: {
		created: function* (rows, ctx) {
			// a cash-out reversed: the task that asked for it closes
			const reversed = rows.filter((row) => row.encashment && row.reverses != null);
			if (reversed.length > 0)
				yield* ctx.schedule('encashment', {
					employments: [...new Set(reversed.map((row) => row.employment_id))]
				});
			// under the system identity: the writer may be an employee, who cannot read the law
			yield* ctx.schedule('registered_effects', {
				collection: 'leave_catalog_entry',
				operation: 'create',
				ids: rows.map((row) => String(row.id))
			});
		},
		updated: function* (changes, ctx) {
			yield* ctx.schedule('registered_effects', {
				collection: 'leave_catalog_entry',
				operation: 'update',
				ids: changes.map((change) => String(change.after.id))
			});
		}
	}
});
