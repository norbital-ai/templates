import { assertNoOverlap } from '../../lib/effective_range.js';
import type { Hooks } from './$types.js';

const QUERY_LIMIT = 20_000;

type PayComponentRange = {
	readonly norbital_id: string;
	readonly company_id: string;
	readonly code: string;
	readonly effective_range: unknown;
};

function identityKey(companyId: string, code: string): string {
	return `${companyId}\u0000${code}`;
}

export function assertBatchHasNoOverlap(
	inputs: readonly {
		readonly norbital_id?: string;
		readonly company_id: string;
		readonly code: string;
		readonly effective_range?: unknown;
	}[],
	existing: readonly PayComponentRange[]
): void {
	const byIdentity = new Map<string, PayComponentRange[]>();
	for (const row of existing) {
		const key = identityKey(row.company_id, row.code);
		const siblings = byIdentity.get(key);
		if (siblings) siblings.push(row);
		else byIdentity.set(key, [row]);
	}
	for (const [index, input] of inputs.entries()) {
		const key = identityKey(input.company_id, input.code);
		const siblings = byIdentity.get(key) ?? [];
		assertNoOverlap({
			candidate: input.effective_range,
			existing: siblings,
			identity: `pay component ${input.code}`
		});
		siblings.push({
			norbital_id: input.norbital_id ?? `batch:${index}`,
			company_id: input.company_id,
			code: input.code,
			effective_range: input.effective_range
		});
		byIdentity.set(key, siblings);
	}
}

/**
 * Exclusion key (plan 02 §7): company =, code =, effective range &&.
 * A catalogue change is an end-date plus a successor row, never an overlapping duplicate.
 *
 * The database is the guarantee — `pay_components_no_overlap` in +model.ts rejects an overlap with
 * SQLSTATE 23P01 whatever path the write takes, including a concurrent one. This hook is the
 * message: it fails first and names the row and the clash instead of raising a raw constraint
 * violation.
 */
export default {
	create: {
		before: {
			description:
				'Refuses a pay component whose effective range overlaps another component with the same code in the same company, so a payslip line can only ever resolve one definition for that code.',
			batchHandler: async ({ inputs, api }) => {
				if (inputs.length === 0) return inputs;
				const companyIds = [...new Set(inputs.map((input) => input.company_id))];
				const existing = await api.db.query.pay_components.findMany({
					where: { company_id: { in: companyIds } },
					columns: {
						norbital_id: true,
						company_id: true,
						code: true,
						effective_range: true
					},
					limit: QUERY_LIMIT
				});
				if (existing.length === QUERY_LIMIT) {
					throw new Error('This legal entity has too many pay components to validate safely.');
				}
				assertBatchHasNoOverlap(inputs, existing);
				return inputs;
			},
			handler: async ({ input, api }) => {
				const existing = await api.db.query.pay_components.findMany({
					where: { company_id: { eq: input.company_id }, code: { eq: input.code } }
				});
				assertNoOverlap({
					candidate: input.effective_range,
					existing,
					identity: `pay component ${input.code}`
				});
				return input;
			}
		}
	},
	update: {
		before: {
			description:
				'Re-checks an edited pay component so a catalogue change becomes an end-date plus a successor row rather than two versions of one code in force at once.',
			handler: async ({ input, existing, api }) => {
				const company_id = input.company_id ?? existing.company_id;
				const code = input.code ?? existing.code;
				const effective_range = input.effective_range ?? existing.effective_range;
				const siblings = await api.db.query.pay_components.findMany({
					where: { company_id: { eq: company_id }, code: { eq: code } }
				});
				assertNoOverlap({
					candidate: effective_range,
					existing: siblings,
					identity: `pay component ${code}`,
					excludeId: existing.norbital_id
				});
				return input;
			}
		}
	}
} satisfies Hooks;
