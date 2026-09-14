import { Effect } from 'effect';
import { refuse, type Api as AuthoringApi } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types';
import { decodeNumber } from '@norbital-ai/std/json';
import { capSubject } from './component_entry_cap_subject.js';
import {
	entryLimitRefusal,
	resolveEntryLimit,
	type LimitSibling
} from '../collections/payroll_runs/lib/entry-cap.js';
import { isSettlementWrite, refuseIfCaptured, settledClaim } from './scheduling/lock.js';
import { isEligible, compileEligibility } from '../collections/payroll_runs/lib/eligibility.js';
import { monthKey } from '../collections/payroll_runs/lib/dates.js';
import {
	captureAmounts,
	entryContext,
	type PayRequestFamily,
	type PayRequestCapture
} from './payroll/money.js';
import { expressionEngine, evaluateBoolean, evaluateNumber } from './expressions/evaluate.js';

export type PayRequestGuard = {
	readonly family: PayRequestFamily;
	readonly eventDate: (candidate: Readonly<Record<string, unknown>>) => string | null;
	readonly sign?: number;
	readonly noun: string;
};

const SIBLING_LIMIT = 10_000;

function assertCapHistoryComplete(rows: readonly unknown[]): void {
	if (rows.length >= SIBLING_LIMIT)
		refuse('The contract cap history exceeds the supported read limit.');
}

/** The row of one money family, with the columns this guard reads. */
const catalogueRowOf = (
	family: PayRequestFamily,
	api: AuthoringApi<WorkspaceSchema, unknown>,
	id: string
) => {
	const columns = {
		id: true,
		settings_id: true,
		code: true,
		evidence: true,
		bands: true,
		destination: true,
		direction: true,
		eligibility: true
	} as const;
	const where = { id: { eq: id } } as const;
	switch (family) {
		case 'CLAIM':
			return api.db.claim_catalogue.findFirst({ where, columns });
		case 'ALLOWANCE':
			return api.db.allowance_catalogue.findFirst({ where, columns });
		case 'PAYMENT':
			return api.db.payment_catalogue.findFirst({ where, columns });
	}
};

/** The entry row itself, for the delete/pin guard. */
const entryRowOf = (
	family: PayRequestFamily,
	api: AuthoringApi<WorkspaceSchema, unknown>,
	id: string
) => {
	const columns = { id: true, payslip_id: true } as const;
	const where = { id: { eq: id } } as const;
	switch (family) {
		case 'CLAIM':
			return api.db.claim_requests.findFirst({ where, columns });
		case 'ALLOWANCE':
			return api.db.allowance_requests.findFirst({ where, columns });
		case 'PAYMENT':
			return api.db.payment_requests.findFirst({ where, columns });
	}
};

const siblingsOf = (
	family: PayRequestFamily,
	api: AuthoringApi<WorkspaceSchema, unknown>,
	employmentId: string,
	componentIds: readonly string[]
): Effect.Effect<readonly Readonly<Record<string, unknown>>[], never, never> => {
	const where = {
		employment_id: { eq: employmentId },
		approval_id: { isNull: true }
	} as const;
	const shared = {
		id: true,
		employment_id: true,
		amount: true,
		as_adjustment_entry: true,
		payslip_id: true
	} as const;
	switch (family) {
		case 'CLAIM':
			return api.db.claim_requests.findMany({
				where: { ...where, catalogue_id: { in: [...componentIds] } },
				columns: { ...shared, catalogue_id: true, incurred_on: true },
				limit: SIBLING_LIMIT
			});
		case 'ALLOWANCE':
			return api.db.allowance_requests.findMany({
				where: { ...where, catalogue_id: { in: [...componentIds] } },
				columns: { ...shared, catalogue_id: true, recurrence: true, derived_from_id: true },
				limit: SIBLING_LIMIT
			});
		case 'PAYMENT':
			return api.db.payment_requests.findMany({
				where: { ...where, catalogue_id: { in: [...componentIds] } },
				columns: { ...shared, catalogue_id: true, effective_on: true },
				limit: SIBLING_LIMIT
			});
	}
};

/** Only revisions of this family/code in the same settings lineage share a contract's ceiling. */
function catalogueRevisionsOf(
	family: PayRequestFamily,
	api: AuthoringApi<WorkspaceSchema, unknown>,
	component: { readonly settings_id: string; readonly code: string }
) {
	return Effect.gen(function* () {
		const settings = yield* api.db.jurisdiction_settings.findFirst({
			where: { id: { eq: component.settings_id }, approval_id: { isNull: true } },
			columns: { code: true }
		});
		if (settings == null) refuse('A capped request must reference approved jurisdiction settings.');
		const versions = yield* api.db.jurisdiction_settings.findMany({
			where: { code: { eq: settings.code }, approval_id: { isNull: true } },
			columns: { id: true },
			limit: SIBLING_LIMIT
		});
		assertCapHistoryComplete(versions);
		const where = {
			settings_id: { in: versions.map((row) => row.id) },
			code: { eq: component.code },
			approval_id: { isNull: true }
		} as const;
		const columns = { id: true, eligibility: true, bands: true } as const;
		switch (family) {
			case 'CLAIM':
				return yield* api.db.claim_catalogue.findMany({ where, columns, limit: SIBLING_LIMIT });
			case 'ALLOWANCE':
				return yield* api.db.allowance_catalogue.findMany({ where, columns, limit: SIBLING_LIMIT });
			case 'PAYMENT':
				return yield* api.db.payment_catalogue.findMany({ where, columns, limit: SIBLING_LIMIT });
		}
	});
}

/** Captured sources retain the output actually settled, including a captured zero. */
function capturedUsageOf(
	family: PayRequestFamily,
	api: AuthoringApi<WorkspaceSchema, unknown>,
	ids: readonly string[]
) {
	return Effect.gen(function* () {
		const captures = new Map<string, PayRequestCapture[]>();
		if (ids.length === 0) return captures;
		type Link = {
			readonly payslipId: string;
			readonly period: string;
			readonly sourceId: string;
		};
		const links: Link[] = [];
		if (family === 'ALLOWANCE') {
			// A standing allowance materialises one row per period; its payslip adjustment names the
			// standing source, so the capture is attributed there.
			const derived = yield* api.db.allowance_requests.findMany({
				where: { derived_from_id: { in: [...ids] }, payslip_id: { isNull: false } },
				columns: { id: true, payslip_id: true, derived_from_id: true, recurrence: true },
				limit: SIBLING_LIMIT
			});
			for (const row of derived)
				links.push({
					payslipId: String(row.payslip_id),
					sourceId: String(row.derived_from_id),
					period: monthKey(String((row.recurrence as { readonly from?: string }).from ?? ''))
				});
		}
		const pinned =
			family === 'CLAIM'
				? yield* api.db.claim_requests.findMany({
						where: { id: { in: [...ids] }, payslip_id: { isNull: false } },
						columns: { id: true, payslip_id: true },
						limit: SIBLING_LIMIT
					})
				: family === 'PAYMENT'
					? yield* api.db.payment_requests.findMany({
							where: { id: { in: [...ids] }, payslip_id: { isNull: false } },
							columns: { id: true, payslip_id: true },
							limit: SIBLING_LIMIT
						})
					: yield* api.db.allowance_requests.findMany({
							where: {
								id: { in: [...ids] },
								payslip_id: { isNull: false },
								derived_from_id: { isNull: true }
							},
							columns: { id: true, payslip_id: true },
							limit: SIBLING_LIMIT
						});
		for (const row of pinned)
			links.push({
				payslipId: String(row.payslip_id),
				sourceId: String(row.id),
				period: ''
			});
		assertCapHistoryComplete(links);
		if (links.length === 0) return captures;
		const payslips = yield* api.db.payslips.findMany({
			where: { id: { in: [...new Set(links.map((row) => row.payslipId))] } },
			columns: { id: true, adjustments: true },
			limit: SIBLING_LIMIT
		});
		assertCapHistoryComplete(payslips);
		return captureAmounts(
			links.map((link) => ({ ...link, family })),
			payslips
		);
	});
}

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

export function assertPayRequestAdmissible(
	guard: PayRequestGuard,
	options: {
		readonly api: AuthoringApi<WorkspaceSchema, unknown>;
		readonly input: Readonly<Record<string, unknown>>;
		readonly existing: Readonly<Record<string, unknown>> | undefined;
	}
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		const { api } = options;
		// The engine's capture or release of this row: the one write a settled row takes.
		if (options.existing !== undefined && isSettlementWrite(options.input)) return;
		const candidate =
			options.existing === undefined
				? { ...options.input }
				: { ...options.existing, ...options.input };

		const amount = decodeNumber(candidate.amount);
		if (!Number.isFinite(amount) || amount <= 0)
			refuse(`A ${guard.noun} amount is a positive magnitude; direction comes from the catalogue.`);

		if (guard.family === 'PAYMENT' && String(candidate.reason ?? '').trim() === '')
			refuse('A payment requires a reason or supporting transaction reference.');

		const componentId = String(candidate.catalogue_id ?? '');
		const component = yield* catalogueRowOf(guard.family, api, componentId);
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
				const person = yield* capSubject(api, employmentId, eventDate);
				if (person != null && (component.eligibility ?? '').trim() !== '') {
					if (!isEligible(component.eligibility, person.subject))
						refuse(
							`${component.code} is not offered to ${person.label}: its eligibility rule does not hold for them.`
						);
				}
				if (person != null) {
					const revisions = yield* catalogueRevisionsOf(guard.family, api, {
						settings_id: String(component.settings_id),
						code: String(component.code)
					});
					assertCapHistoryComplete(revisions);
					const catalogueById = new Map(revisions.map((row) => [row.id, row]));
					// The candidate itself is excluded by id unless the id is empty (a create).
					const siblings = yield* siblingsOf(guard.family, api, employmentId, [
						...catalogueById.keys()
					]);
					assertCapHistoryComplete(siblings);
					const captured = yield* capturedUsageOf(
						guard.family,
						api,
						siblings.map((row) => String(row.id))
					);
					const signOf = (row: Readonly<Record<string, unknown>>) =>
						(guard.sign ?? 1) * (row.as_adjustment_entry === true ? -1 : 1);
					const context = entryContext({
						entry: {
							id: String(candidate.id ?? '\uffff'),
							family: guard.family,
							employment_id: employmentId,
							catalogue_id: componentId,
							amount,
							approval_id: null,
							pay_period: null,
							event_date: eventDate,
							sign: signOf(candidate),
							window: null,
							prorates: false,
							depletes: true,
							recurring: false,
							on_day: null,
							captured: false
						},
						subject: person.subject,
						period: eventDate.slice(0, 7),
						periodStart: `${eventDate.slice(0, 7)}-01`,
						periodEnd: `${eventDate.slice(0, 7)}-01`,
						instalments: 1,
						ordinaryDay: 0,
						ordinaryHour: 0,
						limits: {},
						captures: { paidToDate: 0, remaining: amount }
					});
					const band = bandFor(component.bands, context);
					// A recurring declaration is an award per period; payroll bounds each occurrence
					// by the ceiling, so the declaration itself is not refused by the annual cap.
					const recurring =
						guard.family === 'ALLOWANCE' &&
						(candidate.recurrence as { readonly kind?: unknown } | null)?.kind === 'RECURRING';
					if (band != null && band.limit != null && !recurring) {
						const limit = band.limit as {
							readonly period: 'CALENDAR_YEAR' | 'MONTH' | 'LIFETIME' | 'PER_EVENT';
							readonly on_exceed: 'BLOCK' | 'ALLOW';
							readonly amount: number | string;
						};
						const limitAmount =
							typeof limit.amount === 'number'
								? limit.amount
								: evaluateNumber(expressionEngine, limit.amount, context);
						const rows: LimitSibling[] = siblings.flatMap((row) => {
							const prior = captured.get(String(row.id)) ?? [];
							const common = {
								id: String(row.id),
								employment_id: employmentId,
								event_date: guard.eventDate(row)
							};
							return prior.length > 0
								? prior.map((capture) => ({
										...common,
										amount: signOf(row) * capture.amount
									}))
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
		if (options.existing !== undefined)
			yield* refuseIfCaptured({
				capture: Effect.succeed(settledClaim(options.existing)),
				approvalId: null,
				action: `Changing this ${guard.noun}`
			});
	});
}

export const assertPayRequestDeletable = (
	guard: PayRequestGuard,
	api: AuthoringApi<WorkspaceSchema, unknown>,
	id: string
): Effect.Effect<void, never, never> =>
	Effect.gen(function* () {
		const row = yield* entryRowOf(guard.family, api, id);
		yield* refuseIfCaptured({
			capture: Effect.succeed(row == null ? undefined : settledClaim(row)),
			approvalId: null,
			action: `Deleting this ${guard.noun}`
		});
	});
