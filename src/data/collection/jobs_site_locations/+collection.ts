import { collection } from '@norbital-ai/bolt';

const columns = ['job_id', 'site_location_id'] as const;

const c = collection('jobs_site_locations', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
export default c;

/** The row's `name` is its two sides' labels: a join row has no text of its own. */
c.transform(async (inputs, ctx) => {
	const sides = inputs.map((input, i) => ({
		a: input.job_id ?? ctx.existing[i]?.job_id,
		b: input.site_location_id ?? ctx.existing[i]?.site_location_id
	}));
	const [a, b] = await Promise.all([
		ctx.db.read('jobs', { where: { id: { in: sides.flatMap((s) => s.a ?? []) } }, all: true }),
		ctx.db.read('site_locations', {
			where: { id: { in: sides.flatMap((s) => s.b ?? []) } },
			all: true
		})
	]);
	const aName = new Map(a.rows.map((r) => [r.id, r.job_title]));
	const bName = new Map(b.rows.map((r) => [r.id, r.location_name]));
	return inputs.map((input, i) => ({
		...input,
		name: `${aName.get(sides[i]!.a!) ?? '—'} · ${bName.get(sides[i]!.b!) ?? '—'}`
	}));
});
