import { collection } from '@norbital-ai/bolt';
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
const c = collection('job_assignments', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
export default c;
const UNCERTIFIED =
	'Worker must satisfy at least one site-location job requirement with all required active certifications before assignment.';
/**
 * L-TPL-construction-008: an assignment is refused unless the worker holds active, in-force permits to work covering
 * every certification some job at that site location requires. Checked on create and whenever the worker or the site
 * location changes, so an assignment cannot be moved onto work the worker is not certified for.
 */
c.transform(function* (inputs, ctx) {
	const targets = [];
	for (const [i, input] of inputs.entries()) {
		const before = ctx.existing[i];
		if (
			before !== undefined &&
			input.worker_id === undefined &&
			input.site_location_id === undefined
		)
			continue;
		const worker = input.worker_id ?? before?.worker_id;
		const site = input.site_location_id ?? before?.site_location_id;
		if (worker == null || site == null) return yield* ctx.refuse(UNCERTIFIED);
		if (before !== undefined && worker === before.worker_id && site === before.site_location_id)
			continue;
		targets.push({ worker, site });
	}
	if (targets.length === 0) return inputs;
	const { permitLinks, siteJobs, permits, permitCerts, jobCerts } = yield* ctx.db.read({
		permitLinks: {
			collection: 'permits_to_work_workers',
			where: { worker_id: { in: [...new Set(targets.map((t) => t.worker))] } },
			select: { worker_id: true, permits_to_work_id: true },
			all: true
		},
		siteJobs: {
			collection: 'jobs_site_locations',
			where: { site_location_id: { in: [...new Set(targets.map((t) => t.site))] } },
			select: { site_location_id: true, job_id: true },
			all: true
		},
		permits: {
			collection: 'permits_to_work',
			where: {
				id: { in: { member: 'permitLinks', field: 'permits_to_work_id' } },
				status: { eq: 'active' }
			},
			select: { validity_range: true },
			all: true
		},
		permitCerts: {
			collection: 'permits_to_work_certification_types',
			where: { permits_to_work_id: { in: { member: 'permitLinks', field: 'permits_to_work_id' } } },
			select: { permits_to_work_id: true, certification_type_id: true },
			all: true
		},
		jobCerts: {
			collection: 'jobs_certification_types',
			where: { job_id: { in: { member: 'siteJobs', field: 'job_id' } } },
			select: { job_id: true, certification_type_id: true },
			all: true
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
		if (!qualified) yield* ctx.refuse(UNCERTIFIED);
	}
	return inputs;
});
