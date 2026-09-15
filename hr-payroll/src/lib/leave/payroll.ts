import { childrenOn, serviceStart } from '../employment-contract.js';
import {
	PAGE_LIMIT,
	type PayrollReadApi,
	type ReadLog
} from '../../collections/payroll_runs/lib/api.js';
import { refuse } from '@norbital-ai/bolt/authoring';
import { fromMinorUnits, toMinorUnits, type MoneyValue } from '@norbital-ai/std/finance';
import { Effect } from 'effect';
import type { WorkspaceRow } from '$bolt/types.js';
import type { LeaveCharge } from '../../datatypes/leave_charges/+definition.js';
import type { LeavePayItem } from '../../datatypes/leave_pay_items/+definition.js';
import type { LeaveWindow } from '../../datatypes/leave_event/+definition.js';
import type {
	SettlementBucket,
	SettlementDestination,
	SettlementDirection,
	FamilyPayItem
} from '../payroll/family.js';
import type { LeaveActivity } from './pending.js';
import { activeTimeOff } from './activity.js';
import type { LeaveContext } from './context.js';
import { coversDate } from '../../collections/payroll_runs/lib/effective.js';
import { isEligible, personContext } from '../../collections/payroll_runs/lib/eligibility.js';
import type { Configuration } from '../../collections/payroll_runs/lib/configuration.js';
import { encashmentCode } from './codes.js';

export { encashmentCode } from './codes.js';

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
	readonly deductionEligibility: Readonly<Record<string, boolean>>;
};

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
				bucket: line.bucket === 'ABSENCE' ? 'ABSENCE' : 'EARNING',
				date: null,
				amount: line.amount,
				quantity: line.quantity,
				rate: line.rate
			}
		];
	});
}

/**
 * Family-owned preparation. Payroll receives approved activity and frozen settlement evidence.
 *
 * Three reads, on rows the run has already selected: the approved entries of these employments,
 * every revision of the lineage's leave catalogue (a settled entry cites the revision it was
 * settled under), and the payslips those settled entries are pinned to. The employments, company
 * and versions come from the caller, which read them once for everybody; the deduction verdicts
 * need the terms and the person, and are added by `withLeaveDeductionEligibility` once the run
 * has read those too.
 */
export function prepareLeavePayroll(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly employments: readonly { readonly id: string }[];
	readonly versions: readonly { readonly id: string }[];
	/** The payroll's currency, which a settled capture nobody reverses is stated in. */
	readonly currency: string;
}): Effect.Effect<ReadonlyMap<string, GatheredLeave>> {
	return Effect.gen(function* () {
		const approved = { approval_id: { isNull: true } } as const;
		const employmentIds = options.employments.map((row) => row.id);
		const versionIds = options.versions.map((row) => row.id);
		const [entryRows, catalogueRows] = yield* Effect.all(
			[
				employmentIds.length === 0
					? Effect.succeed([])
					: options.api.db.leave_entries.findMany({
							where: { employment_id: { in: employmentIds }, ...approved },
							columns: {
								id: true,
								employment_id: true,
								catalogue_id: true,
								leave_code: true,
								reference: true,
								event: true,
								charges: true,
								allocations: true,
								approval_id: true,
								payslip_id: true
							},
							limit: PAGE_LIMIT
						}),
				versionIds.length === 0
					? Effect.succeed([])
					: options.api.db.leave_catalogue.findMany({
							where: { settings_id: { in: versionIds }, ...approved },
							limit: PAGE_LIMIT
						})
			],
			{ concurrency: 'unbounded' }
		);
		options.api.reads.assertComplete(entryRows, 'leave entries');
		options.api.reads.assertComplete(catalogueRows, 'leave catalogue revisions');
		const catalogues = catalogueRows as unknown as LeaveCatalogue[];
		// A settled entry's frozen pay lines are read back only where something negates them: the
		// approved reversals name their targets, and every other settled capture is just its pin.
		const entries = entryRows as unknown as LeaveActivity[];
		const reversedIds = new Set(
			entries.flatMap((row) =>
				row.approval_id == null && row.event.kind === 'REVERSAL' ? [row.event.entry_id] : []
			)
		);
		const settlingIds = [
			...new Set(
				entries.flatMap((row) =>
					row.payslip_id != null && reversedIds.has(row.id) ? [row.payslip_id] : []
				)
			)
		];
		const payslipRows =
			settlingIds.length === 0
				? []
				: yield* options.api.db.payslips.findMany({
						where: { id: { in: settlingIds }, ...approved },
						columns: {
							id: true,
							payroll_run_id: true,
							employment_id: true,
							currency: true,
							paid_at: true,
							adjustments: true
						},
						limit: PAGE_LIMIT
					});
		options.api.reads.assertComplete(payslipRows, 'settling payslips');
		const payslipById = new Map(payslipRows.map((row) => [row.id, row]));
		const entriesByEmployment = Map.groupBy(entries, (row) => row.employment_id);
		const result = new Map<string, GatheredLeave>();
		for (const employment of options.employments) {
			const entries = entriesByEmployment.get(employment.id) ?? [];
			// A settled entry's pin is the capture; its payslip's adjustments are the frozen outputs.
			const captures = entries.flatMap((entry) => {
				if (entry.payslip_id == null) return [];
				const payslip = payslipById.get(entry.payslip_id);
				if (payslip == null && reversedIds.has(entry.id))
					refuse('A settled Leave entry has no owning payslip.');
				const pay_items = payslip == null ? [] : settledPayItems(entry, payslip, catalogues);
				return [
					{
						leave_entry_id: entry.id,
						charges: entry.charges,
						pay_items,
						gross_amount: leaveCaptureAmount(pay_items, payslip?.currency ?? options.currency),
						// Paid is this person's own slip, read only where a reversal negates it.
						paid: payslip?.paid_at != null
					}
				];
			});
			result.set(employment.id, { entries, catalogues, captures });
		}
		return result;
	});
}

/** What `prepareLeavePayroll` gathers before the person and their terms are known. */
type GatheredLeave = Omit<PreparedLeavePayroll, 'deductionEligibility'>;

/**
 * The deduction covers whom the leave covers: one predicate per charged day, judged on the person
 * as they stood that day. Pure, so the run adds it once it has read the terms and the employee.
 */
export function withLeaveDeductionEligibility(
	gathered: GatheredLeave,
	options: {
		readonly employment: Parameters<typeof serviceStart>[0];
		readonly employee: WorkspaceRow<'employees'>;
		readonly company: Configuration['company'];
		readonly terms: readonly WorkspaceRow<'employment_terms'>[];
	}
): PreparedLeavePayroll {
	const deductionEligibility: Record<string, boolean> = {};
	for (const entry of activeTimeOff(gathered.entries))
		for (const charge of entry.charges) {
			const catalogue = gathered.catalogues.find((row) => row.id === charge.catalogue_id);
			if (!catalogue) refuse('Approved leave refers to a missing catalogue revision.');
			if (catalogue.paid) continue;
			const term = options.terms.find((row) => row.id === charge.employment_term_id);
			if (!term || !coversDate(term.effective_range, charge.date))
				refuse('Approved leave has no effective captured employment terms.');
			deductionEligibility[`${entry.id}/${charge.date}`] = isEligible(
				catalogue.eligibility,
				personContext({
					employee: options.employee,
					employment: { service_start: serviceStart(options.employment) },
					terms: term,
					asOf: charge.date,
					children: childrenOn(options.employee.children ?? [], charge.date),
					company: options.company
				})
			);
		}
	return { ...gathered, deductionEligibility };
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
export function hasLeavePayment(prepared: GatheredLeave, dueThrough: string): boolean {
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
				catalogue_id: catalogue.id,
				settings_id: catalogue.settings_id,
				code: catalogue.code,
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
						catalogue_id: catalogue.id,
						settings_id: catalogue.settings_id,
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
				// The enum columns arrive as text at the database boundary; the model constrains them
				// to the §9 vocabulary.
				destination: catalogue.destination as SettlementDestination,
				direction: catalogue.direction as SettlementDirection | null,
				bands: [],
				eligibility: catalogue.eligibility,
				family: 'LEAVE'
			};
			return {
				catalogueComponent,
				bucket,
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
