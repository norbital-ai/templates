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

import { refuse, type CollectionTransformDatabase } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { compileEligibility } from '../collections/payroll_runs/lib/eligibility.js';
import { refuseUnlessDraftOnBoth, type SealedVersion } from './settings_seal.js';
import { assessedOnMentions, compileExpression, type DeclaredKey } from './expressions/compile.js';
import { openKeyMentions } from './expressions/contexts.js';
import { WAGES } from './expressions/person-functions.js';

const CATALOGUE_FAMILIES = ['ALLOWANCE', 'ADHOC', 'CLAIM', 'LOAN'] as const;
/** `code('X')` may also name a leave row's encashment line, `<code>_ENCASHMENT`. */
const CODE_FAMILIES = [...CATALOGUE_FAMILIES, 'LEAVE'] as const;
type CatalogueFamily = (typeof CODE_FAMILIES)[number];

type CatalogueRowLike = {
	readonly settings_id?: unknown;
	readonly code?: unknown;
	readonly eligibility?: string | null;
};

/** settings version id → family → code → name. */
type CatalogueCodes = ReadonlyMap<
	string,
	ReadonlyMap<CatalogueFamily, ReadonlyMap<string, string>>
>;

/**
 * The money catalogue codes of every version named, in one wave: the family reads issued
 * together. A transform reads this beside the versions it checks, so a formula's mentions are
 * judged without a read of their own.
 */
export function catalogueCodesByVersion(
	db: Pick<
		CollectionTransformDatabase,
		| 'allowance_catalogue'
		| 'adhoc_catalogue'
		| 'claim_catalogue'
		| 'loan_catalogue'
		| 'leave_catalogue'
	>,
	settingsIds: ReadonlyArray<unknown>
): Effect.Effect<CatalogueCodes> {
	const ids = [...new Set(settingsIds.filter((id): id is string => id != null && id !== ''))];
	if (ids.length === 0) return Effect.succeed(new Map());
	const query = {
		where: { settings_id: { in: ids }, approval_id: { isNull: true } },
		columns: { settings_id: true, code: true, name: true },
		limit: 5000
	} as const;
	return Effect.map(
		Effect.all(
			[
				db.allowance_catalogue.findMany(query),
				db.adhoc_catalogue.findMany(query),
				db.claim_catalogue.findMany(query),
				db.loan_catalogue.findMany(query),
				db.leave_catalogue.findMany(query)
			],
			{ concurrency: 'unbounded' }
		),
		([allowances, adhoc, claims, loans, leaves]) => {
			const byVersion = new Map<string, Map<CatalogueFamily, Map<string, string>>>();
			const file = (
				family: CatalogueFamily,
				rows: ReadonlyArray<{ settings_id: string; code: string; name: string | null }>
			) => {
				for (const row of rows) {
					const families =
						byVersion.get(row.settings_id) ?? new Map<CatalogueFamily, Map<string, string>>();
					const codes = families.get(family) ?? new Map<string, string>();
					codes.set(row.code, row.name ?? '');
					families.set(family, codes);
					byVersion.set(row.settings_id, families);
				}
			};
			file('ALLOWANCE', allowances);
			file('ADHOC', adhoc);
			file('CLAIM', claims);
			file('LOAN', loans);
			file(
				'LEAVE',
				leaves.map((row) => ({ ...row, code: `${row.code}_ENCASHMENT` }))
			);
			return byVersion;
		}
	);
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
	if (settingsId == null || settingsId === '') return;
	const families = catalogues.get(String(settingsId));
	const rowsOf = (family: CatalogueFamily): ReadonlyMap<string, string> =>
		families?.get(family) ?? new Map();
	const mentions = assessedOnMentions(expression);
	for (const code of [...mentions.codes, ...mentions.yearEarned]) {
		const carrying = CODE_FAMILIES.filter((family) => rowsOf(family).has(code));
		if (carrying.length === 0)
			refuse(
				`${what} names ${code}, which is not a row of its settings version. Add the row to that ` +
					'version first, or take it out of the formula.'
			);
		if (carrying.length > 1)
			refuse(
				`${what} names ${code} with code('${code}'), but ${carrying.join(' and ')} both carry it ` +
					'in this version. Give one of them another code.'
			);
	}
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
			readonly rebate?: string;
			readonly deduction?: string;
		}[];
		readonly assessed_on: string;
		readonly ordinary_on?: string;
		readonly elections: readonly DeclaredKey[];
		/** The parts the scheme splits its base into; a formula's `<PART>.<WORD>` must name one. */
		readonly parts?: readonly string[];
	},
	schemeElections?: Readonly<Record<string, readonly DeclaredKey[]>>
): string | null {
	const { rules, assessed_on: assessedOn, elections } = scheme;
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
	if (schemes == null) return;
	for (const membership of countsToward ?? []) {
		// Not a scheme: the reserved mark that files a regular pay class into the earnings history.
		if (membership === WAGES) continue;
		const [scheme, part, ...rest] = membership.split('.');
		const declared = scheme == null ? undefined : schemes.get(scheme);
		if (declared == null)
			refuse(
				`${what} counts toward ${membership}, but the version has no scheme ${scheme}. ` +
					'Add the scheme to the version first, or take it off the class.'
			);
		if (rest.length > 0)
			refuse(`${what} counts toward ${membership}, which is not scheme or scheme.PART.`);
		if (part != null && !declared.includes(part))
			refuse(
				`${what} counts toward ${membership}, but scheme ${scheme} declares no part ${part}` +
					(declared.length === 0
						? '; it has one base, so name it as just ' + scheme + '.'
						: `; its parts are ${declared.join(', ')}.`)
			);
		if (part == null && declared.length > 0)
			refuse(
				`${what} counts toward ${scheme}, which splits its base into ${declared.join(' and ')}: ` +
					`name the part, ${scheme}.${declared[0]}.`
			);
	}
}

/** scheme code → declared parts, per settings version, in one read. */
export function schemePartsByVersion(
	db: Pick<CollectionTransformDatabase, 'statutory_contributions'>,
	settingsIds: ReadonlyArray<unknown>
): Effect.Effect<ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>> {
	const ids = [...new Set(settingsIds.filter((id): id is string => id != null && id !== ''))];
	if (ids.length === 0) return Effect.succeed(new Map());
	return Effect.map(
		db.statutory_contributions.findMany({
			where: { settings_id: { in: ids }, approval_id: { isNull: true } },
			columns: { settings_id: true, code: true, parts: true },
			limit: 5000
		}),
		(rows) => {
			const byVersion = new Map<string, Map<string, readonly string[]>>();
			for (const row of rows) {
				const schemes = byVersion.get(row.settings_id) ?? new Map<string, readonly string[]>();
				schemes.set(row.code, row.parts ?? []);
				byVersion.set(row.settings_id, schemes);
			}
			return byVersion;
		}
	);
}
