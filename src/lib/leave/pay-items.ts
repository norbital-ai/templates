/**
 * The two pay lines a leave row can produce. Neither is captured: the unpaid deduction settles
 * under the leave's own code, the encashment under `${code}_ENCASHMENT`.
 */
export const encashmentCode = (leaveCode: string): string => `${leaveCode}_ENCASHMENT`;
