import { Effect } from 'effect';
import { refuse, type Api as AuthoringApi } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types';
import { decodeNumber } from '@norbital-ai/std/json';
import { capSubject } from './component_entry_cap_subject.js';
import {
	capOccurrenceDate,
	entryCapRefusal,
	noEntitlementRefusal,
	resolveEntryCap
} from '../collections/payroll_runs/lib/entry-cap.js';
import { isSettlementWrite, refuseIfCaptured, settledClaim } from './scheduling/lock.js';
import { isEligible } from '../collections/payroll_runs/lib/eligibility.js';
import type { PayRequestFamily, PayRequestCapture } from './payroll/money.js';

export type PayRequestGuard = {
	readonly family: PayRequestFamily;
	readonly eventDate: (candidate: Readonly<Record<string, unknown>>) => string | null;
	readonly sign?: number;
	readonly noun: string;
};

type CapSource = Readonly<Record<string, unknown>> & {
	readonly id: string;
	readonly employment_id: string;
	readonly event_date: string | null;
	readonly captured_amount: number | null;
};

const SIBLING_LIMIT = 10_000;

function assertCapHistoryComplete(rows: readonly unknown[]): void {
	if (rows.length >= SIBLING_LIMIT)
		refuse('The contract cap history exceeds the supported read limit.');
}

/** The claim a settled request carries: on its own row for the single-use families, on the allowance's capture rows. */
const captureOf = (
	family: PayRequestFamily,
	api: AuthoringApi<WorkspaceSchema, unknown>,
	id: string
): Effect.Effect<{ readonly period: string } | undefined, never, never> => {
	switch (family) {
		case 'CLAIM':
			return Effect.map(
				api.db.claim_requests.findFirst({
					where: { id: { eq: id } },
					columns: { settled_period: true }
				}),
				(row) => (row == null ? undefined : settledClaim(row))
			);
		case 'PAYMENT':
			return Effect.map(
				api.db.payment_requests.findFirst({
					where: { id: { eq: id } },
					columns: { settled_period: true }
				}),
				(row) => (row == null ? undefined : settledClaim(row))
			);
		case 'ALLOWANCE':
			return api.db.payslip_allowance_request_inputs.findFirst({
				where: { allowance_request_id: { eq: id } },
				columns: { period: true }
			});
	}
};

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
		cap: true,
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
		as_adjustment_entry: true
	} as const;
	switch (family) {
		case 'CLAIM':
			return api.db.claim_requests.findMany({
				where: { ...where, claim_catalogue_id: { in: [...componentIds] } },
				columns: { ...shared, claim_catalogue_id: true, incurred_on: true },
				limit: SIBLING_LIMIT
			});
		case 'ALLOWANCE':
			return api.db.allowance_requests.findMany({
				where: { ...where, allowance_catalogue_id: { in: [...componentIds] } },
				columns: { ...shared, allowance_catalogue_id: true, recurrence: true },
				limit: SIBLING_LIMIT
			});
		case 'PAYMENT':
			return api.db.payment_requests.findMany({
				where: { ...where, payment_catalogue_id: { in: [...componentIds] } },
				columns: { ...shared, payment_catalogue_id: true, effective_on: true },
				limit: SIBLING_LIMIT
			});
	}
};

/** Only revisions of this family/code in the same settings lineage share a contract's cap. */
function catalogueRevisionsOf(
	family: PayRequestFamily,
	api: AuthoringApi<WorkspaceSchema, unknown>,
	component: NonNullable<Effect.Success<ReturnType<typeof catalogueRowOf>>>
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
		const columns = { id: true, eligibility: true } as const;
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
		type Link = { readonly payslipId: string; readonly period: string; readonly sourceId: string };
		const settledLinks = (
			rows: readonly {
				readonly id: string;
				readonly settled_payslip_id: string | null;
				readonly settled_period: string | null;
			}[]
		): Link[] =>
			rows.flatMap((row) =>
				row.settled_payslip_id == null
					? []
					: [
							{
								payslipId: row.settled_payslip_id,
								period: row.settled_period ?? '',
								sourceId: row.id
							}
						]
			);
		const settled = { id: true, settled_payslip_id: true, settled_period: true } as const;
		const links: Link[] =
			family === 'ALLOWANCE'
				? (yield* api.db.payslip_allowance_request_inputs.findMany({
						where: { allowance_request_id: { in: [...ids] } },
						columns: { period: true, payslip_id: true, allowance_request_id: true },
						limit: SIBLING_LIMIT
					})).map((row) => ({
						payslipId: row.payslip_id,
						period: row.period,
						sourceId: row.allowance_request_id
					}))
				: family === 'CLAIM'
					? settledLinks(
							yield* api.db.claim_requests.findMany({
								where: { id: { in: [...ids] } },
								columns: settled,
								limit: SIBLING_LIMIT
							})
						)
					: settledLinks(
							yield* api.db.payment_requests.findMany({
								where: { id: { in: [...ids] } },
								columns: settled,
								limit: SIBLING_LIMIT
							})
						);
		assertCapHistoryComplete(links);
		if (links.length === 0) return captures;
		const payslips = yield* api.db.payslips.findMany({
			where: { id: { in: [...new Set(links.map((row) => row.payslipId))] } },
			columns: { id: true, adjustments: true },
			limit: SIBLING_LIMIT
		});
		assertCapHistoryComplete(payslips);
		const totals = new Map<string, number>();
		for (const payslip of payslips)
			for (const adjustment of payslip.adjustments) {
				if (adjustment.family !== family) continue;
				const key = `${payslip.id}:${adjustment.source_id}`;
				totals.set(key, (totals.get(key) ?? 0) + decodeNumber(adjustment.amount));
			}
		for (const link of links) {
			const rows = captures.get(link.sourceId) ?? [];
			rows.push({
				id: link.payslipId,
				period: link.period,
				amount: totals.get(`${link.payslipId}:${link.sourceId}`) ?? 0
			});
			captures.set(link.sourceId, rows);
		}
		return captures;
	});
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
		// The patch merged over the stored row, so a partial update is judged as the row it would
		// produce — the same candidate a form validates before it submits.
		const candidate =
			options.existing === undefined
				? { ...options.input }
				: { ...options.existing, ...options.input };

		const amount = decodeNumber(candidate.amount);
		if (!Number.isFinite(amount) || amount <= 0)
			refuse(`A ${guard.noun} amount is a positive magnitude; direction comes from the component.`);

		if (guard.family === 'PAYMENT' && String(candidate.reason ?? '').trim() === '')
			refuse('A payment requires a reason or supporting transaction reference.');
		if (candidate.corrects_payslip_id != null) {
			const payslip = yield* api.db.payslips.findFirst({
				where: { id: { eq: String(candidate.corrects_payslip_id) } },
				columns: { employment_id: true }
			});
			if (payslip == null || payslip.employment_id !== candidate.employment_id)
				refuse('A correction must reference a payslip from the same employment contract.');
		}

		const componentId = String(candidate[`${guard.family.toLowerCase()}_catalogue_id`] ?? '');
		const component = yield* catalogueRowOf(guard.family, api, componentId);
		if (component != null) {
			if (component.evidence === 'REQUIRED' && candidate.evidence_file == null)
				refuse(
					`Component ${component.code} requires evidence for its ${guard.noun}s. Attach a receipt.`
				);

			// A recurring declaration is an award per period; payroll bounds each occurrence by the cap.
			const recurring =
				guard.family === 'ALLOWANCE' &&
				(candidate.recurrence as { kind?: unknown } | null)?.kind === 'RECURRING';
			if (component.cap != null && !recurring) {
				const eventDate = guard.eventDate(candidate);
				const employmentId = String(candidate.employment_id ?? '');
				if (eventDate != null && employmentId !== '') {
					const person = yield* capSubject(api, employmentId, eventDate);
					if (person != null) {
						const revisions = yield* catalogueRevisionsOf(guard.family, api, component);
						assertCapHistoryComplete(revisions);
						const catalogueById = new Map(revisions.map((row) => [row.id, row]));
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
						const identity = { family: guard.family, code: component.code };
						const resolved = resolveEntryCap({
							cap: component.cap,
							component: identity,
							employmentId,
							entry: { id: String(candidate.id ?? '\uffff'), employment_id: employmentId },
							eventDate,
							siblings: siblings.flatMap<CapSource>((row) => {
								const recurring =
									guard.family === 'ALLOWANCE' &&
									(row.recurrence as { kind?: unknown } | null)?.kind === 'RECURRING';
								const prior = captured.get(String(row.id)) ?? [];
								const common = {
									...row,
									id: String(row.id),
									employment_id: String(row.employment_id)
								};
								return prior.length || recurring
									? prior.map((capture) => ({
											...common,
											id: recurring ? `${row.id}:${capture.id}` : String(row.id),
											event_date: recurring
												? capOccurrenceDate(capture.period)
												: guard.eventDate(row),
											captured_amount: capture.amount
										}))
									: [{ ...common, event_date: guard.eventDate(row), captured_amount: null }];
							}),
							eventDateOf: (row) => row.event_date,
							componentOf: () => identity,
							usedAmountOf: (row) => {
								if (row.captured_amount != null) return signOf(row) * row.captured_amount;
								const source = catalogueById.get(
									String(row[`${guard.family.toLowerCase()}_catalogue_id`])
								);
								if (source == null) refuse('A capped request has no source catalogue row.');
								if (!isEligible(source.eligibility, person.at(row.event_date!))) return 0;
								return signOf(row) * decodeNumber(row.amount);
							},
							subject: person.subject
						});
						if (resolved == null)
							refuse(noEntitlementRefusal(String(component.code), person.label));
						const refusal = entryCapRefusal({
							cap: component.cap,
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
				capture: captureOf(guard.family, api, String(options.existing.id)),
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
	refuseIfCaptured({
		capture: captureOf(guard.family, api, id),
		approvalId: null,
		action: `Deleting this ${guard.noun}`
	});
