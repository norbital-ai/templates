import { defineCustomType } from '@norbital-ai/pod/authoring';
import { z } from 'zod/mini';

export const workedIntervalSchema = z.strictObject({
	start_at: z.iso.datetime({ offset: true }),
	end_at: z.nullable(z.iso.datetime({ offset: true }))
});

/**
 * Raw attendance observations. A source system may call one interval "regular" and another "OT",
 * but both are simply worked time here; overtime is derived only after comparing the normalized
 * intervals with the published schedule and the effective rules.
 */
export const workedIntervalsSchema = z.array(workedIntervalSchema).check(z.minLength(1));

export type WorkedIntervals = z.infer<typeof workedIntervalsSchema>;

export default defineCustomType({
	name: 'worked_intervals',
	description:
		'One or more actual worked intervals. Open attendance has a null final end; overtime is never stored in this value.',
	schema: workedIntervalsSchema
});
