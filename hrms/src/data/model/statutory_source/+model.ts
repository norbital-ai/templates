import { model } from '@norbital-ai/bolt';

export default model('statutory_source', {
	description:
		'One official place research reads for a jurisdiction, for one catalogue family or for all of it. It outlives versions: research proposes new and moved sources, a person activates them, and each run stamps what it checked.',
	record_label: 'record.title',
	fields: {
		jurisdiction_code: { kind: 'text' },
		family: { kind: 'text', optional: true },
		title: { kind: 'text' },
		url: { kind: 'text', format: 'url' },
		origin: { kind: 'enum', values: ['REFERENCE', 'AGENT', 'PERSON'], default: 'PERSON' },
		replaces_url: { kind: 'text', format: 'url', optional: true },
		status: {
			kind: 'state',
			initial: 'PROPOSED',
			states: {
				PROPOSED: { to: ['ACTIVE', 'RETIRED'] },
				ACTIVE: { to: ['RETIRED'] },
				RETIRED: { to: ['ACTIVE'] }
			}
		},
		last_checked_on: { kind: 'date', optional: true },
		research_run_id: { kind: 'text', optional: true },
		notes: { kind: 'text', optional: true }
	},
	constraints: {
		source_url: { unique: ['jurisdiction_code', 'url'] },
		retired_source: { locked: { status: { eq: 'RETIRED' } }, except: ['status', 'notes'] }
	},
	outputs: { default: { fields: 'all' } },
	create: {
		fields: [
			'jurisdiction_code',
			'family',
			'title',
			'url',
			'origin',
			'replaces_url',
			'research_run_id',
			'notes'
		]
	},
	update: {
		fields: ['family', 'title', 'url', 'status', 'notes', 'last_checked_on'],
		transform: function* (changes, ctx) {
			const row = changes.findIndex(
				(change) =>
					change.changed('status') &&
					change.after.status === 'ACTIVE' &&
					change.before.origin === 'AGENT'
			);
			if (ctx.actor.kind !== 'member' && row >= 0)
				return yield* ctx.refuse('errors.statutory_source_person_activates', { row });
			return changes.map(({ set }) => set);
		}
	}
});
