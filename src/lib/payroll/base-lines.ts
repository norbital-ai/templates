import type {
	BaseEntryFamily,
	ContributionBase
} from '../../datatypes/contribution_base/+definition.js';

/**
 * The lines one scheme's base admits, as the calculation-flow graph lists them: the four work
 * lines by flag, then every catalogue row the declaration names. One pure read of the
 * declaration, so the graph and the engine agree by construction.
 */
type BaseLine = {
	readonly code: string;
	readonly family: string;
	readonly effect: 'INCLUDE' | 'REDUCE';
};

type CatalogueRow = { readonly code: string; readonly direction?: string | null };

export function baseLines(options: {
	readonly base: ContributionBase;
	readonly catalogues: ReadonlyArray<readonly [BaseEntryFamily, readonly CatalogueRow[]]>;
	/** The reader-language labels of the work lines: BASIC, ABSENCE, OVERTIME, NIGHT. */
	readonly workLabels: {
		readonly salary: string;
		readonly absence: string;
		readonly overtime: string;
		readonly night: string;
	};
}): BaseLine[] {
	const { base, workLabels } = options;
	const lines: BaseLine[] = [];
	if (base.salary) lines.push({ code: workLabels.salary, family: 'WORK', effect: 'INCLUDE' });
	if (base.absence) lines.push({ code: workLabels.absence, family: 'WORK', effect: 'REDUCE' });
	if (base.overtime) lines.push({ code: workLabels.overtime, family: 'WORK', effect: 'INCLUDE' });
	if (base.night_premium) lines.push({ code: workLabels.night, family: 'WORK', effect: 'INCLUDE' });
	for (const entry of base.entries) {
		const rows = options.catalogues.find(([family]) => family === entry.family)?.[1] ?? [];
		const row = rows.find((candidate) => candidate.code === entry.code);
		// A leave row listed in the base is its encashment, an earning whatever the row's direction.
		const subtracts = entry.family !== 'LEAVE' && row?.direction === 'SUBTRACT';
		lines.push({
			code: entry.code,
			family: entry.family,
			effect: subtracts ? 'REDUCE' : 'INCLUDE'
		});
	}
	return lines;
}
