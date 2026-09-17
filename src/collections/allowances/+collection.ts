import { Effect } from 'effect';
import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';
import model from './+model.js';
import { boundToContract } from '../../lib/employment-contract.js';
import { capSubjects } from '../../lib/component_entry_cap_subject.js';
import { compileEligibility, isEligible } from '../../collections/payroll_runs/lib/eligibility.js';
import { dateKey } from '../../lib/iso-day.js';

const columns = {
	employment_id: true,
	catalogue_id: true,
	amount: true,
	effective_from: true,
	effective_to: true,
	reason: true,
	evidence_file: true,
	as_adjustment_entry: true
} as const;

const LIMIT = 10_000;

/**
 * A standing allowance: a positive monthly amount of one catalogue item over a window, bound to a
 * contract and offered only to the people the catalogue row names on the day it opens.
 *
 * No ceiling is checked here: the run bounds each period's entry by the band's limit, so the
 * declaration itself is never refused by an annual cap. Once a payslip has priced it the amount,
 * the item, the person and the opening day are history; only the closing day may still move, and
 * never back over a period already priced.
 */
export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const candidates = inputs.map((input, index) => ({ ...existing[index], ...input }));
			const catalogueIds = [
				...new Set(candidates.map((row) => String(row.catalogue_id ?? '')).filter(Boolean))
			];
			const employmentIds = [
				...new Set(candidates.map((row) => String(row.employment_id ?? '')).filter(Boolean))
			];
			const storedIds = existing.flatMap((row) => (row == null ? [] : [row.id]));
			const [components, subjectOf, entries] = yield* Effect.all(
				[
					catalogueIds.length === 0
						? Effect.succeed([])
						: db.allowance_catalogue.findMany({
								where: { id: { in: catalogueIds } },
								columns: { id: true, code: true, evidence: true, eligibility: true },
								limit: catalogueIds.length
							}),
					capSubjects(db, employmentIds),
					storedIds.length === 0
						? Effect.succeed([])
						: db.allowance_entries.findMany({
								where: { derived_from_id: { in: storedIds } },
								columns: { derived_from_id: true, to: true },
								limit: LIMIT
							})
				],
				{ concurrency: 'unbounded' }
			);
			if (entries.length >= LIMIT) refuse('The allowance entry history exceeds the read limit.');
			const componentById = new Map(components.map((row) => [row.id, row]));
			return inputs.map((input, index) => {
				const stored = existing[index];
				const candidate = candidates[index]!;
				const amount = decodeNumber(candidate.amount);
				if (!Number.isFinite(amount) || amount <= 0)
					refuse(
						'An allowance amount is a positive magnitude; direction comes from the catalogue.'
					);
				const from = dateKey(candidate.effective_from);
				const to = candidate.effective_to == null ? null : dateKey(candidate.effective_to);
				if (from === '') refuse('An allowance states the day it starts.');
				if (to != null && to < from) refuse('An allowance cannot end before it starts.');
				if (stored != null) {
					const priced = entries
						.filter((row) => row.derived_from_id === stored.id)
						.map((row) => dateKey(row.to))
						.toSorted()
						.at(-1);
					if (priced != null) {
						const frozen = (
							['employment_id', 'catalogue_id', 'amount', 'effective_from'] as const
						).find((key) => input[key] !== undefined && String(input[key]) !== String(stored[key]));
						if (frozen != null)
							refuse(
								`A payslip has priced this allowance, so its ${frozen.replaceAll('_', ' ')} is history. End it and create a new one.`
							);
						if (to != null && to < priced)
							refuse(
								`A payslip has priced this allowance through ${priced}; it cannot end before that day.`
							);
					}
				}
				// An unknown catalogue item is the foreign key's refusal, on every path including the seed.
				const component = componentById.get(String(candidate.catalogue_id ?? ''));
				if (component != null) {
					const eligibilityFault = compileEligibility(component.eligibility);
					if (eligibilityFault != null) refuse(eligibilityFault);
					if (component.evidence === 'REQUIRED' && candidate.evidence_file == null)
						refuse(
							`Component ${component.code} requires evidence for its allowances. Attach a receipt.`
						);
					const person = subjectOf(String(candidate.employment_id ?? ''), from);
					if (
						person != null &&
						component.eligibility.trim() !== '' &&
						!isEligible(component.eligibility, person.subject)
					)
						refuse(
							`${component.code} is not offered to ${person.label}: its eligibility rule does not hold for them.`
						);
				}
				return boundToContract(input, stored);
			});
		})
});
