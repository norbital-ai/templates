import { coversDate, readRange } from '../collections/payroll_runs/lib/effective.js';

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
		readonly id?: string;
		readonly supersedes_id?: string | null;
		readonly approval_id?: string | null;
	}
>(profiles: readonly P[], lawFamilyCode: string, asOf: string): P | null {
	const enacted = profiles.filter(
		(profile) =>
			profile.code === lawFamilyCode &&
			profile.lifecycle === 'SEALED' &&
			profile.approval_id == null
	);
	const retired = new Set<string>();
	for (const successor of enacted) {
		const range = readRange(successor.effective_range);
		if (range == null || !coversDate({ start: range.start, end: null }, asOf)) continue;
		let parentId = successor.supersedes_id;
		const visited = new Set<string>();
		while (parentId != null) {
			if (visited.has(parentId)) throw new Error('Statutory profile successor cycle.');
			visited.add(parentId);
			retired.add(parentId);
			parentId = enacted.find((profile) => profile.id === parentId)?.supersedes_id;
		}
	}
	const covering = enacted.filter(
		(profile) =>
			(profile.id == null || !retired.has(profile.id)) && coversDate(profile.effective_range, asOf)
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

/** Company catalogue and employment inputs retain their stable identities across law revisions. */
export function statutoryCatalogueProfile<
	P extends { readonly id: string; readonly supersedes_id?: string | null }
>(profiles: readonly P[], profile: P): P {
	return statutoryProfileLineage(profiles, profile).at(-1)!;
}

/** New leave codes join the catalogue at their revision; earlier codes retain their identities. */
export function statutoryProfileLineage<
	P extends { readonly id: string; readonly supersedes_id?: string | null }
>(profiles: readonly P[], profile: P): P[] {
	const byId = new Map(profiles.map((row) => [row.id, row]));
	const seen = new Set<string>();
	let root = profile;
	const lineage = [root];
	while (root.supersedes_id != null) {
		if (seen.has(root.id)) throw new Error('Statutory profile successor cycle.');
		seen.add(root.id);
		const parent = byId.get(root.supersedes_id);
		if (parent == null) throw new Error('Statutory catalogue predecessor is missing.');
		root = parent;
		lineage.push(root);
	}
	return lineage;
}

/** No entitlement before a code's introduction, and no catalogue from an unrelated revision. */
export function leaveProfileRequired<
	P extends Parameters<typeof sealedProfileCovering>[0][number] & { readonly id: string }
>(profiles: readonly P[], code: string, introductionId: string, asOf: string): P | null {
	const introduction = profiles.find((row) => row.id === introductionId);
	if (
		introduction == null ||
		introduction.code !== code ||
		introduction.lifecycle !== 'SEALED' ||
		introduction.approval_id != null
	)
		throw new Error('This leave type has no approved statutory profile in the company law family.');
	const range = readRange(introduction.effective_range);
	if (range == null) throw new Error('The leave type introduction has no effective date.');
	if (introduction.supersedes_id != null && !coversDate({ start: range.start, end: null }, asOf))
		return null;
	const profile = statutoryProfileRequired(profiles, code, asOf);
	if (!statutoryProfileLineage(profiles, profile).some((row) => row.id === introductionId))
		throw new Error(
			'This leave type is not part of the statutory profile governing the requested date.'
		);
	return profile;
}

/** Never apply a newly enacted entitlement retroactively to earlier accrual months. */
export function statutoryProfileRequired<
	P extends Parameters<typeof sealedProfileCovering>[0][number]
>(profiles: readonly P[], code: string, asOf: string): P {
	const profile = sealedProfileCovering(profiles, code, asOf);
	if (profile == null)
		throw new Error(
			`No approved statutory profile covers ${asOf}. Configure the historical profile or post an approved opening carry balance.`
		);
	return profile;
}
