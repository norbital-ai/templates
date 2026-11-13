import { model } from '../../../../.norbital/models/jurisdiction.ts';
import { paidUnder } from '../../../lib/amendments.js';

export default model({
	description:
		'One body of law a company answers to: its code, currency, time zone and tax year. What the law says on a day is its dated changes, applied oldest first.',
	icon: 'lucide:scale',
	record_label: 'record.name',
	fields: {
		code: { kind: 'text' },
		name: { kind: 'text' },
		currency: { kind: 'currency' },
		timezone: { kind: 'text', format: 'zone' },
		tax_year_start_month: { kind: 'int', min: 1, max: 12 }
	},
	constraints: { code: { unique: ['code'] } },
	outputs: {
		default: { fields: 'all' },
		kiosk: { fields: ['code', 'name', 'timezone'] }
	},
	create: {
		columns: { fields: ['code', 'name', 'currency', 'timezone', 'tax_year_start_month'] }
	},
	update: {
		columns: { fields: ['name', 'currency', 'timezone', 'tax_year_start_month'] },
		transform: function* (changes, ctx) {
			// what paid periods were worked out in keeps its shape: their currency, their days and their tax year
			const moved = changes.filter(
				({ before, after }) =>
					after.currency !== before.currency ||
					after.timezone !== before.timezone ||
					after.tax_year_start_month !== before.tax_year_start_month
			);
			if (
				moved.length > 0 &&
				(yield* paidUnder(ctx.query, {
					entity_id: { is: { settings_code: { in: moved.map(({ before }) => before.code) } } }
				}))
			)
				return yield* ctx.refuse('errors.jurisdiction_paid_keeps');
			return changes.map(({ set }) => set);
		}
	}
});
