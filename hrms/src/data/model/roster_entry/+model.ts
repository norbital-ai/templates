import { Effect } from 'effect';
import { model } from '../../../../.norbital/models/roster_entry.ts';
import { jsonObject } from '../../../lib/payroll_engine/foundation.js';
import { validateRegistered } from '../../../lib/payroll_engine/registrations.js';
import { tap } from '../../../lib/payroll_engine/taps.js';
import { rosterFindings } from '../../../lib/payroll_engine/roster_warnings.js';
import { amendmentsFor } from '../../../lib/amendments.js';

/** The day a roster entry prices, and the run that priced it: a paid period holding it is worked out again. */
const touched = (
	rows: readonly {
		readonly employment_id: string;
		readonly work_date: string;
		readonly payroll_run_id?: string | null | undefined;
	}[]
) =>
	rows.map((row) => ({
		employment: String(row.employment_id),
		from: String(row.work_date),
		run: row.payroll_run_id ?? null
	}));

export default model({
	description:
		'One roster day: its planned overtime, whether that overtime is taken as time off, and actual worked intervals. It is priced under the contract version in force on its date; the run that priced it is on the entry.',
	record_label:
		"(has(record.employment_id.employee_number) ? record.employment_id.employee_number + ' · ' : '') + string(record.work_date)",
	fields: {
		employment_id: { kind: 'ref', to: 'employment', inverse: 'roster_entry' },
		payroll_run_id: {
			kind: 'ref',
			to: 'payroll_run',
			// the run that priced the day links it through this layer
			inverse: 'roster_entry',
			optional: true,
			on_delete: 'set_null'
		},
		work_date: { kind: 'date' },
		shift_definition_id: {
			kind: 'ref',
			to: 'shift_definition',
			optional: true,
			on_delete: 'restrict'
		},
		planned_overtime_intervals: {
			kind: 'object',
			many: true,
			optional: true,
			fields: {
				start: { kind: 'instant' },
				end: { kind: 'instant' },
				break_minutes: { kind: 'number', min: 0, optional: true },
				breaks: {
					kind: 'object',
					many: true,
					optional: true,
					fields: { start: { kind: 'instant' }, end: { kind: 'instant' } }
				}
			}
		},
		overtime_as_time_off: { kind: 'bool', default: false },
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
			}
		},
		actual_worked_intervals: {
			was: 'worked_intervals',
			kind: 'object',
			many: true,
			optional: true,
			fields: {
				start: { kind: 'instant' },
				end: { kind: 'instant', optional: true },
				break_minutes: { kind: 'number', min: 0, optional: true },
				breaks: {
					kind: 'object',
					many: true,
					optional: true,
					fields: { start: { kind: 'instant' }, end: { kind: 'instant' } }
				}
			}
		}
	},
	constraints: { one_day: { unique: ['employment_id', 'work_date'], import_key: true } },
	outputs: {
		default: {
			fields: 'all',
			employment_id: { fields: 'all' },
			shift_definition_id: { fields: 'all' },
			payroll_run_id: { fields: 'all' }
		},
		kiosk: { fields: ['employment_id', 'work_date', 'actual_worked_intervals', 'payroll_run_id'] }
	},
	create: {
		columns: {
			fields: [
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
		transform: function* (changes, ctx) {
			const rows = changes.map(({ set }) => set);
			yield* validateRegistered(
				ctx.query,
				'roster_entry',
				'create',
				rows.map((row) => jsonObject(row))
			);
			const findings = yield* rosterFindings(
				ctx.query,
				rows.map((row) => jsonObject(row))
			);
			return {
				sets: rows.map((row, index) => ({ ...row, findings: findings[index] ?? [] })),
				on_approved: yield* amendmentsFor(ctx.query, touched(rows))
			};
		},
		effect: function* (changes, ctx) {
			yield* tap(
				ctx,
				'create',
				'roster_entry',
				changes.map(({ after }) => ({ after }))
			);
		}
	},
	update: {
		columns: {
			fields: [
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
				ctx.query,
				'roster_entry',
				'update',
				changes.map((change) => jsonObject(change.after))
			);
			const findings = yield* rosterFindings(
				ctx.query,
				changes.map((change) => jsonObject(change.after))
			);
			return {
				sets: changes.map((change, index) => ({
					...change.set,
					// a day that moves leaves the run that priced it: the period it joins prices it, and seals it
					...(change.before.payroll_run_id != null && change.changed('work_date')
						? { payroll_run_id: null }
						: {}),
					findings: findings[index] ?? []
				})),
				// a day that moves touches the period it left and the period it joined
				on_approved: yield* amendmentsFor(ctx.query, [
					...touched(changes.map((change) => change.before)),
					...touched(changes.map((change) => change.after))
				])
			};
		},
		effect: function* (changes, ctx) {
			yield* tap(ctx, 'update', 'roster_entry', changes);
		}
	},
	delete: {
		transform: function* (changes, ctx) {
			const rows = changes.map(({ before }) => before);
			yield* validateRegistered(
				ctx.query,
				'roster_entry',
				'delete',
				rows.map((row) => jsonObject(row))
			).pipe(
				Effect.catchTag('Refusal', (error) =>
					ctx.refuse('errors.payroll_refused', { values: { message: error.message } })
				)
			);
			// a deleted day is not a day off: the shift pattern takes over, and a paid period is worked out again
			return { on_approved: yield* amendmentsFor(ctx.query, touched(rows)) };
		},
		effect: function* (changes, ctx) {
			yield* tap(
				ctx,
				'delete',
				'roster_entry',
				changes.map(({ before }) => ({ before }))
			);
		}
	}
});
