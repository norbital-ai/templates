import { refuse } from '@norbital-ai/bolt/authoring';
import { isCalendarDate } from '@norbital-ai/std/date';
import { dateKey } from '../../lib/iso-day.js';
import type { Hooks } from './$types.js';

/** The columns a consumed holiday keeps: what a work day or payroll run already read. */
const FROZEN = ['jurisdiction_code', 'date', 'name', 'kind', 'original_date'] as const;

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'A holiday needs a jurisdiction, a valid day and a name; a consumed holiday keeps its day, name and publication.',
				handler: ({ input, existing }) => {
					const row = { ...existing, ...input };
					if (!String(row.jurisdiction_code ?? '').trim())
						refuse('A holiday needs a jurisdiction.');
					if (row.date == null || !isCalendarDate(dateKey(row.date)))
						refuse('A holiday needs a valid calendar day.');
					if (!String(row.name ?? '').trim()) refuse('A holiday needs a name.');
					if (row.original_date != null && !isCalendarDate(dateKey(row.original_date)))
						refuse('The original date must be a valid calendar day.');
					if (existing?.consumed_at != null) {
						for (const column of FROZEN)
							if (
								input[column] !== undefined &&
								String(input[column] ?? '') !== String(existing[column] ?? '')
							)
								refuse(
									`Holiday ${dateKey(existing.date)} has been read by a work day or payroll run and cannot change. Add a new holiday instead.`
								);
						if (input.published_at === null)
							refuse(
								`Holiday ${dateKey(existing.date)} has been read by a work day or payroll run and cannot be unpublished.`
							);
						if (input.consumed_at === null) refuse('A consumed holiday stays consumed.');
					}
					return input;
				}
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'A holiday a work day or payroll run has read cannot be deleted.',
				handler: ({ existing }) => {
					if (existing.consumed_at != null)
						refuse(
							`Holiday ${dateKey(existing.date)} has been read by a work day or payroll run and cannot be deleted.`
						);
				}
			}
		}
	}
} satisfies Hooks;
