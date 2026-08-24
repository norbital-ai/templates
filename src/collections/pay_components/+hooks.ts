import { assertNoOverlap, guardEffectiveRange } from '../../lib/effective_range.js';
import type { HookApi, Hooks, WorkspaceRow } from './$types.js';

type CreateInput = Parameters<
	NonNullable<
		NonNullable<NonNullable<NonNullable<Hooks['create']>['perRecord']>['before']>['handler']
	>
>[0]['input'];

const QUERY_LIMIT = 20_000;

type PayComponentRange = Pick<
	WorkspaceRow<'pay_components'>,
	'id' | 'company_id' | 'code' | 'effective_range'
>;

function identityKey(companyId: string, code: string): string {
	return `${companyId}\u0000${code}`;
}

export function assertBatchHasNoOverlap(
	inputs: readonly CreateInput[],
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
		// Seeded batches carry the row id the seed assigned; interactive ones do not.
		const assignedId = Reflect.get(input, 'id');
		siblings.push({
			id: typeof assignedId === 'string' && assignedId !== '' ? assignedId : `batch:${index}`,
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

/** The stored rows that share a candidate's exclusion key. */
const siblings = (api: HookApi, company_id: string, code: string) =>
	api.db.query.pay_components.findMany({
		where: { company_id: { eq: company_id }, code: { eq: code } }
	});

/** The exclusion key as a stored row holds it. */
type Keyed = Readonly<{ company_id: string; code: string }>;

/** An edit carries only the fields it changes, so the key is read through the stored row. */
const editedSiblings = (
	api: HookApi,
	input: Readonly<{ company_id?: string | null; code?: string | null }>,
	existing: Keyed
) => siblings(api, input.company_id ?? existing.company_id, input.code ?? existing.code);

export default {
	create: {
		perRecord: {
			before: {
				description:
					'Refuses a pay component whose effective range overlaps another component with the same code in the same company, so a payslip line can only ever resolve one definition for that code.',
				handler: ({ input, api }) =>
					guardEffectiveRange(
						siblings(api, input.company_id, input.code),
						input.effective_range,
						`pay component ${input.code}`,
						input
					)
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Re-checks an edited pay component so a catalogue change becomes an end-date plus a successor row rather than two versions of one code in force at once.',
				handler: ({ input, existing, api }) =>
					guardEffectiveRange(
						editedSiblings(api, input, existing),
						input.effective_range ?? existing.effective_range,
						`pay component ${input.code ?? existing.code}`,
						input,
						existing.id
					)
			}
		}
	}
} satisfies Hooks;
