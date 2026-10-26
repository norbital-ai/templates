import { model } from '@norbital-ai/bolt';
import { dispatchFacts, searchTextFor } from '../../../lib/dispatch.js';
const progress = [
	'site_id',
	'title',
	'nature',
	'scheduled_for',
	'description',
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
 * The work order and its dispatch in one row: filed unassigned, dispatched by naming who holds it. `status` is where
 * the work got to; findings about it live in `suspicious_activity_logs`, so a suspicion never erases progress.
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
		/** The dispatch system's reference, when an imported sheet carries one; a sheet imported twice files once. */
		external_ref: { kind: 'text', optional: true, unique: true },
		title: { kind: 'text' },
		nature: { kind: 'text', optional: true },
		scheduled_for: { kind: 'date' },
		description: { kind: 'text' },
		dispatched_at: { kind: 'instant', optional: true },
		status: {
			kind: 'enum',
			values: ['unassigned', 'assigned', 'completed'],
			default: 'unassigned'
		},
		completed_at: { kind: 'instant', optional: true },
		amount_charged: { kind: 'money', optional: true },
		/** Where the contractor reported the work from. */
		location: { kind: 'point', optional: true },
		location_address: { kind: 'text', optional: true },
		summary: { kind: 'text', optional: true },
		/** Search copy of the title and the site's name and code; the write callbacks own it. */
		search_text: { kind: 'text', optional: true, hidden: true },
		/** The WhatsApp message a job came from; retries of one delivery file it once. */
		source_message_id: { kind: 'text', optional: true, unique: true },
		/** Written by the suspicion review only; any other change clears it. */
		suspicion_checked_at: { kind: 'instant', optional: true, hidden: true }
	},
	index: ['scheduled_for', 'suspicion_checked_at'],
	search: {
		text: ['title', 'summary', 'search_text'],
		// `/semantic` in the jobs search box: the work described, on the host's default embedding model. `dim` is the width
		// of the `bolt_embedding` column every job's vector and every probe are read at, so the host's model must honour it.
		semantic: { fields: ['title', 'description', 'summary'], model: 'default', dim: 1536 }
	},
	read: 'all',
	create: {
		columns: ['external_ref', ...progress, 'source_message_id'],
		// a job filed under a new site (its `with`, an import) reads that site from this act
		transform: function* (rows, ctx) {
			const sites = yield* ctx.db.after('sites', {
				id: { in: [...new Set(rows.map((row) => row.site_id))] }
			});
			const siteOf = new Map(sites.map((site) => [site.id, site]));
			return rows.map((row) => ({
				...row,
				...dispatchFacts(row, siteOf.get(row.site_id), ctx.now)
			}));
		}
	},
	update: {
		columns: [...progress, 'suspicion_checked_at'],
		with: {
			photo_evidence: { create: { columns: ['photo', 'source'] } },
			communication_logs: {
				create: { columns: ['message', 'sent_at', 'sender', 'source_message_id'] }
			}
		},
		transform: function* (changes, ctx) {
			// a new title or site (a link from the site's side included) re-derives the search copy
			const retitled = (set: (typeof changes)[number]['set']) =>
				set.title !== undefined || set.site_id !== undefined;
			const siteIds = [
				...new Set(
					changes.flatMap(({ before, set }) =>
						retitled(set) ? [set.site_id ?? before.site_id] : []
					)
				)
			];
			const sites = siteIds.length ? yield* ctx.db.after('sites', { id: { in: siteIds } }) : [];
			const siteOf = new Map(sites.map((site) => [site.id, site]));
			return changes.map(({ before, set }) => {
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
					...(retitled(set)
						? {
								search_text: searchTextFor(
									set.title ?? before.title,
									siteOf.get(set.site_id ?? before.site_id)
								)
							}
						: {}),
					...(reviewStamp ? {} : { suspicion_checked_at: null })
				};
			});
		}
	},
	delete: {}
});
