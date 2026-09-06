import { defineModel, enums, instant, integer, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		company_id: uuid().notNull(),
		period: text({ search: true }).notNull(),
		lifecycle: enums(['DRAFT', 'PAID']).notNull(),
		run_kind: enums(['REGULAR', 'AD_HOC']).notNull().default('REGULAR'),
		sequence: integer().notNull().default(0),
		/**
		 * Hash of the configuration projection the run was priced under (law, catalogue, calendar,
		 * holidays, roster codes). It identifies data, not code, and is recomputable from the sealed
		 * statutory profile named below plus the company's rows in force on `pay_date`; nothing is
		 * copied onto the run. A later run compares hashes to know whether the law it reads is the
		 * law a paid run used.
		 */
		configuration_hash: text().notNull(),
		/**
		 * Hash of the economic inputs the run consumed — terms, facts, entries, loans, year-to-date
		 * consumption — again a fingerprint, never a copy: the captured inputs themselves are the four
		 * `payslip_*_inputs` junctions. An ad hoc run for the same month refuses to proceed when this
		 * differs from the paid regular run's, because it may only add monetary entries. Null on a run
		 * that predates the fingerprint; such a month takes corrections in a later regular payroll.
		 */
		core_input_hash: text(),
		/**
		 * The statutory profile that governed this run — the SEALED `jurisdictions` row in force when
		 * the run was picked, with the pay catalogue sealed beside it. That link plus `pay_date` is the
		 * whole provenance: a sealed profile is immutable (it can only be voided by a successor), so the
		 * rates, bands and catalogue a paid run used can always be re-read exactly, and no copy of them
		 * travels on the run. A real foreign key with `restrict` on the other end.
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
