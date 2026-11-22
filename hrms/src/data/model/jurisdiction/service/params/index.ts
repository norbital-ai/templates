import type { Schema } from 'effect';
import { allowance_catalog } from './allowance_catalog.js';
import { overtime_catalog } from './overtime_catalog.js';
import { statutory_contribution_catalog } from './statutory_contribution_catalog.js';
import { leave_catalog } from './leave_catalog.js';
import { claim_catalog } from './claim_catalog.js';
import { adhoc_catalog } from './adhoc_catalog.js';
import { loan_catalog } from './loan_catalog.js';

/** One typed param schema per family and code: required keys are required, not hidden in a side map. */
export const ROW_PARAMS = {
	allowance_catalog,
	overtime_catalog,
	statutory_contribution_catalog,
	leave_catalog,
	claim_catalog,
	adhoc_catalog,
	loan_catalog
} as const;

const BY_ROW: Readonly<
	Record<string, Readonly<Record<string, Schema.ConstraintDecoder<unknown>>>>
> = ROW_PARAMS;
export const paramsFor = (family: string, code: string) => BY_ROW[family]?.[code];
