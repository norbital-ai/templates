/**
 * Set only on Employee Self-Service. Presence means the leave form is the
 * employee's own request: employment is prefilled, and the event is time off.
 * Encashment and balance adjustments are controller / payroll writes.
 */
export interface LeaveRequestCreateScope {
	readonly employmentId: () => string | undefined;
	readonly companyId: () => string | undefined;
}

export const LEAVE_REQUEST_CREATE_SCOPE = Symbol('norbital_hr.leave_request_create_scope');
