/** The payslip code of a leave row's encashment line; the unpaid day settles under the row's own code. */
export const encashmentCode = (leaveCode: string): string => `${leaveCode}_ENCASHMENT`;

/** The leave row a settled line belongs to, whichever of its two codes the line carries. */
export const leaveRowCode = (lineCode: string): string => lineCode.replace(/_ENCASHMENT$/, '');

/**
 * The annual leave row of a catalogue: the one whose code begins `ANNUAL` (`ANNUAL_LEAVE` in the
 * seed bank, `ANNUAL` in the public fixture). Departure pays out this row and no other: every
 * jurisdiction's commutation-at-exit rule names annual leave, and `can_encash` on the other rows
 * only says a manual encashment may be entered against them.
 */
export const isAnnualLeaveCode = (code: string): boolean => code.startsWith('ANNUAL');
