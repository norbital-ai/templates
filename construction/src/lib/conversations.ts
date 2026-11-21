import * as Predicate from 'effect/Predicate';
import { isArray } from 'effect/Array';
import { Schema } from 'effect';
import { id_of } from '@norbital-ai/bolt';

/** A message's `conversation` is its conversation's key held as text (no ref): the id a `sys_conversation` read filters by. */
export const conversationId = Schema.decodeUnknownSync(id_of('sys_conversation'));

/**
 * The comparable key of a handle: `Avery <AVERY@Example.test>` -> `avery@example.test`; `whatsapp:+65 8123 4501`,
 * `6581234501@s.whatsapp.net` and `6581234501:14@s.whatsapp.net` -> `6581234501`;
 * `telegram:@Avery`, `telegram:avery` and `@Avery` -> `@avery`; `slack:U012AB` -> `slack:u012ab`;
 * `discord:@1234` -> `discord:1234`. `null` when it is none.
 */
export function handleKey(handle: string): string | null {
	const platform = handle.match(/^(slack|discord):\s*@?(\S+)$/);
	if (platform !== null) return `${platform[1]}:${platform[2]?.toLowerCase()}`;
	const telegram = handle.match(/^(?:telegram:\s*@?|@)([^\s@]+)$/)?.[1];
	if (telegram !== undefined) return `@${telegram.toLowerCase()}`;
	if (handle.endsWith('@lid') || handle.endsWith('@g.us')) return null;
	const mail = handle.match(/[^\s<>"]+@[^\s<>"]+\.[^\s<>"]+/)?.[0];
	if (mail !== undefined && !mail.endsWith('.whatsapp.net')) return mail.toLowerCase();
	const digits = handle
		.replace(/^whatsapp:/, '')
		.replace(/[:@].*$/, '')
		.replace(/\D/g, '');
	return digits.length >= 6 ? digits : null;
}

type Keyed = {
	email_key: string | null;
	phone_key: string | null;
	telegram_key: string | null;
	slack_key: string | null;
	discord_key: string | null;
};

export const holdsKey = (contact: Keyed, key: string) =>
	key.startsWith('slack:')
		? contact.slack_key === key
		: key.startsWith('discord:')
			? contact.discord_key === key
			: key.startsWith('@')
				? contact.telegram_key === key
				: key.includes('@')
					? contact.email_key === key
					: contact.phone_key === key;

/** The contact a handle belongs to: exactly one match, else `null`. */
export function matchContact<C extends Keyed>(handle: string, contacts: readonly C[]): C | null {
	const key = handleKey(handle);
	if (key === null) return null;
	const found = contacts.filter((c) => holdsKey(c, key));
	return found.length === 1 ? (found[0] ?? null) : null;
}

/** A stored JSON object's `key`, `undefined` when the value is not an object. */
export const jsonField = (value: unknown, key: string): unknown =>
	Predicate.isObject(value) ? value[key] : undefined;

/** A message's stored attachments within the 20 MiB bound. */
export function filesOf(files: unknown): { id: string; name: string; mime: string }[] {
	if (!isArray(files)) return [];
	return files.flatMap((file) => {
		const [id, name, mime, bytes] = ['id', 'name', 'mime', 'bytes'].map((k) => jsonField(file, k));
		return Predicate.isString(id) &&
			Predicate.isString(name) &&
			Predicate.isString(mime) &&
			Predicate.isNumber(bytes) &&
			bytes <= 20 * 1024 * 1024
			? [{ id, name, mime }]
			: [];
	});
}

/** A message's first stored audio attachment (a voice note), else `null`. */
export const voiceNote = (files: unknown) =>
	filesOf(files).find((file) => file.mime.startsWith('audio/')) ?? null;

/** The first recipient of a stored sent mailbox item. */
export function sentMailHandle(mail: unknown): string {
	const recipients = jsonField(mail, 'to');
	return isArray(recipients) ? String(jsonField(recipients[0], 'address') ?? '') : '';
}

/** A group conversation's member handles (`sys_conversation.kind`/`participants`). */
export function groupParticipantHandles(kind: string | null, participants: unknown): string[] {
	if (kind !== 'group' || !isArray(participants)) return [];
	return participants.flatMap((participant) => {
		const handle = jsonField(participant, 'handle');
		return Predicate.isString(handle) ? [handle] : [];
	});
}
