/**
 * One contracted amount on a payslip, before the calendar touches it. Caused by no input, so it is
 * inlined on `payslips` rather than an adjustment; `component_code` is frozen at settlement.
 */
export type PayslipBase = { readonly component_code: string; readonly amount: number };
