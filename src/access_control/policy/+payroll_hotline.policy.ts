import { policy } from '@norbital-ai/bolt';

/**
 * The payroll hotline's whole authority (`src/agent/envoy/+payroll_hotline.envoy.ts`, `dm: 'envoy'`): a linked
 * member's own payslips of the entity whose WhatsApp number the message arrived on. `{ actor: 'id' }` is the member a
 * DM is bound to and `{ actor: 'instance' }` the number (`entity.hotline`); a turn with no linked member has no
 * `actor.id`, so reads nothing. No team holds it, and it grants no write.
 */
export default policy({
	description:
		"The payroll hotline: the sender's own payslips of the entity whose WhatsApp number they wrote to, read-only.",
	grants: {
		payslip: {
			read: {
				where: {
					employment_id: {
						is: {
							employee_id: { is: { user_id: { eq: { actor: 'id' } } } },
							company_id: { is: { hotline: { eq: { actor: 'instance' } } } }
						}
					}
				},
				fields: [
					'id',
					'salary_from',
					'salary_to',
					'status',
					'currency',
					'gross',
					'total_deductions',
					'net',
					'paid_at'
				]
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
