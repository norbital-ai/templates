import { model, type Id, type WriteCtx } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { beforeOf, runEngine } from '../../../lib/payroll_engine/foundation.js';
import { admitCase, loadWorkplaceAdmission } from '../../../lib/payroll_engine/admit.js';
import { moved, tap } from '../../../lib/payroll_engine/taps.js';

/** A case names a kind its governing version lists; an employment's case takes the employment's company. */
const admitted = (
	ctx: WriteCtx<'workplace_case'>,
	read: Parameters<typeof runEngine>[1],
	at: number,
	row: {
		readonly company_id: Id<'entity'>;
		readonly employment_id?: Id<'employment_contract'> | null;
		readonly kind: string;
		readonly opened_on: string;
		readonly closed_on?: string | null;
	},
	prefetched: Effect.Success<ReturnType<typeof loadWorkplaceAdmission>>
) =>
	runEngine(
		admitCase(
			{
				company_id: row.company_id,
				employment_id: row.employment_id ?? null,
				kind: row.kind,
				opened_on: row.opened_on,
				closed_on: row.closed_on ?? null
			},
			prefetched
		),
		read,
		(message) => ctx.refuse(message, { row: at })
	);

export default model('workplace_case', {
	description:
		'One workplace case of an entity that a jurisdiction duty answers: a request (flexible work, access to or correction of personal data), an incident (a data breach, a work accident) or a change (a dependant). Its kind is a code the governing version lists; its subject employment is optional. Regulatory tasks rise on it being opened, changed or still open.',
	icon: 'lucide:folder-open',
	label: 'kind',
	fields: {
		kind: {
			kind: 'text',
			help: 'A code of the governing version’s case_kinds rule.'
		},
		opened_on: {
			kind: 'date'
		},
		closed_on: {
			kind: 'date',
			optional: true
		},
		before: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			optional: true,
			help: 'The prior values of the fields the last update changed, recorded for the duties that answer a change.'
		},
		facts: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			default: {}
		},
		company_id: {
			kind: 'ref',
			to: 'entity',
			inverse: 'workplace_case',
			owned: true
		},
		employment_id: {
			kind: 'ref',
			to: 'employment_contract',
			inverse: 'workplace_case',
			optional: true
		}
	},
	read: 'all',
	create: {
		columns: {
			workplace_case: ['kind', 'opened_on', 'closed_on', 'facts', 'company_id', 'employment_id']
		},
		transform: function* (rows, ctx) {
			const prefetched = yield* loadWorkplaceAdmission(ctx.db.query, rows);
			return yield* Effect.forEach(rows, (row, at) =>
				admitted(ctx, ctx.db.query, at, row, prefetched).pipe(
					Effect.map((company_id) => ({ ...row, company_id }))
				)
			);
		}
	},
	update: {
		columns: { workplace_case: ['kind', 'opened_on', 'closed_on', 'facts'] },
		// an update records what it changed, for the duties that answer a change
		transform: function* (changes, ctx) {
			const prefetched = yield* loadWorkplaceAdmission(
				ctx.db.query,
				changes.map(({ before, set }) => ({ ...before, ...set }))
			);
			return yield* Effect.forEach(changes, ({ before, set }, at) =>
				admitted(ctx, ctx.db.query, at, { ...before, ...set }, prefetched).pipe(
					Effect.as({ ...set, before: beforeOf(before, set) })
				)
			);
		}
	},
	// The jurisdiction behaviour rules for this model's writes (`behaviour_taps`), started as the writer.
	effect: {
		created: function* (rows, ctx) {
			yield* tap(ctx, 'created', { model: 'workplace_case', ids: rows.map((row) => row.id) });
		},
		updated: function* (changes, ctx) {
			const ids = moved(changes, ['kind', 'opened_on', 'closed_on', 'facts']);
			yield* tap(ctx, 'updated', { model: 'workplace_case', ids });
		}
	}
});
