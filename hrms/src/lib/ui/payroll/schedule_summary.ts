import type { PageContext } from '@norbital-ai/bolt/page';
import { enum_text, label } from '@norbital-ai/ui';
import { jsonObject } from '../../foundation.js';

/** A pay group's schedule in one line: how often, the days it pays, its cut-off and what a non-business pay day does. */
export const scheduleSummary = (ctx: PageContext, value: unknown): string => {
	const schedule = jsonObject(value ?? {});
	const choice = (name: 'frequency' | 'business_day') => {
		const chosen = schedule[name];
		return typeof chosen === 'string'
			? [label(ctx, 'pay_group', `payment_schedule.${name}.${chosen}`, enum_text(chosen))]
			: [];
	};
	return [
		...choice('frequency'),
		...(Array.isArray(schedule.pay_days)
			? [ctx.t('pay_group.pays_on', { days: schedule.pay_days.join(', ') })]
			: []),
		...(typeof schedule.pay_cutoff_day === 'number'
			? [ctx.t('pay_group.cutoff', { day: schedule.pay_cutoff_day })]
			: []),
		...choice('business_day')
	].join(' · ');
};
