import { Effect } from 'effect';
import { validateHolidaySource } from '../../lib/holiday-import.js';
import type { Hooks } from './$types.js';

export default {
	mutate: {
		perRecord: {
			before: {
				description: 'Require an explicit jurisdiction, Google calendar and valid IANA time zone.',
				handler: ({ input, existing }) =>
					Effect.sync(() => {
						validateHolidaySource({
							jurisdiction_code: input.jurisdiction_code ?? existing?.jurisdiction_code ?? '',
							calendar_id: input.calendar_id ?? existing?.calendar_id ?? '',
							time_zone: input.time_zone ?? existing?.time_zone ?? ''
						});
						return input;
					})
			}
		}
	}
} satisfies Hooks;
