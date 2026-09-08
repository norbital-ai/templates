import { custom, defineModel, text, uuid } from '@norbital-ai/bolt/authoring';

/** One Work definition governs the payroll scope of a settings version. */
export default defineModel(
	{
		settings_id: uuid().notNull(),
		code: text({ search: true }).notNull(),
		proration: custom('proration_basis').notNull(),
		ordinary_rate: custom('ordinary_rate').notNull(),
		regime: custom('statutory_regime').notNull(),
		salary: custom('pay_item_metadata').notNull(),
		overtime: custom('pay_item_metadata').notNull(),
		overtime_excess: custom('pay_item_metadata').notNull(),
		// Required when a run contains unexplained absence; omission never selects a leave type.
		absence: custom('pay_item_metadata')
	},
	{
		description:
			'Work calculation rules and the payroll metadata of salary, overtime and unexplained absence. Owned by one settings version; holiday dates are resolved separately for its jurisdiction.',
		recordLabel: 'code',
		icon: 'lucide:clock',
		indexes: [{ columns: ['settings_id'], unique: true }]
	}
);
