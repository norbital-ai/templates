import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { refuseUnlessDraftOnBoth } from '../../lib/settings_seal.js';
import { refuseUnknownBaseEntries } from '../../lib/catalogue_rules.js';
import { compileExpression } from '../../lib/expressions/compile.js';
import { orderSchemes, producedMentions } from '../payroll_runs/lib/mentions.js';
import type { Hooks } from './$types.js';

/**
 * Every rule of a stored scheme, checked one by one: the expression compiles against the scheme
 * context, a `produced.<code>` mention names a scheme of the same version, and the mentions do not
 * close a loop. The whole dependency graph is rebuilt with the incoming row in place (RFC 0002
 * §0.4/§6), so the refusal happens where the rule is written, not where the payroll is built.
 */
function rulesFault(
	rules: readonly { readonly when: string; readonly employee: string; readonly employer: string }[]
): string | null {
	for (const [index, rule] of rules.entries()) {
		const when = compileExpression({ expression: rule.when, site: 'scheme', type: 'boolean' });
		if (when != null) return `Rule ${index + 1}: ${when}`;
		const employee = compileExpression({
			expression: rule.employee,
			site: 'scheme',
			type: 'money'
		});
		if (employee != null) return `Rule ${index + 1} employee: ${employee}`;
		const employer = compileExpression({
			expression: rule.employer,
			site: 'scheme',
			type: 'money'
		});
		if (employer != null) return `Rule ${index + 1} employer: ${employer}`;
	}
	return null;
}

/**
 * Statutory schemes are rows of one jurisdiction settings version and are sealed with it.
 *
 * The version's period is when the scheme governs; per-scheme effective dating is gone. What the
 * hook holds is the **seal**: a scheme of a sealed version refuses create, update and delete,
 * because a contribution rule a paid run was charged under cannot be rewritten. A change of law
 * is a new version of the settings.
 *
 * While the version is a draft the hook also holds the dependency contract: every expression
 * compiles, every `produced.<code>` mention names a scheme of this version, and the mentions do
 * not close a loop. A producer with a living consumer refuses deletion.
 */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses any write on a scheme whose jurisdiction settings version is sealed; schemes of a draft may be prepared and edited until the seal. Compiles every rule expression; refuses a base entry naming a catalogue row the version does not carry; refuses a `produced.<code>` mention the version does not carry and a mention that closes a dependency loop.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						const row = { ...existing, ...input };
						yield* refuseUnlessDraftOnBoth(
							api,
							existing?.settings_id,
							input.settings_id,
							`Scheme ${String(row.code ?? '')}`
						);
						const rules = row.rules ?? [];
						const fault = rulesFault(rules);
						if (fault != null) refuse(fault);
						const settingsId = row.settings_id;
						if (settingsId == null || settingsId === '') return input;
						if (row.base != null)
							yield* refuseUnknownBaseEntries(
								api,
								settingsId,
								row.base,
								`Scheme ${String(row.code ?? '')}`
							);
						const stored = yield* api.db.statutory_contributions.findMany({
							where: {
								settings_id: { eq: String(settingsId) },
								approval_id: { isNull: true }
							},
							columns: { id: true, code: true, rules: true },
							limit: 500
						});
						const entries = [
							...stored
								.filter((other) => other.id !== row.id && other.code !== row.code)
								.map((other) => ({ row: { code: other.code, rules: other.rules } })),
							{ row: { code: String(row.code ?? ''), rules } }
						];
						try {
							orderSchemes(entries);
						} catch (error) {
							refuse(error instanceof Error ? error.message : String(error));
						}
						return input;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses deleting a scheme whose jurisdiction settings version is sealed, or one that another scheme still names as a dependency.',
				handler: ({ existing, api }) =>
					Effect.gen(function* () {
						yield* refuseUnlessDraftOnBoth(
							api,
							existing.settings_id,
							undefined,
							`Scheme ${existing.code}`
						);
						const stored = yield* api.db.statutory_contributions.findMany({
							where: {
								settings_id: { eq: String(existing.settings_id) },
								approval_id: { isNull: true }
							},
							columns: { id: true, code: true, rules: true },
							limit: 500
						});
						for (const other of stored)
							if (other.id !== existing.id && producedMentions(other.rules).includes(existing.code))
								refuse(
									`${other.code} reads produced.${existing.code}, so ${existing.code} cannot be ` +
										'deleted while that rule stands.'
								);
					})
			}
		}
	}
} satisfies Hooks;
