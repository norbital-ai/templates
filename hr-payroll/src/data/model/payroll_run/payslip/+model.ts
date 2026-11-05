import { model } from '@norbital-ai/bolt';
import { tap } from '../../../../lib/payroll_engine/taps.js';

export default model('payslip', {
	description:
		'Per-employee payroll totals, read-only once written. Financial detail is recomputed from the subtotal chain, catalogue entries and ledger.',
	record_label: 'string(record.net_pay)',
	fields: {
		payroll_run_id: {
			kind: 'ref',
			to: 'payroll_run',
			inverse: 'payslips',
			onDelete: 'cascade'
		},
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			onDelete: 'restrict'
		},
		employee_id: { kind: 'ref', to: 'employee_profile', inverse: 'payslips' },
		employment_id: { kind: 'ref', to: 'employee_contract', inverse: 'payslips' },
		entity_id: { kind: 'ref', to: 'entity' },
		basic_earnings: { kind: 'decimal', scale: 12, optional: true },
		gross_earnings: { kind: 'decimal', scale: 12, optional: true },
		net_pay: { kind: 'decimal', scale: 12 },
		total_deductions: { kind: 'decimal', scale: 12, min: 0 },
		employer_cost: { kind: 'decimal', scale: 12, min: 0, default: 0 },
		period: { kind: 'text', optional: true },
		ordinary_wages: { kind: 'decimal', scale: 12, min: 0, default: 0 },
		additional_wages: { kind: 'decimal', scale: 12, min: 0, default: 0 },
		employee_statutory: { kind: 'decimal', scale: 12, min: 0, default: 0 },
		employer_statutory: { kind: 'decimal', scale: 12, min: 0, default: 0 },
		tax_withheld: { kind: 'decimal', scale: 12, min: 0, default: 0 },
		breakdown: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			default: {}
		}
	},
	unique: [{ fields: ['payroll_run_id', 'employee_id', 'entity_id'] }],
	read: {
		payslip: { fields: 'all' },
		'payslip.employment_id': { fields: 'all' },
		'payslip.employee_id': { fields: ['name', 'user_id'] },
		'payslip.payroll_run_id': { fields: 'all' },
		'payslip.settings_id': { fields: ['code', 'currency'] }
	},
	create: {
		columns: {
			payslip: [
				'payroll_run_id',
				'settings_id',
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
				'additional_wages',
				'employee_statutory',
				'employer_statutory',
				'tax_withheld',
				'breakdown'
			]
		}
	},
	effect: {
		created: function* (rows, ctx) {
			yield* tap(
				ctx,
				'create',
				{ collection: 'payslip', ids: rows.map((row) => row.id) },
				rows.map((after) => ({ after }))
			);
		}
	}
});
