import { model } from '../../../../.norbital/models/statutory_finding.ts';
import type { CarriedWrites } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { lawWrite, syncLedgerOn } from '../../../lib/payroll_engine/configuration.js';
import { isJsonObject } from '../../../lib/payroll_engine/foundation.js';
import { queryRows } from '../../../lib/payroll_engine/reads.js';
import { hostOf, officialSource } from '../../../lib/payroll_engine/statutory_research.js';

/** Whether a write moves a finding into or out of force: its changes of law move with it. */
const decided = (change: {
	readonly before: { readonly status: string };
	readonly after: { readonly status: string };
}) => (change.before.status === 'CONFIRMED') !== (change.after.status === 'CONFIRMED');

export default model({
	description:
		'One legal instrument research found for a jurisdiction: how it fits the configuration, its sources and its review. Its changes of law are dated patches, in force only while the finding is confirmed: confirming or rejecting it decides them together.',
	record_label: 'record.title',
	fields: {
		jurisdiction_code: { kind: 'text' },
		instrument_key: { kind: 'text' },
		title: { kind: 'text' },
		fit: { kind: 'enum', values: ['VALUE', 'ROW', 'STRUCTURAL'] },
		families: { kind: 'text', many: true },
		summary: { kind: 'text', optional: true },
		announced_on: { kind: 'date', optional: true },
		status: {
			kind: 'state',
			initial: 'PROPOSED',
			states: {
				PROPOSED: { to: ['CONFIRMED', 'REJECTED'] },
				CONFIRMED: { to: ['REJECTED'] },
				REJECTED: { to: [] }
			}
		},
		source_urls: { kind: 'text', many: true },
		source_quote: { kind: 'text', optional: true },
		verified_on: { kind: 'date', optional: true },
		verified_by: { kind: 'ref', to: 'sys_user', optional: true, on_delete: 'restrict' },
		research_run_id: { kind: 'text', optional: true },
		notes: { kind: 'text', optional: true }
	},
	constraints: {
		// one row per instrument, whichever isolated run found it first
		one_instrument: { unique: ['jurisdiction_code', 'instrument_key'] },
		// a confirmed finding keeps its content: only its notes and its move on stay editable
		confirmed_finding: { locked: { status: { eq: 'CONFIRMED' } }, except: ['status', 'notes'] },
		decided_finding: { locked: { status: { eq: 'REJECTED' } } }
	},
	outputs: {
		default: {
			fields: 'all',
			law_changes: { fields: 'all' },
			verified_by: { fields: ['name'] }
		}
	},
	create: {
		columns: {
			fields: [
				'jurisdiction_code',
				'instrument_key',
				'title',
				'fit',
				'families',
				'summary',
				'announced_on',
				'status',
				'source_urls',
				'source_quote',
				'research_run_id',
				'notes'
			]
		},
		transform: function* (changes, ctx) {
			const row = changes.findIndex(({ set }) => set.status != null && set.status !== 'PROPOSED');
			if (row >= 0) return yield* ctx.refuse('errors.statutory_finding_starts_proposed', { row });
			return changes.map(({ set }) => set);
		}
	},
	update: {
		columns: {
			fields: [
				'title',
				'fit',
				'families',
				'summary',
				'announced_on',
				'status',
				'source_urls',
				'source_quote',
				'notes'
			]
		},
		transform: function* (changes, ctx) {
			// a finding moved into or out of force moves its changes of law: each is checked and amends as if written
			const moved = changes.filter(decided);
			const status = new Map(moved.map(({ before, after }) => [String(before.id), after.status]));
			const carried =
				moved.length === 0
					? Effect.succeed<CarriedWrites>({})
					: lawWrite(
							ctx.query,
							moved.map(({ before }) => before.jurisdiction_code),
							(stored) =>
								stored.map((row) => {
									const next = isJsonObject(row.finding_id)
										? status.get(String(row.finding_id.id))
										: undefined;
									return next === undefined || !isJsonObject(row.finding_id)
										? row
										: { ...row, finding_id: { ...row.finding_id, status: next } };
								})
						).pipe(
							Effect.catchTag('Refusal', (error) =>
								ctx.refuse('errors.payroll_refused', { values: { message: error.message } })
							)
						);
			const confirming = changes.filter(({ set }) => set.status === 'CONFIRMED');
			if (confirming.length === 0)
				return { sets: changes.map(({ set }) => set), on_approved: yield* carried };
			if (ctx.actor.kind !== 'member')
				return yield* ctx.refuse('errors.statutory_finding_person_verifies');
			const { id: verifier } = ctx.actor;
			const got = yield* ctx.query({
				jurisdiction_change: {
					where: { finding_id: { in: confirming.map(({ before }) => before.id) } },
					fields: ['finding_id'],
					limit: 10000
				},
				statutory_source: {
					where: { status: { eq: 'ACTIVE' } },
					fields: ['jurisdiction_code', 'url'],
					limit: 10000
				}
			});
			const sets = yield* Effect.forEach(changes, ({ before, set, after: row }, index) =>
				Effect.gen(function* () {
					if (set.status !== 'CONFIRMED') return set;
					if (row.fit === 'STRUCTURAL')
						return yield* ctx.refuse('errors.statutory_finding_structural', { row: index });
					const hosts = new Set(
						got.statutory_source.rows
							.filter((source) => source.jurisdiction_code === row.jurisdiction_code)
							.map((source) => hostOf(source.url))
					);
					if (!row.source_urls.some((url) => officialSource(url) || hosts.has(hostOf(url))))
						return yield* ctx.refuse('errors.statutory_finding_official_source', { row: index });
					if (!row.source_quote?.trim())
						return yield* ctx.refuse('errors.statutory_finding_quote', { row: index });
					if (!got.jurisdiction_change.rows.some((change) => change.finding_id === before.id))
						return yield* ctx.refuse('errors.statutory_finding_changes_drafted', { row: index });
					return { ...set, verified_on: ctx.today, verified_by: verifier };
				})
			);
			return { sets, on_approved: yield* carried };
		},
		effect: function* (changes, ctx) {
			const moved = changes.filter(decided);
			if (moved.length === 0) return;
			const { jurisdiction_change: rows = [] } = yield* queryRows(ctx.query, {
				jurisdiction_change: {
					where: { finding_id: { in: moved.map(({ before }) => String(before.id)) } },
					fields: ['effective_from'],
					limit: 10000
				}
			});
			yield* syncLedgerOn(
				ctx,
				rows.map((row) => String(row.effective_from))
			);
		}
	}
});
