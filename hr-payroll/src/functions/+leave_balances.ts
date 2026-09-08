import { defineQueryHandler } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';
import type { Api } from './$types.js';
import { calendarDay } from '../lib/iso-day.js';
import { readLeaveContext } from '../lib/leave/context.js';
import { leaveBalanceSummaries } from '../lib/leave/summary.js';

export default defineQueryHandler({
	description:
		'Computes annual leave balances and reservations from effective catalogue rules and manual activity as the calling user.',
	schema: Schema.Struct({
		employment_id: Schema.String.check(Schema.isUUID()),
		as_of: calendarDay
	}),
	handler: ({ employment_id, as_of }, api: Api) =>
		readLeaveContext(api, [employment_id]).pipe(
			Effect.map((context) => leaveBalanceSummaries(context, employment_id, as_of))
		)
});
