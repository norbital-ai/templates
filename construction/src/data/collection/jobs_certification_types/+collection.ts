import { joinName } from '../../../lib/join-name.js';
import { collection } from '@norbital-ai/bolt';
const columns = ['job_id', 'certification_type_id'] as const;
const c = collection('jobs_certification_types', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
export default c;
/** The row's `name` is its two sides' labels: a join row has no text of its own. */
c.transform(function* (inputs, ctx) {
	const sides = inputs.map((input, i) => ({
		a: input.job_id ?? ctx.existing[i]?.job_id,
		b: input.certification_type_id ?? ctx.existing[i]?.certification_type_id
	}));
	const { a, b } = yield* ctx.db.read({
		a: {
			collection: 'jobs',
			where: { id: { in: sides.flatMap((s) => s.a ?? []) } },
			select: { job_title: true },
			all: true
		},
		b: {
			collection: 'certification_types',
			where: { id: { in: sides.flatMap((s) => s.b ?? []) } },
			select: { certification_name: true },
			all: true
		}
	});
	const aName = new Map(a.rows.map((r) => [r.id, r.job_title]));
	const bName = new Map(b.rows.map((r) => [r.id, r.certification_name]));
	return inputs.map((input, i) => {
		const side = sides[i];
		return {
			...input,
			name: joinName(
				side?.a === undefined ? undefined : aName.get(side.a),
				side?.b === undefined ? undefined : bName.get(side.b)
			)
		};
	});
});
