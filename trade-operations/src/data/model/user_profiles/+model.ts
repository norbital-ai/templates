import { Effect } from 'effect';
import { model, type WriteCtx } from '@norbital-ai/bolt';

const KINGDEE_ID = /^[1-9]\d{0,9}$/;
const MAX_SQL_INT = 2147483647;
const kingdeeIdFields = [
	'kingdee_employee_id',
	'kingdee_department_id',
	'kingdee_biller_id',
	'kingdee_customer_id'
] as const;

type KingdeeIdSet = Partial<Record<(typeof kingdeeIdFields)[number], string | null | undefined>>;

function normalizeKingdeeId(value: string | null | undefined): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	const trimmed = value.trim();
	return trimmed === '' ? null : trimmed;
}

function validKingdeeId(value: string): boolean {
	return KINGDEE_ID.test(value) && Number(value) <= MAX_SQL_INT;
}

const normalizeProfileSets = Effect.fnUntraced(function* <T extends KingdeeIdSet>(
	changes: readonly { readonly set: T }[],
	ctx: WriteCtx<'user_profiles'>
) {
	const sets: T[] = [];
	for (const [i, { set }] of changes.entries()) {
		let next: T = { ...set };
		for (const field of kingdeeIdFields) {
			const normalized = normalizeKingdeeId(next[field]);
			if (normalized !== undefined) {
				if (normalized !== null && !validKingdeeId(normalized))
					return yield* ctx.refuse('errors.kingdee_id_invalid', { row: i, field });
				next = { ...next, [field]: normalized };
			}
		}
		sets.push(next);
	}
	return sets;
});

/** Per-user workspace profile carrying Kingdee employee/department/biller/customer bindings and contact details. */
export default model('user_profiles', {
	description: 'User profile with Kingdee employee, department, biller and customer identifiers.',
	icon: 'lucide:id-card',
	record_label: 'record.name',
	fields: {
		user_id: { kind: 'ref', to: 'sys_user' },
		name: { kind: 'text' },
		kingdee_employee_id: { kind: 'text', optional: true },
		kingdee_department_id: { kind: 'text', optional: true },
		kingdee_biller_id: { kind: 'text', optional: true },
		kingdee_customer_id: { kind: 'text', optional: true },
		phone: { kind: 'text', format: 'phone', optional: true },
		notes: { kind: 'text', optional: true }
	},
	constraints: { user: { unique: ['user_id'] } },
	indexes: { search: { text: ['name', 'kingdee_employee_id', 'kingdee_customer_id'] } },
	outputs: { default: { fields: 'all' } },
	create: {
		fields: [
			'user_id',
			'name',
			'kingdee_employee_id',
			'kingdee_department_id',
			'kingdee_biller_id',
			'kingdee_customer_id',
			'phone',
			'notes'
		],
		transform: function* (changes, ctx) {
			return yield* normalizeProfileSets(changes, ctx);
		}
	},
	update: {
		fields: [
			'name',
			'kingdee_employee_id',
			'kingdee_department_id',
			'kingdee_biller_id',
			'kingdee_customer_id',
			'phone',
			'notes'
		],
		transform: function* (changes, ctx) {
			return yield* normalizeProfileSets(changes, ctx);
		}
	},
	delete: {}
});
