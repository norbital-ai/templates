// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The write path every hosted test takes: one `collections.write` push per collection and
 * action, exactly as the browser client sends it. A create carries no id — the runtime allocates
 * one and the settlement's `records` carry it back — and an update or delete names its row.
 */
import {
	asRecord,
	bearerHeaders,
	mutationPush,
	postGuestCommand
} from '@norbital-ai/test-utilities';

export const WRITE_COMMAND = 'collections.write';

export const writeRows = (session, collection, action, inputs, headers, baseVersions = []) =>
	postGuestCommand(
		session.host.baseUrl,
		WRITE_COMMAND,
		mutationPush(session.schemaFingerprint, { collection, action, inputs }, baseVersions),
		headers ?? bearerHeaders(session.credential)
	);

/** The committed rows of an accepted write. */
export const recordsOf = (value) => {
	const body = asRecord(value, WRITE_COMMAND);
	return Array.isArray(body.records) ? body.records : [];
};

/** The ids the runtime allocated, in input order. */
export const createdIds = (value) => recordsOf(value).map((row) => String(row.id));

/** An accepted create of one collection, its rows back. */
export async function createRows(session, collection, inputs, headers) {
	const result = await writeRows(session, collection, 'create', inputs, headers);
	const body = asRecord(result.value, `${WRITE_COMMAND} ${collection}`);
	if (body.resolution !== 'accepted')
		throw new Error(`${WRITE_COMMAND} ${collection} create: ${JSON.stringify(result.value)}`);
	return recordsOf(result.value);
}

/** The stored row version, for a write that asserts what it read. */
export const observedVersion = (collection, id, rowVersion) => ({
	row: { collection, recordId: id },
	rowVersion
});

/**
 * A push written as one collection's rows — `{ collection, rows: [{ action, values }] }` or
 * `{ action: 'delete', collection, ids }` — as the one-action graph the wire carries. A create's
 * client id is dropped: the runtime allocates it. Rows of two actions are two pushes and are
 * refused here rather than silently split.
 */
export const graphOf = (body) => {
	if (body.action === 'delete')
		return {
			collection: body.collection,
			action: 'delete',
			inputs: body.ids.map((id) => ({ id }))
		};
	const actions = new Set(body.rows.map((row) => row.action));
	if (actions.size !== 1)
		throw new Error(`one push carries one action; this one carries ${[...actions].join(', ')}`);
	const [action] = actions;
	return {
		collection: body.collection,
		action,
		inputs: body.rows.map((row) => {
			if (action !== 'create') return row.values;
			const { id: _id, ...values } = row.values;
			return values;
		})
	};
};

export const writeGraph = (session, body, bases = [], headers) =>
	postGuestCommand(
		session.host.baseUrl,
		WRITE_COMMAND,
		mutationPush(session.schemaFingerprint, graphOf(body), bases),
		headers ?? bearerHeaders(session.credential)
	);
