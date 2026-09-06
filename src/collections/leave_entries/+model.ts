import { defineModel, enums, instant, numeric, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		leave_account_id: uuid().notNull(),
		kind: enums([
			'OPENING_ENTITLEMENT',
			'ACCRUAL',
			'STATUTORY_ADJUSTMENT',
			'POLICY_ADJUSTMENT',
			'CARRY_FORWARD',
			'CARRY_TRANSFER_OUT',
			'TAKEN',
			'RESTORED',
			'ENCASHED',
			'COMMUTED',
			'EXPIRED',
			'MANUAL_ADJUSTMENT'
		]).notNull(),
		effective_on: instant({ precision: 'day' }).notNull(),
		days: numeric().notNull(),
		expires_on: instant({ precision: 'day' }),
		reason: text().notNull(),
		source_key: text().notNull(),
		source_request_id: uuid(),
		leave_plan_id: uuid(),
		statutory_profile_id: uuid()
	},
	{
		description:
			'An immutable signed movement in one leave account. Positive entries grant or restore days; negative entries take, encash, commute or expire them.',
		recordLabel: 'kind',
		icon: 'lucide:list-tree',
		indexes: [
			{ columns: ['leave_account_id', 'effective_on'] },
			{ columns: ['leave_account_id', 'source_key'], unique: true },
			{ columns: ['source_request_id'] }
		]
	}
);
