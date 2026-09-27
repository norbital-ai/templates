/**
 * What every catalogue row must satisfy before it is stored: its settings version is still a
 * draft and its own predicate compiles. The bands' expressions and the entitlement amounts are
 * compiled by their own datatype schemas, so they are already refused by the time this runs.
 *
 * What every scheme's `assessed_on` formula must satisfy: each `code('X')` names a row of the
 * scheme's own settings version, and a code() that two catalogues carry is refused rather than
 * guessed between; a `year.earned.<code>` is checked the same way; a `<PART>.` word names a part
 * the scheme declares. And what every class's `counts_toward` must satisfy: each entry names a
 * scheme of the same version, with a part that scheme declares. Refused at the write, rather than
 * at the run where the person who typed it is long gone.
 *
 * Leave carries no pricing and no catalogue money: an unpaid or encashed day is an engine-priced
 * reserved line, so `code(...)` names the money catalogues only.
 */

import { refuse } from './refuse.js';
import { readAll, type Reads } from './reads.js';
import { compileEligibility } from '../lib/payroll/run/eligibility.js';
import { refuseUnlessDraftOnBoth, versionsById, type SealedVersion } from './settings_seal.js';
import { assessedOnMentions, compileExpression, type DeclaredKey } from './expressions/compile.js';
import { openKeyMentions } from './expressions/contexts.js';
import { WAGES } from './expressions/person-functions.js';
import { FIRST_SCHEDULE_WAGES } from './payroll/run/statutory-wages.js';

const CATALOGUE_FAMILIES = ['ALLOWANCE', 'ADHOC', 'CLAIM', 'LOAN'] as const;
/** `code('X')` may also name a leave row's encashment line, `<code>_ENCASHMENT`. */
const CODE_FAMILIES = [...CATALOGUE_FAMILIES, 'LEAVE'] as const;
type CatalogueFamily = (typeof CODE_FAMILIES)[number];

type CatalogueRowLike = {
	readonly settings_id?: unknown | undefined;
	readonly code?: unknown | undefined;
	readonly eligibility?: string | null | undefined;
	readonly qualifies_when?: string | null | undefined;
};

/** settings version id → family → code → name. */
type CatalogueCodes = ReadonlyMap<
	string,
	ReadonlyMap<CatalogueFamily, ReadonlyMap<string, string>>
>;

type CodeRow = {
	readonly settings_id: string;
	readonly code: string;
	readonly name: string | null;
};

/**
 * The money catalogue codes of every version, from each family's rows (read together, one wave): a transform reads
 * them beside the versions it checks, so a formula's mentions are judged without a read of their own.
 */
export function catalogueCodes(families: {
	readonly allowances: readonly CodeRow[];
	readonly adhoc: readonly CodeRow[];
	readonly claims: readonly CodeRow[];
	readonly loans: readonly CodeRow[];
	readonly leaves: readonly CodeRow[];
}): CatalogueCodes {
	const byVersion = new Map<string, Map<CatalogueFamily, Map<string, string>>>();
	const file = (family: CatalogueFamily, rows: readonly CodeRow[]) => {
		for (const row of rows) {
			const known =
				byVersion.get(row.settings_id) ?? new Map<CatalogueFamily, Map<string, string>>();
			const codes = known.get(family) ?? new Map<string, string>();
			codes.set(row.code, row.name ?? '');
			known.set(family, codes);
			byVersion.set(row.settings_id, known);
		}
	};
	file('ALLOWANCE', families.allowances);
	file('ADHOC', families.adhoc);
	file('CLAIM', families.claims);
	file('LOAN', families.loans);
	file(
		'LEAVE',
		families.leaves.map((row) => ({ ...row, code: `${row.code}_ENCASHMENT` }))
	);
	return byVersion;
}

/**
 * Every code and catalogue an `assessed_on` formula names is a row of the scheme's own settings
 * version. The write refuses, so a code the version does not carry cannot reach a payroll where
 * the formula would silently read zero under it.
 */
export function refuseUnknownAssessedOnMentions(
	catalogues: CatalogueCodes,
	settingsId: unknown,
	expression: string,
	what: string
): void {
	const fault = assessedOnMentionFault(catalogues, settingsId, expression, what);
	if (fault != null) refuse(fault);
}

/** `refuseUnknownAssessedOnMentions` as a value: the refusal, or null. */
export function assessedOnMentionFault(
	catalogues: CatalogueCodes,
	settingsId: unknown,
	expression: string,
	what: string
): string | null {
	if (settingsId == null || settingsId === '') return null;
	const families = catalogues.get(String(settingsId));
	const rowsOf = (family: CatalogueFamily): ReadonlyMap<string, string> =>
		families?.get(family) ?? new Map();
	const mentions = assessedOnMentions(expression);
	for (const code of [...mentions.codes, ...mentions.yearEarned]) {
		const carrying = CODE_FAMILIES.filter((family) => rowsOf(family).has(code));
		if (carrying.length === 0)
			return (
				`${what} names ${code}, which is not a row of its settings version. Add the row to that ` +
				'version first, or take it out of the formula.'
			);
		if (carrying.length > 1)
			return (
				`${what} names ${code} with code('${code}'), but ${carrying.join(' and ')} both carry it ` +
				'in this version. Give one of them another code.'
			);
	}
	return null;
}

/**
 * Every expression of a stored scheme, checked one by one against the row's declared elections:
 * the rules compile against the scheme context, the `assessed_on` formula against the assessment
 * site, and the formula is not empty — a scheme that charges nothing cannot be sealed.
 */
export function schemeFault(
	scheme: {
		readonly rules: readonly {
			readonly when: string;
			readonly employee: string;
			readonly employer: string;
			readonly rebate?: string | null | undefined;
			readonly deduction?: string | null | undefined;
			readonly per_unit?: boolean | null | undefined;
		}[];
		readonly assessment_period?: string | null | undefined;
		readonly assessment_scope?: string | null | undefined;
		readonly assessed_on: string;
		readonly ordinary_on?: string | undefined;
		readonly elections: readonly DeclaredKey[];
		/** The parts the scheme splits its base into; a formula's `<PART>.<WORD>` must name one. */
		readonly parts?: readonly string[] | undefined;
	},
	schemeElections?: Readonly<Record<string, readonly DeclaredKey[]>>
): string | null {
	const { rules, assessed_on: assessedOn, elections } = scheme;
	if (
		rules.some((rule) => rule.per_unit) &&
		((scheme.assessment_period != null && scheme.assessment_period !== 'PAY_PERIOD') ||
			scheme.assessment_scope === 'COMPANY' ||
			(scheme.ordinary_on ?? '').trim() !== '')
	)
		return 'Per-unit rules require a PAY_PERIOD employment scheme without an ordinary split.';
	for (const field of elections) {
		for (const [kind, expression] of [
			['requirement', field.required_when],
			['validation', field.valid_when]
		] as const) {
			if (expression == null) continue;
			if (openKeyMentions(expression, 'scheme').includes('deduction'))
				return `${field.key}: a ${kind} cannot read the deduction calculated after rule selection.`;
			const fault = compileExpression({
				expression,
				site: 'scheme',
				type: 'boolean',
				elections,
				schemeElections
			});
			if (fault != null) return `${field.key} ${kind}: ${fault}`;
		}
	}
	const parts = scheme.parts ?? [];
	for (const part of parts)
		if (!/^[A-Z0-9_]+$/.test(part))
			return `Parts: ${part} is not a part name (upper-case letters, digits and underscores).`;
	const undeclaredPart = (expression: string): string | null => {
		for (const word of assessedOnMentions(expression).words) {
			const chain = word.split('.');
			const part = chain[0] === 'year' ? chain[1] : chain[0];
			if (chain.length >= 2 && part != null && !parts.includes(part) && part !== 'year')
				return (
					`names ${word}, but the scheme declares no part ${part}. Declare it under Parts, ` +
					`or read the whole base as ${chain.at(-1)}.`
				);
		}
		return null;
	};
	const formula =
		undeclaredPart(assessedOn) ??
		compileExpression({
			expression: assessedOn,
			site: 'assessment',
			type: 'money',
			elections,
			schemeElections,
			parts
		});
	if (formula != null) return `Assessed-on: ${formula}`;
	if ((scheme.ordinary_on ?? '').trim() !== '') {
		const ordinary =
			undeclaredPart(scheme.ordinary_on ?? '') ??
			compileExpression({
				expression: scheme.ordinary_on ?? '',
				site: 'assessment',
				type: 'money',
				elections,
				schemeElections,
				parts
			});
		if (ordinary != null) return `Ordinary-on: ${ordinary}`;
	}
	if (assessedOn.trim() === '')
		return 'Assessed-on: the scheme charges nothing, so it states what it is assessed on.';
	for (const [index, rule] of rules.entries()) {
		for (const expression of [rule.when, rule.deduction ?? '0.0'])
			if (openKeyMentions(expression, 'scheme').includes('deduction'))
				return `Rule ${index + 1}: the deduction is evaluated after rule selection and cannot select or depend on itself.`;
		const when = compileExpression({
			expression: rule.when,
			site: 'scheme',
			type: 'boolean',
			elections,
			schemeElections
		});
		if (when != null) return `Rule ${index + 1}: ${when}`;
		const employee = compileExpression({
			expression: rule.employee,
			site: 'scheme',
			type: 'money',
			elections,
			schemeElections
		});
		if (employee != null) return `Rule ${index + 1} employee: ${employee}`;
		const employer = compileExpression({
			expression: rule.employer,
			site: 'scheme',
			type: 'money',
			elections,
			schemeElections
		});
		if (employer != null) return `Rule ${index + 1} employer: ${employer}`;
		if (rule.rebate != null) {
			const rebate = compileExpression({
				expression: rule.rebate,
				site: 'scheme',
				type: 'money',
				elections,
				schemeElections
			});
			if (rebate != null) return `Rule ${index + 1} rebate: ${rebate}`;
		}
		if (rule.deduction != null) {
			const deduction = compileExpression({
				expression: rule.deduction,
				site: 'scheme',
				type: 'money',
				elections,
				schemeElections
			});
			if (deduction != null) return `Rule ${index + 1} deduction: ${deduction}`;
		}
	}
	return null;
}

/** The transform rule of a money catalogue row: the input back, or a refusal naming the row. */
export const admitCatalogueRow = <TInput extends CatalogueRowLike>(
	versions: ReadonlyMap<string, SealedVersion>,
	input: TInput,
	existing: CatalogueRowLike | undefined,
	noun: string
): TInput => {
	const row = { ...existing, ...input };
	refuseUnlessDraftOnBoth(
		versions,
		existing?.settings_id,
		input.settings_id,
		`${noun} ${String(row.code ?? '')}`
	);
	const problem = compileEligibility(row.eligibility);
	if (problem != null) refuse(problem);
	if ((row.qualifies_when ?? '').trim() !== '') {
		const qualification = compileExpression({
			expression: row.qualifies_when!,
			site: 'entry',
			type: 'boolean'
		});
		if (qualification != null) refuse(`Claim qualification: ${qualification}`);
	}
	return input;
};

/**
 * Every scheme a class counts toward is a scheme of its own settings version, and a part it
 * names is one the scheme declares — a membership the version cannot honour would read as "in no
 * base" at payroll, silently. `schemes` is the version's scheme code → declared parts.
 */
export function refuseUnknownMemberships(
	schemes: ReadonlyMap<string, readonly string[]> | undefined,
	countsToward: readonly string[] | null | undefined,
	what: string
): void {
	const fault = membershipFault(schemes, countsToward, what);
	if (fault != null) refuse(fault);
}

/** `refuseUnknownMemberships` as a value: the refusal, or null. */
export function membershipFault(
	schemes: ReadonlyMap<string, readonly string[]> | undefined,
	countsToward: readonly string[] | null | undefined,
	what: string
): string | null {
	if (schemes == null) return null;
	for (const membership of countsToward ?? []) {
		// Not a scheme: the reserved mark that files a regular pay class into the earnings history.
		if (membership === WAGES || membership === FIRST_SCHEDULE_WAGES) continue;
		const [scheme, part, ...rest] = membership.split('.');
		const declared = scheme == null ? undefined : schemes.get(scheme);
		if (declared == null)
			return (
				`${what} counts toward ${membership}, but the version has no scheme ${scheme}. ` +
				'Add the scheme to the version first, or take it off the class.'
			);
		if (rest.length > 0)
			return `${what} counts toward ${membership}, which is not scheme or scheme.PART.`;
		if (part != null && !declared.includes(part))
			return (
				`${what} counts toward ${membership}, but scheme ${scheme} declares no part ${part}` +
				(declared.length === 0
					? '; it has one base, so name it as just ' + scheme + '.'
					: `; its parts are ${declared.join(', ')}.`)
			);
		if (part == null && declared.length > 0)
			return (
				`${what} counts toward ${scheme}, which splits its base into ${declared.join(' and ')}: ` +
				`name the part, ${scheme}.${declared[0]}.`
			);
	}
	return null;
}

/** scheme code → declared parts, per settings version, in one paged read. */
async function schemePartsByVersion(
	reads: Reads,
	settingsIds: ReadonlyArray<unknown>
): Promise<ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>> {
	const ids = [...new Set(settingsIds.filter((id): id is string => id != null && id !== ''))];
	const rows = await readAll<{
		settings_id: string;
		code: string;
		parts: readonly string[] | null;
	}>(
		reads,
		'statutory_contributions',
		{ settings_id: { in: ids }, approval_id: { isNull: true } },
		// a lineage's statutory tables exceed one crossing's 4 MiB answer: 4 rows a crossing
		4
	);
	const byVersion = new Map<string, Map<string, readonly string[]>>();
	for (const row of rows) {
		const schemes = byVersion.get(row.settings_id) ?? new Map<string, readonly string[]>();
		schemes.set(row.code, row.parts ?? []);
		byVersion.set(row.settings_id, schemes);
	}
	return byVersion;
}

/**
 * The transform of a money catalogue that counts toward schemes (allowances, ad hoc, claims): the
 * versions and their schemes read in one wave, then each row admitted and its `counts_toward`
 * checked against its own version. `noun` names the row in a refusal.
 */
export async function admitCatalogueRows<
	TInput extends CatalogueRowLike & { readonly counts_toward?: readonly string[] | null }
>(
	noun: string,
	inputs: ReadonlyArray<TInput>,
	existing: ReadonlyArray<CatalogueRowLike | undefined>,
	reads: Reads
): Promise<TInput[]> {
	const settingsIds = [
		...inputs.map((input) => input.settings_id),
		...existing.map((row) => row?.settings_id)
	];
	const [versions, schemes] = await Promise.all([
		versionsById(reads, settingsIds),
		schemePartsByVersion(reads, settingsIds)
	]);
	return inputs.map((input, index) => {
		const row = { ...existing[index], ...input };
		if (input.counts_toward !== undefined)
			refuseUnknownMemberships(
				row.settings_id == null ? undefined : schemes.get(String(row.settings_id)),
				input.counts_toward,
				`${noun} ${String(row.code ?? '')}`
			);
		return admitCatalogueRow(versions, input, existing[index], noun);
	});
}
