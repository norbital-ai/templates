import { model } from '@norbital-ai/bolt';

/** Calendar days a provider is unavailable: vacation, sick leave, or blocked dates. */
export default model('provider_time_off', {
	was: 'helper_time_off',
	description: 'A date span when a provider cannot accept appointments.',
	icon: 'lucide:calendar-off',
	record_label: "record.provider.name + ' · ' + string(record.period.from)",
	fields: {
		provider: { kind: 'ref', to: 'providers', inverse: 'time_off', owned: true },
		period: { kind: 'period', of: 'date' },
		reason: { kind: 'enum', values: ['leave', 'sick', 'unavailable'] }
	},
	constraints: { one_absence: { no_overlap: 'period', per: ['provider'] } },
	outputs: { default: { fields: 'all', provider: { fields: ['name'] } } },
	create: {
		fields: ['provider', 'period', 'reason'],
		effect: function* (_, ctx) {
			yield* ctx.schedule('publish_openings', {}, { key: 'publish_openings' });
		}
	},
	update: {
		fields: ['period', 'reason'],
		effect: function* (_, ctx) {
			yield* ctx.schedule('publish_openings', {}, { key: 'publish_openings' });
		}
	},
	delete: {
		effect: function* (_, ctx) {
			yield* ctx.schedule('publish_openings', {}, { key: 'publish_openings' });
		}
	}
});
