import { collection } from '@norbital-ai/bolt';
/** Filed by a portal visitor; settled by the `portal_intake` run or the desk. */
const booking_requests = collection('booking_requests', {
	read: { fields: 'all', relations: 'all' },
	create: {
		input: {
			columns: [
				'name',
				'email',
				'phone',
				'address',
				'area',
				'service',
				'start',
				'repeat',
				'notes',
				'availability'
			]
		}
	},
	update: { input: { columns: ['status', 'booking', 'outcome'] } }
});
export default booking_requests;
booking_requests.transform(function* (inputs, ctx) {
	const ids = inputs.flatMap((i) => i.availability ?? []);
	const quotes =
		ids.length === 0
			? []
			: (yield* ctx.db.read('availability_requests', {
					where: { id: { in: ids } },
					all: true
				})).rows;
	{
		const out = [];
		for (const [i, input] of inputs.entries()) {
			if (ctx.existing[i] !== undefined) {
				out.push(input);
				continue;
			}
			if (input.start !== undefined && Date.parse(input.start) <= Date.parse(ctx.now))
				yield* ctx.refuse('Pick a time in the future.', { field: 'start' });
			if (input.availability !== undefined && input.availability !== null) {
				const q = quotes.find((q) => q.id === input.availability);
				if (
					q === undefined ||
					q.status !== 'ready' ||
					q.phone !== input.phone ||
					q.service !== input.service ||
					q.address !== input.address ||
					q.area !== (input.area ?? null) ||
					q.repeat !== (input.repeat ?? 'once') ||
					!q.starts.includes(input.start ?? '') ||
					q.checked_at === null ||
					Date.parse(ctx.now) - Date.parse(q.checked_at) > 15 * 60000
				)
					yield* ctx.refuse('Availability changed. Check times again.', { field: 'start' });
			}
			{
				out.push(input);
				continue;
			}
		}
		return out;
	}
});
