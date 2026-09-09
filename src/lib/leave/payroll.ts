import { childrenOn } from '../employment-contract.js';
import { PAGE_LIMIT } from '../../collections/payroll_runs/lib/api.js';
import { refuse } from '@norbital-ai/bolt/authoring';
import { fromMinorUnits, toMinorUnits, type MoneyValue } from '@norbital-ai/std/finance';
import { Effect } from 'effect';
import type { LeaveCharge } from '../../datatypes/leave_charges/+definition.js';
import type { LeavePayItem } from '../../datatypes/leave_pay_items/+definition.js';
import type { LeaveWindow } from '../../datatypes/leave_event/+definition.js';
import type { FamilyPayItem } from '../payroll/family.js';
import type { LeaveActivity } from './pending.js';
import { activeTimeOff } from './activity.js';
import { readLeaveContext, leaveRules, type LeaveReadApi, type LeaveContext } from './context.js';
import { leaveBalanceAt } from './balance.js';
import { leaveWindowOf } from './entitlement.js';
import { settingsInForce } from '../jurisdiction_settings.js';
import { coversDate } from '../../collections/payroll_runs/lib/effective.js';
import { isEligible, personContext } from '../../collections/payroll_runs/lib/eligibility.js';
import {
	LEAVE_ABSENCE_SEQUENCE,
	LEAVE_ENCASHMENT_SEQUENCE,
	absenceTreatments,
	encashmentCode,
	encashmentTreatments
} from './pay-items.js';

type LeaveCapture = {
	readonly leave_entry_id: string;
	readonly charges: readonly LeaveCharge[];
	readonly gross_amount: MoneyValue;
};

export type SettledLeaveCapture = LeaveCapture & { readonly pay_items: readonly LeavePayItem[] };
export type PreparedLeavePayroll = {
	readonly entries: readonly LeaveActivity[];
	readonly catalogues: readonly LeaveContext['catalogues'][number][];
	readonly captures: readonly (SettledLeaveCapture & { readonly paid: boolean })[];
	readonly balances: Readonly<Record<string, number>>;
	readonly deductionEligibility: Readonly<Record<string, boolean>>;
};

/** Family-owned preparation. Payroll receives approved activity and frozen settlement evidence. */
export function prepareLeavePayroll(options: {
	readonly api: LeaveReadApi;
	readonly employmentIds: readonly string[];
	readonly asOf: string;
}): Effect.Effect<ReadonlyMap<string, PreparedLeavePayroll>> {
	return Effect.gen(function* () {
		const context = yield* readLeaveContext(options.api, options.employmentIds, undefined, true);
		const runById = new Map(context.runs.map((row) => [row.id, row]));
		const payslipById = new Map(context.payslips.map((row) => [row.id, row]));
		const captures = context.captures.flatMap((capture) => {
			const payslip = payslipById.get(capture.payslip_id);
			const run = payslip == null ? undefined : runById.get(payslip.payroll_run_id);
			if (!run) refuse('A Leave capture has no owning payroll run.');
			return [{ ...capture, paid: run.lifecycle === 'PAID' }];
		});
		const result = new Map<string, PreparedLeavePayroll>();
		for (const employment of context.employments) {
			const company = context.companies.find((row) => row.id === employment.company_id);
			const employee = context.employees.find((row) => row.id === employment.employee_id);
			if (!company || !employee)
				refuse('Leave payroll needs approved employment and company facts.');
			const versionIds = new Set(
				context.versions.filter((row) => row.code === company.settings_code).map((row) => row.id)
			);
			const catalogues = context.catalogues.filter((row) => versionIds.has(row.settings_id));
			const entries = context.entries.filter(
				(row) => row.employment_id === employment.id && row.approval_id == null
			);
			const entryIds = new Set(entries.map((row) => row.id));
			const current = settingsInForce(context.versions, company.settings_code, options.asOf);
			if (!current) refuse(`No sealed leave catalogue covers ${options.asOf}.`);
			const balances: Record<string, number> = {};
			for (const catalogue of catalogues.filter((row) => row.settings_id === current.id)) {
				const rules = leaveRules(context, employment.id, catalogue.id);
				balances[catalogue.code] =
					leaveBalanceAt({
						entries: entries.filter((row) => row.leave_code === catalogue.code),
						window: leaveWindowOf(options.asOf, catalogue.entitlement.year_start_month),
						date: options.asOf,
						entitlementAt: rules.entitlementAt
					}).balance ?? 0;
			}
			const deductionEligibility: Record<string, boolean> = {};
			for (const entry of activeTimeOff(entries))
				for (const charge of entry.charges) {
					const catalogue = catalogues.find((row) => row.id === charge.leave_catalogue_id);
					if (!catalogue) refuse('Approved leave refers to a missing catalogue revision.');
					if (catalogue.paid) continue;
					const term = context.terms.find(
						(row) => row.employment_id === employment.id && row.id === charge.employment_term_id
					);
					if (!term || !coversDate(term.effective_range, charge.date))
						refuse('Approved leave has no effective captured employment terms.');
					// The deduction covers whom the leave covers: one predicate, not two halves of one fact.
					deductionEligibility[`${entry.id}/${charge.date}`] = isEligible(
						catalogue.eligibility,
						personContext({
							employee,
							employment,
							terms: term,
							asOf: charge.date,
							children: childrenOn(employment.children, charge.date)
						})
					);
				}
			result.set(employment.id, {
				entries,
				catalogues,
				captures: captures.filter((row) => entryIds.has(row.leave_entry_id)),
				balances,
				deductionEligibility
			});
		}
		return result;
	});
}

/** The Leave family selects its own approved sources; payroll receives date slices and agreed money. */
export function leavePayrollInputs(options: {
	readonly entries: readonly LeaveActivity[];
	readonly salaryWindow: { readonly start: string; readonly end: string };
	readonly dueThrough: string;
	/** Every standing capture reserves its exact dates or monetary obligation. */
	readonly captures: readonly LeaveCapture[];
}) {
	const approved = options.entries.filter((row) => row.approval_id == null);
	const reversed = new Set(
		approved.flatMap((row) => (row.event.kind === 'REVERSAL' ? [row.event.entry_id] : []))
	);
	const timeOff = activeTimeOff(approved).flatMap((entry) => {
		const captured = new Set(
			options.captures
				.filter((row) => row.leave_entry_id === entry.id)
				.flatMap((row) => row.charges.map((charge) => charge.date))
		);
		const charges = entry.charges.filter(
			(row) =>
				row.date >= options.salaryWindow.start &&
				row.date <= options.salaryWindow.end &&
				!captured.has(row.date)
		);
		if (new Set(charges.map((row) => row.date)).size !== charges.length)
			refuse('Approved leave has duplicate charges for one date.');
		return charges.length === 0 ? [] : [{ entry, charges }];
	});
	const monetary = approved.flatMap((entry) => {
		const event = entry.event;
		if (options.captures.some((row) => row.leave_entry_id === entry.id) || reversed.has(entry.id))
			return [];
		if (event.kind !== 'ENCASHMENT' && event.kind !== 'REVERSAL') return [];
		if (event.gross_amount == null) return [];
		if (event.due_on == null) refuse('A monetary Leave entry is missing its approved due date.');
		if (event.due_on > options.dueThrough) return [];
		return [{ entry, amount: event.gross_amount, dueOn: event.due_on }];
	});
	return { timeOff, monetary };
}

/** Outstanding Leave money keeps an ended employment selectable without restoring salary. */
export function hasLeavePayment(prepared: PreparedLeavePayroll, dueThrough: string): boolean {
	return (
		leavePayrollInputs({
			entries: prepared.entries,
			captures: prepared.captures,
			salaryWindow: { start: dueThrough, end: dueThrough },
			dueThrough
		}).monetary.length > 0
	);
}

/** Approved date coverage is separate from whether a source has already been paid. */
export function leaveCoverage(prepared: PreparedLeavePayroll, window: LeaveWindow) {
	const days: Record<string, number> = {};
	const byCode: Record<string, number> = {};
	const seen = new Set<string>();
	const add = (entryId: string, charge: LeaveCharge) => {
		if (
			charge.date < window.start ||
			charge.date > window.end ||
			seen.has(`${entryId}/${charge.date}`)
		)
			return;
		seen.add(`${entryId}/${charge.date}`);
		const code = prepared.entries.find((row) => row.id === entryId)?.leave_code;
		if (code == null) refuse('Captured Leave has no source entry.');
		days[charge.date] = (days[charge.date] ?? 0) + charge.days;
		if (days[charge.date]! > 1) refuse(`Approved leave exceeds one day on ${charge.date}.`);
		byCode[code] = (byCode[code] ?? 0) + charge.days;
	};
	for (const entry of activeTimeOff(prepared.entries))
		for (const charge of entry.charges) add(entry.id, charge);
	return { days, byCode };
}

function leaveCaptureAmount(items: readonly LeavePayItem[], currency: string): MoneyValue {
	const minor = items.reduce(
		(sum, item) =>
			sum + toMinorUnits(item.nature === 'ABSENCE' ? -item.amount : item.amount, currency),
		0n
	);
	return { currency, value: fromMinorUnits(minor, currency) };
}

/** Pure Leave calculation: Work supplies withheld-day rates; agreed money is never repriced. */
export function calculateLeavePayroll(options: {
	readonly prepared: PreparedLeavePayroll;
	readonly window: LeaveWindow;
	readonly dueThrough: string;
	readonly currency: string;
	readonly absenceRate: (charge: LeaveCharge) => number;
	/** Deferred salary replay includes dated leave only; agreed money settles in the regular pass. */
	readonly includeMonetary?: boolean;
}) {
	const { prepared, currency } = options;
	const selected = leavePayrollInputs({
		entries: prepared.entries,
		captures: prepared.captures,
		salaryWindow: options.window,
		dueThrough: options.dueThrough
	});
	const captures: SettledLeaveCapture[] = [];
	const add = (
		entryId: string,
		charges: readonly LeaveCharge[],
		items: readonly LeavePayItem[]
	) => {
		captures.push({
			leave_entry_id: entryId,
			charges,
			pay_items: items,
			gross_amount: leaveCaptureAmount(items, currency)
		});
	};
	for (const { entry, charges } of selected.timeOff) {
		const items: LeavePayItem[] = [];
		for (const charge of charges) {
			const catalogue = prepared.catalogues.find((row) => row.id === charge.leave_catalogue_id);
			if (!catalogue) refuse('Approved Leave has no captured catalogue revision.');
			if (catalogue.paid) continue;
			const eligible = prepared.deductionEligibility[`${entry.id}/${charge.date}`];
			if (eligible == null) refuse('The Leave deduction eligibility was not prepared.');
			if (!eligible) continue;
			const rate = options.absenceRate(charge);
			if (!Number.isFinite(rate) || rate < 0)
				refuse('Work must supply a nonnegative Leave absence rate.');
			const amount = fromMinorUnits(toMinorUnits(rate * charge.days, currency), currency);
			if (amount === 0) continue;
			items.push({
				sequence: LEAVE_ABSENCE_SEQUENCE,
				contribution_treatments: absenceTreatments(catalogue.treatments),
				catalogue_id: catalogue.id,
				settings_id: catalogue.settings_id,
				code: catalogue.code,
				is_statutory: catalogue.is_statutory,
				nature: 'ABSENCE',
				date: charge.date,
				amount,
				quantity: charge.days,
				rate
			});
		}
		add(entry.id, charges, items);
	}
	for (const { entry, amount } of options.includeMonetary === false ? [] : selected.monetary) {
		if (amount.currency !== currency)
			refuse('The agreed Leave currency differs from this payroll.');
		const event = entry.event;
		if (event.kind === 'ENCASHMENT') {
			const catalogue = prepared.catalogues.find((row) => row.id === entry.leave_catalogue_id);
			if (!catalogue) refuse('The agreed encashment catalogue revision is missing.');
			add(
				entry.id,
				[],
				[
					{
						code: encashmentCode(catalogue.code),
						sequence: LEAVE_ENCASHMENT_SEQUENCE,
						contribution_treatments: encashmentTreatments(catalogue.treatments),
						catalogue_id: catalogue.id,
						settings_id: catalogue.settings_id,
						is_statutory: catalogue.is_statutory,
						nature: 'EARNING',
						date: null,
						amount: amount.value,
						quantity: event.days,
						rate: event.rate
					}
				]
			);
		} else if (event.kind === 'REVERSAL') {
			const sources = prepared.captures.filter(
				(row) => row.leave_entry_id === event.entry_id && row.paid
			);
			if (sources.some((row) => row.gross_amount.currency !== currency))
				refuse('Reversed Leave currency differs from this payroll.');
			const items = sources.flatMap((row) =>
				row.pay_items.map((item) => ({
					...item,
					amount: -item.amount,
					quantity: item.quantity == null ? null : -item.quantity
				}))
			);
			if (
				toMinorUnits(leaveCaptureAmount(items, currency).value, currency) !==
				toMinorUnits(amount.value, currency)
			)
				refuse('The approved reversal does not match its original paid Leave outputs.');
			add(entry.id, [], items);
		}
	}
	const adjustments = captures.flatMap((capture) =>
		capture.pay_items.map((item) => {
			const catalogueComponent: FamilyPayItem = {
				...item,
				id: `${item.catalogue_id}:${item.nature}:${item.code}`,
				family: 'LEAVE',
				eligibility: '',
				settlement: 'PAYROLL'
			};
			return {
				catalogueComponent,
				nature: item.nature,
				label: item.code,
				amount: item.amount,
				input: { family: 'LEAVE' as const, id: capture.leave_entry_id },
				quantity: item.quantity,
				rate: item.rate,
				statutoryRuleKey: null
			};
		})
	);
	return { adjustments, captures };
}

export function prepareLeaveCatalogue(options: {
	readonly api: import('../../collections/payroll_runs/lib/api.js').PayrollReadApi & {
		readonly reads: import('../../collections/payroll_runs/lib/api.js').ReadLog;
	};
	readonly settingsId: string;
}) {
	return Effect.gen(function* () {
		const rows = yield* options.api.db.leave_catalogue.findMany({
			where: { settings_id: { eq: options.settingsId }, approval_id: { isNull: true } },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(rows, 'leave catalogue entries');
		return rows.filter((row) => row.approval_id == null);
	});
}
