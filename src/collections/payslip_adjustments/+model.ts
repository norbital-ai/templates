import {
	custom,
	defineModel,
	enums,
	integer,
	numeric,
	reference,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

/**
 * One thing a payslip settled that was caused by exactly ONE input.
 *
 * This is the whole of the old `payslip_lines` *and* the whole of the old `payslip_sources`, and it
 * is smaller than either was. `payslip_lines` hand-rolled its polymorphism: a strict union in jsonb,
 * six `generatedAlwaysAs` projections of it so the union's keys could be indexed and related, and a
 * composite unique key on `component_entries` so a line could not claim a different pay component
 * from the entry it consumed. All of that existed because a line stated its component twice. It
 * states it once now, so there is nothing left to guard, and `reference()` gives real per-arm
 * foreign keys with a database-enforced exclusive arc for free.
 *
 * ## The kind is derived, never declared
 *
 * There is no `kind` column and no union tag. Base, proration and statutory are inlined on
 * `payslips` precisely because they point at nothing; a row exists here only when there is one
 * concrete input to name, and `source` names it. `pay_component_id` is NULL for overtime, which is
 * derived from the clock and the jurisdiction's rules rather than from the catalogue, and names the
 * statutory band it was priced under instead.
 *
 * ## A zero-amount row is the settlement lock
 *
 * `payslip_sources` existed to say "this run took this record into account", separately from
 * "this record produced money". It does not need to be a second collection: a work day the run read
 * and priced at nothing is a row here with `amount` 0. It consumed nothing and it is still frozen,
 * because the `restrict` foreign key on its arm is what refuses the delete and the hooks quote the
 * period back. One collection, both facts.
 *
 * ## What the unique index no longer says
 *
 * `payslip_sources.source` was globally unique, so one input could belong to exactly one payslip.
 * That cannot survive partial consumption - a single obligation may legitimately be touched by
 * several payslips, which is what a part-recovered loan instalment is. The constraint is now
 * `unique(source, payslip_id)` per consumable arm, which still makes double-consumption *within*
 * one run impossible. The work-day arm carries the band as well, because a day is priced rather
 * than consumed; see the index declarations for why.
 * The cross-run ceiling became arithmetic instead of a constraint; see
 * `OBLIGATION_OVER_CONSUMED` in `src/lib/settlement_refusals.ts` for the refusal that carries it
 * and the reason the trade was made.
 */
export default defineModel(
	{
		payslip_id: uuid().notNull(),
		/**
		 * The run's period, copied at the moment the claim is taken.
		 *
		 * Denormalized on purpose, and for an access reason rather than a convenience one. The
		 * refusal that stops somebody editing a settled record has to name the period that owns it,
		 * and it is composed inside a `before` hook under the editing person's own subject - a
		 * supervisor has no `payroll_runs` read grant, so joining to the run to fetch its period
		 * would turn an explanation into an access denial. The value cannot drift: the engine-owned
		 * column list in `payroll_runs/+hooks.ts` refuses to let anybody edit `period`.
		 *
		 * It is the one column `settlementLedgerGrants` exposes beside the source, so a rank with no
		 * payroll authority can be told what holds their record without being shown what it paid.
		 */
		period: text().notNull(),
		/**
		 * The one input that caused this row. Required: a row with no source is not an adjustment,
		 * it is base, proration or statutory, and those are inlined on `payslips`.
		 *
		 * `restrict` on every arm - the default - is the settlement lock itself. A record a payslip
		 * has taken into account cannot be deleted out from under it; a draft run releases its
		 * claims by cascading these rows away with its payslips.
		 */
		source: reference({
			/** Claims, standing allowances, bonuses, adjustments, and loan instalment recovery. */
			OBLIGATION: 'obligations',
			/** The clock that priced overtime, and the day whose silence was read as absence. */
			WORK_DAY: 'work_days',
			/** The absence deducted. */
			LEAVE_REQUEST: 'leave_requests'
		}).notNull(),
		/**
		 * The catalogue component this settled under, or NULL for overtime.
		 *
		 * Overtime is not in the catalogue: it is derived from `work_days` and the jurisdiction's
		 * overtime rules, so there is no component to name and `overtime_band` names the rule
		 * instead. Exactly one of the two is set on any row.
		 */
		pay_component_id: uuid(),
		/** The statutory band a derived overtime row was priced under. NULL on every other row. */
		overtime_band: custom('overtime_band_reference'),
		bucket: enums([
			'EARNING',
			'ABSENCE',
			'DEDUCTION',
			'NON_WAGE_PAYMENT',
			'EMPLOYER_COST'
		]).notNull(),
		/** A magnitude, never a direction, and 0 is meaningful: the run read the source and priced it. */
		amount: numeric().notNull(),
		quantity: numeric(),
		rate: numeric(),
		sequence: integer().notNull()
	},
	{
		description:
			'One settled thing on a payslip caused by exactly one input - an obligation, a work day or a leave request - and the only junction table in payroll. A zero amount means the run read the source and it produced nothing; the row still holds the settlement claim.',
		recordLabel: ['bucket', 'amount'],
		icon: 'lucide:list',
		indexes: [
			{ columns: ['payslip_id'] },
			{ columns: ['pay_component_id'], where: '"pay_component_id" IS NOT NULL' },
			/**
			 * ────────────────────────────────────────────────────────────────────────────────────
			 * ONE ADJUSTMENT PER SOURCE PER PAYSLIP - EXCEPT A WORK DAY, WHICH IS NOT CONSUMED BUT
			 * PRICED, AND A SINGLE DAY MAY PRICE INTO SEVERAL BANDS.
			 * ────────────────────────────────────────────────────────────────────────────────────
			 *
			 * The invariant this replaces (`payslip_sources.source`, globally unique) was about
			 * double-**consumption**: an obligation or a leave request is a claim, taking it twice
			 * pays twice, and that must be impossible. Those two arms keep the strict form.
			 *
			 * A work day is not a claim. The run *reads* it and prices what it finds, and one rest
			 * day worked past the normal day genuinely produces two priced segments from one row -
			 * a `FROM_START_OF_DAY` band and a `BEYOND_NORMAL` band - as does a day straddling the
			 * total-work-hours boundary, which splits into a normal and an excess segment. Two rows,
			 * one source, one payslip. The strict form would have failed on the first rest-day
			 * worker. Aggregating them into one row per day is not available either: the payroll
			 * workbook reports ordinary overtime and incentive overtime in separate columns, and
			 * which a segment belongs to varies *within* a day.
			 *
			 * So the work-day arm's key includes the band, and the other two do not. Spelled as three
			 * declarations naming the reference's own storage columns rather than one naming `source`,
			 * because an index that names the reference field expands to every arm identically - it
			 * cannot say something different about one of them.
			 *
			 * All three are named explicitly, because the change from `payslip_sources`' global
			 * `unique(source)` is a drop and an add. Drizzle tries to resolve a same-shape index as a
			 * rename and asks an interactive question a `bolt sync` has nobody to answer; distinct
			 * names are unambiguous statements instead of a question.
			 */
			{
				name: 'payslip_adjustments_obligation_per_payslip',
				columns: ['source__obligation_id', 'payslip_id'],
				unique: true,
				where: '"source__obligation_id" IS NOT NULL'
			},
			{
				name: 'payslip_adjustments_leave_request_per_payslip',
				columns: ['source__leave_request_id', 'payslip_id'],
				unique: true,
				where: '"source__leave_request_id" IS NOT NULL'
			},
			/**
			 * The band is `coalesce`d rather than named directly, and that is load-bearing.
			 *
			 * A unique index treats NULLs as distinct, and `overtime_band` is NULL on every work-day
			 * row that is not overtime - including the zero-amount settlement lock, the row that says
			 * "this day was read and priced at nothing". Naming the column bare would let a payslip
			 * hold any number of those for one day, which is precisely the duplication the whole
			 * index exists to refuse. Folding NULL to the jsonb literal `null` makes absence a value,
			 * so a day yields at most one non-overtime row and at most one row per band.
			 *
			 * `coalesce` over a jsonb literal is IMMUTABLE, which an index expression must be.
			 */
			{
				name: 'payslip_adjustments_work_day_band_per_payslip',
				columns: [
					'source__work_day_id',
					'payslip_id',
					{ expr: `coalesce("overtime_band", 'null'::jsonb)` }
				],
				unique: true,
				where: '"source__work_day_id" IS NOT NULL'
			}
		]
	}
);
