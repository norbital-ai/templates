import { model } from '@norbital-ai/bolt';
import { tap } from '../../../../lib/payroll_engine/taps.js';

export default model('payslip', {
	description:
		'Per-employee payroll totals, read-only once written. Financial detail is recomputed from the subtotal chain, catalogue entries and ledger.',
	record_label:
		"(has(record.employee_id.name) ? record.employee_id.name + ' · ' : '') + (record.period != null ? record.period : '')",
	fields: {
		payroll_run_id: {
			kind: 'ref',
			to: 'payroll_run',
			inverse: 'payslips',
			on_delete: 'cascade'
		},
		employee_id: { kind: 'ref', to: 'employee_profile', inverse: 'payslips' },
		employment_id: { kind: 'ref', to: 'employment', inverse: 'payslips' },
		entity_id: { kind: 'ref', to: 'entity' },
		basic_earnings: { kind: 'decimal', scale: 12, optional: true },
		gross_earnings: { kind: 'decimal', scale: 12, optional: true },
		net_pay: { kind: 'decimal', scale: 12 },
		total_deductions: { kind: 'decimal', scale: 12, min: 0 },
		employer_cost: { kind: 'decimal', scale: 12, min: 0, default: 0 },
		period: { kind: 'text', optional: true },
		ordinary_wages: { kind: 'decimal', scale: 12, min: 0, default: 0 },
		employee_statutory: { kind: 'decimal', scale: 12, min: 0, default: 0 },
		tax_withheld: { kind: 'decimal', scale: 12, min: 0, default: 0 },
		breakdown: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			default: {}
		}
	},
	constraints: { run_person: { unique: ['payroll_run_id', 'employee_id', 'entity_id'] } },
	outputs: {
		default: {
			fields: 'all',
			employment_id: {
				fields: 'all',
				employee_id: { fields: ['name', 'identity_number'] },
				terms: { fields: 'all' }
			},
			employee_id: { fields: ['name', 'user_id'] },
			payroll_run_id: { fields: 'all' },
			// the payslip's law and currency are those of its company's jurisdiction
			entity_id: { fields: ['settings_code'] }
		}
	},
	create: {
		fields: [
			'payroll_run_id',
			'employee_id',
			'employment_id',
			'entity_id',
			'basic_earnings',
			'gross_earnings',
			'net_pay',
			'total_deductions',
			'employer_cost',
			'period',
			'ordinary_wages',
			'employee_statutory',
			'tax_withheld',
			'breakdown'
		],
		effect: function* (changes, ctx) {
			yield* tap(
				ctx,
				'create',
				'payslip',
				changes.map(({ after }) => ({ after }))
			);
		}
	}
});
