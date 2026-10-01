import type { Id } from '@norbital-ai/bolt';
import { decodeNumber } from '../../../../lib/wire.js';

/** Draft captures may change; a paid, funded or actually allocated capture remains frozen. */
export async function workDayCaptureLocks(
	reader: {
		tranches(
			ids: readonly Id<'payslips'>[]
		): Promise<readonly { id: Id<'payable_tranches'>; settlement: { id: string } }[]>;
		allocations(
			ids: readonly Id<'payable_tranches'>[]
		): Promise<readonly { payable_tranche_id: Id<'payable_tranches'> }[]>;
	},
	slips: readonly {
		readonly id: Id<'payslips'>;
		readonly paid_at?: unknown;
		readonly funding_received?: unknown;
		readonly funding_received_on?: unknown;
		readonly funding_reference?: unknown;
	}[]
): Promise<ReadonlySet<string>> {
	const ids = slips.map((slip) => slip.id);
	const locked = new Set(
		slips
			.filter(
				(slip) =>
					slip.paid_at != null ||
					decodeNumber(slip.funding_received ?? 0) > 0 ||
					slip.funding_received_on != null ||
					String(slip.funding_reference ?? '').trim() !== ''
			)
			.map((slip) => String(slip.id))
	);
	if (ids.length === 0) return locked;
	const tranches = await reader.tranches(ids);
	if (tranches.length === 0) return locked;
	const allocations = await reader.allocations(tranches.map((row) => row.id));
	const allocated = new Set(allocations.map((row) => String(row.payable_tranche_id)));
	for (const tranche of tranches)
		if (allocated.has(String(tranche.id))) locked.add(String(tranche.settlement.id));
	return locked;
}
