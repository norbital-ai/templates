import { bolt } from '$bolt';
import type messages from '../../i18n/+messages.ts';

export type MessageKey = keyof typeof messages;

/** A message of the workspace's base locale by key, with its variables. */
export const t = (key: MessageKey, vars?: { readonly [name: string]: string | number }): string =>
	bolt.t(key, vars);
