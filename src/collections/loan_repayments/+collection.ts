import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

/**
 * A repayment is written through its agreement: `loans` accepts the schedule as nested `create`,
 * `update` and `delete` actions and judges the schedule whole. Only the direct delete is exposed,
 * and its grant (`peopleGrants` in `lib/policy_grants.ts`) refuses a repayment a payslip settled.
 */
export default defineCollection({ model, delete: {} });
