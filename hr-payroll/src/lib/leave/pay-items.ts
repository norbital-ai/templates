/**
 * The two pay lines a leave row can produce, and where they sit in the settlement order. Neither is
 * captured: the unpaid deduction settles under the leave's own code, the encashment under
 * `${code}_ENCASHMENT`, and both orders are the ones every seeded row carried.
 */
export const LEAVE_ABSENCE_SEQUENCE = 1000;
export const LEAVE_ENCASHMENT_SEQUENCE = 110;

export const encashmentCode = (leaveCode: string): string => `${leaveCode}_ENCASHMENT`;
