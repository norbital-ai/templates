import { model, type Id, type WriteCtx } from '@norbital-ai/bolt';
import { Effect } from 'effect';
const columns = [
	'assignment_code',
	'job_id',
	'worker_id',
	'site_location_id',
	'role',
	'assignment_range',
	'status',
	'hours_per_day',
	'required_certifications'
] as const;
const UNCERTIFIED =
	'Worker must satisfy at least one site-location job requirement with all required active certifications before assignment.';
/**
 * L-TPL-construction-008: each worker must hold active, in-force permits to work covering every certification some job
 * at the site location requires. Two reads for the whole batch.
 */
const certified = Effect.fnUntraced(function* (
	targets: readonly { readonly worker: Id<'workers'>; readonly site: Id<'site_locations'> }[],
	ctx: WriteCtx<'job_assignments'>
) {
	if (targets.length === 0) return;
	const { permits_to_work_workers: permitLinks, jobs_site_locations: siteJobs } =
		yield* ctx.db.query({
			permits_to_work_workers: {
				where: { worker_id: { in: [...new Set(targets.map((t) => t.worker))] } },
				fields: ['worker_id', 'permits_to_work_id']
			},
			jobs_site_locations: {
				where: { site_location_id: { in: [...new Set(targets.map((t) => t.site))] } },
				fields: ['site_location_id', 'job_id']
			}
		});
	const permitIds = [...new Set(permitLinks.rows.map((l) => l.permits_to_work_id))];
	const {
		permits_to_work: permits,
		permits_to_work_certification_types: permitCerts,
		jobs_certification_types: jobCerts
	} = yield* ctx.db.query({
		permits_to_work: {
			where: { id: { in: permitIds }, status: { eq: 'active' } },
			fields: ['validity_range']
		},
		permits_to_work_certification_types: {
			where: { permits_to_work_id: { in: permitIds } },
			fields: ['permits_to_work_id', 'certification_type_id']
		},
		jobs_certification_types: {
			where: { job_id: { in: [...new Set(siteJobs.rows.map((l) => l.job_id))] } },
			fields: ['job_id', 'certification_type_id']
		}
	});
	const today = String(ctx.today);
	const inForce = new Set(
		permits.rows
			.filter((p) => {
				const v = p.validity_range;
				return v == null || (String(v.from) <= today && (v.to == null || String(v.to) >= today));
			})
			.map((p) => p.id)
	);
	const certsByPermit = Map.groupBy(permitCerts.rows, (l) => l.permits_to_work_id);
	const requiredByJob = Map.groupBy(jobCerts.rows, (l) => l.job_id);
	for (const { worker, site } of targets) {
		const covered = new Set(
			permitLinks.rows
				.filter((l) => l.worker_id === worker && inForce.has(l.permits_to_work_id))
				.flatMap((l) =>
					(certsByPermit.get(l.permits_to_work_id) ?? []).map((c) => c.certification_type_id)
				)
		);
		const qualified = siteJobs.rows
			.filter((l) => l.site_location_id === site)
			.some((l) => {
				const required = requiredByJob.get(l.job_id) ?? [];
				return required.length > 0 && required.every((r) => covered.has(r.certification_type_id));
			});
		if (!qualified) return yield* ctx.refuse(UNCERTIFIED);
	}
});
/**
 * An assignment is refused unless the worker is certified for the site location: checked on create and whenever the
 * worker or the site location changes, so an assignment cannot be moved onto work the worker is not certified for.
 */
export default model('job_assignments', {
	description: 'Worker assignments tied to project jobs and site locations.',
	icon: 'lucide:hard-hat',
	label: 'assignment_code',
	fields: {
		assignment_code: { kind: 'text', optional: true },
		role: { kind: 'text', optional: true },
		assignment_range: { kind: 'period', of: 'date', optional: true },
		status: {
			kind: 'enum',
			values: ['assigned', 'in_progress', 'completed', 'cancelled'],
			optional: true
		},
		hours_per_day: { kind: 'decimal', scale: 2, optional: true },
		required_certifications: { kind: 'text', many: true, optional: true },
		worker_id: { kind: 'ref', to: 'workers', inverse: 'job_assignments' },
		job_id: { kind: 'ref', to: 'jobs', inverse: 'job_assignments', optional: true },
		site_location_id: { kind: 'ref', to: 'site_locations', inverse: 'job_assignments' }
	},
	search: { text: ['assignment_code'] },
	read: {
		job_assignments: { fields: 'all' },
		'job_assignments.site_location_id': { fields: ['project_id'] }
	},
	create: {
		columns: { job_assignments: columns },
		transform: function* (rows, ctx) {
			yield* certified(
				rows.map((r) => ({ worker: r.worker_id, site: r.site_location_id })),
				ctx
			);
			return rows;
		}
	},
	update: {
		columns: { job_assignments: columns },
		transform: function* (changes, ctx) {
			yield* certified(
				changes.flatMap(({ before, set }) => {
					const worker = set.worker_id ?? before.worker_id;
					const site = set.site_location_id ?? before.site_location_id;
					return worker === before.worker_id && site === before.site_location_id
						? []
						: [{ worker, site }];
				}),
				ctx
			);
			return changes.map((c) => c.set);
		}
	}
});
