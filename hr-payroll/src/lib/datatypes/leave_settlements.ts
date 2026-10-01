import type { LeaveCharge } from './leave_charges.js';
import type { LeavePayItem } from './leave_pay_items.js';
/** Every dated Leave claim settled by one immutable payslip, including zero cash. */
export type LeaveSettlement = {
	readonly leave_entry_id: string;
	readonly charges: readonly LeaveCharge[];
	readonly pay_items: readonly LeavePayItem[];
};
