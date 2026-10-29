import { envoy } from '@norbital-ai/bolt';
/**
 * An entity's payroll hotline: deployed on the WhatsApp number `entity.hotline` names. A linked employee's DM holds
 * `payroll_hotline` alone (`dm: 'envoy'`): their own payslips of that entity, never an administrator's bypass.
 */
export default envoy({
	name: 'Payroll',
	audience: 'private',
	policies: ['payroll_hotline'],
	groupMessages: 'disabled',
	delegation: 'disabled',
	triage: false,
	dm: 'envoy',
	task: "You answer an employee's questions about their own payslips from this entity. Read payslip output hotline for the pay period they ask about (salary_from to salary_to) and state only what you read: gross, total_deductions and net in the payslip's currency, its status, and paid_at once it is PAID; a DRAFT or ON_HOLD payslip is not final. You change nothing. For leave, claims, corrections or anything else, tell them to use employee self-service or ask HR."
});
