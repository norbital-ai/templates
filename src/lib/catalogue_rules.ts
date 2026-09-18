/**
 * What every catalogue row must satisfy before it is stored: its settings version is still a
 * draft and its own predicate compiles. The bands' expressions and the entitlement amounts are
 * compiled by their own datatype schemas, so they are already refused by the time this runs.
 *
 * What every scheme's `assessed_on` formula must satisfy: each `code('X')` and every code in a
 * `catalog(...)` pick or exclude names a row of the scheme's own settings version, and a code()
 * that two catalogues carry is refused rather than guessed between. A `year.earned.<code>` is
 * checked the same way. Refused at the write, rather than at the run where the person who typed
 * it is long gone.
 *
 * Leave carries no pricing and no catalogue money: an unpaid or encashed day is an engine-priced
 * reserved line, so `catalog(...)` and `code(...)` name the three money catalogues only.
 */

import { refuse, type CollectionTransformDatabase } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { compileEligibility } from '../collections/payroll_runs/lib/eligibility.js';
import { refuseUnlessDraftOnBoth, type SealedVersion } from './settings_seal.js';
import { assessedOnMentions, compileExpression, type DeclaredKey } from './expressions/compile.js';

const CATALOGUE_FAMILIES = ['ALLOWANCE', 'CLAIM', 'LOAN'] as const;
type CatalogueFamily = (typeof CATALOGUE_FAMILIES)[number];

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
 * The money catalogue codes of every version named, in one wave: the three family reads issued
 * together. A transform reads this beside the versions it checks, so a formula's mentions are
 * judged without a read of their own.
 */
export function catalogueCodesByVersion(
	db: Pick<
		CollectionTransformDatabase,
		'allowance_catalogue' | 'claim_catalogue' | 'loan_catalogue'
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
				db.claim_catalogue.findMany(query),
				db.loan_catalogue.findMany(query)
			],
			{ concurrency: 'unbounded' }
		),
		([allowances, claims, loans]) => {
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
			file('CLAIM', claims);
			file('LOAN', loans);
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
	for (const selection of mentions.catalogues) {
		if (!(CATALOGUE_FAMILIES as readonly string[]).includes(selection.catalogue))
			refuse(
				`${what} selects catalog('${selection.catalogue}'), which is not one of the money ` +
					`catalogues (${CATALOGUE_FAMILIES.join(', ')}).`
			);
		const rows = rowsOf(selection.catalogue as CatalogueFamily);
		for (const code of [...selection.pick, ...selection.exclude])
			if (!rows.has(code))
				refuse(
					`${what} selects ${selection.catalogue} ${code}, which is not a row of its settings ` +
						'version. Add the row to that version first, or take it out of the formula.'
				);
	}
	for (const code of [...mentions.codes, ...mentions.yearEarned]) {
		const carrying = CATALOGUE_FAMILIES.filter((family) => rowsOf(family).has(code));
		if (carrying.length === 0)
			refuse(
				`${what} names ${code}, which is not a row of its settings version. Add the row to that ` +
					'version first, or take it out of the formula.'
			);
		if (carrying.length > 1)
			refuse(
				`${what} names ${code} with code('${code}'), but ${carrying.join(' and ')} both carry it ` +
					'in this version. Select it with catalog(...) instead.'
			);
	}
}

/**
 * Every expression of a stored scheme, checked one by one against the row's declared elections:
 * the rules compile against the scheme context, the `assessed_on` formula against the assessment
 * site, and the formula is not empty — a scheme that charges nothing cannot be sealed.
 */
export function schemeFault(scheme: {
	readonly rules: readonly {
		readonly when: string;
		readonly employee: string;
		readonly employer: string;
	}[];
	readonly assessed_on: string;
	readonly ordinary_on?: string;
	readonly elections: readonly DeclaredKey[];
}): string | null {
	const { rules, assessed_on: assessedOn, elections } = scheme;
	const formula = compileExpression({
		expression: assessedOn,
		site: 'assessment',
		type: 'money',
		elections
	});
	if (formula != null) return `Assessed-on: ${formula}`;
	if ((scheme.ordinary_on ?? '').trim() !== '') {
		const ordinary = compileExpression({
			expression: scheme.ordinary_on ?? '',
			site: 'assessment',
			type: 'money',
			elections
		});
		if (ordinary != null) return `Ordinary-on: ${ordinary}`;
	}
	if (assessedOn.trim() === '')
		return 'Assessed-on: the scheme charges nothing, so it states what it is assessed on.';
	for (const [index, rule] of rules.entries()) {
		const when = compileExpression({
			expression: rule.when,
			site: 'scheme',
			type: 'boolean',
			elections
		});
		if (when != null) return `Rule ${index + 1}: ${when}`;
		const employee = compileExpression({
			expression: rule.employee,
			site: 'scheme',
			type: 'money',
			elections
		});
		if (employee != null) return `Rule ${index + 1} employee: ${employee}`;
		const employer = compileExpression({
			expression: rule.employer,
			site: 'scheme',
			type: 'money',
			elections
		});
		if (employer != null) return `Rule ${index + 1} employer: ${employer}`;
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
