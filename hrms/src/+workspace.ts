import { workspace } from '@norbital-ai/bolt';
import { AUTOMATION_LIMITS, MEMBER_LIMITS } from './access_control/policy/grants.js';

/**
 * Multi-country HR and payroll. Money is stated in each row's own currency (a jurisdiction settings version names
 * it), so the workspace sets no default currency. Timezone and locale belong to the client; the server stores UTC.
 */
export default workspace({
	tz: 'UTC',
	locale: 'en',
	// statutory drift researches on the strong class; the host maps each class to a model
	ai: { embeddings: ['default'] },
	limits: {
		configuration_execution: AUTOMATION_LIMITS,
		employee: MEMBER_LIMITS,
		hr_controller: MEMBER_LIMITS,
		hr_manager: MEMBER_LIMITS,
		invitation_profile_automation: AUTOMATION_LIMITS,
		kiosk: MEMBER_LIMITS,
		manager: MEMBER_LIMITS,
		payroll_execution: AUTOMATION_LIMITS,
		senior_management: MEMBER_LIMITS,
		supervisor: MEMBER_LIMITS
	}
});
