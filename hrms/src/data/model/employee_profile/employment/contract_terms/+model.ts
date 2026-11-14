import { model } from '../../../../../../.norbital/models/contract_terms.ts';
import { TERM_FIELDS } from '../../../../../lib/person.js';
import { idOf } from '../../../../../lib/payroll_engine/reads.js';
import { afterDated, datedWrite } from '../+model.js';

const named = (clears: readonly string[] | null | undefined) =>
	(clears ?? []).every((name) => TERM_FIELDS.some((field) => field === name));

export default model({
	description:
		'One dated change to what was agreed with a person in a stint: from its date, the terms it holds are now these. A term left empty is unchanged; one named in clears is taken away. A change is dated the first of a month, or the stint’s first day, and may be edited, moved or deleted.',
	icon: 'lucide:file-text',
	record_label: 'record.effective_from',
	fields: {
		employment_id: { kind: 'ref', to: 'employment', inverse: 'terms', on_delete: 'cascade' },
		effective_from: { kind: 'date' },
		/** A change signed after a period's pay date does not apply to that period; the signing month pays it back. */
		signed_on: { kind: 'date', optional: true },
		engagement: {
			kind: 'enum',
			optional: true,
			values: ['EMPLOYEE', 'PART_TIME', 'CONTRACTOR', 'INTERN', 'APPRENTICE', 'CONSULTANT', 'PAYEE']
		},
		// the payroll this person is paid in; a company with one group fills it in on a stint's first terms
		pay_group_id: {
			kind: 'ref',
			to: 'pay_group',
			inverse: 'contract_terms',
			optional: true,
			on_delete: 'restrict'
		},
		signed_contract_period: { kind: 'period', of: 'date', optional: true },
		probation_period: { kind: 'period', of: 'date', optional: true },
		/** The agreed rate: exactly one basis, and its amount. */
		rate: {
			kind: 'json',
			optional: true,
			shape: {
				kind: 'union',
				by: 'unit',
				arms: {
					MONTHLY: { amount: { kind: 'number', min: 0 } },
					DAILY: { amount: { kind: 'number', min: 0 } },
					HOURLY: { amount: { kind: 'number', min: 0 } }
				}
			}
		},
		normal_hours_per_day: { kind: 'json', shape: { kind: 'number', min: 0 }, optional: true },
		normal_hours_per_week: { kind: 'json', shape: { kind: 'number', min: 0 }, optional: true },
		normal_days_per_week: {
			kind: 'json',
			shape: { kind: 'number', min: 0, max: 7 },
			optional: true
		},
		employer_bears_income_tax: { kind: 'bool', optional: true },
		employee_borne_tax_items: { kind: 'text', many: true, optional: true },
		job_title: { kind: 'text', optional: true },
		department: { kind: 'text', optional: true },
		statutory_work_category: { kind: 'text', optional: true },
		work_classification: { kind: 'text', optional: true },
		work_region: { kind: 'text', optional: true },
		worksite: { kind: 'text', optional: true },
		shift_pattern_id: { kind: 'ref', to: 'shift_pattern', optional: true },
		notice_period: {
			kind: 'object',
			optional: true,
			fields: {
				value: { kind: 'number', min: 0 },
				unit: { kind: 'enum', values: ['DAYS', 'WEEKS', 'MONTHS'] }
			}
		},
		annual_leave_carry_limit_days: {
			kind: 'json',
			shape: { kind: 'number', min: 0 },
			optional: true
		},
		wage_payment_method: {
			kind: 'enum',
			values: ['BANK', 'CASH', 'CHEQUE', 'DIGITAL'],
			optional: true
		},
		allowances: {
			kind: 'json',
			optional: true,
			shape: {
				kind: 'record',
				of: { kind: 'object', fields: { amount: { kind: 'number', min: 0 } } }
			}
		},
		/** The terms above taken away from this date. */
		clears: { kind: 'text', many: true, optional: true }
	},
	constraints: { one_change: { unique: ['employment_id', 'effective_from'] } },
	outputs: {
		default: {
			fields: 'all',
			// a read reaches a stint's rows through the stint, its person and its company
			employment_id: {
				fields: 'all',
				employee_id: { fields: 'all', employment: { fields: 'all' } },
				entity_id: { fields: 'all' }
			}
		}
	},
	// every write is checked on the stint it leaves, on its date and at every later change, and carries the amendment
	// rows of the paid periods it reaches
	create: {
		columns: { fields: ['employment_id', 'effective_from', 'signed_on', ...TERM_FIELDS, 'clears'] },
		transform: function* (changes, ctx) {
			const unknown = changes.findIndex(({ after }) => !named(after.clears));
			if (unknown >= 0)
				return yield* ctx.refuse('errors.contract_terms_clears', { row: unknown, field: 'clears' });
			const { filled, carried } = yield* datedWrite(ctx, 'create', 'contract_terms', changes);
			return {
				sets: changes.map(({ set, after }) => {
					const group = filled.get(String(after.id));
					return group === undefined ? set : { ...set, pay_group_id: idOf('pay_group', group) };
				}),
				on_approved: carried
			};
		},
		effect: function* (changes, ctx) {
			yield* afterDated(ctx, 'create', 'contract_terms', changes);
		}
	},
	update: {
		columns: { fields: ['effective_from', 'signed_on', ...TERM_FIELDS, 'clears'] },
		transform: function* (changes, ctx) {
			// a stint whose first day moves carries its first rows along: it checked itself with them moved, and its own
			// reach holds the days between
			if (ctx.carried_by === 'employment') return changes.map(({ set }) => set);
			const unknown = changes.findIndex(({ after }) => !named(after.clears));
			if (unknown >= 0)
				return yield* ctx.refuse('errors.contract_terms_clears', { row: unknown, field: 'clears' });
			const { carried } = yield* datedWrite(ctx, 'update', 'contract_terms', changes);
			return { sets: changes.map(({ set }) => set), on_approved: carried };
		},
		effect: function* (changes, ctx) {
			yield* afterDated(ctx, 'update', 'contract_terms', changes);
		}
	},
	delete: {
		transform: function* (changes, ctx) {
			const { carried } = yield* datedWrite(ctx, 'delete', 'contract_terms', changes);
			return { on_approved: carried };
		},
		effect: function* (changes, ctx) {
			yield* afterDated(ctx, 'delete', 'contract_terms', changes);
		}
	}
});
