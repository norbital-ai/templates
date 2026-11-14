import { model } from '@norbital-ai/bolt';
import { tap } from '../../../lib/payroll_engine/taps.js';

export default model('obligation', {
	description: 'A free-form task or reminder raised by an event.',
	record_label: 'record.title',
	fields: {
		entity_id: { kind: 'ref', to: 'entity', inverse: 'obligations' },
		employee_id: { kind: 'ref', to: 'employee_profile', optional: true },
		employment_id: { kind: 'ref', to: 'employment', optional: true },
		title: { kind: 'text' },
		due_on: { kind: 'date', optional: true },
		fulfilled_on: { kind: 'date', optional: true },
		occurrence_key: { kind: 'text' },
		evidence: {
			kind: 'file',
			accept: ['application/pdf', 'image/*'],
			max: '20MiB',
			optional: true
		},
		waiver_reason: { kind: 'text', optional: true },
		state: {
			kind: 'state',
			initial: 'OPEN',
			states: {
				OPEN: { to: ['FULFILLED', 'WAIVED'] },
				FULFILLED: { to: [] },
				// a waiver is taken back by reopening: the fact it answered stands again, or it was waived by mistake
				WAIVED: { to: ['OPEN'] }
			}
		}
	},
	constraints: {
		// a task is raised once: an effect that raises one already on file keeps it (`obligation.import`)
		one_occurrence: { unique: ['occurrence_key'], import_key: true },
		// a completed task keeps its record; a waived one keeps only its reason and may reopen
		fulfilled_task: { locked: { state: { eq: 'FULFILLED' } } },
		waived_task: { locked: { state: { eq: 'WAIVED' } }, except: ['waiver_reason', 'state'] }
	},
	outputs: {
		default: {
			fields: 'all',
			employee_id: { fields: ['name'] },
			employment_id: { fields: ['employee_id'] },
			entity_id: { fields: ['name'] }
		}
	},
	create: {
		fields: ['entity_id', 'employee_id', 'employment_id', 'title', 'due_on', 'occurrence_key'],
		effect: function* (changes, ctx) {
			yield* ctx.notify(
				changes
					.map(({ after }) => after)
					.filter((row) => row.occurrence_key.startsWith('LOAN_RECOVERY:'))
					.map((row) => ({
						title: row.title,
						description: 'The final payroll cannot recover this loan in full. Chase the remainder.',
						to: [{ team: 'hr_controller' }, { team: 'manager_hr_controller' }],
						link: { model: 'obligation', id: row.id },
						once: row.occurrence_key
					}))
			);
		}
	},
	update: {
		fields: ['title', 'due_on', 'fulfilled_on', 'evidence', 'waiver_reason', 'state'],
		effect: function* (changes, ctx) {
			const edited = changes.filter((change) => change.changed('state', 'fulfilled_on'));
			if (edited.length === 0) return;
			yield* tap(ctx, 'update', 'obligation', edited);
		}
	},
	delete: {}
});
