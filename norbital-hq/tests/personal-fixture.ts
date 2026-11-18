import type { Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { required, recordOf, pageOf, nativeId } from './workspace.js';

/** A sales member's own email or WhatsApp account (owner = self), created under their own grants. */
export const personalAccount = Effect.fnUntraced(function* (
	t: Kit,
	member: ReturnType<Kit['member']>,
	integration: 'email' | 'whatsapp',
	name: string = `My ${integration}`
) {
	const owner = required(
		pageOf(yield* (yield* t.as(t.admin)).query({ sys_user: {} }), 'sys_user').rows.find(
			(row) => row.id === member.id
		)
	);
	const created = yield* (yield* t.as(member)).act({
		'sys_integration.create': [{ integration, name, owner: nativeId('sys_user', owner.id) }]
	});
	if (created.kind !== 'committed') throw new Error(JSON.stringify(created));
	return recordOf(created.records, 'sys_integration').id;
});
