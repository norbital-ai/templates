import { envoy } from '@norbital-ai/bolt';

/**
 * The sales desk, reached on Telegram by anyone who can message it. An unlinked customer's DM runs under exactly the
 * Sales team's four policies (never more); a linked staff member's DM adds their own authority. Groups are ignored.
 * Its limits are `sales_rep`'s: `envoys.receive` per sender and per desk, and the desk-wide `agent` and `act` budgets.
 */
export default envoy({
	channel: 'sales_desk',
	audience: 'public',
	policies: ['accounts_read', 'products_read', 'commercial_shared', 'sales_rep'],
	groupMessages: 'disabled',
	delegation: 'enabled',
	task: 'Answer questions about quotes and accounts for this customer.'
});
