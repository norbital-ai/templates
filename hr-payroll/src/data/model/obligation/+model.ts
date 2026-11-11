import { model } from '@norbital-ai/bolt';
import { tap } from '../../../lib/payroll_engine/taps.js';

export default model('obligation', {
	description: 'A free-form task or reminder raised by an event.',
	label: 'title',
	fields: {
		entity_id: { kind: 'ref', to: 'entity', inverse: 'obligations' },
		employee_id: { kind: 'ref', to: 'employee_profile', optional: true },
		employment_id: { kind: 'ref', to: 'employee_contract', optional: true },
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
				OPEN: {
					to: ['FULFILLED', 'WAIVED'],
					edit: ['title', 'due_on', 'fulfilled_on', 'evidence', 'waiver_reason', 'state']
				},
				FULFILLED: { to: [], edit: 'none' },
				// a waiver is taken back by reopening: the fact it answered stands again, or it was waived by mistake
				WAIVED: { to: ['OPEN'], edit: ['waiver_reason', 'state'] }
			}
		}
	},
	unique: [{ fields: ['occurrence_key'] }],
	read: {
		obligation: { fields: 'all' },
		'obligation.employee_id': { fields: ['name'] },
		'obligation.employment_id': { fields: ['employee_id'] },
		'obligation.entity_id': { fields: ['name'] }
	},
	create: {
		columns: {
			obligation: ['entity_id', 'employee_id', 'employment_id', 'title', 'due_on', 'occurrence_key']
		}
	},
	update: {
		columns: {
			obligation: ['title', 'due_on', 'fulfilled_on', 'evidence', 'waiver_reason', 'state']
		}
	},
	delete: {
		check: function* (rows, ctx) {
			if (rows.some((r) => r.state !== 'OPEN'))
				return yield* ctx.refuse('A completed task keeps its record.');
		}
	},
	effect: {
		updated: function* (changes, ctx) {
			const edited = changes.filter(
				({ before, after }) =>
					before.state !== after.state || before.fulfilled_on !== after.fulfilled_on
			);
			if (edited.length === 0) return;
			yield* tap(ctx, 'update', 'obligation', edited);
		}
	},
	notify: function* (event) {
		if (event.kind !== 'write' || event.action !== 'create') return [];
		return event.records
			.filter((row) => row.occurrence_key.startsWith('LOAN_RECOVERY:'))
			.map((row) => ({
				title: row.title,
				description: 'The final payroll cannot recover this loan in full. Chase the remainder.',
				to: [{ team: 'hr_controller' }, { team: 'manager_hr_controller' }] as const,
				once: row.occurrence_key
			}));
	}
});
