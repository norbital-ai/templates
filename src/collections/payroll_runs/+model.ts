import {
	custom,
	defineModel,
	enums,
	instant,
	integer,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		company_id: uuid().notNull(),
		period: text({ search: true }).notNull(),
		lifecycle: enums(['DRAFT', 'PAID']).notNull(),
		run_kind: enums(['REGULAR', 'AD_HOC']).notNull().default('REGULAR'),
		sequence: integer().notNull().default(0),
		configuration_hash: text().notNull(),
		configuration_snapshot: custom('payroll_configuration_snapshot').notNull(),
		/**
		 * The statutory snapshot that governed this run's calculation — the effective-dated
		 * `jurisdictions` row in force when the run was picked. Engine-owned, written atomically
		 * with the configuration snapshot and the payslips, and a real foreign key with `restrict`
		 * on the other end: a snapshot a paid run used is an append-only historical record, and
		 * legislation changes create a new effective-dated row rather than editing this one.
		 */
		statutory_snapshot_id: uuid().notNull(),
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
			'A frozen payroll calculation for a company and month. Sequence zero is regular payroll; subsequent ad hoc runs pay the cumulative monthly difference. Only drafts can be deleted. The run names the statutory snapshot that governed it and the calculation version that produced its outputs.',
		recordLabel: ['period', 'lifecycle'],
		icon: 'lucide:play-circle',
		indexes: [
			{ columns: ['company_id', 'period', 'sequence'], unique: true },
			{ columns: ['statutory_snapshot_id'] }
		]
	}
);
