import { collection } from '@norbital-ai/bolt';
import { dispatchFacts, searchTextFor } from '../../../lib/dispatch.js';
import {
	photoSourceKey,
	photoSummary,
	uninspectedPhotoFacts
} from '../../../lib/photo-integrity.js';
import { importWorkOrders, WORK_ORDER_ROW } from '../../../lib/work-order-import.js';

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
 * A work order names its site and day and may carry the dispatch system's reference and the channel message it came
 * from; those identity keys are create-only. Naming a contractor is the dispatch. A channel report lands as one update:
 * the progress, the photos it carried and the messages that are this job's slice of the conversation.
 * `suspicion_checked_at` is the review's stamp; any other change clears it, so the review judges the job again.
 */
const job_assignments = collection('job_assignments', {
	read: { fields: 'all' },
	create: { input: { columns: ['external_ref', ...progress, 'source_message_id'] } },
	update: {
		input: {
			columns: [...progress, 'suspicion_checked_at'],
			with: {
				photo_evidence: { create: { columns: ['photo', 'source'] } },
				communication_logs: {
					create: { columns: ['message', 'sent_at', 'sender', 'source_message_id'] }
				}
			}
		}
	},
	delete: {},
	actions: {
		import_work_orders: {
			description:
				'Creates job assignments from the rows of a work-order sheet (CSV or xlsx): site address or code, optional postal code, day, title, and optionally nature, description, assignee and dispatch reference. A site is matched by its code or its address key; an address no site carries is filed as a new site. A row already filed (the same dispatch reference, or the same title on the same day at the same site) is skipped, so a sheet imported twice files nothing twice. The whole sheet is checked first and every faulty row is named.',
			input: { rows: { kind: 'list', min: 1, max: 5000, of: WORK_ORDER_ROW } },
			output: {
				kind: 'object',
				fields: { created: { kind: 'int' }, sites: { kind: 'int' }, skipped: { kind: 'int' } }
			}
		}
	}
});
export default job_assignments;

job_assignments.transform(async (inputs, ctx) => {
	const siteIds = [
		...new Set(inputs.flatMap((input) => (input.site_id == null ? [] : [input.site_id])))
	];
	const sites = siteIds.length
		? await ctx.db.read('sites', { where: { id: { in: siteIds } }, all: true })
		: { rows: [] };
	const siteOf = new Map(sites.rows.map((site) => [site.id, site]));

	return inputs.map((input, i) => {
		const stored = ctx.existing[i];
		if (stored === undefined) {
			const siteId = input.site_id;
			if (siteId == null) {
				ctx.refuse('A job needs a site.', { field: 'site_id' });
				return input;
			}
			return { ...input, ...dispatchFacts(input, siteOf.get(siteId), ctx.now) };
		}
		for (const message of input.communication_logs?.create ?? [])
			for (const field of ['message', 'sender', 'source_message_id'] as const)
				if (String(message[field] ?? '').trim() === '')
					ctx.refuse(`Communication log ${field} cannot be empty.`);
		const photos = input.photo_evidence?.create ?? [];
		// only the review's own stamp leaves the job read; any other change is new evidence
		const reviewStamp = Object.keys(input).every((key) => key === 'suspicion_checked_at');
		const status = input.status ?? stored.status;
		return {
			...input,
			...(input.assignee_user_id != null &&
			stored.dispatched_at == null &&
			input.dispatched_at === undefined
				? { dispatched_at: ctx.now }
				: {}),
			...(status === 'completed' && (input.completed_at ?? stored.completed_at) == null
				? { completed_at: ctx.now }
				: {}),
			...(input.title !== undefined || input.site_id !== undefined
				? {
						search_text: searchTextFor(
							String(input.title ?? stored.title),
							siteOf.get(input.site_id ?? stored.site_id)
						)
					}
				: {}),
			...(reviewStamp ? {} : { suspicion_checked_at: null }),
			...(photos.length === 0
				? {}
				: {
						photo_evidence: {
							...input.photo_evidence,
							// a nested create runs no photo_evidence transform, so its facts are stamped here
							create: photos.map((photo) => {
								const source = photo.source ?? ({ kind: 'workspace_upload' } as const);
								return {
									...photo,
									source,
									source_key: photoSourceKey(source, String(photo.photo.id)),
									summary: photoSummary(source),
									...uninspectedPhotoFacts()
								};
							})
						}
					})
		};
	});
});

job_assignments.action('import_work_orders', (input, ctx) => importWorkOrders(input.rows, ctx));
