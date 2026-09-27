import { collection, type Id } from '@norbital-ai/bolt';
import { readRange } from '../../../lib/payroll/run/effective.js';
import { factValueFault, type FactKey } from '../../../lib/datatypes/fact_keys.js';
import {
	contractOverlapFault,
	contractReferenceFault,
	contractReferences
} from '../../../lib/employment-contract.js';
import { termsSummary } from '../../../lib/derived-titles.js';
import { dateKey } from '../../../lib/iso-day.js';
import { settingsInForce, stableJson } from '../../../lib/jurisdiction_settings.js';
import { sealedLineages } from '../../../lib/entity-facts.js';

/** Contracts. A referenced contract is frozen and undeletable (the delete guard reads its references). */
const employments = collection('employments', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'employee_id',
				'company_id',
				'employee_number',
				'bank',
				'effective_range',
				'exit_reason',
				'exit_facts',
				'comments'
			],
			with: {
				employment_terms: {
					create: {
						columns: [
							'residency_status',
							'residency_since',
							'currency',
							'base_salary',
							'minimum_wage_2025_region',
							'minimum_wage_2026_area_reclassified',
							'allowances',
							'pay_frequency',
							'work_classification',
							'statutory_work_category',
							'employment_type',
							'department',
							'job_title',
							'payroll_group',
							'paid_rest_days',
							'grade',
							'pass_type',
							'tax_residency',
							'notice_days',
							'ordinary_hours_per_week',
							'shift_pattern_id',
							'effective_range'
						]
					}
				}
			}
		}
	},
	update: {
		input: {
			columns: [
				'employee_id',
				'company_id',
				'employee_number',
				'bank',
				'effective_range',
				'exit_reason',
				'exit_facts',
				'comments',
				// the departure settlement's stamps (leave_encashment_on_exit / _due), granted to their policy alone
				'encashment_due_on',
				'encashment_raised_at'
			]
		}
	},
	delete: { transform: true }
});
export default employments;

/** What a departed contract may still take, and what an open one may change without clearing its references. */
const DEPARTURE_NOTES = new Set(['comments', 'exit_reason', 'exit_facts']);

const lastDayOf = (range: unknown) => {
	const end = readRange(range)?.end;
	return end == null ? null : dateKey(end);
};

/**
 * One contract per employee and entity on any date; every referenced contract is frozen; departure closes the range
 * once and only its notes stay writable after; a paid final payroll fixes the departure inputs; a referenced contract
 * is never deleted (the delete guard reads the same references).
 */
employments.transform(async (inputs, { existing, db, refuse }) => {
	type Candidate = {
		id?: string;
		employee_id?: string | null;
		company_id?: string | null;
		effective_range?: unknown;
		exit_facts?: Readonly<Record<string, unknown>> | null;
	};
	const candidates: Candidate[] = inputs.map((input, index) => ({
		...existing[index],
		...('$delete' in input ? {} : input)
	}));
	const changedKeys = (index: number): string[] => {
		const input = inputs[index]!;
		const stored = existing[index];
		if (stored == null || '$delete' in input) return [];
		return Object.entries(input)
			.filter(
				([key, value]) => stableJson(value) !== stableJson(stored[key as keyof typeof stored])
			)
			.map(([key]) => key);
	};
	const declared = candidates.filter(
		(row, index) => !('$delete' in inputs[index]!) && Object.keys(row.exit_facts ?? {}).length > 0
	);
	const departures = inputs.flatMap((_, index) =>
		changedKeys(index).some((key) => key === 'exit_reason' || key === 'exit_facts')
			? [existing[index]!.id]
			: []
	);
	const changing = inputs.flatMap((input, index) => {
		const stored = existing[index];
		if (stored == null) return [];
		if ('$delete' in input) return [stored.id];
		const changed = changedKeys(index);
		const closed = lastDayOf(stored.effective_range) != null;
		const free = changed.every(
			(key) => DEPARTURE_NOTES.has(key) || (!closed && key === 'effective_range')
		);
		return changed.length > 0 && !free ? [stored.id] : [];
	});
	const people = [
		...new Set(candidates.flatMap((row) => (row.employee_id == null ? [] : [row.employee_id])))
	];
	const entityIds = [
		...new Set(declared.flatMap((row) => (row.company_id == null ? [] : [row.company_id])))
	];
	// One wave: the entities whose law judges departures, paid finals, the person's other contracts, and what
	// references the contracts being changed; then the lineages of those entities.
	const [companies, paid, others, references] = await Promise.all([
		entityIds.length === 0
			? []
			: db
					.read('companies', { where: { id: { in: entityIds as Id<'companies'>[] } }, all: true })
					.then((page) => page.rows),
		departures.length === 0
			? []
			: db
					.read('payslips', {
						where: { employment_id: { in: departures }, status: { eq: 'PAID' } },
						all: true
					})
					.then((page) => page.rows),
		people.length === 0
			? []
			: db
					.read('employments', {
						where: { employee_id: { in: people as Id<'employees'>[] } },
						all: true
					})
					.then((page) => page.rows),
		contractReferences(db, changing)
	]);
	const codes = [...new Set(companies.map((row) => row.settings_code))];
	const versions =
		codes.length === 0 ? [] : (await db.read('jurisdiction_settings', sealedLineages(codes))).rows;

	for (const row of declared) {
		const lastDay = lastDayOf(row.effective_range);
		if (lastDay == null)
			refuse('Departure inputs require a last working day.', { field: 'exit_facts' });
		const code = companies.find((company) => company.id === row.company_id)?.settings_code;
		const version = code == null ? null : settingsInForce(versions, code, lastDay!);
		if (version == null)
			return refuse(
				'Departure inputs require a sealed jurisdiction version on the last working day.',
				{
					field: 'exit_facts'
				}
			);
		for (const [key, value] of Object.entries(row.exit_facts ?? {})) {
			const field = (version.exit_facts as readonly FactKey[]).find(
				(declaration) => declaration.key === key
			);
			if (field == null)
				refuse(`${code} does not declare the departure input ${key}.`, { field: 'exit_facts' });
			const fault = factValueFault(field!, value);
			if (fault != null) refuse(fault, { field: 'exit_facts' });
		}
	}
	for (const [index, row] of candidates.entries()) {
		if ('$delete' in inputs[index]!) continue;
		const lastDay = lastDayOf(row.effective_range);
		if (
			lastDay != null &&
			paid.some(
				(slip) => slip.employment_id === row.id && dateKey(String(slip.terms_through)) >= lastDay
			)
		)
			refuse(
				'Departure calculation inputs are fixed by paid final payroll. Record a separate correction.'
			);
		const peers = [
			...candidates.slice(index + 1).filter((_, at) => !('$delete' in inputs[index + 1 + at]!)),
			...others.filter(
				(other) => other.id !== row.id && !candidates.some((candidate) => candidate.id === other.id)
			)
		];
		const overlap = contractOverlapFault(row, peers);
		if (overlap != null) refuse(overlap, { field: 'effective_range' });
	}
	return inputs.map((input, index) => {
		const stored = existing[index];
		// A contract's first terms arrive nested; their own transform does not run (rule 27), so their derived
		// fields are filled here.
		if (stored == null)
			return '$delete' in input || input.employment_terms?.create == null
				? input
				: {
						...input,
						employment_terms: {
							...input.employment_terms,
							create: input.employment_terms.create.map((terms) => ({
								...terms,
								summary: termsSummary(terms)
							}))
						}
					};
		if (
			!('$delete' in input) &&
			lastDayOf(stored.effective_range) != null &&
			changedKeys(index).includes('effective_range')
		)
			// A closed contract never reopens; a rehire is a new contract.
			refuse('A closed contract cannot be reopened. Create a new contract for a rehire.', {
				field: 'effective_range'
			});
		if (changing.includes(stored.id)) {
			const fault = contractReferenceFault(references, stored.id);
			if (fault != null) refuse(fault);
		}
		return input;
	});
});
