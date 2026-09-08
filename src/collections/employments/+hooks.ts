import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { stableJson } from '../../lib/jurisdiction_settings.js';
import {
	assertContractDoesNotOverlap,
	assertContractUnreferenced,
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
							with: { employment_departure: { where: { approval_id: { isNull: true } } } },
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
					with: { employment_departure: { where: { approval_id: { isNull: true } } } },
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
					'Enforce one active contract per employee and entity; permanently freeze every referenced contract.',
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
							return { ...input, ...(parentColumn == null ? {} : { [parentColumn]: parent!.id }) };
						const changed = Object.entries(input).some(
							([key, value]) =>
								key !== 'id' &&
								key !== 'row_version' &&
								stableJson(value) !== stableJson(Reflect.get(existing, key))
						);
						if (changed) yield* assertContractUnreferenced(api, existing.id);
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
