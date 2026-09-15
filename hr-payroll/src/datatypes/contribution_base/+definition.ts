import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * What one statutory scheme charges (RFC 0003 §1).
 *
 * The scheme declares its own wage base, the way its statute does: whether the contract salary,
 * an absence, the overtime classes and the night premium are in it, and which catalogue rows are.
 * A line the declaration does not admit feeds nothing. The sign is the line's own landing — an
 * earning adds, an absence or deduction subtracts — so there is no effect to state.
 *
 * `entries` names catalogue rows of the scheme's own settings version by family and code; the
 * write refuses a code the version does not carry. A leave row listed here is its encashment; an
 * unpaid leave day is an absence and follows `absence`.
 */
export const BASE_ENTRY_FAMILIES = ['LEAVE', 'ALLOWANCE', 'CLAIM', 'PAYMENT', 'LOAN'] as const;
export type BaseEntryFamily = (typeof BASE_ENTRY_FAMILIES)[number];

export const contributionBaseEntrySchema = Schema.Struct({
	family: Schema.Literals(BASE_ENTRY_FAMILIES),
	code: Schema.String.check(Schema.isMinLength(1)),
	/**
	 * The first amount a tax year of this entry that is outside the base (RFC 0004 §3): NIRC
	 * s.32(B)(7)(e)'s ₱90,000 on 13th-month pay in the withholding base. Null is no exemption.
	 */
	annual_exempt: Schema.optionalKey(Schema.NullOr(Schema.Finite.check(Schema.isGreaterThan(0))))
});

export const contributionBaseValueSchema = Schema.Struct({
	/** The BASIC line. */
	salary: Schema.Boolean,
	/** The ABSENCE line and every unpaid leave day, subtracting. */
	absence: Schema.Boolean,
	/** Every work band line, the INCENTIVE funnel included. */
	overtime: Schema.Boolean,
	/** The NIGHT_PREMIUM line. */
	night_premium: Schema.Boolean,
	entries: Schema.Array(contributionBaseEntrySchema)
});
export type ContributionBase = Schema.Schema.Type<typeof contributionBaseValueSchema>;

export const EMPTY_BASE: ContributionBase = {
	salary: false,
	absence: false,
	overtime: false,
	night_premium: false,
	entries: []
};

/** A base that admits no line charges nothing; the seal refuses it. */
export const baseAdmitsNothing = (base: ContributionBase): boolean =>
	!base.salary &&
	!base.absence &&
	!base.overtime &&
	!base.night_premium &&
	base.entries.length === 0;

export default defineCustomType({
	name: 'contribution_base',
	description:
		'The wage base one statutory scheme charges: whether salary, absence, overtime and the night premium are in it, and which catalogue rows of its settings version are. Earnings add, absences and deductions subtract.',
	schema: Schema.toStandardSchemaV1(contributionBaseValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
