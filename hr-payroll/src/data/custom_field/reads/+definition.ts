import { customField } from '@norbital-ai/bolt';
import { READS_SHAPE } from '../../../lib/payroll_engine/reads.js';

export default customField('reads', {
	description:
		'The rows a registered rule or effect reads before it runs: one layer per model, its filter, the row limit and the fields it keeps. Every layer is read once for the whole batch.',
	shape: READS_SHAPE,
	validate: (value) =>
		Object.entries(value).some(
			([, layer]) => layer != null && typeof layer.limit === 'number' && layer.limit < 1
		)
			? 'A read layer takes at least one row.'
			: undefined
});
