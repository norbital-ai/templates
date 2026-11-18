import type { Id } from '@norbital-ai/bolt';

/** Discriminated union of the three user-authored activity creation flows. */
export type ActivityKindChoice = 'recording' | 'note' | 'meeting';

export type ActivityDraft =
	| {
			readonly type: 'recording';
			readonly subject: string;
			readonly occurred_at: string;
			readonly contact_id: Id<'contacts'> | null;
			readonly detail: string;
	  }
	| {
			readonly type: 'note';
			readonly subject: string;
			readonly occurred_at: string;
			readonly contact_id: Id<'contacts'> | null;
			readonly detail: string;
	  }
	| {
			readonly type: 'meeting';
			readonly subject: string;
			readonly scheduled_start_at: string;
			readonly scheduled_end_at: string;
			readonly location: string;
			readonly attendees: readonly string[];
			readonly calendar_notify: boolean;
			readonly contact_id: Id<'contacts'> | null;
			readonly detail: string;
	  };

export function createActivityDraft(
	type: ActivityKindChoice,
	nowIso: string,
	initialContact: Id<'contacts'> | null = null
): ActivityDraft {
	switch (type) {
		case 'recording':
			return {
				type: 'recording',
				subject: '',
				occurred_at: nowIso,
				contact_id: initialContact,
				detail: ''
			};
		case 'note':
			return {
				type: 'note',
				subject: '',
				occurred_at: nowIso,
				contact_id: initialContact,
				detail: ''
			};
		case 'meeting': {
			const start = new Date(nowIso);
			const end = new Date(start.getTime() + 60 * 60 * 1000);
			return {
				type: 'meeting',
				subject: '',
				scheduled_start_at: start.toISOString(),
				scheduled_end_at: end.toISOString(),
				location: '',
				attendees: [],
				calendar_notify: false,
				contact_id: initialContact,
				detail: ''
			};
		}
	}
}
