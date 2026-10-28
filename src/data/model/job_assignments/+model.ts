import { model, type WorkspaceQuery } from '@norbital-ai/bolt';
import * as Effect from 'effect/Effect';
import { dispatchFacts, memberByContact } from '../../../lib/dispatch.js';
const contacted = (contact: string | null | undefined) => (contact?.trim() ?? '') !== '';
/** The members a batch's contacts may name, in one read (none when no row names a contact). */
// ponytail: reads every member's email and phone; filter by contact key once membership nears the read limit
const membersFor = Effect.fnUntraced(function* (
	db: WorkspaceQuery,
	contacts: readonly (string | null | undefined)[]
) {
	if (!contacts.some((contact) => contacted(contact))) return [];
	const { sys_user } = yield* db.query({ sys_user: { fields: ['email', 'phone'] } });
	return sys_user.rows;
});
const progress = [
	'site_id',
	'title',
	'nature',
	'scheduled_for',
	'description',
	'assignee_contact',
	'assignee_user_id',
	'dispatched_at',
	'status',
	'completed_at',
	'amount_charged',
	'location',
	'location_address',
	'summary'
] as const;
/**
 * The work order and its dispatch in one row: pending until completed, dispatched by linking the contractor who holds
 * it. `status` is where the work got to; findings about it live in `suspicious_activity_logs`, so a suspicion never
 * erases progress. A contractor's email or phone number (`assignee_contact`) links the member it names; a contact no
 * member holds leaves the job without a contractor, which the board shows as a warning, never as a status.
 *
 * A work order names its site and day and may carry the dispatch system's reference and the WhatsApp message it came
 * from; those identity keys are create-only. Naming a contractor is the dispatch. A WhatsApp report lands as one update:
 * the progress, the photos it carried and the messages that are this job's slice of the conversation (each child's own
 * create callback stamps it). `suspicion_checked_at` is the review's stamp; any other change clears it, so the review
 * judges the job again.
 */
export default model('job_assignments', {
	description:
		'One dispatched day job: the work order, who holds it and where it got to. Evidence facts and suspicion judgements live in their own models.',
	icon: 'lucide:clipboard-check',
	label: 'title',
	fields: {
		site_id: { kind: 'ref', to: 'sites', inverse: 'job_assignments' },
		/** The contractor holding the work: a member whose team holds `field_ops_contractor`, not a record. */
		assignee_user_id: { kind: 'ref', to: 'sys_user', optional: true },
		/** The contractor's email or phone number as entered; the write callbacks link the member it names. */
		assignee_contact: { kind: 'text', optional: true },
		/** The dispatch system's reference, when an imported sheet carries one; a sheet imported twice files once. */
		external_ref: { kind: 'text', optional: true, unique: true },
		title: { kind: 'text' },
		nature: { kind: 'text', optional: true },
		scheduled_for: { kind: 'date' },
		description: { kind: 'text' },
		dispatched_at: { kind: 'instant', optional: true },
		status: {
			kind: 'enum',
			values: ['pending', 'completed'],
			default: 'pending'
		},
		completed_at: { kind: 'instant', optional: true },
		amount_charged: { kind: 'money', optional: true },
		/** Where the contractor reported the work from. */
		location: { kind: 'point', optional: true },
		location_address: { kind: 'text', optional: true },
		summary: { kind: 'text', optional: true },
		/** The WhatsApp message a job came from; retries of one delivery file it once. */
		source_message_id: { kind: 'text', optional: true, unique: true, hidden: true },
		/** Written by the suspicion review only; any other change clears it. */
		suspicion_checked_at: { kind: 'instant', optional: true, hidden: true }
	},
	index: ['scheduled_for', 'suspicion_checked_at'],
	search: {
		// `site_id` matches the site's own search text (name, address, unit, code, client); `external_ref` stays out, as
		// the contractor's grant masks it and a masked field refuses the search
		text: ['title', 'nature', 'summary', 'site_id'],
		// `/semantic` in the jobs search box: the work described, on the host's default embedding model. `dim` is the width
		// of the `bolt_embedding` column every job's vector and every probe are read at, so the host's model must honour it.
		semantic: { fields: ['title', 'description', 'summary'], model: 'default', dim: 1536 }
	},
	read: {
		job_assignments: { fields: 'all' },
		/** The photos filed on a job: so a reader (a controller, the WhatsApp envoy) sees what was sent for it. */
		'job_assignments.photo_evidence': { fields: ['photo', 'summary', 'flags', 'created_at'] },
		'job_assignments.site_id': {
			fields: ['name', 'address', 'unit_number', 'site_code', 'client_name', 'site_key']
		}
	},
	create: {
		columns: { job_assignments: ['external_ref', ...progress, 'source_message_id'] },
		transform: function* (rows, ctx) {
			const members = yield* membersFor(
				ctx.db,
				rows.map((row) => row.assignee_contact)
			);
			return rows.map((row) => {
				const linked = contacted(row.assignee_contact)
					? { ...row, assignee_user_id: memberByContact(members, row.assignee_contact) }
					: row;
				return { ...linked, ...dispatchFacts(linked, ctx.now) };
			});
		}
	},
	update: {
		columns: {
			job_assignments: [...progress, 'suspicion_checked_at'],
			'job_assignments.photo_evidence': ['photo', 'source'],
			'job_assignments.communication_logs': ['message', 'sent_at', 'sender', 'source_message_id']
		},
		transform: function* (changes, ctx) {
			// a report files photos and messages; it never changes or removes one already filed
			const rewrite = changes.findIndex(({ set }) =>
				[set.photo_evidence, set.communication_logs].some(
					(filed) => filed !== undefined && Object.keys(filed).some((verb) => verb !== 'create')
				)
			);
			if (rewrite >= 0)
				return yield* ctx.refuse(
					'An assignment files new photos and messages; it never changes or removes filed ones.',
					{ row: rewrite }
				);
			const members = yield* membersFor(
				ctx.db,
				changes.map(({ set }) => set.assignee_contact)
			);
			return changes.map(({ before, set: given }) => {
				// a new contact relinks the job: to the member it names, or to nobody
				const set = contacted(given.assignee_contact)
					? { ...given, assignee_user_id: memberByContact(members, given.assignee_contact) }
					: given;
				// only the review's own stamp leaves the job read; any other change is new evidence
				const reviewStamp = Object.keys(set).every((key) => key === 'suspicion_checked_at');
				const status = set.status ?? before.status;
				return {
					...set,
					...(set.assignee_user_id != null &&
					before.dispatched_at == null &&
					set.dispatched_at === undefined
						? { dispatched_at: ctx.now }
						: {}),
					...(status === 'completed' && (set.completed_at ?? before.completed_at) == null
						? { completed_at: ctx.now }
						: {}),
					...(reviewStamp ? {} : { suspicion_checked_at: null })
				};
			});
		}
	},
	delete: {}
});
