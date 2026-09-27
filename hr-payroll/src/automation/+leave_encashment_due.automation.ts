import { automation } from '@norbital-ai/bolt';
import { settleExit } from '../lib/leave/exit-settlement.js';
import { getErrorMessage } from '../lib/refuse.js';

/**
 * The daily catch-up for departures recorded in advance: the contracts whose deferred encashment has fallen due and
 * was never raised. Only what `leave_encashment_on_exit` deferred is swept (seeds leave `encashment_due_on` null),
 * and the raise stamp means a request HR has seen, even a rejected one, is never raised again.
 */
const leave_encashment_due = automation({
	description:
		'Daily catch-up for departures recorded in advance. Raises due leave encashment and separation requests for HR approval; existing requests are skipped.',
	on: { cron: '0 1 * * *' },
	output: {
		kind: 'object',
		fields: {
			checked: { kind: 'int' },
			raised: { kind: 'int' },
			failures: { kind: 'list', of: { kind: 'text' } },
			completed: { kind: 'list', of: { kind: 'text' } }
		}
	},
	runAs: ['leave_encashment_on_exit_automation']
});
export default leave_encashment_due;

leave_encashment_due.run(async (_input, ctx) => {
	const { rows } = await ctx.read('employments', {
		where: { encashment_due_on: { lte: ctx.today }, encashment_raised_at: { isNull: true } },
		select: { id: true },
		all: true
	});
	let raised = 0;
	const failures: string[] = [];
	const completed: string[] = [];
	for (const row of rows) {
		try {
			const outcome = await settleExit(ctx, row.id);
			raised += outcome.raised.length;
			if (outcome.status !== 'not_due' && outcome.status !== 'open') completed.push(row.id);
		} catch (error) {
			failures.push(`${row.id}: ${getErrorMessage(error)}`);
		}
	}
	await ctx.progress({
		ratio: 1,
		text: `Contracts checked: ${rows.length}. Requests raised: ${raised}. Failures: ${failures.length}.`
	});
	return { checked: rows.length, raised, failures, completed };
});
