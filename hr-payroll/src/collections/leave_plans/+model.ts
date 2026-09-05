import { custom, defineModel, enums, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		company_id: uuid().notNull(),
		code: text({ search: true }).notNull(),
		name: text({ search: true }).notNull(),
		lifecycle: enums(['DRAFT', 'ACTIVE', 'RETIRED']).notNull().default('DRAFT'),
		transition: enums(['FULL_AT_EFFECTIVE_DATE', 'PRORATE_REMAINDER', 'NEXT_LEAVE_YEAR'])
			.notNull()
			.default('NEXT_LEAVE_YEAR'),
		effective_range: custom('instant_range', { precision: 'day' }).notNull(),
		supersedes_id: uuid(),
		change_note: text().notNull()
	},
	{
		description:
			'One effective-dated company leave-plan version. HR prepares a DRAFT; one policy approval activates it; ACTIVE and RETIRED versions are immutable evidence.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:notebook-tabs',
		indexes: [
			{ columns: ['company_id', 'code'] },
			{ columns: ['supersedes_id'], unique: true, where: '"supersedes_id" IS NOT NULL' }
		]
	}
);
