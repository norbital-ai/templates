import { refuse } from './refuse.js';
import { readAll, type Reads } from './reads.js';
import { decodeNumber } from './wire.js';
import { dateKey } from './iso-day.js';
import { capSubjects } from './component_entry_cap_subject.js';
import {
	entryLimitRefusal,
	resolveEntryLimit,
	type LimitSibling
} from '../lib/payroll/run/entry-cap.js';
import { assertNotCaptured } from './scheduling/lock.js';
import { isEligible, compileEligibility } from '../lib/payroll/run/eligibility.js';
import {
	captureAmounts,
	entryContext,
	type PayRequestFamily,
	type PayRequest,
	type PayRequestCapture
} from './payroll/money.js';
import { expressionEngine, evaluateBoolean, evaluateNumber } from './expressions/evaluate.js';

export type PayRequestGuard = {
	readonly family: PayRequestFamily;
	/** The class table the request names, and the table its siblings (and their pins) live in. */
	readonly catalogue: 'claim_catalogue' | 'adhoc_catalogue';
	readonly requests: 'claim_requests' | 'adhoc_requests';
	readonly eventDate: (candidate: Readonly<Record<string, unknown>>) => string | null;
	readonly sign?: number | undefined;
	readonly noun: string;
};

type CatalogueRow = {
	readonly id: string;
	readonly settings_id: string;
	readonly code: string;
	readonly evidence: string | null;
	readonly bands: readonly {
		readonly when: string;
		readonly amount: number | string;
		readonly limit: unknown;
	}[];
	readonly eligibility: string | null;
	readonly qualifies_when?: string | null;
};

type SiblingRow = Readonly<Record<string, unknown>> & {
	readonly id: string;
	readonly employment_id: string;
	readonly catalogue_id: string;
	readonly payslip_id: string | null;
};

/** The band that governs a candidate entry, or `null` when the table does not cover it. */
function bandFor(
	bands: readonly {
		readonly when: string;
		readonly amount: number | string;
		readonly limit: unknown;
	}[],
	context: Record<string, unknown>
) {
	if (bands.length === 0) return null;
	const engine = expressionEngine;
	for (const band of bands) {
		if (band.when.trim() === '') return band;
		try {
			if (evaluateBoolean(engine, band.when, context)) return band;
		} catch {
			return band;
		}
	}
	return null;
}

/**
 * Every claim or ad hoc request in a batch, admitted together (RFC §5.3): wave 1 is keyed by the inputs — the
 * catalogue rows they name, the people, every sibling claim of those people and the payslips that
 * captured any of them, and the settings versions — and wave 2 is the catalogue revisions of each
 * named code across its lineage. The rule then runs once per input over rows already in hand.
 * A standing allowance is admitted by its own collection: it carries no ceiling of its own, since
 * the run bounds each period's entry.
 */
export async function admitPayRequests(
	guard: PayRequestGuard,
	reads: Reads,
	inputs: ReadonlyArray<Readonly<Record<string, unknown>>>,
	existing: ReadonlyArray<Readonly<Record<string, unknown>> | undefined>
): Promise<void> {
	const candidates = inputs.map((input, index) => ({ ...existing[index], ...input }));
	const catalogueIds = [
		...new Set(candidates.map((row) => String(row.catalogue_id ?? '')).filter((id) => id !== ''))
	];
	const employmentIds = [
		...new Set(candidates.map((row) => String(row.employment_id ?? '')).filter((id) => id !== ''))
	];
	const [components, subjectOf, siblings, payslips, versions] = await Promise.all([
		readAll<CatalogueRow>(reads, guard.catalogue, { id: { in: catalogueIds } }),
		capSubjects(reads, employmentIds),
		// Every claim of these people, pinned or free: the siblings a ceiling counts, and the
		// capture links their pins are.
		readAll<SiblingRow>(reads, guard.requests, { employment_id: { in: employmentIds } }),
		readAll<{ readonly id: string; readonly adjustments: unknown }>(reads, 'payslips', {
			employment_id: { in: employmentIds }
		}),
		readAll<{ readonly id: string; readonly code: string }>(
			reads,
			'jurisdiction_settings',
			{
				approval_id: { isNull: true }
			},
			undefined,
			{ id: true, code: true }
		)
	]);
	const componentById = new Map(components.map((row) => [row.id, row]));
	const codeOfVersion = new Map(versions.map((row) => [row.id, row.code]));
	const versionsOfCode = Map.groupBy(versions, (row) => row.code);
	// Wave 2: the revisions of every named code across its lineage, which share the ceiling.
	const lineage = [...componentById.values()].flatMap((component) => {
		const code = codeOfVersion.get(component.settings_id);
		return code == null
			? []
			: [
					{
						code: component.code,
						versionIds: (versionsOfCode.get(code) ?? []).map((row) => row.id)
					}
				];
	});
	const companyIds = [
		...new Set(
			candidates.flatMap((row) => {
				const date = guard.eventDate(row);
				const companyId =
					date == null ? null : subjectOf(String(row.employment_id ?? ''), date)?.companyId;
				return companyId == null ? [] : [companyId];
			})
		)
	];
	const [revisionRows, religiousHolidays] = await Promise.all([
		readAll<CatalogueRow>(reads, guard.catalogue, {
			settings_id: { in: [...new Set(lineage.flatMap((entry) => entry.versionIds))] },
			code: { in: [...new Set(lineage.map((entry) => entry.code))] },
			approval_id: { isNull: true }
		}),
		// The days a THR ceiling counts (ID Permenaker 6/2016 art.5(2)), as the run reads them.
		readAll<{ readonly company_id: string; readonly date: string; readonly religion: string }>(
			reads,
			'jurisdiction_holidays',
			{
				company_id: { in: companyIds },
				religion: { isNull: false },
				published_at: { isNull: false },
				approval_id: { isNull: true }
			},
			undefined,
			{ company_id: true, date: true, religion: true }
		)
	]);
	const revisionById = new Map(revisionRows.map((row) => [row.id, row]));
	const payslipById = new Map(payslips.map((row) => [row.id, row]));

	for (const [index, candidate] of candidates.entries()) {
		const stored = existing[index];
		if (
			candidate.medical_reimbursement != null &&
			candidate.pay_period != null &&
			candidate.pay_period !== ''
		)
			refuse(
				'A treatment reimbursement settles from its due date; do not override its pay period.'
			);
		const amount = decodeNumber(candidate.amount);
		const componentId = String(candidate.catalogue_id ?? '');
		const component = componentById.get(componentId);
		// A class with bands prices the line from the person (a separation payment is a multiple
		// of the monthly wage), so its request may state no amount; a class without bands pays
		// the amount stated, which must be one.
		if (
			!Number.isFinite(amount) ||
			amount < 0 ||
			(amount === 0 && (component?.bands.length ?? 0) === 0)
		)
			refuse(
				`${/^[aeiou]/i.test(guard.noun) ? 'An' : 'A'} ${guard.noun} amount is a positive magnitude; direction comes from the catalogue.`
			);
		if (component != null) {
			const eligibilityFault = compileEligibility(component.eligibility);
			if (eligibilityFault != null) refuse(eligibilityFault);
			if (component.evidence === 'REQUIRED' && candidate.evidence_file == null)
				refuse(
					`Component ${component.code} requires evidence for its ${guard.noun}s. Attach a receipt.`
				);
			const eventDate = guard.eventDate(candidate);
			const employmentId = String(candidate.employment_id ?? '');
			if (eventDate != null && employmentId !== '') {
				const person = subjectOf(employmentId, eventDate);
				if (person != null && (component.eligibility ?? '').trim() !== '') {
					if (!isEligible(component.eligibility, person.subject))
						refuse(
							`${component.code} is not offered to ${person.label}: its eligibility rule does not hold for them.`
						);
				}
				if (person != null) {
					const code = codeOfVersion.get(component.settings_id);
					if (code == null)
						refuse('A capped request must reference approved jurisdiction settings.');
					const revisionIds = new Set(
						revisionRows
							.filter(
								(row) => row.code === component.code && codeOfVersion.get(row.settings_id) === code
							)
							.map((row) => row.id)
					);
					const ownSiblings = siblings.filter(
						(row) =>
							row.employment_id === employmentId &&
							row.approval_id == null &&
							revisionIds.has(row.catalogue_id)
					);
					const captured = capturedUsage(
						guard.family,
						siblings,
						payslipById,
						ownSiblings.map((row) => row.id)
					);
					const signOf = (row: Readonly<Record<string, unknown>>) =>
						(guard.sign ?? 1) * (row.as_adjustment_entry === true ? -1 : 1);
					const ownHolidays = religiousHolidays
						.filter((row) => row.company_id === person.companyId)
						.map((row) => ({ date: dateKey(row.date), religion: row.religion }));
					const contextOf = (row: Readonly<Record<string, unknown>>, date: string) => {
						const keyed = decodeNumber(row.amount);
						return entryContext({
							entry: {
								amount: keyed,
								event_date: date,
								incurred_on: row.incurred_on as string | null,
								medical_reimbursement:
									row.medical_reimbursement as PayRequest['medical_reimbursement'],
								late_wage: row.late_wage as PayRequest['late_wage']
							},
							// A sibling is priced for this entry's person, as the run prices it (money.ts).
							subject: person.subject,
							period: date.slice(0, 7),
							periodStart: `${date.slice(0, 7)}-01`,
							periodEnd: `${date.slice(0, 7)}-01`,
							instalments: 1,
							// A write-time guard prices the entry outside any run: no proration is known here.
							daysEmployed: 0,
							daysInMonth: 0,
							ordinaryDay: 0,
							ordinaryHour: 0,
							limits: {},
							captures: { paidToDate: 0, remaining: keyed },
							religiousHolidays: ownHolidays
						});
					};
					// What a request consumes of a ceiling is what its band prices it at, as the run
					// values it (money.ts): ID's THR is one month's wage whatever is keyed (Permenaker
					// 6/2016 art.3(1)). No band covering a banded class is nothing; no bands, the keyed sum.
					const pricedAt = (
						row: Readonly<Record<string, unknown>>,
						date: string,
						bands: CatalogueRow['bands']
					): number => {
						const own = contextOf(row, date);
						const priced = bandFor(bands, own);
						if (priced != null) return evaluateNumber(expressionEngine, String(priced.amount), own);
						return bands.length > 0 ? 0 : decodeNumber(row.amount);
					};
					const context = contextOf(candidate, eventDate);
					if (
						(component.qualifies_when ?? '').trim() !== '' &&
						!evaluateBoolean(expressionEngine, component.qualifies_when!, context)
					)
						refuse(`${component.code} does not satisfy its claim qualification rule.`);
					const band = bandFor(component.bands, context);
					if (band != null && band.limit != null) {
						const limit = band.limit as {
							readonly period: 'CALENDAR_YEAR' | 'MONTH' | 'LIFETIME' | 'PER_EVENT';
							readonly on_exceed: 'BLOCK' | 'ALLOW';
							readonly amount: string;
						};
						const limitAmount = evaluateNumber(expressionEngine, limit.amount, context);
						const rows: LimitSibling[] = ownSiblings.flatMap((row) => {
							const prior = captured.get(row.id) ?? [];
							const common = {
								id: row.id,
								employment_id: employmentId,
								event_date: guard.eventDate(row)
							};
							if (prior.length > 0)
								return prior.map((capture) => ({
									...common,
									amount: signOf(row) * capture.amount
								}));
							const bands = (revisionById.get(row.catalogue_id) ?? component).bands;
							return [
								{
									...common,
									amount:
										common.event_date == null
											? 0
											: signOf(row) * pricedAt(row, common.event_date, bands)
								}
							];
						});
						const resolved = resolveEntryLimit({
							limit,
							limitAmount,
							entryId: String(candidate.id ?? '\uffff'),
							employmentId,
							eventDate,
							siblings: rows
						});
						const refusal =
							resolved == null
								? null
								: entryLimitRefusal({
										limit,
										resolved,
										componentCode: component.code,
										subject: person.label,
										proposed: signOf(candidate) * pricedAt(candidate, eventDate, component.bands),
										currency: person.currency ?? undefined
									});
						if (refusal !== null) refuse(refusal);
					}
				}
			}
		}
		// Only an edit can disturb a capture: a create has no prior run that consumed it.
		if (stored !== undefined)
			assertNotCaptured(
				{ payslip_id: stored.payslip_id as string | null },
				`Changing this ${guard.noun}`
			);
	}
}

/** Captured sources retain the output actually settled, including a captured zero. */
function capturedUsage(
	family: PayRequestFamily,
	siblings: ReadonlyArray<SiblingRow>,
	payslipById: ReadonlyMap<string, { readonly id: string; readonly adjustments: unknown }>,
	ids: readonly string[]
): ReadonlyMap<string, readonly PayRequestCapture[]> {
	if (ids.length === 0) return new Map();
	const wanted = new Set(ids);
	type Link = { readonly payslipId: string; readonly period: string; readonly sourceId: string };
	const links: Link[] = [];
	for (const row of siblings) {
		if (row.payslip_id == null) continue;
		if (!wanted.has(row.id)) continue;
		links.push({ payslipId: row.payslip_id, sourceId: row.id, period: '' });
	}
	if (links.length === 0) return new Map();
	const payslips = [...new Set(links.map((link) => link.payslipId))].flatMap((id) => {
		const payslip = payslipById.get(id);
		return payslip == null ? [] : [payslip];
	});
	return captureAmounts(
		links.map((link) => ({ ...link, family })),
		payslips as never
	);
}
