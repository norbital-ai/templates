import {
	prepareCaptureContracts,
	withCaptureContract,
	type PreparedCaptureContracts
} from '../../lib/payslip-capture.js';
import type { Hooks } from './$types.js';

export default {
	mutate: {
		prepare: ({ inputs, api }) =>
			prepareCaptureContracts(
				api,
				'work_days',
				inputs.map((input) => input.work_day_id),
				inputs.map((input) => input.payslip_id)
			),
		perRecord: {
			before: {
				description:
					'Capture only inputs belonging to the payslip’s employment contract; refuse edits to stored captures.',
				handler: ({ input, existing, prepared, parent }) =>
					withCaptureContract(input, existing, input.work_day_id, prepared, parent)
			}
		}
	}
} satisfies Hooks<PreparedCaptureContracts>;
