import { coversDate } from '../collections/payroll_runs/lib/effective.js';

/**
 * The one SEALED statutory profile of a law family that governs a date.
 *
 * A company binds to a law family through its jurisdiction anchor row; the versions of that family
 * share its `code`. The pick is lifecycle-gated (DRAFT profiles never govern, VOIDED profiles are
 * retired) and period-scoped (the version whose effective range covers the date), and it must be
 * exactly one — zero is a missing configuration, two is an ambiguous one; both refuse.
 *
 * Pure over read rows, so the engine's pick, the write hooks' guards and the client panel quote
 * the same selection from the same inputs.
 */
export function sealedProfileCovering<
	P extends {
		readonly code: string;
		readonly lifecycle: string;
		readonly effective_range: unknown;
	}
>(profiles: readonly P[], lawFamilyCode: string, asOf: string): P | null {
	const covering = profiles.filter(
		(profile) =>
			profile.code === lawFamilyCode &&
			profile.lifecycle === 'SEALED' &&
			coversDate(profile.effective_range, asOf)
	);
	if (covering.length === 0) return null;
	if (covering.length > 1) {
		throw new Error(
			`Statutory profiles ${covering.map((profile) => profile.code).join(', ')} overlap on ${asOf}. ` +
				'Void every version but one before payroll can pick a configuration.'
		);
	}
	return covering[0] ?? null;
}
