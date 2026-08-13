import type { Hooks } from './$types.js';

const DESK_TIME_ZONE = 'Asia/Singapore';

function deskToday(): string {
	const parts = new Intl.DateTimeFormat('en', {
		timeZone: DESK_TIME_ZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(new Date());
	const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value ?? '';
	return `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`;
}

export default {
	create: {
		before: {
			description:
				'Stamps a task activity with the current desk date as its due date when none was entered.',
			handler: async ({ input }) => {
				if (input.type === 'task' && input.due_date == null) {
					return { ...input, due_date: deskToday() };
				}
				return input;
			}
		}
	}
} satisfies Hooks;
