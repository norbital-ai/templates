import { policy } from '@norbital-ai/bolt';

/**
 * Shift-check automations (`appointments_confirm_shift`, `appointments_decline_shift`): read and
 * update a provider's day after the automation checks starter ownership via `ctx.trigger`.
 */
export default policy({
	description: 'Shift-check automations: record a provider’s confirmation or unavailability.',
	grants: {
		providers: { outputs: { default: {} } },
		appointments: {
			outputs: { provider: {} },
			update: { fields: ['shift_check'] }
		}
	}
});
