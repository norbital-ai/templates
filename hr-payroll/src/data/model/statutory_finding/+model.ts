import { model } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { hostOf, officialSource } from '../../../lib/payroll_engine/statutory_change.js';

export default model('statutory_finding', {
	description:
		'One legal instrument research found for a jurisdiction: how it fits the configuration, its sources and its review. Its statutory changes are the dated deltas; confirming or rejecting the finding decides them together.',
	label: 'title',
	fields: {
		jurisdiction_code: { kind: 'text' },
		instrument_key: { kind: 'text' },
		title: { kind: 'text' },
		fit: { kind: 'enum', values: ['VALUE', 'ROW', 'STRUCTURAL'] },
		families: { kind: 'list', of: { kind: 'text' } },
		summary: { kind: 'text', optional: true },
		announced_on: { kind: 'date', optional: true },
		status: {
			kind: 'state',
			initial: 'PROPOSED',
			states: {
				PROPOSED: {
					to: ['CONFIRMED', 'REJECTED'],
					edit: [
						'title',
						'fit',
						'families',
						'summary',
						'announced_on',
						'source_urls',
						'source_quote',
						'notes',
						'verified_on',
						'verified_by',
						'status'
					]
				},
				CONFIRMED: { to: ['APPLIED', 'REJECTED'], edit: ['status', 'notes'] },
				APPLIED: { to: [], edit: 'none' },
				REJECTED: { to: [], edit: 'none' }
			}
		},
		source_urls: { kind: 'list', of: { kind: 'text' } },
		source_quote: { kind: 'text', optional: true },
		verified_on: { kind: 'date', optional: true },
		verified_by: { kind: 'ref', to: 'sys_user', optional: true, onDelete: 'restrict' },
		research_run_id: { kind: 'text', optional: true },
		notes: { kind: 'text', optional: true }
	},
	// one row per instrument, whichever isolated run found it first
	unique: [{ fields: ['jurisdiction_code', 'instrument_key'] }],
	read: {
		statutory_finding: { fields: 'all' },
		'statutory_finding.changes': { fields: 'all' },
		'statutory_finding.verified_by': { fields: ['name'] }
	},
	create: {
		columns: {
			statutory_finding: [
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
		transform: function* (rows, ctx) {
			if (rows.some((row) => row.status !== undefined && row.status !== 'PROPOSED'))
				return yield* ctx.refuse('A statutory finding starts as proposed.');
			return rows;
		}
	},
	update: {
		columns: {
			statutory_finding: [
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
				return yield* ctx.refuse('A person verifies a statutory finding.');
			const { id: verifier } = ctx.actor;
			const got = yield* ctx.db.query({
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
			return yield* Effect.forEach(changes, ({ before, set }) =>
				Effect.gen(function* () {
					if (set.status !== 'CONFIRMED') return set;
					const row = { ...before, ...set };
					if (row.fit === 'STRUCTURAL')
						return yield* ctx.refuse(
							'A structural finding needs the template extended; data cannot carry it.'
						);
					const hosts = new Set(
						got.statutory_source.rows
							.filter((source) => source.jurisdiction_code === row.jurisdiction_code)
							.map((source) => hostOf(source.url))
					);
					if (!row.source_urls.some((url) => officialSource(url) || hosts.has(hostOf(url))))
						return yield* ctx.refuse('Confirming a finding needs an official https source.');
					if (!row.source_quote?.trim())
						return yield* ctx.refuse('Confirming a finding needs its quoted source.');
					const owned = got.statutory_change.rows.filter(
						(change) => change.finding_id === before.id
					);
					if (owned.length === 0)
						return yield* ctx.refuse('Confirming a finding needs its changes drafted.');
					if (owned.some((change) => change.effective_from == null))
						return yield* ctx.refuse('Confirming a finding needs every change dated.');
					return { ...set, verified_on: ctx.today, verified_by: verifier };
				})
			);
		}
	}
});
