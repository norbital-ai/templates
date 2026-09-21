import { defineWebhook } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';
import type { Integrations } from './$types.js';

/**
 * Inbound job updates from the dispatch system.
 *
 * The binding files and updates the work order — the assignment row itself, since the two used to
 * be separate collections and are now one. `external_ref` is the dispatch system's own reference
 * and carries a unique index, which is what makes an at-least-once redelivery an update rather than
 * a second job. `scheduled_for` arrives as a calendar day and is stored in its canonical form: the
 * UTC midnight every `precision: 'day'` reader resolves.
 *
 * The feed's own `status` is deliberately not mapped. `unassigned | assigned | in_progress |
 * completed` is *this* workspace's dispatch state — written when a contractor is named and when the
 * work is finished — and the dispatch system cannot know either; a redelivery carrying its stale
 * `status` would otherwise walk a completed job back to assigned.
 *
 * A site code that resolves to nothing fails **that job** and no other: `map` throws, the platform
 * records the rejection against that record's position and writes its siblings. A `resolve` that
 * cannot run at all is the other case and behaves differently on purpose: it fails the delivery,
 * the host answers non-2xx, and the dispatch system redelivers.
 *
 * The signature is the credential. There is no `connection` here because there is nothing to
 * request — the source pushes, and what makes a delivery trustworthy is an HMAC over the raw body
 * that only a holder of `DISPATCH_WEBHOOK_SECRET` could have computed. `eventIdHeader` names the
 * dispatch system's own delivery id, so a redelivery is recognised before a record is even read.
 */
export default {
	dispatch: {
		policies: ['dispatch_integration'],
		receive: {
			job_updated: defineWebhook({
				webhook: {
					path: '/dispatch/job-updated',
					signature: {
						header: 'x-dispatch-signature',
						secret: { env: 'DISPATCH_WEBHOOK_SECRET' },
						algorithm: 'sha256',
						encoding: 'hex'
					},
					eventIdHeader: 'x-dispatch-event-id'
				},
				// The delivery is `{ job: { … } }`, so the record is one level in. `input` describes the
				// job itself rather than the envelope, which is what lets a malformed job be reported as
				// one bad job instead of one unreadable delivery.
				records: { field: 'job' },
				input: Schema.Struct({
					reference: Schema.Trimmed.check(Schema.isMinLength(1)),
					site_code: Schema.Trimmed.check(Schema.isMinLength(1)),
					title: Schema.Trimmed.check(Schema.isMinLength(1)),
					scheduled_for: Schema.Trimmed.check(Schema.isMinLength(1)),
					nature: Schema.optionalKey(Schema.String),
					description: Schema.optionalKey(Schema.String)
				}),
				identity: { column: 'external_ref', value: (job) => job.reference },
				resolve: ({ records, api }) =>
					Effect.map(
						api.db.sites.findMany({
							where: { site_code: { in: [...new Set(records.map((job) => job.site_code))] } },
							columns: { id: true, site_code: true }
						}),
						(sites) =>
							new Map(
								sites.flatMap((site) =>
									site.site_code === null ? [] : [[site.site_code, site.id] as const]
								)
							)
					),
				map: (job, sites) => {
					const siteId = sites.get(job.site_code);
					// Refused rather than defaulted. A job filed against the wrong site is worse than a job
					// that did not arrive, and this is the one place that knows the difference.
					if (siteId === undefined) {
						throw new Error(
							`job ${job.reference} names site ${job.site_code}, which this workspace has no site for`
						);
					}
					const { reference: external_ref, site_code: _siteCode, ...row } = job;
					return {
						...row,
						external_ref,
						site_id: siteId,
						nature: row.nature ?? null,
						description: row.description ?? '',
						scheduled_for: `${row.scheduled_for}T00:00:00.000Z`
					};
				}
			})
		}
	}
} satisfies Integrations;
