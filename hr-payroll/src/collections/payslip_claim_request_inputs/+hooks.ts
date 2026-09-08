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
				'claim_requests',
				inputs.map((input) => input.claim_request_id),
				inputs.map((input) => input.payslip_id)
			),
		perRecord: {
			before: {
				description:
					'Capture only inputs belonging to the payslip’s employment contract; refuse edits to stored captures.',
				handler: ({ input, existing, prepared, parent }) =>
					withCaptureContract(input, existing, input.claim_request_id, prepared, parent)
			}
		}
	}
} satisfies Hooks<PreparedCaptureContracts>;
