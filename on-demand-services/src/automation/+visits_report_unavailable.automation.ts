import { automation } from '@norbital-ai/bolt';
import { declineShift } from '../lib/visit-recovery.js';

export default automation('visits_report_unavailable', {
	description:
		'The controller records that the assigned cleaner cannot work this day and requests recommendations.',
	input: {
		targets: { kind: 'list', of: { kind: 'id', of: 'visits' }, min: 1 },
		mc: { kind: 'bool' }
	},
	runAs: 'trigger',
	run: declineShift
});
