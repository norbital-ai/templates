import { defineModel, instant, numeric, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employment_id: uuid().notNull(),
		leave_type_id: uuid().notNull(),
		event_reference: text({ search: true }).notNull(),
		qualifying_date: instant({ precision: 'day' }).notNull(),
		starts_on: instant({ precision: 'day' }).notNull(),
		expires_on: instant({ precision: 'day' }).notNull(),
		allocated_days: numeric().notNull(),
		eligibility_evidence: text().notNull()
	},
	{
		description:
			'An approved, finite allocation for one qualifying event, such as birth, adoption or bereavement. HR verifies eligibility, any shared household allocation and the conversion to scheduled workdays. Requests consume this allocation across leave years until its inclusive expiry date.',
		recordLabel: 'event_reference',
		icon: 'lucide:calendar-check',
		indexes: [{ columns: ['employment_id', 'leave_type_id', 'event_reference'], unique: true }]
	}
);
