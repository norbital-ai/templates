import { customField } from '@norbital-ai/bolt';
import { SUSPENSION_KINDS_SHAPE } from '../../../lib/payroll_engine/suspension_kinds.js';

export default customField('suspension_kinds', {
	description:
		'The causes and configured effects of work suspensions inside one jurisdiction version.',
	shape: SUSPENSION_KINDS_SHAPE,
	validate: (value) =>
		value.some((kind) => kind.code.trim() === '') ||
		new Set(value.map((kind) => kind.code)).size !== value.length
			? 'Suspension kinds must have distinct non-empty codes.'
			: undefined
});
