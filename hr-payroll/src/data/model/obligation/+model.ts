import { model } from '@norbital-ai/bolt';
import { currency } from '@norbital-ai/std/decimal';

export default model('obligation', {
	description:
		'One money liability of an entity to an authority: a remittance of the statutory contributions or taxes a payroll run charged, its amount (the named schemes’ employee and employer lines of the run’s payslips), its due day, and how it was closed — settled with its evidence, or waived with a reason. Non-money duties are regulatory tasks.',
	icon: 'lucide:landmark',
	label: 'duty_code',
	fields: {
		duty_code: {
			kind: 'text'
		},
		references: {
			kind: 'custom',
			of: 'references',
			optional: true
		},
		occurrence_key: {
			kind: 'text',
			optional: true,
			help: 'The duty and the run that raised it; one obligation per occurrence.'
		},
		trigger_ref: {
			kind: 'text',
			help: 'The payroll run that raised it.'
		},
		triggered_on: {
			kind: 'date'
		},
		due_on: {
			kind: 'date'
		},
		currency: {
			kind: 'currency',
			optional: true,
			help: 'The payroll currency of the version that raised it; the amounts are in it.'
		},
		amount_due: {
			kind: 'money',
			currency: 'currency',
			optional: true
		},
		amount_settled: {
			kind: 'money',
			currency: 'currency',
			optional: true
		},
		state: {
			kind: 'enum',
			values: ['OPEN', 'FULFILLED', 'WAIVED'],
			default: 'OPEN'
		},
		fulfilled_on: {
			kind: 'date',
			optional: true
		},
		waive_reason: {
			kind: 'text',
			optional: true
		},
		reference: {
			kind: 'text',
			optional: true
		},
		evidence_file: {
			kind: 'file',
			accept: ['*/*'],
			max: '20MiB',
			optional: true
		},
		facts: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			default: {}
		},
		company_id: {
			kind: 'ref',
			to: 'entity',
			inverse: 'obligation',
			owned: true
		},
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'obligation'
		}
	},
	read: 'all',
	create: {
		columns: {
			obligation: [
				'duty_code',
				'references',
				'occurrence_key',
				'trigger_ref',
				'triggered_on',
				'due_on',
				'amount_due',
				'amount_settled',
				'state',
				'fulfilled_on',
				'waive_reason',
				'reference',
				'evidence_file',
				'facts',
				'company_id',
				'settings_id'
			]
		},
		// The amounts are money in the raising version's payroll currency, so a new obligation takes that currency.
		transform: function* (rows, ctx) {
			const {
				jurisdiction_settings: { rows: versions }
			} = yield* ctx.db.query({
				jurisdiction_settings: {
					where: { id: { in: [...new Set(rows.map((row) => row.settings_id))] } },
					fields: ['payroll']
				}
			});
			const currencyOf = new Map(
				versions.map((row) => [
					row.id,
					row.payroll?.currency ? currency(row.payroll.currency) : null
				])
			);
			return rows.map((row) => ({
				...row,
				currency: currencyOf.get(row.settings_id) ?? null
			}));
		}
	},
	update: {
		columns: {
			obligation: [
				'due_on',
				'amount_due',
				'amount_settled',
				'state',
				'fulfilled_on',
				'waive_reason',
				'reference',
				'evidence_file',
				'facts'
			]
		}
	},
	delete: {
		// an open obligation is withdrawn when the run that raised it is deleted (`payroll_run_bookkeeping`); a settled or
		// waived one stays
		check: function* (rows, ctx) {
			const row = rows.findIndex((held) => held.state !== 'OPEN');
			if (row >= 0)
				return yield* ctx.refuse(
					'Only an open obligation is withdrawn; a settled or waived one stays.',
					{ row }
				);
		}
	}
});
