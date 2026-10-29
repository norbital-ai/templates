import { policy } from '@norbital-ai/bolt';

/**
 * The payroll hotline's whole authority (`src/agent/envoy/+payroll_hotline.envoy.ts`, `dm: 'envoy'`): a linked
 * member's own payslips of the entity whose WhatsApp number the message arrived on. `{ var: 'requestor.id' }` is the member a
 * DM is bound to and `{ var: 'requestor.instance' }` the number (`entity.hotline`); a turn with no linked member has no
 * `actor.id`, so reads nothing. No team holds it, and it grants no write.
 */
export default policy({
	description:
		"The payroll hotline: the sender's own payslips of the entity whose WhatsApp number they wrote to, read-only.",
	grants: {
		payslip: {
			outputs: {
				hotline: {
					payslip: {
						where: {
							employment_id: {
								is: {
									employee_id: { is: { user_id: { eq: { var: 'requestor.id' } } } },
									company_id: { is: { hotline: { eq: { var: 'requestor.instance' } } } }
								}
							}
						}
					}
				}
			}
		}
	},
	limits: {
		'envoys.receive': [
			{ rate: '10/min', per: 'sender' },
			{ rate: '300/min', per: 'subject' }
		]
	}
});
