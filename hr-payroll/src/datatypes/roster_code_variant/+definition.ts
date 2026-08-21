import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

const clockTime = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/));

/**
 * The meaning of one code used by patterns, monthly rosters and workbook imports.
 *
 * A working code owns its scheduled clock window and unpaid break. REST and OFF are genuine
 * variants of the same roster vocabulary, so they carry no meaningless nullable clock fields.
 * PUBLIC_HOLIDAY is deliberately absent: it is resolved from `company_holidays` for the employee,
 * and can therefore never drift from a manually assigned per-person code.
 */
export const rosterCodeVariantValueSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal('WORK'),
		start_time: clockTime,
		end_time: clockTime,
		break_minutes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
	}),
	Schema.Struct({ kind: Schema.Literal('REST') }),
	Schema.Struct({ kind: Schema.Literal('OFF') })
]);

export type RosterCodeVariant = Schema.Schema.Type<typeof rosterCodeVariantValueSchema>;

/** Strict standard view: a key no arm declares is refused rather than stripped. */
export const rosterCodeVariantSchema = Schema.toStandardSchemaV1(rosterCodeVariantValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});

export default defineCustomType({
	name: 'roster_code_variant',
	description:
		'A roster code is either a scheduled work window with its unpaid break, a protected rest day, or another planned off day. Public holidays come from the observed holiday calendar.',
	schema: rosterCodeVariantSchema
});
