import type { calculateFamilyAssessments } from './families.js';
import {
	assessContributions,
	assessCompanyContributions,
	personWageFloor
} from './contribution.js';
import { accumulatePayslip } from './run/accumulate.js';
import { atWorksite } from './run/configuration.js';
import { personContext } from './run/eligibility.js';
import { employmentDates } from './run/settlement.js';
import { monthBounds } from './run/dates.js';
import { cents, currencyFractionDigits } from './run/rounding.js';
import { fullyUnpaidDays } from '../leave/payroll.js';
import { stint } from '../employment-contract.js';
import { dateKey } from '../iso-day.js';
import { decodeNumber } from '../wire.js';
import { refuse } from '../refuse.js';
import type { MeasuredAdjustment } from './family.js';
import type { LeavePayItem } from '../datatypes/leave_pay_items.js';

type Assessment = ReturnType<typeof calculateFamilyAssessments>;
type Options = Parameters<typeof calculateFamilyAssessments>[0];

/** Allocate rounded money by days, preserving the total; ties follow source/date order. */
function allocate(amount: number, weights: readonly number[], currency: string): number[] {
	const scale = 10 ** currencyFractionDigits(currency);
	const total = weights.reduce((sum, weight) => sum + weight, 0);
	const units = Math.round(amount * scale);
	const shares = weights.map((weight, index) => {
		const exact = (units * weight) / total;
		return { index, units: Math.floor(exact), fraction: exact - Math.floor(exact) };
	});
	const remainder = units - shares.reduce((sum, share) => sum + share.units, 0);
	for (const share of shares
		.toSorted((a, b) => b.fraction - a.fraction || a.index - b.index)
		.slice(0, remainder))
		share.units++;
	return shares.map((share) => share.units / scale);
}

/**
 * A leave wage floor is judged after its named employee charges, before tax or voluntary
 * deductions. Top-ups are frozen on each source/date, so a reversal restores the exact money.
 * A second contribution pass taxes that wage; a protected charge that then changes is circular
 * and refuses rather than guessing a fixed point.
 */
export function applyLeaveNetFloors(assessment: Assessment, options: Options): Assessment {
	let changed = false;
	const protectedByEmployment = new Map<string, Set<string>>();
	const deficits = new Map<string, number>();
	const adjustmentItems = new WeakMap<MeasuredAdjustment, LeavePayItem>();
	const candidates: { item: LeavePayItem; group: string; employment: string }[] = [];
	let measuredContracts = assessment.measuredContracts.map((contract) => {
		const { measured } = contract;
		const { bundle } = measured;
		const configuration = atWorksite(
			options.configuration,
			bundle.termsHistory,
			bundle.workDays,
			bundle.employee
		);
		const rules = configuration.jurisdiction.payroll.leave_net_floors ?? [];
		if (rules.length === 0 || measured.captured.leave.length === 0) return contract;
		const dates = employmentDates(bundle.employment);
		const employed = bundle.employedDays;
		if (employed == null) return contract;
		const paidDays = Math.max(
			0,
			(measured.normalWorkingDaysIn?.(employed) ?? measured.periodWorkingDays) -
				measured.periodFullyUnpaidDays
		);
		const extra: MeasuredAdjustment[] = [];
		const payItems = new Map<string, LeavePayItem[]>();
		const charges = assessment.chargesByEmployment.get(bundle.employment.id) ?? [];
		for (const rule of rules) {
			const covered = measured.captured.leave
				.flatMap((capture) =>
					capture.charges.flatMap((charge) => {
						const catalogue = bundle.leave.catalogues.find((row) => row.id === charge.catalogue_id);
						const terms = bundle.termsHistory.find((row) => row.id === charge.employment_term_id);
						if (
							catalogue?.code !== rule.leave_code ||
							terms == null ||
							charge.days <= 0 ||
							!rule.worksites.includes(terms.worksite ?? '') ||
							(rule.effective_to != null && charge.date > rule.effective_to)
						)
							return [];
						if (charge.hours != null || terms.pay_frequency !== 'MONTHLY')
							refuse(
								`${bundle.employment.employee_number}: ${rule.code} needs a monthly day-valued leave wage.`
							);
						const daily = capture.pay_items.filter(
							(item) =>
								item.date === charge.date &&
								item.code === rule.leave_code &&
								item.bucket === 'ABSENCE'
						);
						const rate =
							daily.find((item) => item.rate != null)?.rate ??
							decodeNumber(terms.base_salary) / rule.divisor_days;
						const deduction = daily.reduce((sum, item) => sum + item.amount, 0);
						const dated = configuration.onDay?.(charge.date) ?? configuration;
						const person = personContext({
							employee: bundle.employee,
							employment: stint(bundle.employment, dated.jurisdiction.exit_facts ?? []),
							terms,
							company: configuration.company,
							asOf: charge.date
						});
						return [
							{
								capture,
								charge,
								catalogue,
								rate,
								paid: rate * charge.days - deduction,
								floor:
									((personWageFloor({ ...dated, company: configuration.company }, person) *
										rule.minimum_fraction) /
										rule.divisor_days) *
									charge.days
							}
						];
					})
				)
				.toSorted(
					(a, b) =>
						a.capture.leave_entry_id.localeCompare(b.capture.leave_entry_id) ||
						a.charge.date.localeCompare(b.charge.date)
				);

			if (covered.length === 0) continue;
			const protectedCodes = protectedByEmployment.get(bundle.employment.id) ?? new Set<string>();
			for (const code of rule.employee_scheme_codes) protectedCodes.add(code);
			protectedByEmployment.set(bundle.employment.id, protectedCodes);
			const history = (options.gathered.leaveFloorHistory ?? []).filter(
				(row) => row.payslip.employment_id === bundle.employment.id
			);
			const salaryCodes = new Set(
				measured.base
					.filter((line) => line.catalogueComponent.output === 'salary')
					.map((line) => line.catalogueComponent.code)
			);
			for (const [illnessMonth, monthCovered] of Map.groupBy(covered, (row) =>
				row.charge.date.slice(0, 7)
			)) {
				const month = monthBounds(illnessMonth);
				const monthEmployed = {
					start: dates.hire > month.start ? dates.hire : month.start,
					end: dates.exit != null && dates.exit < month.end ? dates.exit : month.end
				};
				const employedPaidDays = Math.max(
					0,
					(measured.normalWorkingDaysIn?.(monthEmployed) ?? paidDays) -
						fullyUnpaidDays(bundle.leave, monthEmployed, [])
				);
				if (employedPaidDays <= 0) continue;
				const reversedSources = new Set(
					bundle.leave.entries.flatMap((entry) =>
						entry.approval_id == null && entry.reversal_of_id != null ? [entry.reversal_of_id] : []
					)
				);
				const activeSources = new Set(
					bundle.leave.entries
						.filter(
							(entry) =>
								entry.approval_id == null &&
								!entry.as_adjustment_entry &&
								!reversedSources.has(entry.id)
						)
						.map((entry) => entry.id)
				);
				const priorCaptures = history
					.flatMap((row) => row.payslip.leave_settlements ?? [])
					.filter((capture) => activeSources.has(capture.leave_entry_id));
				const priorCharges = priorCaptures
					.flatMap((capture) => capture.charges)
					.filter(
						(charge) =>
							charge.date.slice(0, 7) === illnessMonth &&
							bundle.leave.catalogues.find((row) => row.id === charge.catalogue_id)?.code ===
								rule.leave_code
					);
				const priorItems = priorCaptures
					.flatMap((capture) => capture.pay_items)
					.filter((item) => item.date?.slice(0, 7) === illnessMonth);
				const sickDays =
					priorCharges.reduce((sum, row) => sum + row.days, 0) +
					monthCovered.reduce((sum, row) => sum + row.charge.days, 0);
				const share = Math.min(1, sickDays / employedPaidDays);
				const reversed = new Set(
					bundle.leave.entries.flatMap((entry) =>
						entry.approval_id == null && entry.reversal_of_id != null ? [entry.reversal_of_id] : []
					)
				);
				const approved = bundle.leave.entries
					.filter(
						(entry) =>
							entry.approval_id == null && !entry.as_adjustment_entry && !reversed.has(entry.id)
					)
					.flatMap((entry) => entry.charges)
					.filter(
						(charge) =>
							charge.date.slice(0, 7) === illnessMonth &&
							bundle.leave.catalogues.find((row) => row.id === charge.catalogue_id)?.code ===
								rule.leave_code
					);
				const byDate = new Map<string, number>();
				for (const charge of approved)
					byDate.set(charge.date, (byDate.get(charge.date) ?? 0) + charge.days);
				const fullMonth =
					(rule.effective_to == null || rule.effective_to >= month.end) &&
					dates.hire <= month.start &&
					(dates.exit == null || dates.exit >= month.end) &&
					[...byDate.values()].every((days) => days <= 1) &&
					[...byDate.values()].reduce((sum, days) => sum + days, 0) >= employedPaidDays;
				const historicalCharges = history.reduce(
					(sum, row) =>
						sum +
						row.payslip.statutory.reduce((total, line) => {
							if (!rule.employee_scheme_codes.includes(line.scheme_code)) return total;
							const own =
								row.period.slice(0, 7) === illnessMonth
									? line.employee_amount - (line.earned_employee_amount ?? 0)
									: 0;
							return (
								total +
								own +
								(line.earned_period?.slice(0, 7) === illnessMonth
									? (line.earned_employee_amount ?? 0)
									: 0)
							);
						}, 0),
					0
				);
				const currentCharges = charges.reduce((sum, charge) => {
					if (!rule.employee_scheme_codes.includes(charge.contribution.row.code)) return sum;
					return (
						sum +
						(bundle.window.period.slice(0, 7) === illnessMonth
							? charge.employee - (charge.lateTopUp?.employee ?? 0)
							: 0) +
						(charge.lateTopUp?.period.slice(0, 7) === illnessMonth
							? (charge.lateTopUp.employee ?? 0)
							: 0)
					);
				}, 0);
				const employeeCharges = historicalCharges + currentCharges;
				const previousDeduction = priorItems
					.filter((item) => item.code === rule.leave_code && item.bucket === 'ABSENCE')
					.reduce((sum, item) => sum + item.amount, 0);
				const previousTopups = priorItems
					.filter((item) => item.code === rule.code && item.reserved_line === 'BASE')
					.reduce((sum, item) => sum + item.amount, 0);
				const currentDeduction = monthCovered.reduce(
					(sum, row) => sum + row.rate * row.charge.days - row.paid,
					0
				);
				const monthlyFloor =
					monthCovered.reduce((sum, row) => sum + row.floor * rule.divisor_days, 0) /
					monthCovered.reduce((sum, row) => sum + row.charge.days, 0);
				const priorPaid =
					priorCharges.reduce((sum, charge) => {
						const frozen = priorItems.find(
							(item) =>
								item.code === rule.leave_code &&
								item.bucket === 'ABSENCE' &&
								item.date === charge.date
						);
						const terms = bundle.termsHistory.find((row) => row.id === charge.employment_term_id);
						return (
							sum +
							(frozen?.rate ?? decodeNumber(terms?.base_salary ?? 0) / rule.divisor_days) *
								charge.days
						);
					}, 0) - previousDeduction;

				const priorSalary = history.reduce((sum, row) => {
					const start = dateKey(row.payslip.salary_from),
						end = dateKey(row.payslip.salary_to);
					if (start === '' || end === '') {
						if (row.period.slice(0, 7) !== illnessMonth) return sum;
						refuse(
							'Leave net floor needs the earlier payslip frozen salary window; a mutable company calendar cannot prove settlement.'
						);
					}
					if (start > month.end || end < month.start) return sum;
					return (
						sum +
						row.payslip.base
							.filter((line) => salaryCodes.has(line.component_code))
							.reduce((total, line) => {
								const segments = (row.payslip.proration ?? []).filter(
									(segment) => segment.component_code === line.component_code
								);
								const priced = segments.reduce(
									(amount, segment) => amount + segment.prorated_amount,
									0
								);
								if (priced === 0) {
									if (start < month.start || end > month.end)
										refuse(
											'Leave net floor needs dated frozen salary proration across calendar months.'
										);
									return total + line.amount;
								}
								if (segments.some((segment) => segment.from.slice(0, 7) !== segment.to.slice(0, 7)))
									refuse(
										'Leave net floor needs salary proration segments confined to one calendar month.'
									);
								const attributed = segments
									.filter((segment) => segment.from.slice(0, 7) === illnessMonth)
									.reduce((amount, segment) => amount + segment.prorated_amount, 0);
								return total + (line.amount * attributed) / priced;
							}, 0)
					);
				}, 0);

				const currentSalary =
					bundle.window.period.slice(0, 7) === illnessMonth
						? measured.base
								.filter((line) => line.catalogueComponent.output === 'salary')
								.reduce((sum, line) => sum + line.amount, 0)
						: 0;
				const peers = assessment.measuredContracts.filter(
					(row) =>
						row.employment.employee_id === bundle.employment.employee_id &&
						row.employment.company_id === bundle.employment.company_id
				);
				const normalWage = (row: typeof contract) =>
					row.measured.base
						.filter((line) => line.catalogueComponent.output === 'salary')
						.reduce((sum, line) => sum + line.amount, 0);
				const totalNormal = peers.reduce((sum, row) => sum + normalWage(row), 0);
				const wageShare =
					peers.length === 1
						? 1
						: totalNormal > 0
							? normalWage(contract) / totalNormal
							: 1 / peers.length;
				const floor =
					(fullMonth ? monthlyFloor * share : (monthlyFloor / rule.divisor_days) * sickDays) *
					wageShare;
				const paid = fullMonth
					? priorSalary + currentSalary - previousDeduction - currentDeduction
					: priorPaid + monthCovered.reduce((sum, row) => sum + row.paid, 0);
				const group = `${bundle.employment.company_id}:${bundle.employment.employee_id}:${rule.code}:${illnessMonth}`;
				const deficit = cents(
					cents(floor, measured.currency) +
						cents(employeeCharges * share, measured.currency) -
						cents(paid, measured.currency) -
						previousTopups,
					measured.currency
				);
				deficits.set(group, (deficits.get(group) ?? 0) + deficit);
				const topUp = Math.max(0, deficit);
				if (topUp === 0) continue;
				const amounts = allocate(
					topUp,
					monthCovered.map((row) => row.charge.days),
					measured.currency
				);
				for (const [index, row] of monthCovered.entries()) {
					const amount = amounts[index]!;
					if (amount === 0) continue;
					const item: LeavePayItem = {
						catalogue_id: row.catalogue.id,
						settings_id: row.catalogue.settings_id,
						code: rule.code,
						bucket: 'EARNING',
						date: row.charge.date,
						amount,
						quantity: row.charge.days,
						reserved_line: 'BASE'
					};
					candidates.push({ item, group, employment: bundle.employment.id });
					const prior = payItems.get(row.capture.leave_entry_id) ?? [];
					prior.push(item);
					payItems.set(row.capture.leave_entry_id, prior);
					const adjustment: MeasuredAdjustment = {
						catalogueComponent: {
							id: `${row.catalogue.id}:${rule.code}`,
							catalogue_id: row.catalogue.id,
							settings_id: row.catalogue.settings_id,
							code: rule.code,
							output: `derived:${rule.code}`,
							family: 'WORK',
							destination: 'PAY',
							direction: 'ADD',
							bands: [],
							eligibility: '',
							...{ definition: { source: 'DERIVED_NORMAL', unit: 'MONEY' } }
						},
						bucket: 'EARNING',
						label: rule.code,
						amount,
						input: { family: 'LEAVE', id: row.capture.leave_entry_id },
						quantity: row.charge.days,
						rate: null,
						statutoryRuleKey: null,
						...(illnessMonth === bundle.window.period.slice(0, 7)
							? {}
							: { earnedPeriod: illnessMonth })
					};
					adjustmentItems.set(adjustment, item);
					extra.push(adjustment);
				}
			}
		}
		if (extra.length === 0) return contract;
		changed = true;
		const adjustments = [...measured.adjustments, ...extra];
		const next = {
			...measured,
			adjustments,
			captured: {
				...measured.captured,
				leave: measured.captured.leave.map((capture) => {
					const items = payItems.get(capture.leave_entry_id) ?? [];
					return {
						...capture,
						pay_items: [...capture.pay_items, ...items],
						gross_amount: {
							...capture.gross_amount,
							value: cents(
								capture.gross_amount.value + items.reduce((sum, item) => sum + item.amount, 0),
								measured.currency
							)
						}
					};
				})
			}
		};
		return {
			...contract,
			measured: next,
			calculation: {
				...contract.calculation,
				accumulation: accumulatePayslip({
					items: [...next.base, ...next.adjustments],
					ordinaryHour: next.ordinaryHourlyRate
				})
			}
		};
	});
	if (!changed) return assessment;
	const adjustedAmounts = new WeakMap<LeavePayItem, number>();
	for (const [group, rows] of Map.groupBy(candidates, (row) => row.group)) {
		const ordered = rows.toSorted(
			(a, b) => a.employment.localeCompare(b.employment) || a.item.date!.localeCompare(b.item.date!)
		);
		const currency = measuredContracts.find((row) => row.employment.id === ordered[0]!.employment)!
			.measured.currency;
		const amounts = allocate(
			Math.max(0, cents(deficits.get(group) ?? 0, currency)),
			ordered.map((row) => row.item.amount),
			currency
		);
		ordered.forEach((row, index) => adjustedAmounts.set(row.item, amounts[index]!));
	}
	measuredContracts = measuredContracts.map((contract) => {
		const measured = contract.measured;
		const adjustments = measured.adjustments
			.map((row) => {
				const item = adjustmentItems.get(row);
				return item == null ? row : { ...row, amount: adjustedAmounts.get(item) ?? row.amount };
			})
			.filter((row) => row.amount !== 0);
		const next = {
			...measured,
			adjustments,
			captured: {
				...measured.captured,
				leave: measured.captured.leave.map((capture) => {
					let difference = 0;
					const items = capture.pay_items
						.map((item) => {
							const amount = adjustedAmounts.get(item);
							if (amount == null) return item;
							difference += amount - item.amount;
							return { ...item, amount };
						})
						.filter((item) => item.amount !== 0);
					return {
						...capture,
						pay_items: items,
						gross_amount: {
							...capture.gross_amount,
							value: cents(capture.gross_amount.value + difference, measured.currency)
						}
					};
				})
			}
		};
		return {
			...contract,
			measured: next,
			calculation: {
				...contract.calculation,
				accumulation: accumulatePayslip({
					items: [...next.base, ...next.adjustments],
					ordinaryHour: next.ordinaryHourlyRate
				})
			}
		};
	});
	const chargesByEmployment = assessContributions(measuredContracts);

	const protectedPeople = new Map<string, { ids: Set<string>; codes: Set<string> }>();
	for (const [employmentId, codes] of protectedByEmployment) {
		const contract = measuredContracts.find((row) => row.employment.id === employmentId)!;
		const key = `${contract.employment.company_id}:${contract.employment.employee_id}`;
		const person = protectedPeople.get(key) ?? { ids: new Set<string>(), codes: new Set<string>() };
		for (const peer of measuredContracts.filter(
			(row) =>
				row.employment.company_id === contract.employment.company_id &&
				row.employment.employee_id === contract.employment.employee_id
		))
			person.ids.add(peer.employment.id);
		for (const code of codes) person.codes.add(code);
		protectedPeople.set(key, person);
	}
	for (const [key, person] of protectedPeople)
		for (const code of person.codes) {
			const total = (map: Assessment['chargesByEmployment']) =>
				[...person.ids]
					.flatMap((id) => map.get(id) ?? [])
					.filter((row) => row.contribution.row.code === code)
					.reduce(
						(sum, row) => ({
							employee: sum.employee + row.employee,
							employer: sum.employer + row.employer,
							base: sum.base + row.base
						}),
						{ employee: 0, employer: 0, base: 0 }
					);
			const before = total(assessment.chargesByEmployment),
				after = total(chargesByEmployment);
			if (
				cents(before.employee) !== cents(after.employee) ||
				cents(before.employer) !== cents(after.employer) ||
				cents(before.base) !== cents(after.base)
			)
				refuse(
					`Leave net floor for ${key} changes protected ${code} contributions. A circular contribution base needs an explicit supported rule.`
				);
		}

	const companyCharges = assessCompanyContributions({
		...options,
		accumulations: measuredContracts.map(({ calculation }) => calculation.accumulation),
		charges: [...chargesByEmployment.values()].flat(),
		company: options.gathered.company
	});
	return { ...assessment, measuredContracts, chargesByEmployment, companyCharges };
}
