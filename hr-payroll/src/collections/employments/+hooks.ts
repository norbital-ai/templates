import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { stableJson } from '../../lib/jurisdiction_settings.js';
import { readRange } from '../payroll_runs/lib/effective.js';
import {
	assertContractDoesNotOverlap,
	assertContractUnreferenced,
	nextContractNumber,
	type ContractCandidate
} from '../../lib/employment-contract.js';
import type { Hooks } from './$types.js';

type Prepared = {
	candidates: ContractCandidate[];
	stored: ContractCandidate[];
	pending: ContractCandidate[];
};
const LIMIT = 20_000;

export default {
	mutate: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const ids = inputs.flatMap((row) => (row.id == null ? [] : [row.id]));
				const priors = ids.length
					? yield* api.db.employments.findMany({
							where: { id: { in: ids } },
							limit: LIMIT
						})
					: [];
				const byId = new Map(priors.map((row) => [row.id, row]));
				const candidates = inputs.map((input) => ({ ...byId.get(input.id ?? ''), ...input }));
				const companyIds = [
					...new Set(candidates.flatMap((row) => (row.company_id == null ? [] : [row.company_id])))
				];
				const employeeIds = [
					...new Set(
						candidates.flatMap((row) => (row.employee_id == null ? [] : [row.employee_id]))
					)
				];
				// Nested ownership is supplied to per-record hooks. Until then, retain the wider
				// guarded read so an omitted parent foreign key cannot hide an existing contract.
				const where = {
					...(candidates.every((row) => row.company_id != null)
						? { company_id: { in: companyIds } }
						: {}),
					...(candidates.every((row) => row.employee_id != null)
						? { employee_id: { in: employeeIds } }
						: {})
				};
				const stored = yield* api.db.employments.findMany({
					where,
					limit: LIMIT
				});
				const pending = yield* api.db.employments.findPending({ where, limit: LIMIT });
				const storedById = new Map(stored.map((row) => [row.id, row]));
				return {
					candidates,
					stored,
					pending: pending.map((row) => ({ ...storedById.get(row.id), ...row }))
				};
			}),
		perRecord: {
			before: {
				description:
					'Enforce one contract per employee and entity on any date; permanently freeze every referenced contract; departure closes the range once and only comments stay writable after.',
				handler: ({ input, existing, recordId, prepared, parent, api }) =>
					Effect.gen(function* () {
						if (prepared.stored.length >= LIMIT || prepared.pending.length >= LIMIT)
							refuse(
								'The employment contract read reached its safety ceiling. Contract exclusivity cannot be verified.'
							);
						const parentColumn =
							parent?.collection === 'employees' && parent.column === 'employee_id'
								? 'employee_id'
								: parent?.collection === 'companies' && parent.column === 'company_id'
									? 'company_id'
									: undefined;
						const bindParent = (row: ContractCandidate) => {
							if (parentColumn == null || parent == null) return row;
							if (row[parentColumn] != null && row[parentColumn] !== parent.id)
								refuse('A nested contract must use its enclosing employee or legal entity.');
							return { ...row, [parentColumn]: parent.id };
						};
						const candidates = prepared.candidates.map(bindParent);
						for (const [index, candidate] of candidates.entries())
							assertContractDoesNotOverlap(candidate, candidates.slice(index + 1));
						const held = prepared.stored.find((row) => row.id === recordId);
						const candidate = bindParent({ ...held, ...existing, ...input });
						assertContractDoesNotOverlap(
							candidate,
							[...prepared.stored, ...prepared.pending].filter((row) => row.id !== recordId)
						);
						if (existing == null)
							return {
								...input,
								...(parentColumn == null ? {} : { [parentColumn]: parent!.id }),
								// The stint's rolling number is the hook's, not the operator's: one past the
								// person's highest contract at this entity, pending rehires included.
								contract_number: nextContractNumber(
									candidate,
									[...prepared.stored, ...prepared.pending].filter((row) => row.id !== recordId)
								)
							};
						const differs = ([key, value]: [string, unknown]) =>
							key !== 'id' &&
							key !== 'row_version' &&
							stableJson(value) !== stableJson(Reflect.get(existing, key));
						const changed = Object.entries(input)
							.filter(differs)
							.map(([key]) => key);
						const departureNote = (key: string) => key === 'comments' || key === 'exit_reason';
						const onlyComments = changed.length > 0 && changed.every(departureNote);
						if (readRange(existing.effective_range)?.end != null) {
							// A closed contract never reopens; a rehire is a new contract.
							if (changed.includes('effective_range'))
								refuse('A closed contract cannot be reopened. Create a new contract for a rehire.');
							if (!onlyComments && changed.length > 0)
								yield* assertContractUnreferenced(api, existing.id);
							return input;
						}
						// An open contract closes its range (departure) and keeps comments freely;
						// anything else must clear the seal first.
						const onlyCloseAndComments = changed.every(
							(key) => departureNote(key) || key === 'effective_range'
						);
						if (!onlyCloseAndComments && changed.length > 0)
							yield* assertContractUnreferenced(api, existing.id);
						return input;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Keep every employment contract that has ever been referenced.',
				handler: ({ existing, api }) => assertContractUnreferenced(api, existing.id)
			}
		}
	}
} satisfies Hooks<Prepared>;
