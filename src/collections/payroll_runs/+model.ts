import { custom, defineModel, enums, instant, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		company_id: uuid().notNull(),
		period: text({ search: true }).notNull(),
		lifecycle: enums(['DRAFT', 'PAID']).notNull(),
		/** Hash of the selected configuration; holidays retains the published holidays the run read. */
		configuration_hash: text().notNull(),
		/** Annual calendars publish independently of settings; preserve their full selected revisions. */
		holidays: custom('holiday_snapshots').notNull(),
		/** Sealed catalogue/settings version. Independently published calendars are captured alongside it. */
		settings_id: uuid().notNull(),
		/**
		 * The engine/build identity that interpreted the captured configuration. Engine-owned and
		 * stable for a deployed payroll algorithm: a configuration hash identifies data, not code,
		 * and without this the same captured rules could be interpreted differently after an engine
		 * change with no durable explanation on the run.
		 */
		calculation_version: text().notNull(),
		pay_date: instant({ precision: 'day' }).notNull(),
		attendance_from: instant({ precision: 'day' }).notNull(),
		attendance_to: instant({ precision: 'day' }).notNull()
	},
	{
		description:
			'A frozen payroll calculation for a company and period: a month (YYYY-MM) at a monthly company, a half (YYYY-MM-1 for the 1st to the 15th, YYYY-MM-2 for the 16th to the month end) at a semi-monthly one. Exactly one payroll is permitted per company and period. Later approved adjustments settle in a subsequent period. Only drafts can be deleted. The run names the jurisdiction settings version that governed it and the calculation version that produced its outputs.',
		recordLabel: ['period', 'lifecycle'],
		icon: 'lucide:play-circle',
		indexes: [{ columns: ['company_id', 'period'], unique: true }, { columns: ['settings_id'] }]
	}
);
