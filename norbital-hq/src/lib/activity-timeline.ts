import type { Row } from '@norbital-ai/bolt';
import { DateTime, Duration } from 'effect';

/** Conversation slices retain source records, account ownership and project boundaries. */
export type TimelineItem = Pick<Row<'activities'>, 'id' | 'kind' | 'subject' | 'occurred_at'> & {
	source_key?: string | null;
	source_user?: string | null;
	thread_key?: string | null;
	project_id?: string | null;
	project_name?: string | null;
	handle?: string | null;
	direction?: string | null;
};

export function activitySlices<T extends TimelineItem>(rows: readonly T[]) {
	const ordered = [...new Map(rows.map((row) => [row.id, row])).values()].sort(
		(a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id)
	);
	const slices: (Pick<T, 'id' | 'occurred_at' | 'kind'> & { messages: T[] })[] = [];
	const conversations = new Map<string, (typeof slices)[number]>();
	for (const row of ordered) {
		const key =
			row.kind === 'message' && row.thread_key != null
				? JSON.stringify([row.source_user, row.source_key, row.thread_key])
				: null;
		const previous = key === null ? undefined : conversations.get(key);
		if (
			previous !== undefined &&
			previous.messages.at(-1)?.project_id === row.project_id &&
			Duration.isLessThanOrEqualTo(
				DateTime.distance(
					DateTime.makeUnsafe(previous.occurred_at),
					DateTime.makeUnsafe(row.occurred_at)
				),
				Duration.minutes(30)
			)
		) {
			const slice = {
				...previous,
				messages: [...previous.messages, row],
				occurred_at: row.occurred_at
			};
			slices[slices.indexOf(previous)] = slice;
			if (key !== null) conversations.set(key, slice);
		} else {
			const slice = { id: row.id, messages: [row], occurred_at: row.occurred_at, kind: row.kind };
			slices.push(slice);
			if (key !== null) conversations.set(key, slice);
		}
	}
	return slices.sort(
		(a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id.localeCompare(a.id)
	);
}
