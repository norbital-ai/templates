import { defineModel, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		/** The scheme whose employee share is a relief. */
		relieving_id: uuid().notNull(),
		/** The scheme the relief reduces the chargeable income of. */
		relieved_id: uuid().notNull()
	},
	{
		description:
			'One scheme-to-scheme relief: the relieving scheme’s employee share reduces the relieved scheme’s chargeable income, and is produced before it. Both ends live in one settings version and are cloned with it.',
		recordLabel: ['relieving_id', 'relieved_id'],
		icon: 'lucide:hand-coins',
		indexes: [{ columns: ['relieving_id', 'relieved_id'], unique: true }]
	}
);
