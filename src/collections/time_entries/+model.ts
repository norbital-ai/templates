import { custom, date, defineModel, integer, uuid } from '@norbital-ai/pod/authoring';

export default defineModel(
	{
		employment_id: uuid().notNull(),
		work_date: date().notNull(),
		worked_intervals: custom('worked_intervals').notNull(),
		/**
		 * The unpaid break, in whole minutes.
		 *
		 * Minutes are the stored unit because they are exact — every break a rota actually uses is a
		 * whole number of them, and the overtime engine, the payroll export and the customer's
		 * time-entries workbook all measure in them. The operator enters and reads hours; that is
		 * presentation, and it never reinterprets what is stored.
		 */
		break_minutes: integer().notNull().default(0)
	},
	{
		description:
			'Raw worked intervals and unpaid break time for one operational day. Schedule variance, premium work and overtime are derived from attendance, the published schedule and effective rules.',
		recordLabel: 'work_date',
		icon: 'lucide:timer',
		indexes: [{ columns: ['employment_id', 'work_date'] }]
	}
);
