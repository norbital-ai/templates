import { custom, defineModel, text, uuid } from '@norbital-ai/bolt/authoring';

/** One Work definition governs the payroll scope of a settings version. */
export default defineModel(
	{
		settings_id: uuid().notNull(),
		proration: custom('proration_basis').notNull(),
		ordinary_rate: custom('ordinary_rate').notNull(),
		regime: custom('statutory_regime').notNull(),
		/**
		 * Scheme × {salary, overtime, overtime_excess, absence}: how each scheme charges the four pay
		 * lines Work produces. Their codes and orders are constants (`pay-items.ts`).
		 */
		treatments: custom('work_treatments').notNull(),
		/** The instrument the regime transcribes; one citation for the row. */
		authority: text()
	},
	{
		description:
			'Work calculation rules: proration, the ordinary rate, the working-time regime and how each scheme charges salary, overtime and unexplained absence. Owned by one settings version; holiday dates are resolved separately for its jurisdiction.',
		icon: 'lucide:clock',
		indexes: [{ columns: ['settings_id'], unique: true }]
	}
);
