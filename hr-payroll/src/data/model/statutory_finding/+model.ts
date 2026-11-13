import { model } from '../../../../.norbital/models/statutory_finding.ts';
import { Effect } from 'effect';
import { hostOf, officialSource } from '../../../lib/payroll_engine/statutory_change.js';

export default model({
	description:
		'One legal instrument research found for a jurisdiction: how it fits the configuration, its sources and its review. Its statutory changes are the dated deltas; confirming or rejecting the finding decides them together.',
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
				CONFIRMED: { to: ['APPLIED', 'REJECTED'] },
				APPLIED: { to: [] },
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
		decided_finding: { locked: { status: { in: ['APPLIED', 'REJECTED'] } } }
	},
	outputs: {
		default: {
			fields: 'all',
			changes: { fields: 'all' },
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
			const confirming = changes.filter(({ set }) => set.status === 'CONFIRMED');
			if (confirming.length === 0) return changes.map(({ set }) => set);
			if (ctx.actor.kind !== 'member')
				return yield* ctx.refuse('errors.statutory_finding_person_verifies');
			const { id: verifier } = ctx.actor;
			const got = yield* ctx.query({
				statutory_change: {
					where: { finding_id: { in: confirming.map(({ before }) => before.id) } },
					fields: ['finding_id', 'effective_from'],
					limit: 10000
				},
				statutory_source: {
					where: { status: { eq: 'ACTIVE' } },
					fields: ['jurisdiction_code', 'url'],
					limit: 10000
				}
			});
			return yield* Effect.forEach(changes, ({ before, set, after: row }, index) =>
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
					const owned = got.statutory_change.rows.filter(
						(change) => change.finding_id === before.id
					);
					if (owned.length === 0)
						return yield* ctx.refuse('errors.statutory_finding_changes_drafted', { row: index });
					if (owned.some((change) => change.effective_from == null))
						return yield* ctx.refuse('errors.statutory_finding_changes_dated', { row: index });
					return { ...set, verified_on: ctx.today, verified_by: verifier };
				})
			);
		}
	}
});
