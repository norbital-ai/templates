import type { JsonObject, Lookup } from '../../../../lib/contracts.js';
import { lookupOf, settingsConstants, UNITS } from '../../../../lib/contracts.js';
import { contextRoots } from '../../jurisdiction/service/expressions.js';
import { programOf } from '../../jurisdiction/service/programs.js';
import { Refusal, isJsonObject, leaveEntry, monthEndOf } from '../../../../lib/foundation.js';
import {
	accountsOf,
	eventOn,
	eventsOf,
	periodOn
} from '../../employee_profile/employee_balance/service/core.js';
import {
	amount,
	basisDays,
	catalogByCode,
	eligible,
	evaluateNumber,
	floorMinor,
	heldBalance,
	id,
	line,
	number,
	ownMonthWeight,
	paidShare,
	paidShareOf,
	payBasis,
	period,
	rateOf,
	round,
	rounding,
	salaryOf,
	signed,
	slotsOf,
	statutoryOrder,
	subtotalChain,
	text,
	unemployedDays,
	unpaidByDate,
	withCompanyPaidLeave,
	type BackPayLine,
	type PayLine,
	type PayrollInput,
	type PayrollResult,
	type Slot,
	type SlotShare,
	type StatutoryResult,
	type SubtotalResult,
	type TimeOff
} from './rates.js';

export {
	isWorkingDay,
	offDaysFor,
	offDaysOf,
	paidShareOf,
	payBasis,
	sharesPay,
	statutoryOrder,
	subtotalChain,
	type BackPayLine,
	type PayLine,
	type PayrollInput,
	type PayrollResult,
	type ProjectedDay,
	type StatutoryResult,
	type SubtotalResult,
	type TimeOff
} from './rates.js';

/** Enriches each work day with the hour/day rate and monthly wage of the contract terms and month it was worked under. */
export function enrichWorkDays(
	input: PayrollInput,
	basis: ReturnType<typeof payBasis>,
	coverage: { readonly from: string; readonly to: string },
	days: readonly JsonObject[]
) {
	const paidYm = coverage.from.slice(0, 7);
	const defaultTerms = input.employment.terms ?? null;
	const defaultRates = {
		hour_rate: basis.overtime_hour_rate,
		day_rate: basis.day_rate,
		month_wage: basis.month_wage
	};
	type DayRates = typeof defaultRates;
	const ratesByTerms = new Map<unknown, Map<string, DayRates>>();
	const wagesByDay = new Map<string, number>();
	const enriched = days.map(
		(
			day
		): JsonObject & {
			readonly date: string;
			readonly hour_rate: number;
			readonly day_rate: number;
		} => {
			const { terms: worked, ...rest } = day;
			const terms = isJsonObject(worked) ? worked : defaultTerms;
			const date = String(day.date ?? '');
			const ym = date.slice(0, 7);
			let rates: DayRates | undefined;
			if (terms === defaultTerms && ym === paidYm) {
				rates = defaultRates;
			} else {
				let byMonth = ratesByTerms.get(terms);
				if (byMonth === undefined) {
					byMonth = new Map();
					ratesByTerms.set(terms, byMonth);
				}
				rates = byMonth.get(ym);
				if (rates === undefined) {
					const own = payBasis(
						{ ...input, employment: { ...input.employment, terms } },
						ym === paidYm ? coverage : { from: `${ym}-01`, to: monthEndOf(ym) }
					);
					rates = {
						hour_rate: own.overtime_hour_rate,
						day_rate: own.day_rate,
						month_wage: own.month_wage
					};
					byMonth.set(ym, rates);
				}
			}
			wagesByDay.set(date, rates.month_wage);
			return { ...rest, date, hour_rate: rates.hour_rate, day_rate: rates.day_rate };
		}
	);
	return { days: enriched, wagesByDay };
}

export function calculatePayroll(given: PayrollInput): PayrollResult {
	const input = withCompanyPaidLeave(given);
	const chain = subtotalChain(input.subtotals);
	const coverage = period(input.run);
	const settingsLookup = lookupOf(input.settings);
	const balance = heldBalance(input);
	// expressions read service entitlement dates, not the latest contract's start
	const employment =
		typeof input.employment.service_started_on === 'string' &&
		isJsonObject(input.employment.effective_range)
			? {
					...input.employment,
					effective_range: {
						...input.employment.effective_range,
						from: input.employment.service_started_on
					}
				}
			: input.employment;
	const subject = { employee: input.employee, employment, employer: input.employer };
	const basis = payBasis(input, coverage);
	const salary =
		input.run.kind === 'OFF_CYCLE' ? undefined : salaryOf(input, coverage, basis.working_days);
	// What depends on the month a day falls in is priced in that month, never in the run's attendance window: a day
	// worked carries the hour and day rate of the contract version it was worked under, worked out over its own month.
	const { days: enrichedDays, wagesByDay } = enrichWorkDays(
		input,
		basis,
		coverage,
		input.work?.days ?? []
	);
	const work = { days: enrichedDays };
	// the constants view: a row reads the jurisdiction's settings fields under ctx.lookup, then its own lookup
	const settingsView: Lookup = settingsConstants(input.settings);
	const leaveRows = catalogByCode(input.leave_catalog);
	const leaveUsed = accountsOf({ leave: input.balance.leave }).leave ?? {};
	const person = {
		scope: String(input.settings.code),
		started: String(
			input.employment.service_started_on ??
				(isJsonObject(input.employment.effective_range)
					? input.employment.effective_range.from
					: '')
		),
		events: eventsOf(input.employment)
	};
	const order = (slot: Slot) => `${slot.date}:${slot.part === 'PM' ? 1 : 0}`;
	/** Days of a row already used in a slot's window before it: what the balance holds less the days at or after it. */
	const usedBefore = (row: JsonObject, slot: Slot): number => {
		const code = String(row.code),
			lookup = lookupOf(row),
			period = periodOn(lookup, person, slot.date);
		// ponytail: a day posted after this run's window still counts as used; read those slots if a rule needs it exact
		const after = (input.entries.leave_catalog_entry ?? [])
			.filter((entry) => entry.catalog_code === code)
			.flatMap(slotsOf)
			.filter(
				(other) => order(other) >= order(slot) && periodOn(lookup, person, other.date) === period
			).length;
		return Math.max(0, (leaveUsed[code]?.[period]?.used ?? 0) - after / 2);
	};
	const shareOf: SlotShare = (row, entry, slot) =>
		paidShareOf(row, () => {
			const lookup = lookupOf(row);
			return {
				subject,
				entry: leaveEntry(entry),
				lookup: { ...settingsView, ...lookup },
				calendar_days: basis.calendar_days,
				working_days: basis.working_days,
				month_wage: basis.month_wage,
				day_rate: basis.day_rate,
				hour_rate: basis.hour_rate,
				work,
				work_events: input.work_events ?? [],
				run: input.run,
				as_of: slot.date,
				event: eventOn(lookup, person.events, slot.date) ?? null,
				...(contextRoots(String(row.paid_share)).has('used') ? { used: usedBefore(row, slot) } : {})
			};
		});
	const unpaid = unpaidByDate(input, shareOf);
	// the run's priced leave slots: a statutory base that counts a leave code's days reads them here
	const leave = (input.entries.leave_catalog_entry ?? []).flatMap((entry) => {
		const row = leaveRows.get(String(entry.catalog_code));
		if (row === undefined || entry.encashment === true) return [];
		const code = String(row.code);
		return slotsOf(entry).map((slot) => ({
			code,
			date: slot.date,
			part: slot.part,
			paid_share: shareOf(row, entry, slot)
		}));
	});
	// the share of the period paid, by the statute's basis: an allowance that reads it falls with the salary
	const paid_share = paidShare(input, coverage, settingsView.proration_basis, unpaid, basis);
	const counted = salary === undefined ? [] : basisDays(input, coverage, salary.basis);
	const prorationDays = salary === undefined ? 0 : unemployedDays(input, counted);
	// a missed day is a share of the period's days (calendar or working, by the basis); only `DAY_RATE` prices it at
	// the statute's day rate. A half-month or ten-day cycle shares out its own part of the month's salary
	const frequency = String(
		(isJsonObject(input.employer.payment_schedule) ? input.employer.payment_schedule : {})
			.frequency ?? 'MONTHLY'
	);
	const unit =
		salary === undefined
			? 0
			: salary.basis === 'DAY_RATE' || counted.length === 0
				? // the statute's day rate holds the rated allowances; the salary's share of it is what a missed day takes
					basis.day_rate *
					(rateOf(input).unit === 'MONTHLY' && basis.month_wage > salary.amount && salary.amount > 0
						? salary.amount / basis.month_wage
						: 1)
				: salary.amount /
					(frequency === 'SEMI_MONTHLY' ? 2 : frequency === 'TEN_DAY' ? 3 : 1) /
					counted.length;
	// days not employed and absent days take no more than the period's basic: no checkpoint goes below zero
	const periodBasic =
		salary === undefined
			? 0
			: salary.amount / (frequency === 'SEMI_MONTHLY' ? 2 : frequency === 'TEN_DAY' ? 3 : 1);
	// a jurisdiction rounds a day's rate before it multiplies the days (`RATE`, the default) or only the amount (`AMOUNT`)
	const rateFirst = settingsView.day_rate_rounding !== 'AMOUNT';
	const perDay = (value: number) => (rateFirst ? round(input.settings, value) : value);
	// a day not employed at the statute's day rate is priced as a no-pay day is: the rate to the minor unit, times the days
	// a version that starts inside the period: the period pays the first version's salary, and each later version adds
	// the difference of its day rate for its own days. The period's basic is the last version's, so the proration
	// gives back what that overstates.
	const dayPrice = (value: number) => (salary?.basis === 'DAY_RATE' ? perDay(value) : value);
	const inPeriod = (input.employed ?? [])
		.filter((version) => isJsonObject(version.terms))
		.map((version) => ({
			from: version.from,
			terms: isJsonObject(version.terms) ? version.terms : {},
			days: counted.filter(
				(day) => version.from <= day && (version.to === null || day <= version.to)
			).length
		}))
		.filter((version) => version.days > 0)
		.toSorted((a, b) => a.from.localeCompare(b.from));
	const [firstVersion] = inPeriod;
	const amountOf = (terms: JsonObject) =>
		salaryOf({ ...input, employment: { ...input.employment, terms } }, coverage).amount;
	const earlierTerms =
		salary === undefined || salary.amount <= 0 || firstVersion === undefined || inPeriod.length < 2
			? 0
			: (() => {
					const baseAmount = amountOf(firstVersion.terms);
					const baseDay = dayPrice((unit * baseAmount) / salary.amount);
					return (
						salary.amount -
						baseAmount -
						inPeriod
							.slice(1)
							.reduce(
								(total, version) =>
									total +
									version.days *
										(dayPrice((unit * amountOf(version.terms)) / salary.amount) - baseDay),
								0
							)
					);
				})();
	const proration_amount = Math.min(periodBasic, prorationDays * dayPrice(unit) + earlierTerms);
	// an absent day is a day of its own month, its rate to the minor unit like a no-pay day's
	const absent = (input.work?.days ?? [])
		.filter((day) => day.day_type === 'ABS')
		.reduce(
			(total, day) =>
				total +
				perDay(
					unit *
						(salary === undefined || salary.basis === 'DAY_RATE'
							? 1
							: ownMonthWeight(input, coverage, salary.basis, String(day.date)))
				),
			0
		);
	const chainByCode = new Map(chain.map((row, index) => [text(row, 'code'), { row, index }]));
	const hasProrated = chainByCode.has('PRORATED');
	const hasPaidBasic = chainByCode.has('PAID_BASIC');
	// When every scheduled non-holiday working day in the period's salary coverage is 100% unpaid, basic pay for the
	// period is zero: the last unpaid leave entry covering days in this period absorbs the remaining basic at PAID_BASIC,
	// or PRORATED absorbs it via abs_amount when the full-period absence has no unpaid leave entry.
	const lastCurrentUnpaidLeave =
		input.full_period_unpaid === true && hasPaidBasic
			? (input.entries.leave_catalog_entry ?? [])
					.filter((raw) => {
						if (raw.payroll_run_id != null || raw.encashment === true) return false;
						const catalog = leaveRows.get(String(raw.catalog_code));
						if (catalog === undefined) return false;
						return slotsOf(raw).some(
							(slot) =>
								slot.date >= coverage.from &&
								slot.date <= coverage.to &&
								shareOf(catalog, raw, slot) < 1
						);
					})
					.at(-1)
			: undefined;
	const abs_amount =
		input.full_period_unpaid === true && lastCurrentUnpaidLeave === undefined
			? Math.max(0, periodBasic - proration_amount)
			: Math.min(periodBasic - proration_amount, absent);
	// a no-pay day takes the same share of the salary: an allowance that reads `ctx.paid_share` loses its own share
	// on its own line, so the wage the day rate divides (allowances included) is not what the line deducts
	// a no-pay day is priced at the salary of the version in force on its date, a day before a raise at the old salary
	const nplUnitOn = (date: string) => {
		if (salary === undefined || salary.amount <= 0) return unit;
		const version = (input.employed ?? []).find(
			(held) =>
				isJsonObject(held.terms) && held.from <= date && (held.to === null || date <= held.to)
		);
		return version === undefined || !isJsonObject(version.terms)
			? unit
			: (unit * amountOf(version.terms)) / salary.amount;
	};
	const baseFields = {
		subject,
		allowance: input.allowance,
		balances: balance,
		calendar_days: basis.calendar_days,
		working_days: basis.working_days,
		month_wage: basis.month_wage,
		day_rate: basis.day_rate,
		hour_rate: basis.hour_rate,
		paid_share,
		proration_amount,
		abs_amount,
		leave,
		work,
		work_events: input.work_events ?? [],
		run: input.run,
		as_of: coverage.to
	};
	const base = (base_pay: unknown, lookup: Lookup) => ({
		...baseFields,
		lookup: { ...settingsView, ...lookup },
		base_pay
	});
	const openingPay =
		salary === undefined
			? 0
			: hasProrated
				? salary.amount
				: salary.amount * paidShare(input, coverage, salary.basis, unpaid, basis);
	const lines: PayLine[] = [];
	// what this run's ad hoc entries post to an account (`CODE.side`), such as a benefit in kind a tax row counts
	const posted: Record<string, Record<string, number>> = {};
	// leave paid out in money by this run (a cash-out at exit or on request): a levy that stops at wages reads it
	let encashment = 0;
	const values = new Map<string, number>();
	const results: SubtotalResult[] = [];
	const subtotalsObj: Record<string, number> = {};
	const computedBy = new Map<string, number>();
	const baseSubtotal = chain[0];
	if (baseSubtotal === undefined) throw new Refusal({ message: 'A payroll run needs subtotals.' });

	const producersBySubtotal = new Map<
		string,
		{ readonly row: JsonObject; readonly model: 'allowance_catalog' | 'overtime_catalog' }[]
	>();
	if (input.run.kind !== 'OFF_CYCLE') {
		for (const row of input.allowance) {
			const key = String(row.subtotal);
			const list = producersBySubtotal.get(key);
			const item = { row, model: 'allowance_catalog' as const };
			if (list === undefined) producersBySubtotal.set(key, [item]);
			else list.push(item);
		}
		for (const row of input.overtime) {
			const key = String(row.subtotal);
			const list = producersBySubtotal.get(key);
			const item = { row, model: 'overtime_catalog' as const };
			if (list === undefined) producersBySubtotal.set(key, [item]);
			else list.push(item);
		}
	}
	const allowanceRoots = programOf('allowance_catalog')?.roots;
	const overtimeRoots = programOf('overtime_catalog')?.roots;
	let byRateCache: readonly (typeof work.days)[] | undefined;
	const workDaysByRate = () => {
		if (byRateCache === undefined) {
			const grouped = Map.groupBy(
				work.days,
				(day) =>
					`${String(day.hour_rate)}/${String(day.day_rate)}/${String(wagesByDay.get(day.date))}`
			);
			byRateCache = [...grouped.values()];
		}
		return byRateCache;
	};
	const catalogs = [
		{
			byCode: leaveRows,
			entries: input.entries.leave_catalog_entry ?? [],
			model: 'leave_catalog' as const,
			entryModel: 'leave_catalog_entry' as const,
			roots: programOf('leave_catalog')?.roots
		},
		{
			byCode: catalogByCode(input.claim_catalog),
			entries: input.entries.claim_catalog_entry ?? [],
			model: 'claim_catalog' as const,
			entryModel: 'claim_catalog_entry' as const,
			roots: programOf('claim_catalog')?.roots
		},
		{
			byCode: catalogByCode(input.adhoc_catalog),
			entries: input.entries.adhoc_catalog_entry ?? [],
			model: 'adhoc_catalog' as const,
			entryModel: 'adhoc_catalog_entry' as const,
			roots: programOf('adhoc_catalog')?.roots
		}
	];
	const loanCatalog = catalogByCode(input.loan_catalog);
	const openRepayments =
		input.run.kind === 'OFF_CYCLE'
			? []
			: (input.entries.loan_catalog_entry_repayment ?? []).filter(
					(repayment) =>
						repayment.payroll_run_id == null &&
						!(repayment.paid_on != null && String(repayment.paid_on) > coverage.to)
				);
	const loansById =
		openRepayments.length === 0
			? undefined
			: new Map((input.entries.loan_catalog_entry ?? []).map((row) => [id(row), row]));

	for (const [chainIndex, subtotal] of chain.entries()) {
		const code = text(subtotal, 'code');
		const previous = subtotal.previous;
		const previousValue = typeof previous === 'string' ? (values.get(previous) ?? 0) : 0;
		const subtotalsSnapshot = { ...subtotalsObj };
		const baseContext = {
			...base(previousValue, settingsLookup),
			subtotals: subtotalsSnapshot
		};
		const rawComputed =
			chainIndex === 0 && subtotal.calculation == null
				? openingPay
				: evaluateNumber(
						subtotal.calculation,
						chainIndex === 0 ? { ...baseContext, base_pay: openingPay } : baseContext,
						`${code}.calculation`
					);
		// round each subtotal delta to the law's minor unit so lines and checkpoints agree to the cent
		const computed = round(
			input.settings,
			round(input.settings, previousValue + rawComputed) - previousValue
		);
		computedBy.set(code, computed);
		if (computed !== 0)
			lines.push(
				line({
					code,
					label: text(subtotal, 'name'),
					subtotal,
					amount: Math.abs(computed),
					direction: computed < 0 ? 'DEDUCT' : 'ADD',
					incurred_on: coverage.from,
					coverage,
					source: input.employment,
					model: 'employment'
				})
			);
		const subtotalLines: PayLine[] = [];
		for (const { row: producer, model } of producersBySubtotal.get(code) ?? []) {
			const producerCode = text(producer, 'code');
			const lookup = lookupOf(producer);
			const roots = model === 'allowance_catalog' ? allowanceRoots : overtimeRoots;
			const context = {
				...base(previousValue + computed, lookup),
				...(model === 'overtime_catalog' ? { hour_rate: basis.overtime_hour_rate } : {}),
				subtotals: subtotalsSnapshot
			};
			if (!eligible(producer.eligibility, context, `${producerCode}.eligibility`, roots)) continue;
			// an overtime row prices the days at their own rates: one evaluation for each rate the window holds
			const byRate = model === 'overtime_catalog' ? workDaysByRate() : undefined;
			const value =
				byRate === undefined || byRate.length === 0
					? evaluateNumber(producer.conversion, context, `${producerCode}.conversion`, roots)
					: byRate.reduce((total, days) => {
							const [first] = days;
							return (
								total +
								evaluateNumber(
									producer.conversion,
									{
										...context,
										hour_rate: Number(first?.hour_rate),
										day_rate: Number(first?.day_rate),
										month_wage: wagesByDay.get(String(first?.date)) ?? basis.month_wage,
										work: { days }
									},
									`${producerCode}.conversion`,
									roots
								)
							);
						}, 0);
			if (value === 0) continue;
			subtotalLines.push(
				line({
					code: producerCode,
					label: producerCode,
					subtotal,
					amount: round(input.settings, value),
					direction:
						model === 'overtime_catalog' && producer.direction === 'DEDUCT' ? 'DEDUCT' : 'ADD',
					incurred_on: coverage.to,
					coverage,
					source: producer,
					model
				})
			);
		}

		for (const group of catalogs) {
			if (group.entries.length === 0) continue;
			const byCode = group.byCode;
			for (const raw of group.entries) {
				// a posted entry already reached a finalised payslip: never pay it again
				if (raw.payroll_run_id != null) continue;
				const entry = group.model === 'leave_catalog' ? leaveEntry(raw) : raw;
				const catalog = byCode.get(String(entry.catalog_code));
				if (catalog === undefined) continue;
				// unpaid days come off the basic whatever the row's own subtotal (that one takes its payout): a statutory
				// base reads the reduced amount, never a deduction after it
				const home =
					group.model === 'leave_catalog' && entry.encashment !== true && hasPaidBasic
						? 'PAID_BASIC'
						: catalog.subtotal;
				if (home !== code) continue;
				if (
					input.run.kind === 'OFF_CYCLE' &&
					(group.model !== 'adhoc_catalog' || catalog.off_cycle_eligible !== true)
				)
					continue;
				const catalogCode = text(catalog, 'code');
				const leave = group.model === 'leave_catalog';
				// a no-pay leave posts its unpaid amount as the catalog line
				if (leave && entry.encashment !== true && hasPaidBasic) {
					const slots = slotsOf(entry);
					// the day's rate to the currency's minor unit, then each date's own share of it, rounded: as a payroll
					// clerk prices it (a half day is half the rounded rate, to the minor unit)
					const unpaidOn = new Map<string, number>();
					for (const slot of slots)
						unpaidOn.set(
							slot.date,
							(unpaidOn.get(slot.date) ?? 0) + (1 - shareOf(catalog, entry, slot)) / 2
						);
					// Sum unpaid share by calendar month and unit rate before rounding so two half-days in the same month
					// equal one full day without double-rounding each half-day separately.
					const unpaidByUnit = new Map<string, { unit: number; share: number }>();
					for (const [date, share] of unpaidOn) {
						const unit = perDay(
							nplUnitOn(date) *
								(settingsView.proration_basis === 'CALENDAR_DAYS'
									? ownMonthWeight(input, coverage, 'CALENDAR_DAYS', date)
									: 1)
						);
						const key = `${date.slice(0, 7)}:${String(unit)}`;
						const existing = unpaidByUnit.get(key);
						if (existing === undefined) unpaidByUnit.set(key, { unit, share });
						else existing.share += share;
					}
					const rawUnpaidAmount = [...unpaidByUnit.values()].reduce(
						(total, { unit, share }) => total + perDay(Number((share * unit).toFixed(10))),
						0
					);
					// no-pay days take what the basic still holds, never more; a full-period unpaid month clears remaining basic
					const room = Math.max(
						0,
						previousValue +
							computed +
							subtotalLines.reduce((total, l) => total + signed(l.direction, l.amount), 0)
					);
					const unpaidAmount =
						raw === lastCurrentUnpaidLeave ? Math.max(rawUnpaidAmount, room) : rawUnpaidAmount;
					if (unpaidAmount > 0 && room > 0)
						subtotalLines.push(
							line({
								code: catalogCode,
								label: catalogCode,
								subtotal,
								amount: round(input.settings, Math.min(unpaidAmount, room)),
								direction: 'DEDUCT',
								party: 'EMPLOYEE',
								incurred_on: String(entry.incurred_on ?? coverage.to),
								coverage,
								source: entry,
								model: group.entryModel,
								quantity: slots.length / 2,
								unit: 'DAY'
							})
						);
					continue;
				}
				// leave taken prices no line of its own: only its unpaid part, above, and a cash-out, below
				if (leave && entry.encashment !== true) continue;
				const lookup = lookupOf(catalog);
				const context = {
					...base(previousValue + computed, lookup),
					entry,
					subtotals: subtotalsSnapshot
				};
				const roots = group.roots;
				if (!eligible(catalog.eligibility, context, `${catalogCode}.eligibility`, roots)) continue;
				// a cash-out takes no day off and pays its row's payout
				const field = leave ? 'payout' : 'conversion';
				const value = evaluateNumber(catalog[field], context, `${catalogCode}.${field}`, roots);
				// only adhoc states a direction and a party; a quantity below zero flips its line
				// leave taken beyond what the last day earned is taken back at the row's own payout
				const net =
					(group.model === 'adhoc_catalog' && catalog.direction === 'DEDUCT') ||
					(leave && entry.take_back === true)
						? -value
						: value;
				const paid = round(input.settings, Math.abs(net));
				if (paid === 0) continue;
				if (leave && entry.encashment === true) encashment += net;
				if (group.model === 'adhoc_catalog' && Array.isArray(lookup.accounts))
					for (const account of lookup.accounts)
						if (
							isJsonObject(account) &&
							account.account === 'statutory' &&
							account.measure === 'paid' &&
							account.period === undefined
						) {
							const [scheme = '', side = ''] = String(account.code).split('.');
							const sign = (account.operation === 'DEDUCT' ? -1 : 1) * (value < 0 ? -1 : 1);
							const held = (posted[scheme] ??= {});
							held[side] = (held[side] ?? 0) + sign * paid;
						}
				const unit = UNITS.find((one) => one === entry.unit);
				subtotalLines.push(
					line({
						code: catalogCode,
						label: catalogCode,
						subtotal,
						amount: paid,
						direction: net < 0 ? 'DEDUCT' : 'ADD',
						party:
							group.model === 'adhoc_catalog' && catalog.party === 'EMPLOYER'
								? 'EMPLOYER'
								: 'EMPLOYEE',
						incurred_on: String(entry.incurred_on ?? coverage.to),
						coverage,
						source: entry,
						model: group.entryModel,
						...(typeof entry.quantity === 'number' ? { quantity: entry.quantity } : {}),
						...(unit === undefined ? {} : { unit })
					})
				);
			}
		}

		if (
			code === 'PAID_BASIC' &&
			input.run.kind !== 'OFF_CYCLE' &&
			input.employee.dock_undertime === true &&
			salary !== undefined &&
			salary.amount > 0
		) {
			const fallbackNormalHours = rateOf(input).hoursPerDay;
			let totalUndertimeMinutes = 0;
			let rawUndertime = 0;
			for (const day of input.work?.days ?? []) {
				const mins = Number(day.undertime_minutes ?? 0);
				if (!(mins > 0)) continue;
				const date = String(day.date);
				const dayVersion = (input.employed ?? []).find(
					(held) =>
						isJsonObject(held.terms) && held.from <= date && (held.to === null || date <= held.to)
				);
				const normalHours =
					dayVersion !== undefined &&
					isJsonObject(dayVersion.terms) &&
					typeof dayVersion.terms.normal_hours_per_day === 'number' &&
					dayVersion.terms.normal_hours_per_day > 0
						? dayVersion.terms.normal_hours_per_day
						: fallbackNormalHours;
				const denomMinutes = Math.max(Number(day.scheduled_shift_minutes ?? 0), normalHours * 60);
				if (!(denomMinutes > 0)) continue;
				const dayRateOnDate =
					nplUnitOn(date) *
					(salary.basis === 'DAY_RATE' ? 1 : ownMonthWeight(input, coverage, salary.basis, date));
				totalUndertimeMinutes += mins;
				rawUndertime += (dayRateOnDate / denomMinutes) * mins;
			}
			const undertimeAmount = floorMinor(input.settings, rawUndertime);
			const room = Math.max(
				0,
				previousValue +
					computed +
					subtotalLines.reduce((total, l) => total + signed(l.direction, l.amount), 0)
			);
			const docked = round(input.settings, Math.min(undertimeAmount, room));
			if (docked > 0)
				subtotalLines.push(
					line({
						code: 'UNDERTIME',
						label: 'Undertime',
						subtotal,
						amount: docked,
						direction: 'DEDUCT',
						party: 'EMPLOYEE',
						incurred_on: coverage.to,
						coverage,
						source: { code: 'UNDERTIME' },
						model: 'roster_entry',
						quantity: Math.round((totalUndertimeMinutes / 60) * 10000) / 10000,
						unit: 'HOUR'
					})
				);
		}

		for (const repayment of openRepayments) {
			const loan = loansById?.get(String(repayment.loan_id));
			const catalog = loan === undefined ? undefined : loanCatalog.get(String(loan.catalog_code));
			if (catalog === undefined || catalog.subtotal !== code) continue;
			const value = amount(repayment.amount ?? 0, 'repayment.amount');
			if (value === 0) continue;
			subtotalLines.push(
				line({
					code: text(catalog, 'code'),
					label: text(catalog, 'code'),
					subtotal,
					amount: round(input.settings, value),
					direction: 'DEDUCT',
					party: 'EMPLOYEE',
					incurred_on: String(repayment.paid_on ?? coverage.to),
					coverage,
					source: repayment,
					model: 'loan_catalog_entry_repayment',
					quantity: value,
					unit: 'MONEY'
				})
			);
		}

		const value = round(
			input.settings,
			previousValue +
				computed +
				subtotalLines.reduce((total, l) => total + signed(l.direction, l.amount), 0)
		);
		values.set(code, value);
		subtotalsObj[code] = value;
		results.push({ code, name: text(subtotal, 'name'), value });
		lines.push(...subtotalLines);
	}

	// Back-pay lines from later-signed terms preserve each item's own catalogue code, source and subtotal (or post at the
	// law's declared back-pay subtotal, e.g. ADDITIONAL_WAGES where all prior-month arrears are additional wages).
	const backPaySetting = isJsonObject(input.settings.conversions)
		? input.settings.conversions.back_pay
		: undefined;
	const backPayFloor =
		typeof backPaySetting === 'string' ? (chainByCode.get(backPaySetting)?.index ?? -1) : -1;
	const backPayBySubtotal = new Map<string, number>();
	for (const bp of input.back_pay ?? []) {
		const own = chainByCode.get(bp.subtotal);
		const target =
			backPayFloor >= 0 && (own === undefined || own.index < backPayFloor)
				? chain[backPayFloor]
				: (own?.row ?? baseSubtotal);
		if (target === undefined) continue;
		const targetCode = text(target, 'code');
		const amt = round(input.settings, bp.amount);
		if (amt === 0) continue;
		lines.push(
			line({
				code: bp.code,
				label: bp.label,
				subtotal: target,
				amount: amt,
				direction: bp.direction,
				party: bp.party,
				incurred_on: coverage.to,
				coverage,
				source: { code: bp.code },
				model: bp.source,
				back_pay_period: bp.back_pay_period
			})
		);
		if (bp.party === 'EMPLOYEE')
			backPayBySubtotal.set(
				targetCode,
				round(input.settings, (backPayBySubtotal.get(targetCode) ?? 0) + signed(bp.direction, amt))
			);
	}
	let backPaySoFar = 0;
	const backPayAt = new Map<string, number>();
	for (const r of results) {
		backPaySoFar = round(input.settings, backPaySoFar + (backPayBySubtotal.get(r.code) ?? 0));
		backPayAt.set(r.code, backPaySoFar);
		if (backPaySoFar !== 0) {
			const next = round(input.settings, r.value + backPaySoFar);
			values.set(r.code, next);
			subtotalsObj[r.code] = next;
			r.value = next;
		}
	}
	const backPayContext = Object.fromEntries(backPayAt);

	const statutory: StatutoryResult[] = [];
	const statutoryValues: Record<string, { employee: number; employer: number }> = {};
	// carried pay enters the chain where it was earned: its checkpoint and every one after it
	let carriedSoFar = 0;
	const withCarried = new Map<string, number>();
	const withCarriedObj: Record<string, number> = {};
	for (const r of results) {
		carriedSoFar += input.carried?.[r.code] ?? 0;
		const total = r.value + carriedSoFar;
		withCarried.set(r.code, total);
		withCarriedObj[r.code] = total;
	}
	let overtimeTotal = 0;
	for (const row of lines)
		if (row.source_id.model === 'overtime_catalog')
			overtimeTotal += signed(row.direction, row.amount);
	const statutoryRoots = programOf('statutory_contribution_catalog')?.roots;
	const statutoryPaid = isJsonObject(balance.statutory_contribution)
		? balance.statutory_contribution
		: {};
	for (const scheme of statutoryOrder(input.statutory)) {
		const code = text(scheme, 'code');
		const subtotal =
			typeof scheme.subtotal === 'string' ? chainByCode.get(scheme.subtotal)?.row : undefined;
		if (subtotal === undefined)
			throw new Refusal({ message: `${code}: its subtotal is not in this law.` });
		const lookup = lookupOf(scheme);
		const paidMonth = scheme.assessed === 'PAID' && input.carried !== undefined;
		const context = {
			...base((paidMonth ? withCarried : values).get(text(subtotal, 'code')) ?? 0, lookup),
			subtotals: paidMonth ? withCarriedObj : subtotalsObj,
			back_pay: backPayContext,
			statutory: statutoryValues,
			posted,
			encashment,
			overtime: overtimeTotal
		};
		if (!eligible(scheme.eligibility, context, `${code}.eligibility`, statutoryRoots)) continue;
		const owed = evaluateNumber(
			scheme.employee_amount,
			context,
			`${code}.employee_amount`,
			statutoryRoots
		);
		// below zero a row refunds on this run where its statute has the employer repay; otherwise it stops at zero and carries
		const refunds = lookup.below_zero === 'REFUND' && owed < 0;
		const employee = refunds
			? -round(input.settings, -owed)
			: round(input.settings, Math.max(0, owed));
		// the employer's share settles as the employee's does: a row that refunds gives back what an earlier run overcharged
		const employerOwed = evaluateNumber(
			scheme.employer_amount,
			context,
			`${code}.employer_amount`,
			statutoryRoots
		);
		const employer =
			lookup.below_zero === 'REFUND' && employerOwed < 0
				? -round(input.settings, -employerOwed)
				: round(input.settings, amount(employerOwed, `${code}.employer_amount`));
		statutoryValues[code] = { employee, employer };
		const employeeYtd = Number(statutoryPaid[`${code}.employee`] ?? 0) + employee;
		const employerYtd = Number(statutoryPaid[`${code}.employer`] ?? 0) + employer;
		statutory.push({
			code,
			kind: String(scheme.kind ?? 'CONTRIBUTION'),
			employee,
			employer,
			employee_ytd: employeeYtd,
			employer_ytd: employerYtd
		});
		if (employee !== 0)
			lines.push(
				line({
					code,
					label: code,
					subtotal,
					amount: Math.abs(employee),
					direction: employee > 0 ? 'DEDUCT' : 'ADD',
					party: 'EMPLOYEE',
					incurred_on: coverage.to,
					coverage,
					source: scheme,
					model: 'statutory_contribution_catalog'
				})
			);
		const employerTarget =
			typeof scheme.employer_cost_subtotal === 'string'
				? chainByCode.get(scheme.employer_cost_subtotal)?.row
				: undefined;
		if (employerTarget !== undefined && employer !== 0)
			lines.push(
				line({
					code: `${code}_EMPLOYER`,
					label: `${code} (employer)`,
					subtotal: employerTarget,
					amount: Math.abs(employer),
					direction: employer > 0 ? 'ADD' : 'DEDUCT',
					party: 'EMPLOYER',
					incurred_on: coverage.to,
					coverage,
					source: scheme,
					model: 'statutory_contribution_catalog'
				})
			);
	}
	// Statutory lines are producers too: the checkpoints add them up. Nothing is evaluated twice.
	const finalValues = new Map<string, number>();
	const finalResults: SubtotalResult[] = [];
	const linesBy = Map.groupBy(
		lines.filter(
			(l) =>
				l.party === 'EMPLOYEE' &&
				!(l.source_id.model === 'employment' && l.back_pay_period === undefined)
		),
		(l) => l.subtotal
	);
	for (const subtotal of chain) {
		const code = text(subtotal, 'code');
		const previous = subtotal.previous;
		const previousValue = typeof previous === 'string' ? (finalValues.get(previous) ?? 0) : 0;
		const value = round(
			input.settings,
			previousValue +
				(computedBy.get(code) ?? 0) +
				(linesBy.get(code) ?? []).reduce((total, l) => total + signed(l.direction, l.amount), 0)
		);
		finalValues.set(code, value);
		finalResults.push({ code, name: text(subtotal, 'name'), value });
	}
	results.splice(0, results.length, ...finalResults);
	const net = results.at(-1)?.value ?? 0;
	if (net < 0 && lines.some((l) => l.source_id?.model === 'loan_catalog_entry_repayment'))
		throw new Refusal({
			message: `${String(input.employee.name ?? id(input.employee))}: loan recovery would leave net pay at ${net}; reduce the final repayment.`
		});
	const employerCost = lines
		.filter((l) => l.party === 'EMPLOYER')
		.reduce((total, l) => total + signed(l.direction, l.amount), 0);
	return {
		lines,
		subtotals: results,
		statutory,
		time_off: timeOffOf(input, person),
		net_pay: net,
		employer_cost: employerCost
	};
}

/**
 * The overtime a run's days took as time off (`time_off_hours`), owed by the hour on the one leave row of the law that
 * takes it (`overtime_as_time_off`), an hour-unit row (`unit: 'HOUR'`).
 */
const timeOffOf = (
	input: PayrollInput,
	person: Parameters<typeof periodOn>[1]
): readonly TimeOff[] => {
	const owed =
		input.run.kind === 'OFF_CYCLE'
			? []
			: (input.work?.days ?? []).filter((day) => Number(day.time_off_hours ?? 0) > 0);
	if (owed.length === 0) return [];
	const [taker, ...more] = input.leave_catalog.filter(
		(row) => lookupOf(row).overtime_as_time_off === true
	);
	if (taker === undefined || more.length > 0 || lookupOf(taker).unit !== 'HOUR')
		throw new Refusal({
			message:
				'Overtime taken as time off needs one leave row of this law that takes it (overtime_as_time_off), counted in hours (unit HOUR).'
		});
	return owed.map((day) => ({
		code: text(taker, 'code'),
		period: periodOn(lookupOf(taker), person, String(day.date)),
		hours: Number(day.time_off_hours),
		on: String(day.date)
	}));
};
