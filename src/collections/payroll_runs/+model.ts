import { custom, defineModel, instant, sql, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		company_id: uuid().notNull(),
		period: text({ search: true }).notNull(),
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
		attendance_to: instant({ precision: 'day' }).notNull(),
		/**
		 * How each charge was derived: per payslip, every scheme's base lines, producer reads,
		 * governing rule and shares. Engine-owned and frozen with the run; the Flow screen renders
		 * it, nothing consumes it in a calculation.
		 */
		calculation_trace: custom('payroll_trace')
			.notNull()
			.default(sql`'[]'::jsonb`),
		/**
		 * The COMPANY-assessed schemes' charges: one row for the whole run, over the sum of every
		 * payslip's money, after the employment schemes. The employer's own levy — it is on no
		 * payslip, so a reader adds it to the run's employer cost.
		 */
		company_charges: custom('payslip_statutory', { multiple: true })
			.notNull()
			.default(sql`'[]'::jsonb`),
		/**
		 * What the engine noticed but did not refuse — a day past the hours-of-work limit, an
		 * instalment net pay could not carry — one sentence per line, frozen with the run so the
		 * operator reads them where the run is, not in a host log.
		 */
		warnings: text().notNull().default('')
	},
	{
		description:
			'A frozen payroll calculation for a company and period: a month (YYYY-MM) at a monthly company, a half (YYYY-MM-1 for the 1st to the 15th, YYYY-MM-2 for the 16th to the month end) at a semi-monthly one. Exactly one payroll is permitted per company and period. Later approved adjustments settle in a subsequent period. Payment lives on the payslips; the run carries no state of its own and only an unpaid run can be deleted. The run names the jurisdiction settings version that governed it and the calculation version that produced its outputs.',
		recordLabel: ['period'],
		icon: 'lucide:play-circle',
		indexes: [{ columns: ['company_id', 'period'], unique: true }, { columns: ['settings_id'] }]
	}
);
