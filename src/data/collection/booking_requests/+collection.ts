import { collection } from '@norbital-ai/bolt';

/** Filed by a portal visitor; settled by the `portal_intake` run or the desk. */
const booking_requests = collection('booking_requests', {
	read: { fields: 'all', relations: 'all' },
	create: {
		input: {
			columns: ['name', 'email', 'phone', 'address', 'area', 'service', 'start', 'repeat', 'notes']
		}
	},
	update: { input: { columns: ['status', 'booking', 'outcome'] } }
});
export default booking_requests;

booking_requests.transform(async (inputs, ctx) =>
	inputs.map((input, i) => {
		if (
			ctx.existing[i] === undefined &&
			input.start !== undefined &&
			Date.parse(input.start) <= Date.parse(ctx.now)
		)
			ctx.refuse('Pick a time in the future.', { field: 'start' });
		return input;
	})
);
