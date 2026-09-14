import type { StatutoryOptIn, WorkRules } from '../../datatypes/work_rules/+definition.js';

/**
 * Every line that opted into a statutory scheme, wherever it is declared: a catalogue band, a work
 * band, or one of the engine-priced work lines. One pure walk over the rows a settings version
 * already holds, so the scheme's read-only Opted-in lines tab and the calculation-flow graph agree
 * by construction rather than by two copies of the same loop.
 */
type OptInLine = {
	readonly code: string;
	readonly family: string;
	/** The band condition that opted in; empty for an engine-priced line. */
	readonly where: string;
	readonly contribution_id: string;
	readonly effect: StatutoryOptIn['effect'];
};

type CatalogueBand = {
	readonly when: string;
	readonly statutory_opt_ins?: readonly StatutoryOptIn[];
};
type CatalogueRow = {
	readonly code: string;
	readonly bands?: readonly CatalogueBand[];
};

export function optInLines(options: {
	readonly catalogues: ReadonlyArray<readonly [string, readonly CatalogueRow[]]>;
	readonly work: WorkRules | null | undefined;
	/** The reader-language labels of the engine-priced lines: BASIC, ABSENCE, NIGHT. */
	readonly engineLineLabels: {
		readonly salary: string;
		readonly absence: string;
		readonly night: string;
	};
}): OptInLine[] {
	const lines: OptInLine[] = [];
	for (const [family, catalogue] of options.catalogues)
		for (const row of catalogue)
			for (const band of row.bands ?? [])
				for (const optIn of band.statutory_opt_ins ?? [])
					lines.push({
						code: row.code,
						family,
						where: band.when,
						contribution_id: optIn.contribution_id,
						effect: optIn.effect
					});
	const work = options.work;
	if (work == null) return lines;
	const engine: ReadonlyArray<readonly [string, readonly StatutoryOptIn[]]> = [
		[options.engineLineLabels.salary, work.engine_lines.salary.statutory_opt_ins],
		[options.engineLineLabels.absence, work.engine_lines.absence.statutory_opt_ins],
		[options.engineLineLabels.night, work.engine_lines.night.statutory_opt_ins]
	];
	for (const [code, optIns] of engine)
		for (const optIn of optIns) lines.push({ code, family: 'WORK', where: '', ...optIn });
	for (const band of work.rates.bands)
		for (const optIn of band.statutory_opt_ins)
			lines.push({
				code: `${band.line} ${band.label}`,
				family: 'WORK',
				where: band.when,
				contribution_id: optIn.contribution_id,
				effect: optIn.effect
			});
	return lines;
}
