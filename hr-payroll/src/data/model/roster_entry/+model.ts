import { Effect } from 'effect';
import { model } from '@norbital-ai/bolt';
import { jsonObject, type Json } from '../../../lib/payroll_engine/foundation.js';
import { validateRegistered } from '../../../lib/payroll_engine/registrations.js';
import { tap } from '../../../lib/payroll_engine/taps.js';
import { rosterFindings } from '../../../lib/payroll_engine/roster_warnings.js';

export default model('roster_entry', {
	description:
		'One roster day: its planned overtime and actual worked intervals. The employment and payroll run lock are on the entry.',
	label: 'work_date',
	fields: {
		employment_id: { kind: 'ref', to: 'employee_contract', inverse: 'roster_entry' },
		payroll_run_id: { kind: 'ref', to: 'payroll_run', optional: true },
		work_date: { kind: 'date' },
		shift_definition_id: {
			kind: 'ref',
			to: 'shift_definition',
			optional: true,
			onDelete: 'restrict'
		},
		planned_overtime_intervals: {
			kind: 'list',
			optional: true,
			of: {
				kind: 'object',
				fields: {
					start: { kind: 'instant' },
					end: { kind: 'instant' },
					break_minutes: { kind: 'number', min: 0, optional: true },
					breaks: {
						kind: 'list',
						optional: true,
						of: {
							kind: 'object',
							fields: { start: { kind: 'instant' }, end: { kind: 'instant' } }
						}
					}
				}
			}
		},
		findings: { kind: 'json', default: [] },
		actual_worked_intervals: {
			was: 'worked_intervals',
			kind: 'list',
			optional: true,
			of: {
				kind: 'object',
				fields: {
					start: { kind: 'instant' },
					end: { kind: 'instant', optional: true },
					break_minutes: { kind: 'number', min: 0, optional: true },
					breaks: {
						kind: 'list',
						optional: true,
						of: {
							kind: 'object',
							fields: { start: { kind: 'instant' }, end: { kind: 'instant' } }
						}
					}
				}
			}
		}
	},
	unique: [{ fields: ['employment_id', 'work_date'] }],
	locked: { payroll_run_id: { isNull: false } },
	read: {
		roster_entry: { fields: 'all' },
		'roster_entry.employment_id': { fields: 'all' },
		'roster_entry.shift_definition_id': { fields: 'all' },
		'roster_entry.payroll_run_id': { fields: 'all' }
	},
	outputs: {
		kiosk: {
			roster_entry: {
				fields: ['employment_id', 'work_date', 'actual_worked_intervals', 'payroll_run_id']
			}
		}
	},
	create: {
		columns: {
			roster_entry: [
				'employment_id',
				'work_date',
				'shift_definition_id',
				'planned_overtime_intervals',
				'actual_worked_intervals',
				'findings'
			]
		},
		transform: function* (rows, ctx) {
			yield* validateRegistered(
				ctx.db.query,
				'roster_entry',
				'create',
				rows.map((row) => jsonObject(row))
			);
			const groups = new Map<string, number[]>();
			rows.forEach((row, index) => {
				const employment = String(row.employment_id);
				const group = groups.get(employment) ?? [];
				group.push(index);
				groups.set(employment, group);
			});
			const findings = new Map<number, Json>();
			yield* Effect.forEach([...groups], ([employment, indexes]) =>
				Effect.map(
					rosterFindings(
						ctx.db.query,
						employment,
						indexes.map((index) => jsonObject(rows[index]!))
					),
					(warned) => {
						warned.forEach((row, at) => findings.set(indexes[at]!, row.findings ?? []));
					}
				)
			);
			return rows.map((row, index) => ({ ...row, findings: findings.get(index) ?? [] }));
		}
	},
	update: {
		columns: {
			roster_entry: [
				'payroll_run_id',
				'work_date',
				'shift_definition_id',
				'planned_overtime_intervals',
				'actual_worked_intervals',
				'findings'
			]
		},
		transform: function* (changes, ctx) {
			if (
				changes.every(
					(change) =>
						Object.keys(change.set).length === 1 && Object.hasOwn(change.set, 'payroll_run_id')
				)
			)
				return changes.map((change) => change.set);
			yield* validateRegistered(
				ctx.db.query,
				'roster_entry',
				'update',
				changes.map((change) => jsonObject({ ...change.before, ...change.set }))
			);
			if (changes.some((change) => change.before.payroll_run_id != null))
				return yield* ctx.refuse('This roster entry is locked by a payroll run.');
			const groups = new Map<string, number[]>();
			changes.forEach((change, index) => {
				const employment = String(change.before.employment_id);
				const group = groups.get(employment) ?? [];
				group.push(index);
				groups.set(employment, group);
			});
			const findings = new Map<number, Json>();
			yield* Effect.forEach([...groups], ([employment, indexes]) =>
				Effect.map(
					rosterFindings(
						ctx.db.query,
						employment,
						indexes.map((index) =>
							jsonObject({ ...changes[index]!.before, ...changes[index]!.set })
						)
					),
					(warned) => {
						warned.forEach((row, at) => findings.set(indexes[at]!, row.findings ?? []));
					}
				)
			);
			return changes.map((change, index) => ({
				...change.set,
				findings: findings.get(index) ?? []
			}));
		}
	},
	effect: {
		created: function* (rows, ctx) {
			yield* tap(
				ctx,
				'create',
				{ collection: 'roster_entry', ids: rows.map((r) => r.id) },
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			yield* tap(
				ctx,
				'update',
				{ collection: 'roster_entry', ids: changes.map((c) => c.after.id) },
				changes
			);
		},
		deleted: function* (rows, ctx) {
			yield* tap(
				ctx,
				'delete',
				{ collection: 'roster_entry', ids: rows.map((r) => r.id) },
				rows.map((before) => ({ before }))
			);
		}
	},
	delete: {
		check: function* (rows, ctx) {
			yield* validateRegistered(
				ctx.db.query,
				'roster_entry',
				'delete',
				rows.map((row) => jsonObject(row))
			);
			if (rows.some((row) => row.payroll_run_id != null))
				return yield* ctx.refuse('This roster entry is locked by a payroll run.');
		}
	}
});
