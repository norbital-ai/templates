import { model } from '@norbital-ai/bolt';

export default model('statutory_source', {
	description:
		'One official place research reads for a jurisdiction, for one catalogue family or for all of it. It outlives versions: research proposes new and moved sources, a person activates them, and each run stamps what it checked.',
	label: 'title',
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
				PROPOSED: { to: ['ACTIVE', 'RETIRED'], edit: 'all' },
				ACTIVE: { to: ['RETIRED'], edit: 'all' },
				RETIRED: { to: ['ACTIVE'], edit: ['status', 'notes'] }
			}
		},
		last_checked_on: { kind: 'date', optional: true },
		research_run_id: { kind: 'text', optional: true },
		notes: { kind: 'text', optional: true }
	},
	unique: [{ fields: ['jurisdiction_code', 'url'] }],
	read: { statutory_source: { fields: 'all' } },
	create: {
		columns: {
			statutory_source: [
				'jurisdiction_code',
				'family',
				'title',
				'url',
				'origin',
				'replaces_url',
				'research_run_id',
				'notes'
			]
		}
	},
	update: {
		columns: {
			statutory_source: ['family', 'title', 'url', 'status', 'notes', 'last_checked_on']
		},
		transform: function* (changes, ctx) {
			if (
				ctx.actor.kind !== 'member' &&
				changes.some(
					({ before, set }) =>
						set.status === 'ACTIVE' && before.status !== 'ACTIVE' && before.origin === 'AGENT'
				)
			)
				return yield* ctx.refuse('A person activates a source research proposes.');
			return changes.map(({ set }) => set);
		}
	}
});
