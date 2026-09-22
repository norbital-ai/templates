/**
 * The allowances a contract lists, read off its terms rows. A leaf the wage walk, the money
 * requests and the schemes all read; the steps that price the allowances live in
 * `allowances.ts`.
 */

import { decodeNumber } from '@norbital-ai/std/json';
import type { EmploymentBundle } from '../../collections/payroll_runs/lib/gather.js';
import type {
	CatalogueComponent,
	Configuration
} from '../../collections/payroll_runs/lib/configuration.js';
import { coversDate } from '../../collections/payroll_runs/lib/effective.js';
import type { IsoDate } from '../../collections/payroll_runs/lib/dates.js';
import type { ContractAllowance } from '../../datatypes/contract_allowances/+definition.js';

type Terms = EmploymentBundle['terms'][number];

/** The classes a terms row lists; a row that states none lists none. */
export const listedAllowances = (terms: Terms): readonly ContractAllowance[] =>
	Array.isArray(terms.allowances) ? (terms.allowances as readonly ContractAllowance[]) : [];

/**
 * The class a contract lists, as the period's version prices it. The listing names the row of
 * the version the contract was signed under; the code is the class's identity across versions,
 * so a later sealed version prices the same allowance by its own bands and rules. A code the
 * period's version no longer offers resolves to nothing.
 */
export function contractAllowanceClass(
	configuration: Pick<Configuration, 'catalogueComponents' | 'allowanceCodeById'>,
	catalogueId: string
): CatalogueComponent | undefined {
	const code = configuration.allowanceCodeById.get(catalogueId);
	return configuration.catalogueComponents.find(
		(row) =>
			row.family === 'ALLOWANCE' && (code == null ? row.id === catalogueId : row.code === code)
	);
}

/**
 * The standing allowances in force on a day, summed: `terms.fixed_allowances`, and with the
 * wage the "one month's wage" a statute defines as basic plus fixed allowances (ID THR and the
 * BPJS bases, VN's insurance salary, MY's termination benefit). Where a scheme asks, only the
 * classes that count toward it (VN's insurance-equivalent allowance is on the contract but
 * enters no insurance base); a person-site reader takes them all.
 */
export function contractAllowancesOn(
	bundle: EmploymentBundle,
	configuration: Configuration,
	asOf: IsoDate,
	scheme?: string,
	/** Allowance codes left out of the sum (a gross rate's statutory exclusions). */
	exclude: readonly string[] = []
): number {
	const terms = bundle.termsHistory.find((row) => coversDate(row.effective_range, asOf));
	if (terms == null) return 0;
	return listedAllowances(terms).reduce((sum, listed) => {
		const component = contractAllowanceClass(configuration, listed.catalogue_id);
		if (
			component == null ||
			component.destination !== 'PAY' ||
			component.direction !== 'ADD' ||
			exclude.includes(component.code)
		)
			return sum;
		if (
			scheme != null &&
			!(component.counts_toward ?? []).some(
				(entry) => entry === scheme || entry.startsWith(`${scheme}.`)
			)
		)
			return sum;
		return sum + decodeNumber(listed.amount);
	}, 0);
}
