import { collection } from '@norbital-ai/bolt';

/**
 * A roster of record is one employment over one calendar month. Its existence is the whole fact, so it has no update:
 * a roster is the roster of what it names, and another month or person is another roster.
 */
const c = collection('rosters', {
	read: { fields: 'all' },
	create: { input: { columns: ['employment_id', 'period'] } },
	delete: {}
});
export default c;

c.transform(async (inputs, ctx) => {
	for (const input of inputs)
		if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(input.period)))
			ctx.refuse(`A roster period is a calendar month as YYYY-MM, not "${String(input.period)}".`, {
				field: 'period'
			});
	return inputs;
});
