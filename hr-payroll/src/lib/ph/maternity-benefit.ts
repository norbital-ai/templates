import type { Decimal } from '@norbital-ai/std/decimal';
import { Schema } from 'effect';
import { dateKey, isCalendarDate } from '../iso-day.js';
import { refuse } from '../refuse.js';
import { decodeNumber } from '../wire.js';

/** One month on the member's SSS contribution statement, including months with no paid credit. */
export type SssContributionMonth = {
	readonly coverage_month: string;
	readonly regular_msc: number | string | Decimal;
	readonly paid_on?: string | null;
	readonly source_reference: string;
};

export function validateSssContributionMonth(row: Partial<SssContributionMonth>): void {
	if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.coverage_month ?? ''))
		refuse('SSS coverage month must be YYYY-MM.');
	if (!(row.source_reference ?? '').trim())
		refuse('An SSS month needs a contribution-statement reference.');
	const msc = decodeNumber(row.regular_msc);
	if (
		!Number.isFinite(msc) ||
		msc < 0 ||
		msc > 20_000 ||
		Math.abs(msc * 100 - Math.round(msc * 100)) > 1e-7
	)
		refuse('Regular SSS monthly salary credit must be PHP 0–20,000 to centavo precision.');
	if (row.paid_on == null) {
		if (msc !== 0) refuse('An unpaid SSS month cannot have monthly salary credit.');
	} else if (!isCalendarDate(dateKey(row.paid_on)) || msc <= 0) {
		refuse('A paid SSS month needs a payment day and positive regular monthly salary credit.');
	}
}

/** Frozen paid-month inputs; an attached SSS statement is required before a candidate can fund cash. */
export function snapshotSssContributionMonths(
	months: readonly (SssContributionMonth & {
		readonly id: string;
		readonly evidence_file?: unknown;
	})[],
	from: string,
	through: string
): string {
	const relevant = months
		.filter((row) => row.coverage_month >= from && row.coverage_month <= through)
		.toSorted((left, right) => left.coverage_month.localeCompare(right.coverage_month));
	if (relevant.some((row) => row.evidence_file == null || row.evidence_file === ''))
		refuse(
			'A frozen SSS advance candidate needs an attached contribution statement for each of its twelve months.'
		);
	return JSON.stringify(
		relevant.map((row) => ({
			id: row.id,
			coverage_month: row.coverage_month,
			regular_msc: decodeNumber(row.regular_msc),
			paid_on: row.paid_on == null ? null : dateKey(row.paid_on),
			source_reference: row.source_reference
		}))
	);
}

/**
 * The frozen months `snapshotSssContributionMonths` wrote, read back as their row ids. The snapshot is the one
 * owner of this shape, so its reader is here rather than at each call site.
 */
export function readSssSnapshotMonthIds(snapshot: string): readonly string[] {
	const decoded: unknown = JSON.parse(snapshot);
	if (!Array.isArray(decoded))
		refuse('A PH maternity advance plan has invalid frozen SSS statement history.');
	return decoded.map((month) => {
		const row = Schema.decodeUnknownSync(sssSnapshotMonthSchema, {
			onExcessProperty: 'ignore'
		})(month);
		return row.id;
	});
}

const sssSnapshotMonthSchema = Schema.Struct({
	id: Schema.String,
	coverage_month: Schema.String,
	regular_msc: Schema.Finite,
	paid_on: Schema.NullOr(Schema.String),
	source_reference: Schema.String
});

export type MaternityContingency = 'BIRTH' | 'MISCARRIAGE' | 'EMERGENCY_TERMINATION';

/** A calculation over a complete twelve-month statement; this does not establish an SSS award. */
export function calculateSssMaternityBenefit(input: {
	readonly contingency_date: string;
	readonly contingency: MaternityContingency;
	readonly solo_parent: boolean;
	readonly months: readonly SssContributionMonth[];
}) {
	const date = dateKey(input.contingency_date);
	if (!isCalendarDate(date)) refuse('A maternity contingency needs a real calendar date.');
	if (date < '2019-03-11')
		refuse('The 105-day SSS maternity rules require a contingency on or after 11 March 2019.');
	if (!['BIRTH', 'MISCARRIAGE', 'EMERGENCY_TERMINATION'].includes(input.contingency))
		refuse('Unknown SSS maternity contingency.');
	if (input.solo_parent && input.contingency !== 'BIRTH')
		refuse('The additional solo-parent days apply to live childbirth.');
	const year = decodeNumber(date.slice(0, 4));
	const month = decodeNumber(date.slice(5, 7));
	const quarter = Math.floor((month - 1) / 3);
	const semesterStart = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
	const start = new Date(
		Date.UTC(semesterStart.getUTCFullYear(), semesterStart.getUTCMonth() - 12, 1)
	);
	const expected = Array.from({ length: 12 }, (_, index) => {
		const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
		return day.toISOString().slice(0, 7);
	});
	const byMonth = new Map<string, SssContributionMonth>();
	for (const row of input.months) {
		if (row.coverage_month < expected[0]! || row.coverage_month > expected[11]!) continue;
		validateSssContributionMonth(row);
		if (byMonth.has(row.coverage_month)) refuse('Duplicate SSS coverage month.');
		byMonth.set(row.coverage_month, row);
	}
	if (byMonth.size !== 12 || expected.some((month) => !byMonth.has(month)))
		refuse('A maternity cash calculation needs all twelve SSS contribution months.');
	const semesterStartDay = semesterStart.toISOString().slice(0, 10);
	const paidCredits = expected
		.map((month) => byMonth.get(month)!)
		.filter((row) => row.paid_on != null && dateKey(row.paid_on) < semesterStartDay)
		.map((row) => Math.round(decodeNumber(row.regular_msc) * 100));
	const contributionQualified = paidCredits.length >= 3;
	const topSix = paidCredits.sort((a, b) => b - a).slice(0, 6);
	const totalMscCentavos = topSix.reduce((sum, credit) => sum + credit, 0);
	const days = input.contingency === 'BIRTH' ? (input.solo_parent ? 120 : 105) : 60;
	return {
		qualifying_window: { from: expected[0]!, through: expected[11]! },
		semester_from: semesterStartDay,
		paid_months: paidCredits.length,
		contribution_qualified: contributionQualified,
		total_msc: contributionQualified ? totalMscCentavos / 100 : 0,
		adsc: contributionQualified ? totalMscCentavos / 18_000 : 0,
		compensable_days: days,
		candidate_benefit: contributionQualified ? Math.round((totalMscCentavos * days) / 180) / 100 : 0
	};
}
