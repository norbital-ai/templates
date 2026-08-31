export interface LeaveRequestCreateScope {
	readonly employmentId: () => string | undefined;
	readonly companyId: () => string | undefined;
}

export const LEAVE_REQUEST_CREATE_SCOPE = Symbol('norbital_hr.leave_request_create_scope');
