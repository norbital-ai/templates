import {
	boolean,
	custom,
	defineModel,
	enums,
	integer,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

/**
 * One revision of a leave definition.
 *
 * The shared catalogue spine: availability and entitlement are computed on demand. Leave carries
 * no pricing: an unpaid day is priced at the ordinary day wage as `NO_PAY_LEAVE`, and an encashed
 * day at the same rate as `ENCASHMENT`, by the engine. Which schemes read either is each scheme's
 * own `assessed_on` formula. Leave adds its own facts: whether a day is unpaid and after how many
 * days evidence is owed, and whether the row may be encashed at all.
 */
export default defineModel(
	{
		settings_id: uuid().notNull(),
		code: text({ search: true }).notNull(),
		name: text({ search: true }).notNull(),
		/** The section of law the row transcribes; a row that cites one is statutory and the drift automation watches it. */
		authority: text(),
		/**
		 * One CEL expression over the person context (`payroll_runs/lib/eligibility.ts`), evaluated
		 * on the leave year's rule date. `''` is everyone. A row an employee is not eligible for
		 * has no computed entitlement while ineligible, and an unpaid day of it is not deducted.
		 */
		eligibility: text().notNull().default(''),
		/** Whether an entry against this line must, may or need not attach proof. */
		evidence: enums(['NONE', 'OPTIONAL', 'REQUIRED']).notNull().default('NONE'),
		/** An unpaid day is deducted at the ordinary day wage as `NO_PAY_LEAVE`. */
		is_npl: boolean().notNull().default(false),
		/**
		 * The share of the day wage the employer pays for a day of this leave, over the person and
		 * the leave (`leave.month_index`, `leave.day_index`, `leave.days`): `0.5` is half pay (TW
		 * 病假), `leave.month_index <= 4 ? 1.0 : leave.month_index <= 8 ? 0.75 : …` the Indonesian
		 * sick scale. Empty is the whole wage, or none where `is_npl`; the unpaid share is deducted
		 * as `NO_PAY_LEAVE`.
		 */
		pay_fraction: text().notNull().default(''),
		/**
		 * Who pays the leave: the employer through payroll, or a social-insurance FUND outside it
		 * (VN sick, maternity and paternity). A FUND day is no wage from the employer — deducted
		 * like an unpaid day and counted among the month's unpaid days — and the employer's claim
		 * on the fund is not a payroll line.
		 */
		paid_by: enums(['EMPLOYER', 'FUND']).notNull().default('EMPLOYER'),
		/**
		 * The leave code whose pool a day of this leave also draws from: hospitalisation leave that
		 * includes the outpatient days (SG s.89), family-care leave counted inside personal leave
		 * (TW 性平法 §20), joint leave set against annual leave (ID cuti bersama). Null draws from
		 * this row alone.
		 */
		consumes_code: text(),
		/** The unit the leave is taken in: whole and half days, or hours (TW from 2026-01-01). */
		unit: enums(['DAY', 'HOUR']).notNull().default('DAY'),
		/**
		 * Whether the remaining balance of this row may be encashed. A statute that makes a row
		 * non-convertible says so here; an `is_npl` row is never encashable.
		 */
		can_encash: boolean().notNull().default(true),
		/** From this many charged days a certificate is required and checked by the entry transform. */
		evidence_after_days: integer(),
		entitlement: custom('leave_entitlement').notNull()
	},
	{
		description:
			'One leave definition: eligibility, computed entitlement, whether a day is unpaid, whether it may be encashed and the evidence it demands. Manual entries decide carry-forward and encashment.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:calendar-days',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
