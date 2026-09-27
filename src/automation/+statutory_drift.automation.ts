import { automation } from '@norbital-ai/bolt';
import { runStatutoryDrift, statutoryDriftOutput } from '../lib/statutory-drift.js';

/**
 * Monthly research of every lineage's version in force, all lineages in parallel: one agentic model call each, handed
 * its goal, its official sources and the version's rows. A lineage with changes gets one unsealed draft for HR to
 * review and seal; nothing is sealed, edited or deleted.
 */
const statutory_drift = automation({
	description:
		'Monthly research of each jurisdiction settings version in force against its official sources, every lineage in parallel. Changes the research reports, each with its source and quote, become one unsealed draft version for review.',
	on: { cron: '0 3 1 * *' },
	input: {
		/** One lineage, when started by hand; every lineage otherwise. */
		code: { kind: 'text', optional: true }
	},
	output: statutoryDriftOutput,
	runAs: ['statutory_drift_automation'],
	concurrency: { max: 1 }
});
export default statutory_drift;

statutory_drift.run(async (input, ctx) => runStatutoryDrift(ctx, input.code ?? undefined));
