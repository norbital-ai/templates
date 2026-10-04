import { decodeNumber } from '../../payroll_engine/foundation/primitives.js';
import type { SettlementClaim } from '../../scheduling/lock.js';

/** An unpaid snapshot pin is advisory; payment, received funds or actual allocation freezes its source. */
export function captureClaims(
	days: readonly { readonly id: string; readonly payslip_id?: string | null | undefined }[],
	slips: readonly {
		readonly id: string;
		readonly paid_at?: unknown;
		readonly funding_received?: unknown;
		readonly funding_received_on?: unknown;
		readonly funding_reference?: unknown;
	}[],
	allocatedSlipIds: ReadonlySet<string>
): ReadonlyMap<string, SettlementClaim> {
	const frozen = new Set(
		slips
			.filter(
				(slip) =>
					slip.paid_at != null ||
					decodeNumber(slip.funding_received ?? 0) > 0 ||
					slip.funding_received_on != null ||
					String(slip.funding_reference ?? '').trim() !== '' ||
					allocatedSlipIds.has(slip.id)
			)
			.map((slip) => slip.id)
	);
	return new Map(
		days.flatMap<[string, SettlementClaim]>((day) =>
			day.payslip_id != null && frozen.has(day.payslip_id) ? [[day.id, { period: '' }]] : []
		)
	);
}

/** A record remains closed until every authoritative capture read has answered successfully. */
export function capturedWorkDayFrozen(
	day: Parameters<typeof captureClaims>[0][number] | null,
	slips: Parameters<typeof captureClaims>[1],
	allocatedSlipIds: ReadonlySet<string>,
	readsReady: boolean
): boolean {
	return (
		day?.payslip_id != null &&
		(!readsReady || captureClaims([day], slips, allocatedSlipIds).has(day.id))
	);
}
