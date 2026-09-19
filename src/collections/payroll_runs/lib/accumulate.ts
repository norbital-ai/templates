/**
 * Step 5 — ACCUMULATE.
 *
 * One pass per payslip over every priced line, producing the six **reserved magnitudes** — the
 * engine's own money, `BASE`, `OVERTIME`, `NIGHT_PREMIUM`, `ABSENCE`, `NO_PAY_LEAVE`,
 * `ENCASHMENT` — and a `code → signed amount` map over every catalogue row the payslip priced.
 * A scheme's `assessed_on` is then one expression over those two facts, so what a statute charges
 * is read against the Act rather than admitted entry by entry.
 *
 * A catalogue row's sign is its own landing: an earning adds, an absence or a deduction subtracts.
 * The reserved lines are magnitudes; the formula writes their sign.
 *
 * Every priced line is kept, so the run's calculation trace can name the lines the formula
 * selected without re-reading the payslip.
 */

import type { FamilyPayItem, PricedItem } from '../../../lib/payroll/family.js';
import { leaveRowCode } from '../../../lib/leave/codes.js';
import { INCENTIVE_LINE } from '../../../lib/payroll/work-bands.js';
import { CATALOGUE_WORDS, type CatalogueWord } from '../../../lib/expressions/contexts.js';

/**
 * The reserved lines of the assessment site. `OVERTIME_PREMIUM` is not a line of its own: it is
 * the part of every overtime line above the ordinary hour (amount − hours × ordinary hour), the
 * quantity a tax regime exempts where it exempts the premium and not the wage (VN art.4(8)
 * before 1 July 2026).
 */
export type ReservedLine =
	| 'BASE'
	| 'OVERTIME'
	| 'NIGHT_PREMIUM'
	| 'OVERTIME_PREMIUM'
	| 'ABSENCE'
	| 'NO_PAY_LEAVE'
	| 'ENCASHMENT'
	/** The overtime lines a band funnelled above its named limit — inside OVERTIME as well. */
	| 'INCENTIVE';

/** One priced line that fed the payslip, as the calculation trace records it. */
export type ContributionLine = {
	/** The catalogue component or work class the line settles under, e.g. `OVERTIME`. */
	readonly code: string;
	/** The band label that priced it, e.g. the OT class `1.5`. */
	readonly label: string;
	readonly effect: 'INCLUDE' | 'REDUCE';
	readonly amount: number;
};

/** One priced line with the reserved line it feeds, or null where it is a catalogue row. */
export type AccumulationLine = ContributionLine & {
	readonly family: FamilyPayItem['family'];
	readonly reserved: ReservedLine | null;
};

/** Everything one payslip's money says to CONTRIBUTE, before any scheme has been read. */
export type AccumulatedPayslip = {
	readonly reserved: Readonly<Record<ReservedLine, number>>;
	/** Catalogue row code → its signed amount on this payslip. Leave rows carry their row code. */
	readonly codes: ReadonlyMap<string, number>;
	/** Catalogue row code → the family whose catalogue it came from. */
	readonly familyOf: ReadonlyMap<string, FamilyPayItem['family']>;
	/** Catalogue row code → the schemes (and parts, `CPF.ADDITIONAL`) its class counts toward. */
	readonly countsTowardOf: ReadonlyMap<string, readonly string[]>;
	readonly lines: readonly AccumulationLine[];
};

/** The sign a line carries into the map: its landing, never a stated effect. */
const effectOf = (item: PricedItem): ContributionLine['effect'] =>
	item.bucket === 'ABSENCE' || item.bucket === 'DEDUCTION' ? 'REDUCE' : 'INCLUDE';

/** The reserved line a line feeds, or null where it is a catalogue row. */
function reservedOf(item: PricedItem): ReservedLine | null {
	const component = item.catalogueComponent;
	if (component.family !== 'WORK') {
		// Leave carries no pricing: an unpaid day is the reserved `NO_PAY_LEAVE` line and an
		// encashed day the reserved `ENCASHMENT` line, both priced by the engine at the day wage.
		if (component.family === 'LEAVE')
			return item.bucket === 'ABSENCE' ? 'NO_PAY_LEAVE' : 'ENCASHMENT';
		return null;
	}
	if (component.output === 'salary') return 'BASE';
	if (component.output === 'absence') return 'ABSENCE';
	if (component.output === 'night') return 'NIGHT_PREMIUM';
	return 'OVERTIME';
}

/** The catalogue code a line's money is filed under; a leave encashment is its row's code. */
function catalogueCode(item: PricedItem): string {
	const component = item.catalogueComponent;
	if (component.family !== 'LEAVE') return component.code;
	return leaveRowCode(component.code);
}

/** One payslip's priced lines, folded into the reserved magnitudes and the code map. */
export function accumulatePayslip(options: {
	readonly items: readonly (PricedItem & { readonly quantity?: number | null })[];
	/** The ordinary hour the premium is measured above; 0 prices every overtime line as premium. */
	readonly ordinaryHour?: number;
}): AccumulatedPayslip {
	const magnitudes: Record<ReservedLine, number> = {
		BASE: 0,
		OVERTIME: 0,
		NIGHT_PREMIUM: 0,
		OVERTIME_PREMIUM: 0,
		ABSENCE: 0,
		NO_PAY_LEAVE: 0,
		ENCASHMENT: 0,
		INCENTIVE: 0
	};
	const codes = new Map<string, number>();
	const familyOf = new Map<string, FamilyPayItem['family']>();
	const countsTowardOf = new Map<string, readonly string[]>();
	const lines: AccumulationLine[] = [];
	for (const item of options.items) {
		// Information is not money; no scheme charges it.
		if (item.amount === 0 || item.bucket === 'INFORMATION') continue;
		const effect = effectOf(item);
		const reserved = reservedOf(item);
		const code = catalogueCode(item);
		lines.push({
			code,
			label: item.label,
			effect,
			amount: item.amount,
			family: item.catalogueComponent.family,
			reserved
		});
		if (reserved != null) {
			magnitudes[reserved] += item.amount;
			// An encashed leave day is a reserved line and also its row's own code
			// (`code('ANNUAL_LEAVE_ENCASHMENT')`), for a law that treats one leave's commutation
			// differently from another's (PH: vacation leave is de minimis, sick leave is not).
			if (reserved === 'ENCASHMENT') {
				const rowCode = `${code}_ENCASHMENT`;
				codes.set(rowCode, (codes.get(rowCode) ?? 0) + item.amount);
				familyOf.set(rowCode, 'LEAVE');
				countsTowardOf.set(rowCode, []);
			}
			if (reserved === 'OVERTIME') {
				magnitudes.OVERTIME_PREMIUM += Math.max(
					0,
					item.amount - (item.quantity ?? 0) * (options.ordinaryHour ?? 0)
				);
				// The funnelled slice — the hours a band priced above its named limit — is its own
				// magnitude too, for a law that taxes the overrun (VN Decree 253/2026 art.26(3)).
				if ((item.catalogueComponent.output ?? '').startsWith(`${INCENTIVE_LINE}:`))
					magnitudes.INCENTIVE += item.amount;
			}
			continue;
		}
		const signed = effect === 'REDUCE' ? -item.amount : item.amount;
		codes.set(code, (codes.get(code) ?? 0) + signed);
		familyOf.set(code, item.catalogueComponent.family);
		countsTowardOf.set(code, item.catalogueComponent.counts_toward ?? []);
	}
	return { reserved: magnitudes, codes, familyOf, countsTowardOf, lines };
}

/** The sum two contracts' payslips present as one person's money to one scheme. */
export function sumAccumulations(parts: readonly AccumulatedPayslip[]): AccumulatedPayslip {
	if (parts.length === 1) return parts[0]!;
	const reserved: Record<ReservedLine, number> = {
		BASE: 0,
		OVERTIME: 0,
		NIGHT_PREMIUM: 0,
		OVERTIME_PREMIUM: 0,
		ABSENCE: 0,
		NO_PAY_LEAVE: 0,
		ENCASHMENT: 0,
		INCENTIVE: 0
	};
	const codes = new Map<string, number>();
	const familyOf = new Map<string, FamilyPayItem['family']>();
	const countsTowardOf = new Map<string, readonly string[]>();
	const lines: AccumulationLine[] = [];
	for (const part of parts) {
		for (const key of Object.keys(reserved) as ReservedLine[]) reserved[key] += part.reserved[key];
		for (const [code, amount] of part.codes) codes.set(code, (codes.get(code) ?? 0) + amount);
		for (const [code, family] of part.familyOf) familyOf.set(code, family);
		for (const [code, schemes] of part.countsTowardOf) countsTowardOf.set(code, schemes);
		lines.push(...part.lines);
	}
	return { reserved, codes, familyOf, countsTowardOf, lines };
}

/** The catalogue a word sums: `ALLOWANCES` the allowance lines, `ADHOC` the ad hoc lines, `CLAIMS` the claim lines. */
export const WORD_FAMILY: Readonly<Record<CatalogueWord, FamilyPayItem['family']>> = {
	ALLOWANCES: 'ALLOWANCE',
	ADHOC: 'ADHOC',
	CLAIMS: 'CLAIM'
};

/**
 * Whether a class's `counts_toward` puts it in one scheme's base — `part` null for the whole
 * base (any part of the scheme counts), a name for that part alone. `EPF` lists the scheme;
 * `CPF.ADDITIONAL` lists a part of it.
 */
export function countsToward(
	memberships: readonly string[] | undefined,
	scheme: string,
	part: string | null
): boolean {
	if (memberships == null) return false;
	return memberships.some((membership) => {
		const [named, namedPart] = membership.split('.');
		if (named !== scheme) return false;
		return part == null ? true : namedPart === part;
	});
}

/**
 * The catalogue words of one scheme over one accumulation, pre-aggregated before the formula
 * runs: `ALLOWANCES`, `CLAIMS`, and for each declared part `<PART>: { ALLOWANCES, CLAIMS }`.
 */
export function catalogueWords(
	accumulation: AccumulatedPayslip,
	scheme: string,
	parts: readonly string[]
): Record<string, number | Record<CatalogueWord, number>> {
	const sum = (word: CatalogueWord, part: string | null): number => {
		let total = 0;
		for (const [code, amount] of accumulation.codes) {
			if (accumulation.familyOf.get(code) !== WORD_FAMILY[word]) continue;
			if (!countsToward(accumulation.countsTowardOf.get(code), scheme, part)) continue;
			total += amount;
		}
		return total;
	};
	const words: Record<string, number | Record<CatalogueWord, number>> = {};
	for (const word of CATALOGUE_WORDS) words[word] = sum(word, null);
	for (const part of parts)
		words[part] = Object.fromEntries(
			CATALOGUE_WORDS.map((word) => [word, sum(word, part)])
		) as Record<CatalogueWord, number>;
	return words;
}

/**
 * What an earlier instalment of the same month settled, read back off its payslip: the lines
 * re-folded into the same magnitudes and code map this run accumulates, and the statutory rows
 * as charged. A MONTH-assessed scheme at a semi-monthly or weekly cadence prices the month on the
 * sum of its instalments and charges the difference from what the earlier ones already took.
 */
export type MonthPrior = {
	readonly accumulation: AccumulatedPayslip;
	/** scheme code → what the earlier instalments charged and on what base. */
	readonly charged: ReadonlyMap<
		string,
		{ employee: number; employer: number; base: number; ordinary: number }
	>;
};

type SettledLine = {
	readonly component_code: string;
	readonly amount: unknown;
	readonly bucket?: string;
	readonly quantity?: unknown;
};

/**
 * A settled payslip's lines as priced items, by the catalogue the run holds. A line whose
 * component the version no longer carries (a leave row's encashment, a code since retired) is
 * folded by what its code and bucket say.
 */
export function accumulateSettledPayslip(
	payslip: {
		readonly base: readonly SettledLine[];
		readonly adjustments: readonly SettledLine[];
	},
	componentsByCode: ReadonlyMap<string, FamilyPayItem>,
	ordinaryHour?: number
): AccumulatedPayslip {
	const items = [...payslip.base, ...payslip.adjustments].map((line) => {
		const code = String(line.component_code);
		const bucket = (line.bucket ?? 'EARNING') as PricedItem['bucket'];
		const stub = (family: FamilyPayItem['family']): FamilyPayItem => ({
			id: code,
			settings_id: '',
			code,
			family,
			destination: 'PAY',
			direction: bucket === 'ABSENCE' || bucket === 'DEDUCTION' ? 'SUBTRACT' : 'ADD',
			bands: [],
			eligibility: ''
		});
		const component =
			componentsByCode.get(code) ??
			stub(code.endsWith('_ENCASHMENT') || bucket === 'ABSENCE' ? 'LEAVE' : 'ALLOWANCE');
		return {
			catalogueComponent: component,
			bucket,
			label: code,
			amount: Number(line.amount),
			quantity: line.quantity == null ? null : Number(line.quantity)
		} as PricedItem & { readonly quantity?: number | null };
	});
	return accumulatePayslip({ items, ordinaryHour });
}
