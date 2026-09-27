import { everyField } from '../every-field.js';
import type { Id, QueryCtx } from '@norbital-ai/bolt';
import { PAYROLL_TIME_ZONE } from '../iso-day.js';
import { settingsInForce } from '../jurisdiction_settings.js';

type Reads = Pick<QueryCtx, 'read' | 'get' | 'now' | 'todayIn'>;

/**
 * Today on the employing entity's own wall clock: its settings version in force's `payroll.timezone`. A 23:30 punch in
 * a UTC+7 entity is that evening, not the next day as the Kuala Lumpur default would read it. An entity with no
 * version in force keeps the default.
 */
export async function entityDay(ctx: Reads, companyId: Id<'companies'>): Promise<string> {
	const company = await ctx.get('companies', companyId, {
		select: everyField('companies')
	});
	const code = company?.settings_code;
	if (code == null) return String(ctx.todayIn(PAYROLL_TIME_ZONE));
	const versions = await ctx.read('jurisdiction_settings', {
		select: everyField('jurisdiction_settings'),
		where: { code: { eq: code } },
		all: true
	});
	const version = settingsInForce(
		versions.rows.map((row) => ({
			...row,
			sealed_at: row.sealed_at == null ? null : String(row.sealed_at),
			voided_at: row.voided_at == null ? null : String(row.voided_at),
			approval_id: row.approval_id == null ? null : row.approval_id
		})),
		code,
		String(ctx.todayIn('UTC'))
	);
	const zone = (version?.payroll as { timezone?: string } | undefined)?.timezone;
	return String(ctx.todayIn(zone ?? PAYROLL_TIME_ZONE));
}
