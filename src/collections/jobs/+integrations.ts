import { defineWebhook } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';
import type { Integrations } from './$types.js';

/**
 * Inbound job updates from the dispatch system.
 *
 * This is the binding that could not previously be written. Two things were missing and both are
 * here now. `jobs` had no external-key column, so there was nothing for `identity.column` to point
 * at and a redelivery — which every provider does, because webhook delivery is at-least-once —
 * would have filed a second job; `external_ref` is that column and carries a unique index. And the
 * dispatch system names a site by **its** code, never by our `id`, while `map` was a pure
 * `(record) => Row` with no way to look one up. `site_id` is a required `uuid`, so the whole
 * integration was inexpressible rather than merely awkward.
 *
 * `resolve` is what closes that. It runs **once per delivery** with an `api`, turns every site code
 * in the batch into one `in (…)`, and hands `map` the index it built. That shape is deliberate: a
 * lookup inside `map` would be a round trip per job, which is invisible on the two-job deliveries a
 * developer tests with and ruinous on a morning's dispatch of five hundred.
 *
 * A code that resolves to nothing fails **that job** and no other. `map` throws, the platform
 * records the rejection against that record's position and writes its siblings — so one job for a
 * site this workspace has never heard of does not cost the rest of the delivery. A `resolve` that
 * cannot run at all is the other case and behaves differently on purpose: it fails the delivery, the
 * host answers non-2xx, and the dispatch system redelivers.
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
					description: Schema.optionalKey(Schema.String),
					status: Schema.optionalKey(
						Schema.Literals(['unassigned', 'assigned', 'in_progress', 'completed'])
					)
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
						status: row.status ?? 'unassigned'
					};
				}
			})
		}
	}
} satisfies Integrations;
