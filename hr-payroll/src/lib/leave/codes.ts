/** The payslip code of a leave row's encashment line; the unpaid day settles under the row's own code. */
export const encashmentCode = (leaveCode: string): string => `${leaveCode}_ENCASHMENT`;

/** The leave row a settled line belongs to, whichever of its two codes the line carries. */
export const leaveRowCode = (lineCode: string): string => lineCode.replace(/_ENCASHMENT$/, '');
