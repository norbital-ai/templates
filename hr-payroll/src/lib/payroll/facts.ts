/**
 * The employment's statutory facts as the person and scheme sites read them: which schemes it is
 * registered with, and since when.
 */
import type { PersonInput } from '../../collections/payroll_runs/lib/eligibility.js';
import type { StatutoryFactStatus } from '../../collections/payroll_runs/lib/contribute.js';
import type { Configuration } from '../../collections/payroll_runs/lib/configuration.js';
import { coversDate } from '../../collections/payroll_runs/lib/effective.js';
import type { IsoDate } from '../../collections/payroll_runs/lib/dates.js';
import type { EmploymentBundle } from '../../collections/payroll_runs/lib/gather.js';
import { refuse } from '@norbital-ai/bolt/authoring';
import { resolveFactValues } from '../declared-facts.js';
import { stableJson } from '../jurisdiction_settings.js';
import { factScopeFault, type FactKey } from '../../datatypes/fact_keys/+definition.js';
import { dateKey } from '../iso-day.js';

type FactRow = Pick<
	EmploymentBundle['statutoryFacts'][number],
	'employment_id' | 'statutory_contribution_id' | 'status' | 'effective_range'
>;

/** A change that lowers the declaration: a dependant count, an enrolment going off. */
function isReduction(previous: unknown, next: unknown): boolean {
	if (typeof previous === 'number' && typeof next === 'number') return next < previous;
	return previous === true && next === false;
}

/**
 * The declared values as of a day, applying each field's .
 *
 * TW art. 5 defers dependant reductions to the January after the event while increases take the
 * event month. A deferred field therefore reads its prior declaration's value until the January
 * following the reduction; every other field of the declaration applies from its own date.
 * `YEAR_START` defers every change the same way (ID PMK 168/2023 art.9(4): the PTKP status on
 * 1 January governs the year); a change declared on 1 January is that day's status.
 */
function deferredElections(options: {
	readonly rows: readonly FactRow[];
	readonly schemeId: string;
	readonly employmentId: string;
	readonly asOf: IsoDate;
	readonly fields: readonly FactKey[];
	readonly status: StatutoryFactStatus;
}): StatutoryFactStatus {
	if (options.status.kind !== 'REGISTERED') return options.status;
	const deferred = options.fields.filter(
		(field) => field.change_effect === 'NEXT_YEAR_JANUARY' || field.change_effect === 'YEAR_START'
	);
	if (deferred.length === 0) return options.status;
	const elections = { ...(options.status.elections ?? {}) };
	for (const field of deferred) {
		const declarations = options.rows
			.filter((row) => row.statutory_contribution_id === options.schemeId)
			.filter((row) => row.employment_id == null || row.employment_id === options.employmentId)
			.flatMap((row) => {
				if (row.status == null || row.status.kind !== 'REGISTERED') return [];
				const elections = row.status.elections ?? {};
				if (!Object.hasOwn(elections, field.key)) return [];
				return [
					{
						start: dateKey(row.effective_range == null ? null : row.effective_range.start) || null,
						value: elections[field.key]
					}
				];
			})
			.filter((row) => row.start != null && row.start <= options.asOf)
			.toSorted((left, right) => left.start!.localeCompare(right.start!));
		if (declarations.length === 0) continue;
		const everyChange = field.change_effect === 'YEAR_START';
		let effective = declarations[0]!.value;
		for (const declaration of declarations.slice(1)) {
			if (
				everyChange ? effective === declaration.value : !isReduction(effective, declaration.value)
			) {
				effective = declaration.value;
				continue;
			}
			const january =
				everyChange && declaration.start!.endsWith('-01-01')
					? declaration.start!
					: `${Number(declaration.start!.slice(0, 4)) + 1}-01-01`;
			if (options.asOf >= january) effective = declaration.value;
		}
		elections[field.key] = effective;
	}
	return { ...options.status, elections };
}

type PersonFactScheme = {
	readonly id: string;
	readonly code: string;
	readonly elections: readonly FactKey[];
};

function selectFactStatusesOn(
	rows: readonly FactRow[],
	asOf: IsoDate,
	employmentId: string,
	schemes: readonly PersonFactScheme[]
): Map<string, StatutoryFactStatus> {
	const selected = new Map<string, FactRow>();
	for (const fact of rows) {
		if (!coversDate(fact.effective_range, asOf) || fact.status == null) continue;
		if (fact.employment_id != null && fact.employment_id !== employmentId) continue;
		const previous = selected.get(fact.statutory_contribution_id);
		if (previous?.employment_id != null && fact.employment_id == null) continue;
		if (
			previous != null &&
			(previous.employment_id ?? null) === (fact.employment_id ?? null) &&
			stableJson(previous.status) !== stableJson(fact.status)
		)
			refuse(
				`Conflicting statutory declarations apply on ${asOf}. Close or correct overlapping declarations before calculating payroll.`
			);
		selected.set(fact.statutory_contribution_id, fact);
	}
	const fields = new Map(schemes.map((scheme) => [scheme.id, scheme.elections]));
	const facts = new Map<string, StatutoryFactStatus>();
	for (const [schemeId, fact] of selected) {
		if (fact.status.kind === 'REGISTERED') {
			const fault = factScopeFault(
				fields.get(schemeId) ?? [],
				fact.status.elections ?? {},
				fact.employment_id
			);
			if (fault != null) refuse(fault);
		}
		facts.set(
			schemeId,
			deferredElections({
				rows,
				schemeId,
				employmentId,
				asOf,
				fields: fields.get(schemeId) ?? [],
				status: fact.status
			})
		);
	}
	return facts;
}

/** The statutory facts in force on a day, by scheme id. */
export function factStatusesOn(
	rows: EmploymentBundle['statutoryFacts'],
	asOf: IsoDate,
	employmentId: string,
	contributions: Configuration['contributions']
): Map<string, StatutoryFactStatus> {
	return selectFactStatusesOn(
		rows,
		asOf,
		employmentId,
		contributions.map((scheme) => scheme.row)
	);
}

/** Resolve dated personal facts for one employment without exposing payroll's wrapped config rows. */
export function personFactsOn(
	rows: readonly FactRow[],
	schemes: readonly PersonFactScheme[],
	asOf: IsoDate,
	employmentId: string
): NonNullable<PersonInput['facts']> {
	return personFactsFromSchemes(schemes, selectFactStatusesOn(rows, asOf, employmentId, schemes));
}

/** The facts as the person site reads them: one row per scheme of the version, registered or not. */
export function personFacts(
	contributions: Configuration['contributions'],
	facts: ReadonlyMap<string, StatutoryFactStatus>
): NonNullable<PersonInput['facts']> {
	return personFactsFromSchemes(
		contributions.map((scheme) => scheme.row),
		facts
	);
}

function personFactsFromSchemes(
	schemes: readonly PersonFactScheme[],
	facts: ReadonlyMap<string, StatutoryFactStatus>
): NonNullable<PersonInput['facts']> {
	return schemes.map((scheme) => {
		const status = facts.get(scheme.id);
		return {
			code: scheme.code,
			registered: status?.kind === 'REGISTERED',
			since: status?.kind === 'REGISTERED' ? (status.since ?? null) : null,
			elections: resolveFactValues(
				scheme.elections,
				status?.kind === 'REGISTERED' ? (status.elections ?? {}) : {},
				scheme.code,
				false
			),
			election_keys: status?.kind === 'REGISTERED' ? Object.keys(status.elections ?? {}) : []
		};
	});
}
