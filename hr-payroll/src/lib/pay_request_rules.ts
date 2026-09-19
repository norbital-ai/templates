import { Effect } from 'effect';
import { refuse, type CollectionTransformDatabase } from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';
import { capSubjects } from './component_entry_cap_subject.js';
import {
	entryLimitRefusal,
	resolveEntryLimit,
	type LimitSibling
} from '../collections/payroll_runs/lib/entry-cap.js';
import { assertNotCaptured } from './scheduling/lock.js';
import { isEligible, compileEligibility } from '../collections/payroll_runs/lib/eligibility.js';
import {
	captureAmounts,
	entryContext,
	type PayRequestFamily,
	type PayRequestCapture
} from './payroll/money.js';
import { expressionEngine, evaluateBoolean, evaluateNumber } from './expressions/evaluate.js';

export type PayRequestGuard = {
	readonly family: PayRequestFamily;
	/** The class table the request names, and the table its siblings (and their pins) live in. */
	readonly catalogue: 'claim_catalogue' | 'adhoc_catalogue';
	readonly requests: 'claim_requests' | 'adhoc_requests';
	readonly eventDate: (candidate: Readonly<Record<string, unknown>>) => string | null;
	readonly sign?: number;
	readonly noun: string;
};

const SIBLING_LIMIT = 10_000;

function assertCapHistoryComplete(rows: readonly unknown[]): void {
	if (rows.length >= SIBLING_LIMIT)
		refuse('The contract cap history exceeds the supported read limit.');
}

type PayRequestDb = Pick<
	CollectionTransformDatabase,
	| 'claim_catalogue'
	| 'claim_requests'
	| 'adhoc_catalogue'
	| 'adhoc_requests'
	| 'employments'
	| 'jurisdiction_settings'
	| 'payslips'
>;

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
};

type SiblingRow = Readonly<Record<string, unknown>> & {
	readonly id: string;
	readonly employment_id: string;
	readonly catalogue_id: string;
	readonly payslip_id: string | null;
};

const catalogueColumns = {
	id: true,
	settings_id: true,
	code: true,
	evidence: true,
	bands: true,
	eligibility: true
} as const;

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
export function admitPayRequests(
	guard: PayRequestGuard,
	db: PayRequestDb,
	inputs: ReadonlyArray<Readonly<Record<string, unknown>>>,
	existing: ReadonlyArray<Readonly<Record<string, unknown>> | undefined>
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		const candidates = inputs.map((input, index) => ({ ...existing[index], ...input }));
		const catalogueIds = [
			...new Set(candidates.map((row) => String(row.catalogue_id ?? '')).filter((id) => id !== ''))
		];
		const employmentIds = [
			...new Set(candidates.map((row) => String(row.employment_id ?? '')).filter((id) => id !== ''))
		];
		// The class and request tables of the two families share every column this rule reads; the
		// union of their clients is not callable, the claim clients' shape reads either.
		const catalogue = db[guard.catalogue] as PayRequestDb['claim_catalogue'];
		const requests = db[guard.requests] as PayRequestDb['claim_requests'];
		const [components, subjectOf, siblingRows, payslips, versions] = yield* Effect.all(
			[
				catalogueIds.length === 0
					? Effect.succeed([])
					: catalogue.findMany({
							where: { id: { in: catalogueIds } },
							columns: catalogueColumns,
							limit: catalogueIds.length
						}),
				capSubjects(db, employmentIds),
				// Every claim of these people, pinned or free: the siblings a ceiling counts, and the
				// capture links their pins are.
				employmentIds.length === 0
					? Effect.succeed([])
					: requests.findMany({
							where: { employment_id: { in: employmentIds } },
							limit: SIBLING_LIMIT
						}),
				employmentIds.length === 0
					? Effect.succeed([])
					: db.payslips.findMany({
							where: { employment_id: { in: employmentIds } },
							columns: { id: true, adjustments: true },
							limit: SIBLING_LIMIT
						}),
				db.jurisdiction_settings.findMany({
					where: { approval_id: { isNull: true } },
					columns: { id: true, code: true },
					limit: SIBLING_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		assertCapHistoryComplete(siblingRows);
		assertCapHistoryComplete(payslips);
		assertCapHistoryComplete(versions);
		const componentById = new Map(
			(components as ReadonlyArray<CatalogueRow>).map((row) => [row.id, row])
		);
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
		const revisionRows =
			lineage.length === 0
				? []
				: yield* catalogue.findMany({
						where: {
							settings_id: { in: [...new Set(lineage.flatMap((entry) => entry.versionIds))] },
							code: { in: [...new Set(lineage.map((entry) => entry.code))] },
							approval_id: { isNull: true }
						},
						columns: { id: true, settings_id: true, code: true, eligibility: true, bands: true },
						limit: SIBLING_LIMIT
					});
		assertCapHistoryComplete(revisionRows);
		const siblings = siblingRows as ReadonlyArray<SiblingRow>;
		const payslipById = new Map(payslips.map((row) => [row.id, row]));

		for (const [index, candidate] of candidates.entries()) {
			const stored = existing[index];
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
									(row) =>
										row.code === component.code && codeOfVersion.get(row.settings_id) === code
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
						const context = entryContext({
							entry: { amount, event_date: eventDate },
							subject: person.subject,
							period: eventDate.slice(0, 7),
							periodStart: `${eventDate.slice(0, 7)}-01`,
							periodEnd: `${eventDate.slice(0, 7)}-01`,
							instalments: 1,
							// A write-time guard prices the entry outside any run: no proration is known here.
							daysEmployed: 0,
							daysInMonth: 0,
							ordinaryDay: 0,
							ordinaryHour: 0,
							limits: {},
							captures: { paidToDate: 0, remaining: amount }
						});
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
								return prior.length > 0
									? prior.map((capture) => ({ ...common, amount: signOf(row) * capture.amount }))
									: [{ ...common, amount: signOf(row) * decodeNumber(row.amount) }];
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
											componentCode: String(component.code),
											subject: person.label,
											proposed: signOf(candidate) * amount
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
	});
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
	assertCapHistoryComplete(links);
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
