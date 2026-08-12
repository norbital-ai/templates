import { defineCustomType } from '@norbital-ai/pod/authoring';
import { z } from 'zod/mini';

const clockTime = z.string().check(z.regex(/^([01]\d|2[0-3]):[0-5]\d$/));

/**
 * The meaning of one code used by patterns, monthly rosters and workbook imports.
 *
 * A working code owns its scheduled clock window and unpaid break. REST and OFF are genuine
 * variants of the same roster vocabulary, so they carry no meaningless nullable clock fields.
 * PUBLIC_HOLIDAY is deliberately absent: it is resolved from `company_holidays` for the employee,
 * and can therefore never drift from a manually assigned per-person code.
 */
export const rosterCodeVariantSchema = z.discriminatedUnion('kind', [
	z.strictObject({
		kind: z.literal('WORK'),
		start_time: clockTime,
		end_time: clockTime,
		break_minutes: z.number().check(z.int(), z.nonnegative())
	}),
	z.strictObject({ kind: z.literal('REST') }),
	z.strictObject({ kind: z.literal('OFF') })
]);

export type RosterCodeVariant = z.infer<typeof rosterCodeVariantSchema>;

export default defineCustomType({
	name: 'roster_code_variant',
	description:
		'A roster code is either a scheduled work window with its unpaid break, a protected rest day, or another planned off day. Public holidays come from the observed holiday calendar.',
	schema: rosterCodeVariantSchema
});
