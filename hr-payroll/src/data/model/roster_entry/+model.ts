import { model } from '@norbital-ai/bolt';
import { jsonObject } from '../../../lib/payroll_engine/foundation.js';
import { validateRegistered } from '../../../lib/payroll_engine/registrations.js';
import { tap } from '../../../lib/payroll_engine/taps.js';
import { rosterFindings } from '../../../lib/payroll_engine/roster_warnings.js';
import { assertUnpriced } from '../../../lib/payroll_engine/pay_cycle.js';

const ARREARS = 'Pay what it missed with an arrears adhoc entry in the next run.';

export default model('roster_entry', {
	description:
		'One roster day: its planned overtime, whether that overtime is taken as time off, and actual worked intervals. The employment and payroll run lock are on the entry.',
	label: 'work_date',
	fields: {
		employment_id: { kind: 'ref', to: 'employee_contract', inverse: 'roster_entry' },
		payroll_run_id: { kind: 'ref', to: 'payroll_run', optional: true, onDelete: 'setNull' },
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
		overtime_as_time_off: {
			kind: 'bool',
			default: false,
			help: "The worker takes this day's planned overtime as time off: the run pays no overtime for it and owes its hours on the leave row that takes overtime as time off."
		},
		findings: { kind: 'json', default: [] },
		// Labour Code art.137(1): pregnancy has no consent exception; an infant under 12 months needs the day's consent.
		consent: {
			kind: 'json',
			optional: true,
			shape: {
				kind: 'object',
				fields: {
					night_work: { kind: 'bool' },
					overtime: { kind: 'bool' },
					reference: { kind: 'text' }
				}
			},
			help: 'The signed per-day consent for night work and overtime while raising a child under 12 months. Pregnancy never takes consent.'
		},
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
				'overtime_as_time_off',
				'actual_worked_intervals',
				'findings',
				'consent'
			]
		},
		transform: function* (rows, ctx) {
			yield* validateRegistered(
				ctx.db.query,
				'roster_entry',
				'create',
				rows.map((row) => jsonObject(row))
			);
			yield* assertUnpriced(
				ctx.db.query,
				rows.map((row) => ({ employment: row.employment_id, date: row.work_date })),
				ARREARS
			);
			const findings = yield* rosterFindings(
				ctx.db.query,
				rows.map((row) => jsonObject(row))
			);
			return rows.map((row, index) => ({ ...row, findings: findings[index] ?? [] }));
		}
	},
	update: {
		columns: {
			roster_entry: [
				'payroll_run_id',
				'work_date',
				'shift_definition_id',
				'planned_overtime_intervals',
				'overtime_as_time_off',
				'actual_worked_intervals',
				'findings',
				'consent'
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
			yield* assertUnpriced(
				ctx.db.query,
				changes.map(({ before, set }) => ({
					employment: before.employment_id,
					date: set.work_date ?? before.work_date
				})),
				ARREARS
			);
			const findings = yield* rosterFindings(
				ctx.db.query,
				changes.map((change) => jsonObject({ ...change.before, ...change.set }))
			);
			return changes.map((change, index) => ({
				...change.set,
				findings: findings[index] ?? []
			}));
		}
	},
	effect: {
		created: function* (rows, ctx) {
			yield* tap(
				ctx,
				'create',
				'roster_entry',
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			yield* tap(ctx, 'update', 'roster_entry', changes);
		},
		deleted: function* (rows, ctx) {
			yield* tap(
				ctx,
				'delete',
				'roster_entry',
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
