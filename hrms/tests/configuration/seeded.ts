import { lawsOf } from '../../src/lib/law.ts';
import { seedLaw, seededLaws } from '../kit.ts';

/** Every seeded law: its changes, oldest first, and the law as it stands on each change's date (`law.on`). */
export const SEEDED = seededLaws().map((code) => {
	const seed = seedLaw(code);
	const laws = lawsOf(seed);
	const changes = seed.jurisdiction_change.toSorted((left, right) =>
		String(left.effective_from).localeCompare(String(right.effective_from))
	);
	return {
		code,
		changes,
		standing: changes.map((row) => {
			const law = laws(code, String(row.effective_from));
			if (law === undefined) throw new Error(`No ${code} law on ${String(row.effective_from)}`);
			return law;
		})
	};
});
