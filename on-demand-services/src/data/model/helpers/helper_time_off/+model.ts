import { model } from '@norbital-ai/bolt';
/** Days a helper is not available: leave, medical leave, anything else. */
export default model('helper_time_off', {
	description: 'A span of days a helper cannot take visits.',
	icon: 'lucide:calendar-off',
	record_label: "record.helper.name + ' · ' + string(record.period.from)",
	fields: {
		helper: { kind: 'ref', to: 'helpers', inverse: 'time_off', owned: true },
		period: { kind: 'period', of: 'date' },
		reason: { kind: 'enum', values: ['leave', 'medical', 'other'] }
	},
	constraints: { one_absence: { no_overlap: 'period', per: ['helper'] } },
	outputs: { default: { fields: 'all', helper: { fields: ['name'] } } },
	create: {
		fields: ['helper', 'period', 'reason'],
		effect: function* (_, ctx) {
			yield* ctx.schedule('publish_openings', {}, { key: 'publish_openings' });
		}
	},
	update: { fields: ['period', 'reason'] },
	delete: {}
});
