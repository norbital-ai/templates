import { Effect } from 'effect';
import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import model from './+model.js';
import { stableJson } from '../../lib/jurisdiction_settings.js';
import { readRange } from '../payroll_runs/lib/effective.js';
import {
	assertContractDoesNotOverlap,
	assertContractUnreferenced,
	contractReferences,
	nextContractNumber,
	type ContractCandidate
} from '../../lib/employment-contract.js';

const columns = {
	employee_id: true,
	company_id: true,
	employee_number: true,
	bank: true,
	effective_range: true,
	exit_reason: true,
	comments: true
} as const;

/** A new contract may bring its first terms; the engine fills the employment they belong to. */
const terms = {
	create: {
		columns: {
			residency_status: true,
			residency_since: true,
			base_salary: true,
			allowances: true,
			pay_frequency: true,
			work_classification: true,
			statutory_work_category: true,
			employment_type: true,
			department: true,
			job_title: true,
			payroll_group: true,
			grade: true,
			pass_type: true,
			tax_residency: true,
			notice_days: true,
			ordinary_hours_per_week: true,
			shift_pattern_id: true,
			effective_range: true
		}
	}
} as const;

const LIMIT = 20_000;

/**
 * One contract per employee and entity on any date; every referenced contract is frozen;
 * departure closes the range once and only comments stay writable after. The stint's rolling
 * `contract_number` is derived here, never submitted. Deleting a referenced contract is refused
 * by the delete grant (`peopleGrants`), which reads the same references.
 */
export default defineCollection({
	model,
	create: { input: { columns, with: { term_employment: terms } } },
	update: { input: { columns } },
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const candidates = inputs.map((input, index) => ({ ...existing[index], ...input }));
			const employeeIds = [
				...new Set(candidates.flatMap((row) => (row.employee_id == null ? [] : [row.employee_id])))
			];
			const changing = inputs.flatMap((input, index) => {
				const stored = existing[index];
				if (stored == null) return [];
				const changed = Object.keys(input).filter(
					(key) =>
						key !== 'id' &&
						key !== 'row_version' &&
						stableJson(input[key as keyof typeof input]) !==
							stableJson(stored[key as keyof typeof stored])
				);
				const departureNote = (key: string) => key === 'comments' || key === 'exit_reason';
				const closed = readRange(stored.effective_range)?.end != null;
				const free = closed
					? changed.every(departureNote)
					: changed.every((key) => departureNote(key) || key === 'effective_range');
				return changed.length > 0 && !free ? [stored.id] : [];
			});
			// One wave: the person's other contracts, and what references the ones being changed.
			const [stored, references] = yield* Effect.all(
				[
					employeeIds.length === 0
						? Effect.succeed([])
						: db.employments.findMany({
								where: { employee_id: { in: employeeIds } },
								limit: LIMIT
							}),
					contractReferences(db, changing)
				],
				{ concurrency: 'unbounded' }
			);
			if (stored.length >= LIMIT)
				refuse(
					'The employment contract read reached its safety ceiling. Contract exclusivity cannot be verified.'
				);
			for (const [index, candidate] of candidates.entries())
				assertContractDoesNotOverlap(candidate, candidates.slice(index + 1));
			return inputs.map((input, index) => {
				const candidate = candidates[index]!;
				const recordId = existing[index]?.id;
				const others: ContractCandidate[] = stored.filter((row) => row.id !== recordId);
				assertContractDoesNotOverlap(candidate, others);
				const held = existing[index];
				if (held == null)
					return {
						...input,
						// The stint's rolling number is derived, not the operator's: one past the
						// person's highest contract at this entity, pending rehires included.
						contract_number: nextContractNumber(candidate, others)
					};
				const changed = Object.keys(input).filter(
					(key) =>
						key !== 'id' &&
						key !== 'row_version' &&
						stableJson(input[key as keyof typeof input]) !==
							stableJson(held[key as keyof typeof held])
				);
				if (readRange(held.effective_range)?.end != null && changed.includes('effective_range'))
					// A closed contract never reopens; a rehire is a new contract.
					refuse('A closed contract cannot be reopened. Create a new contract for a rehire.');
				// An open contract closes its range (departure) and keeps comments freely;
				// anything else must clear the seal first.
				if (changing.includes(held.id)) assertContractUnreferenced(references, held.id);
				return input;
			});
		})
});
