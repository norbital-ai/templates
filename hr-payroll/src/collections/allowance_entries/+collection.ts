import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

/**
 * Engine output. An entry is born under the payslip that priced it, in the run's own payload, and
 * dies with a draft slip through the payslip's cascade; nobody keys one, edits one or deletes one
 * by hand, which the policies hold (`payrollRunCascadeGrants`). The declaration exists so the
 * run's nested `create` can reach the table.
 */
export default defineCollection({
	model,
	create: {
		input: {
			columns: {
				derived_from_id: true,
				employment_id: true,
				catalogue_id: true,
				from: true,
				to: true,
				basis: true,
				days: true,
				denominator: true,
				unpaid_days: true,
				contract_amount: true,
				amount: true
			}
		}
	},
	delete: {}
});
