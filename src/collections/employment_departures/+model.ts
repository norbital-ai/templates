import { defineModel, enums, instant, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employment_id: uuid().notNull(),
		exit_date: instant({ precision: 'day' }).notNull(),
		exit_reason: enums([
			'RESIGNATION',
			'END_OF_CONTRACT',
			'TERMINATION',
			'RETRENCHMENT',
			'MISCONDUCT',
			'RETIREMENT',
			'DEATH',
			'OTHER'
		]).notNull(),
		note: text()
	},
	{
		description:
			'The actual end of one employment contract. This immutable fact changes its service window without editing the sealed contract or creating payments.',
		recordLabel: ['exit_date', 'exit_reason'],
		icon: 'lucide:log-out',
		indexes: [{ columns: ['employment_id'], unique: true }]
	}
);
