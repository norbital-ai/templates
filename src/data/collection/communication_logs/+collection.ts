import { collection } from '@norbital-ai/bolt';

/** A message is kept exactly as received: create only, so immutability is structural. */
const communication_logs = collection('communication_logs', {
	read: { fields: 'all' },
	create: {
		input: { columns: ['job_assignment_id', 'message', 'sent_at', 'sender', 'source_message_id'] }
	}
});
export default communication_logs;

communication_logs.transform(async (inputs, ctx) =>
	inputs.map((input) => {
		for (const field of ['message', 'sender', 'source_message_id'] as const)
			if (String(input[field] ?? '').trim() === '')
				ctx.refuse(`Communication log ${field} cannot be empty.`, { field });
		return input;
	})
);
