import { Effect } from 'effect';
import type { Api } from '../../functions/$types.js';
import { calendarDateInTimeZone, PAYROLL_TIME_ZONE } from '../iso-day.js';
import { settingsInForce } from '../jurisdiction_settings.js';

/**
 * Today on the employing entity's own wall clock: its settings version in force's
 * `payroll.timezone`. A 23:30 punch in a UTC+7 entity is that evening, not the next day as the
 * Kuala Lumpur default would read it. An entity with no version in force keeps the default.
 */
export const entityDay = (api: Api, companyId: string, now: Date) =>
	Effect.gen(function* () {
		const company = yield* api.db.companies.findFirst({
			where: { id: { eq: companyId } },
			columns: { id: true, settings_code: true }
		});
		const code = company?.settings_code;
		const versions =
			code == null
				? []
				: yield* api.db.jurisdiction_settings.findMany({
						where: { code: { eq: code } },
						columns: {
							id: true,
							code: true,
							name: true,
							sealed_at: true,
							voided_at: true,
							approval_id: true,
							effective_range: true,
							payroll: true
						},
						limit: 200
					});
		const version =
			code == null ? null : settingsInForce(versions, code, calendarDateInTimeZone(now, 'UTC'));
		return calendarDateInTimeZone(now, version?.payroll?.timezone ?? PAYROLL_TIME_ZONE);
	});
