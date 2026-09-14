import { childrenOn } from '../employment-contract.js';
import { PAGE_LIMIT } from '../../collections/payroll_runs/lib/api.js';
import { refuse } from '@norbital-ai/bolt/authoring';
import { fromMinorUnits, toMinorUnits, type MoneyValue } from '@norbital-ai/std/finance';
import { Effect } from 'effect';
import type { LeaveCharge } from '../../datatypes/leave_charges/+definition.js';
import type { LeavePayItem } from '../../datatypes/leave_pay_items/+definition.js';
import type { LeaveWindow } from '../../datatypes/leave_event/+definition.js';
import type { StatutoryOptIn } from '../../datatypes/work_rules/+definition.js';
import type {
	SettlementBucket,
	SettlementDestination,
	SettlementDirection,
	FamilyPayItem
} from '../payroll/family.js';
import type { LeaveActivity } from './pending.js';
import { activeTimeOff } from './activity.js';
import { readLeaveContext, leaveRules, type LeaveReadApi, type LeaveContext } from './context.js';
import { leaveBalanceAt } from './balance.js';
import { leaveWindowOf } from './entitlement.js';
import { settingsInForce } from '../jurisdiction_settings.js';
import { coversDate } from '../../collections/payroll_runs/lib/effective.js';
import { isEligible, personContext } from '../../collections/payroll_runs/lib/eligibility.js';
import { runtimeExpressionEngine, evaluateBoolean } from '../expressions/evaluate.js';
import { LEAVE_ABSENCE_SEQUENCE, LEAVE_ENCASHMENT_SEQUENCE, encashmentCode } from './pay-items.js';

type LeaveCatalogue = LeaveContext['catalogues'][number];

type LeaveCapture = {
	readonly leave_entry_id: string;
	readonly charges: readonly LeaveCharge[];
	readonly gross_amount: MoneyValue;
};

export type SettledLeaveCapture = LeaveCapture & { readonly pay_items: readonly LeavePayItem[] };
export type PreparedLeavePayroll = {
	readonly entries: readonly LeaveActivity[];
	readonly catalogues: readonly LeaveCatalogue[];
	readonly captures: readonly (SettledLeaveCapture & { readonly paid: boolean })[];
	readonly balances: Readonly<Record<string, number>>;
	readonly deductionEligibility: Readonly<Record<string, boolean>>;
};

/**
 * The entry context a leave band is selected over.
 *
 * `lib/payroll/money.ts` builds the same shape for a pay request, but its `entry` is a `PayRequest`
 * whose days, hours and quantity are always zero, and leave has neither a request nor a person
 * context at settlement. The members below are the ones a leave band can read; a band that names a
 * member leave does not carry simply evaluates false.
 */
function leaveEntryContext(
	entry: LeaveActivity,
	charge: LeaveCharge | null
): Record<string, unknown> {
	const event = entry.event;
	const encashment = event.kind === 'ENCASHMENT';
	const date = charge?.date ?? (encashment ? event.effective_on : '');
	const days = charge?.days ?? (encashment ? event.days : 0);
	const amount = encashment ? event.gross_amount.value : 0;
	return {
		person: {},
		entry: {
			amount,
			days,
			hours: 0,
			quantity: days,
			event_date: date,
			period: date.slice(0, 7),
			recurring: false,
			occurrence_index: 1,
			window: { start: '', end: '' },
			captures: { paid_to_date: 0, remaining: amount }
		},
		rates: { ordinary_day: 0, ordinary_hour: 0 },
		limits: {},
		period: { key: date.slice(0, 7), start: '', end: '', index: 1, instalments: 1 },
		leave: {}
	};
}

/** The first band whose `when` holds over the entry context; silence in the table is no opt-in. */
function leaveBandOptIns(
	catalogue: LeaveCatalogue,
	entry: LeaveActivity,
	charge: LeaveCharge | null
): readonly StatutoryOptIn[] {
	if (catalogue.bands.length === 0) return [];
	const engine = runtimeExpressionEngine();
	const context = leaveEntryContext(entry, charge);
	for (const band of catalogue.bands) {
		if (band.when.trim() === '') return band.statutory_opt_ins;
		try {
			if (evaluateBoolean(engine, band.when, context)) return band.statutory_opt_ins;
		} catch (error) {
			throw new Error(
				`A ${catalogue.code} leave band condition did not evaluate: ` +
					`${error instanceof Error ? error.message : String(error)}`
			);
		}
	}
	return [];
}

/** The catalogue revision a settled line names, resolved by the code the payslip froze. */
function settledCatalogueOf(
	entry: LeaveActivity,
	componentCode: string,
	catalogues: readonly LeaveCatalogue[]
): LeaveCatalogue {
	const matches = (row: LeaveCatalogue | undefined) =>
		row != null && (row.code === componentCode || encashmentCode(row.code) === componentCode);
	const own = catalogues.find((row) => row.id === entry.catalogue_id);
	if (matches(own)) return own!;
	const charged = entry.charges
		.map((charge) => catalogues.find((row) => row.id === charge.catalogue_id))
		.find(matches);
	if (charged != null) return charged;
	const byCode = catalogues.find(matches);
	if (byCode != null) return byCode;
	refuse(`Settled Leave line ${componentCode} has no catalogue revision in this lineage.`);
}

/** The frozen pay lines of one settled entry, read back off the payslip it is pinned to. */
function settledPayItems(
	entry: LeaveActivity,
	payslip: LeaveContext['payslips'][number],
	catalogues: readonly LeaveCatalogue[]
): readonly LeavePayItem[] {
	return payslip.adjustments.flatMap((line): LeavePayItem[] => {
		if (line.family !== 'LEAVE' || line.source_id !== entry.id) return [];
		const catalogue = settledCatalogueOf(entry, line.component_code, catalogues);
		return [
			{
				catalogue_id: catalogue.id,
				settings_id: catalogue.settings_id,
				code: line.component_code,
				is_statutory: catalogue.is_statutory,
				sequence: catalogue.sequence,
				bucket: line.bucket === 'ABSENCE' ? 'ABSENCE' : 'EARNING',
				statutory_opt_ins: [...leaveBandOptIns(catalogue, entry, null)],
				date: null,
				amount: line.amount,
				quantity: line.quantity,
				rate: line.rate
			}
		];
	});
}

/** Family-owned preparation. Payroll receives approved activity and frozen settlement evidence. */
export function prepareLeavePayroll(options: {
	readonly api: LeaveReadApi;
	readonly employmentIds: readonly string[];
	readonly asOf: string;
}): Effect.Effect<ReadonlyMap<string, PreparedLeavePayroll>> {
	return Effect.gen(function* () {
		const context = yield* readLeaveContext(options.api, options.employmentIds, undefined, true);
		const payslipById = new Map(context.payslips.map((row) => [row.id, row]));
		const result = new Map<string, PreparedLeavePayroll>();
		for (const employment of context.employments) {
			const company = context.companies.find((row) => row.id === employment.company_id);
			const employee = context.employees.find((row) => row.id === employment.employee_id);
			if (!company || !employee)
				refuse('Leave payroll needs approved employment and company facts.');
			const versionIds = new Set(
				context.versions.filter((row) => row.code === company.settings_code).map((row) => row.id)
			);
			const entries = context.entries.filter(
				(row) => row.employment_id === employment.id && row.approval_id == null
			);
			const current = settingsInForce(context.versions, company.settings_code, options.asOf);
			if (!current) refuse(`No sealed leave catalogue covers ${options.asOf}.`);
			const catalogues = context.catalogues.filter((row) => versionIds.has(row.settings_id));
			// A settled entry's pin is the capture; its payslip's adjustments are the frozen outputs.
			const captures = entries.flatMap((entry) => {
				if (entry.payslip_id == null) return [];
				const payslip = payslipById.get(entry.payslip_id);
				if (payslip == null) refuse('A settled Leave entry has no owning payslip.');
				const pay_items = settledPayItems(entry, payslip, catalogues);
				return [
					{
						leave_entry_id: entry.id,
						charges: entry.charges,
						pay_items,
						gross_amount: leaveCaptureAmount(pay_items, payslip.currency),
						// This person's own payslip, not their run's summary. A capture on a slip that
						// has been paid is paid; a colleague still waiting on a correction no longer
						// makes it unpaid, and the run reading DRAFT because of that colleague no
						// longer makes it so either.
						paid: payslip.paid_at != null
					}
				];
			});
			const balances: Record<string, number> = {};
			for (const catalogue of catalogues.filter((row) => row.settings_id === current.id)) {
				const rules = leaveRules(context, employment.id, catalogue.id);
				balances[catalogue.code] =
					leaveBalanceAt({
						entries: entries.filter((row) => row.leave_code === catalogue.code),
						window: leaveWindowOf(options.asOf, catalogue.entitlement),
						date: options.asOf,
						entitlementAt: rules.entitlementAt
					}).balance ?? 0;
			}
			const deductionEligibility: Record<string, boolean> = {};
			for (const entry of activeTimeOff(entries))
				for (const charge of entry.charges) {
					const catalogue = catalogues.find((row) => row.id === charge.catalogue_id);
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
							children: childrenOn(employment.children, charge.date),
							company
						})
					);
				}
			result.set(employment.id, {
				entries,
				catalogues,
				captures,
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
	/** Every settled entry reserves its whole self; the pin on the entry is that reservation. */
	readonly captures: readonly { readonly leave_entry_id: string }[];
	/** Money-only callers (hasLeavePayment) do not judge whether a time-off entry straddles. */
	readonly monetaryOnly?: boolean;
}) {
	const approved = options.entries.filter((row) => row.approval_id == null);
	const reversed = new Set(
		approved.flatMap((row) => (row.event.kind === 'REVERSAL' ? [row.event.entry_id] : []))
	);
	const settled = new Set(options.captures.map((row) => row.leave_entry_id));
	const timeOff = options.monetaryOnly
		? []
		: activeTimeOff(approved).flatMap((entry) => {
				if (settled.has(entry.id)) return [];
				const charges = entry.charges.filter(
					(row) => row.date >= options.salaryWindow.start && row.date <= options.salaryWindow.end
				);
				if (charges.length === 0) return [];
				if (charges.length !== entry.charges.length)
					refuse(
						`Approved ${entry.leave_code} leave straddles the payroll window ` +
							`${options.salaryWindow.start}–${options.salaryWindow.end}. A time-off entry ` +
							'settles whole in the period that contains all of its days; split the leave ' +
							'into one entry per period.'
					);
				if (new Set(charges.map((row) => row.date)).size !== charges.length)
					refuse('Approved leave has duplicate charges for one date.');
				return [{ entry, charges }];
			});
	const monetary = approved.flatMap((entry) => {
		const event = entry.event;
		if (settled.has(entry.id) || reversed.has(entry.id)) return [];
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
			dueThrough,
			monetaryOnly: true
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
			sum + toMinorUnits(item.bucket === 'ABSENCE' ? -item.amount : item.amount, currency),
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
			const catalogue = prepared.catalogues.find((row) => row.id === charge.catalogue_id);
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
				statutory_opt_ins: [...leaveBandOptIns(catalogue, entry, charge)],
				catalogue_id: catalogue.id,
				settings_id: catalogue.settings_id,
				code: catalogue.code,
				is_statutory: catalogue.is_statutory,
				bucket: 'ABSENCE',
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
			const catalogue = prepared.catalogues.find((row) => row.id === entry.catalogue_id);
			if (!catalogue) refuse('The agreed encashment catalogue revision is missing.');
			add(
				entry.id,
				[],
				[
					{
						code: encashmentCode(catalogue.code),
						sequence: LEAVE_ENCASHMENT_SEQUENCE,
						statutory_opt_ins: [...leaveBandOptIns(catalogue, entry, null)],
						catalogue_id: catalogue.id,
						settings_id: catalogue.settings_id,
						is_statutory: catalogue.is_statutory,
						bucket: 'EARNING',
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
			const catalogue = prepared.catalogues.find((row) => row.id === item.catalogue_id);
			if (!catalogue)
				refuse('A settled Leave line names a catalogue revision that is not available.');
			// The frozen pay item states its own bucket: an unpaid day is the ABSENCE arm, an
			// encashment the EARNING arm, whatever the one catalogue row's destination says.
			const bucket: SettlementBucket = item.bucket;
			const catalogueComponent: FamilyPayItem = {
				id: `${item.catalogue_id}:${item.code}`,
				catalogue_id: item.catalogue_id,
				settings_id: item.settings_id,
				code: item.code,
				is_statutory: item.is_statutory,
				// The enum columns arrive as text at the database boundary; the model constrains them
				// to the §9 vocabulary.
				destination: catalogue.destination as SettlementDestination,
				direction: catalogue.direction as SettlementDirection | null,
				bands: catalogue.bands,
				optIns: item.statutory_opt_ins,
				sequence: item.sequence,
				eligibility: catalogue.eligibility,
				family: 'LEAVE'
			};
			return {
				catalogueComponent,
				bucket,
				optIns: item.statutory_opt_ins,
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
