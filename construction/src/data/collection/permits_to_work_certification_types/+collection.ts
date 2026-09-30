import { collection } from '@norbital-ai/bolt';

const columns = ['permits_to_work_id', 'certification_type_id'] as const;

const c = collection('permits_to_work_certification_types', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
export default c;

/** The row's `name` is its two sides' labels: a join row has no text of its own. */
c.transform(async (inputs, ctx) => {
	const sides = inputs.map((input, i) => ({
		a: input.permits_to_work_id ?? ctx.existing[i]?.permits_to_work_id,
		b: input.certification_type_id ?? ctx.existing[i]?.certification_type_id
	}));
	const [a, b] = await Promise.all([
		ctx.db.read('permits_to_work', {
			where: { id: { in: sides.flatMap((s) => s.a ?? []) } },
			all: true
		}),
		ctx.db.read('certification_types', {
			where: { id: { in: sides.flatMap((s) => s.b ?? []) } },
			all: true
		})
	]);
	const aName = new Map(a.rows.map((r) => [r.id, r.permit_number]));
	const bName = new Map(b.rows.map((r) => [r.id, r.certification_name]));
	return inputs.map((input, i) => ({
		...input,
		name: `${aName.get(sides[i]!.a!) ?? '—'} · ${bName.get(sides[i]!.b!) ?? '—'}`
	}));
});
