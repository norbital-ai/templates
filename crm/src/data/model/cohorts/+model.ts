import { model } from '@norbital-ai/bolt';

/**
 * A batch of cold leads sent one sequence together through Apollo. It is drafted (members added), `launch_cohort`
 * pushes the sequence's steps to its Apollo sequence (`apollo_sequence_id`, created when empty), sets each member's
 * rendered projects on their Apollo contact and enrols them; `sync_cohort` brings their progress back. Marking it done
 * releases its leads for another cohort. The counts roll up from its members.
 */
export default model('cohorts', {
	description: 'A batch of leads sent one outreach sequence through Apollo.',
	icon: 'lucide:users-round',
	record_label: 'record.name',
	fields: {
		name: { kind: 'text' },
		sequence: { kind: 'ref', to: 'sequences', inverse: 'cohorts' },
		status: {
			kind: 'state',
			initial: 'draft',
			states: {
				draft: { to: ['launched', 'done'] },
				launched: { to: ['done'], stamp: 'launched_at' },
				done: { stamp: 'done_at' }
			}
		},
		launched_at: { kind: 'instant', optional: true },
		done_at: { kind: 'instant', optional: true },
		apollo_sequence_id: { kind: 'text', optional: true },
		synced_at: { kind: 'instant', optional: true },
		member_count: { kind: 'count', of: 'members' },
		replied_count: { kind: 'count', of: 'members', where: { replied: { eq: true } } },
		meeting_count: { kind: 'count', of: 'members', where: { meeting_booked: { eq: true } } },
		stopped_count: { kind: 'count', of: 'members', where: { stopped: { is_null: false } } }
	},
	constraints: {
		// a launched cohort keeps the sequence its members were sent
		sent: { locked: { status: { ne: 'draft' } }, except: ['name', 'status', 'synced_at'] }
	},
	indexes: { find: { text: ['name'] } },
	outputs: { default: { fields: 'all', sequence: { fields: ['name', 'steps'] } } },
	create: { fields: ['name', 'sequence', 'apollo_sequence_id'] },
	update: {
		fields: ['name', 'sequence', 'apollo_sequence_id', 'status', 'synced_at'],
		// a finished cohort releases its leads: their memberships stop counting as active
		transform: function* (changes, ctx) {
			const done = changes.flatMap((change) =>
				change.changed('status') && change.after.status === 'done' ? [change.after.id] : []
			);
			const sets = changes.map(({ set }) => set);
			if (done.length === 0) return sets;
			const members = (yield* ctx.query({
				cohort_members: {
					where: { cohort: { in: done }, active: { eq: true } },
					fields: ['revision']
				}
			})).cohort_members.rows;
			return {
				sets,
				with: {
					cohort_members: {
						update: members.map((row) => ({
							target: { id: row.id, revision: row.revision },
							set: { active: false }
						}))
					}
				}
			};
		}
	},
	delete: {}
});
