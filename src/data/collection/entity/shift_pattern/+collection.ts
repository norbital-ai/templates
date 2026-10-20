import { collection } from '@norbital-ai/bolt';
import { cycleDays } from '../../../../lib/payroll_engine/shift_pattern.js';
const create_columns = ['code', 'name', 'pattern', 'effective_range', 'company_id'] as const;
const update_columns = ['code', 'name', 'pattern', 'effective_range'] as const;
const c = collection('shift_pattern', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
export default c;

c.transform(function* (inputs, ctx) {
	const rows = inputs.map((input, i) => ({ ...ctx.existing[i], ...input }));
	const companies = [
		...new Set(rows.flatMap((row) => (row.company_id == null ? [] : [row.company_id])))
	];
	const got = yield* ctx.db.read({
		shifts: {
			collection: 'shift_definition',
			where: { company_id: { in: companies } },
			select: { company_id: true },
			all: true
		}
	});
	const shifts = new Map(got.shifts.rows.map((row) => [String(row.id), row.company_id]));
	for (const row of rows)
		for (const day of cycleDays(row.pattern)) {
			const id = day.roster_code_id;
			if (id != null && id !== '' && shifts.get(id) !== row.company_id)
				return yield* ctx.refuse('Each pattern day must use a shift code belonging to its entity.');
		}
	return inputs;
});
