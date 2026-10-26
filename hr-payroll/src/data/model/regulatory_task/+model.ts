import { model } from '@norbital-ai/bolt';

export default model('regulatory_task', {
	description:
		'One non-money regulatory duty of an entity — a filing, registration, notification, certificate or report — raised by a row event under the jurisdiction version in force: the row that triggered it, its due day, and how it was closed — done with its evidence, or dismissed with a reason.',
	icon: 'lucide:clipboard-check',
	label: 'title',
	fields: {
		code: {
			kind: 'text'
		},
		title: {
			kind: 'text'
		},
		references: {
			kind: 'custom',
			of: 'references',
			optional: true
		},
		subject_collection: {
			kind: 'text',
			help: 'The collection of the row that triggered the duty.'
		},
		subject_id: {
			kind: 'text'
		},
		trigger_ref: {
			kind: 'text'
		},
		triggered_on: {
			kind: 'date'
		},
		due_on: {
			kind: 'date'
		},
		state: {
			kind: 'enum',
			values: ['OPEN', 'DONE', 'DISMISSED'],
			default: 'OPEN'
		},
		done_on: {
			kind: 'date',
			optional: true
		},
		dismiss_reason: {
			kind: 'text',
			optional: true
		},
		evidence_file: {
			kind: 'file',
			accept: ['*/*'],
			max: '20MiB',
			optional: true
		},
		occurrence_key: {
			kind: 'text',
			help: 'The duty and its occurrence; one task per occurrence.'
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
			inverse: 'regulatory_task',
			owned: true
		},
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'regulatory_task'
		}
	},
	read: 'all',
	create: {
		columns: [
			'code',
			'title',
			'references',
			'subject_collection',
			'subject_id',
			'trigger_ref',
			'triggered_on',
			'due_on',
			'state',
			'done_on',
			'dismiss_reason',
			'evidence_file',
			'occurrence_key',
			'facts',
			'company_id',
			'settings_id'
		]
	},
	// `occurrence_key` moves when a duty is withdrawn (its exit moved or undone), so the exit as it now stands raises anew.
	update: {
		columns: [
			'occurrence_key',
			'due_on',
			'state',
			'done_on',
			'dismiss_reason',
			'evidence_file',
			'facts'
		]
	}
});
