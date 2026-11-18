import { Context, Effect, Layer, Schema } from 'effect';
import {
	KitInvalid,
	TestWorkspace,
	type Caller,
	NativeReadRow,
	type Kit,
	type NativeReadAnswer,
	type TestOptions,
	type TestPorts
} from '@norbital-ai/bolt-cli/test';
import {
	input_schema,
	instance_id as checkedInstanceId,
	type Kind,
	type ModelName,
	type Id,
	type ValueOf
} from '@norbital-ai/bolt';
import type { Json } from '@norbital-ai/bolt/engine';
import { SOW_FIELDS } from '../src/lib/extracted.js';
import { ActRefused } from '@norbital-ai/bolt/errors';
import { documentRead, preview, render, termsKey } from '../src/lib/documents.js';

const root = `${process.cwd()}/`;
type WorkspaceOptions<P extends TestPorts> = Omit<
	Extract<TestOptions<P>, { artifact?: never }>,
	'root'
>;
/** The real source workspace, one per test. */
export const workspaceServices = <P extends TestPorts = never>(options: WorkspaceOptions<P> = {}) =>
	Layer.build(sharedWorkspace(options));

/** One source workspace shared by a file's tests: `layer(sharedWorkspace(...))`. */
export const sharedWorkspace = <P extends TestPorts = never>(options: WorkspaceOptions<P> = {}) =>
	TestWorkspace.layer({ root, seed: 'none', ...options });

export const workspace = <P extends TestPorts = never>(options: WorkspaceOptions<P> = {}) =>
	workspaceServices(options).pipe(Effect.map((services) => Context.get(services, TestWorkspace)));

class FixtureResponseFailed extends Schema.TaggedError<FixtureResponseFailed>()(
	'FixtureResponseFailed',
	{
		cause: Schema.Defect()
	}
) {}

/** The HTTP act reply: an outcome, or a transport error. */
const WireReply = Schema.Union([
	Schema.Struct({
		outcome: Schema.StructWithRest(
			Schema.Struct({
				kind: Schema.String,
				code: Schema.optionalKey(Schema.String),
				message: Schema.optionalKey(Schema.String)
			}),
			[Schema.Record(Schema.String, Schema.Json)]
		)
	}),
	Schema.Struct({ error: Schema.Struct({ code: Schema.String, message: Schema.String }) })
]);

/** Malformed authored inputs go through the real HTTP schema boundary. */
export const wireAct = Effect.fnUntraced(function* (
	t: Kit,
	who: Parameters<Kit['as']>[0],
	callable: string,
	input: Json
) {
	const actor = (yield* t.as(who)).authority.actor;
	if (actor.kind !== 'member') throw new Error('Fixture wire writes require a member');
	const cookie = yield* t.session(actor.id);
	const response = yield* t.handle(
		new Request('http://localhost/__bolt/act', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'Idempotency-Key': crypto.randomUUID(),
				cookie
			},
			body: JSON.stringify({ acts: { [callable]: input }, issued_at: t.clock.now() })
		})
	);
	const answer: unknown = yield* Effect.tryPromise({
		try: async (): Promise<unknown> => response.json(),
		catch: (cause) => new FixtureResponseFailed({ cause })
	});
	const reply = yield* Schema.decodeUnknownEffect(WireReply)(answer);
	if ('error' in reply) return yield* Effect.fail(new ActRefused(reply.error));
	const { kind, code, message } = reply.outcome;
	if (kind !== 'committed')
		return yield* Effect.fail(new ActRefused({ code: code ?? kind, message: message ?? kind }));
	return reply.outcome;
});

export const member = Effect.fnUntraced(function* (
	t: Kit,
	policies: Parameters<Kit['member']>[0],
	over: Parameters<Kit['member']>[1] = {}
) {
	const teams = Object.entries(t.manifest.teams)
		.filter(([, team]) =>
			('policies' in team ? team.policies : team).some((policy) => policies.includes(policy))
		)
		.map(([name]) => name);
	const holder = t.member(policies, { teams, ...over });
	const row = pageOf(yield* (yield* t.as(t.admin)).query({ sys_user: {} }), 'sys_user').rows.find(
		(row) => row.id === holder.id
	);
	if (row === undefined) throw new Error('Missing created fixture member');
	return { ...holder, id: nativeId('sys_user', row.id) };
});

export const recordAt = <A>(rows: readonly A[], index = 0): A => {
	const row = rows[index];
	if (row === undefined) throw new Error('Expected a fixture record');
	return row;
};

type Written = { readonly model: string; readonly id: string; readonly revision: number };
/** Native commits include related rows; the model discriminator admits each ID's brand. */
export const recordOf = <C extends ModelName>(records: readonly Written[], model: C, index = 0) => {
	const record = recordAt(
		records.filter((record) => record.model === model),
		index
	);
	return { id: nativeId(model, record.id), revision: record.revision };
};

/** IDs retain their model brand only after the native kind codec admits the fixture value. */
export function nativeId<C extends string>(model: C, value: unknown): Id<C> {
	const codec = input_schema({ kind: 'ref', to: model });
	const decoded = Schema.decodeUnknownSync(codec)(value);
	const branded = Schema.declare<Id<C>>(
		(candidate: unknown): candidate is Id<C> =>
			typeof candidate === 'string' && Schema.is(codec)(candidate)
	);
	return Schema.decodeUnknownSync(branded)(decoded);
}

/** A kit read's page of `root`: the kit decodes by the running manifest, so a test narrows the root to its page here. */
const Page = Schema.Struct({
	rows: Schema.Array(NativeReadRow),
	next: Schema.optionalKey(Schema.NullOr(Schema.String)),
	total: Schema.optionalKey(Schema.Number)
});
export const pageOf = (answer: NativeReadAnswer, root: string) =>
	Schema.decodeUnknownSync(Page)(answer[root]);

/** A record as an update or delete names it: its id and the revision stored now, read from its table. */
export const targetOf = Effect.fnUntraced(function* <C extends ModelName>(
	t: Kit,
	model: C,
	id: Id<C>
) {
	const row = (yield* t.db.rows(Schema.Struct({ revision: Schema.Number }), {
		text: `SELECT revision FROM "${model}" WHERE id = $1`,
		params: [id]
	}))[0];
	if (row === undefined)
		return yield* Effect.fail(new KitInvalid({ message: `Missing ${model} ${id}` }));
	return { id, revision: row.revision };
});

/**
 * A workspace account (no owner), paired: its queued sends leave as a connected link's do. Pairing is the host's, so the
 * fixture records the connected status on the row directly.
 */
export const connectedAccount = Effect.fnUntraced(function* (
	t: Kit,
	integration: 'email' | 'whatsapp',
	name: string
) {
	const created = yield* (yield* t.as(t.admin)).act({
		'sys_integration.create': [{ integration, name }]
	});
	if (created.kind !== 'committed') throw new Error(JSON.stringify(created));
	const { id } = recordOf(created.records, 'sys_integration');
	yield* t.db.write({
		text: 'UPDATE sys_integration SET status = $2::jsonb WHERE id = $1',
		params: [id, { state: 'connected' }]
	});
	return id;
});

/** Runs are host ledgers, inspected through the real database with their stored field codecs. */
export const runRows = (t: Kit, automation: string) =>
	t.db.rows(Schema.Struct({ state: Schema.String, error: Schema.NullOr(Schema.Json) }), {
		text: 'SELECT state, error FROM sys_run WHERE automation = $1',
		params: [automation]
	});

/** A definition brand is admitted only after reading that exact native integration row. */
export const instance_id = Effect.fnUntraced(function* <D extends string>(
	caller: Caller,
	definition: D & Parameters<typeof checkedInstanceId<D>>[0],
	id: Id<'sys_integration'>
) {
	const row =
		pageOf(
			yield* caller.query({
				sys_integration: { where: { id: { eq: id } }, fields: ['integration'], limit: 1 }
			}),
			'sys_integration'
		).rows[0] ?? null;
	if (row === null)
		return yield* Effect.fail(new KitInvalid({ message: `Missing integration ${id}` }));
	const integration = yield* Schema.decodeUnknownEffect(Schema.Literal(definition))(
		row['integration']
	);
	return checkedInstanceId<D>(definition, { id, integration });
});

export const required = <A>(value: A | null | undefined): A => {
	if (value === null || value === undefined) throw new Error('Missing fixture value');
	return value;
};

/** A native value admitted by an authored field's own kind codec, typed as that field's value. */
export const ofKind = <const K extends Kind>(kind: K) => {
	const codec = input_schema(kind);
	return Schema.declare<ValueOf<K>>((value: unknown): value is ValueOf<K> =>
		Schema.is(codec)(value)
	);
};
export const idOf = <C extends string>(model: C) =>
	Schema.declare<Id<C>>(
		(value: unknown): value is Id<C> =>
			typeof value === 'string' && Schema.is(input_schema({ kind: 'ref', to: model }))(value)
	);
const rowsOf = <F extends Schema.Struct.Fields>(fields: F) =>
	Schema.Struct({ rows: Schema.Array(Schema.Struct(fields)) });
const text = Schema.String,
	maybe = Schema.NullOr(Schema.String);
/** `documentRead`'s answer, decoded by the fields it reads (the kit answers by the running manifest, untyped). */
const DocumentAnswer = Schema.Struct({
	template_documents: rowsOf({
		id: idOf('template_documents'),
		title: text,
		key: text,
		kind: Schema.Literals(['document', 'email', 'research']),
		scope: Schema.Literals(['company', 'project']),
		version: Schema.Number,
		required: Schema.NullOr(Schema.Array(text)),
		subject: maybe,
		body: text,
		drafting_instructions: maybe
	}),
	companies: rowsOf({
		name: text,
		uen: maybe,
		address: maybe,
		website: maybe,
		industry: maybe,
		research: maybe,
		use_cases: Schema.NullOr(Schema.Array(text)),
		stage: text,
		revision: Schema.Number,
		owner: Schema.NullOr(Schema.Struct({ id: idOf('sys_user'), name: maybe }))
	}),
	contacts: rowsOf({
		id: idOf('contacts'),
		revision: Schema.Number,
		full_name: text,
		job_title: maybe,
		email: maybe,
		company_signatory: Schema.Boolean,
		is_primary: Schema.NullOr(Schema.Boolean),
		seniority: maybe,
		angle: maybe
	}),
	projects: rowsOf({
		name: text,
		company_id: Schema.NullOr(idOf('companies')),
		signatory: Schema.NullOr(idOf('contacts')),
		overview: maybe,
		definitions: ofKind(SOW_FIELDS.definitions),
		implementation_scope: ofKind(SOW_FIELDS.implementation_scope),
		data_migration: ofKind(SOW_FIELDS.data_migration),
		milestones: ofKind(SOW_FIELDS.milestones),
		uat_tests: ofKind(SOW_FIELDS.uat_tests),
		fees: ofKind(SOW_FIELDS.fees)
	}),
	agreement_settings: rowsOf({
		provider_company: maybe,
		provider_uen: maybe,
		provider_address: maybe,
		provider_signatory_name: text,
		provider_signatory_title: maybe
	})
});
const SignedAnswer = Schema.Struct({
	signed_documents: rowsOf({
		terms: Schema.Record(Schema.String, Schema.String),
		template_version: Schema.Struct({ id: idOf('template_documents'), body: text })
	})
});

/** A catalogue template's preview as its page renders it: the caller's read, then the same helper. */
export const previewAs = Effect.fnUntraced(function* (
	caller: Caller,
	input: {
		readonly key: string;
		readonly company: Id<'companies'>;
		readonly project?: Id<'projects'>;
		readonly as_of: string;
	}
) {
	const data = yield* Schema.decodeUnknownEffect(DocumentAnswer)(
		yield* caller.query(documentRead(input.key, input.company, input.project ?? null))
	);
	return preview(data, input.as_of);
});
/** A signed copy rendered from its frozen terms and the version it was signed on, as its page renders it. */
export const signedAs = Effect.fnUntraced(function* (caller: Caller, id: Id<'signed_documents'>) {
	const { signed_documents } = yield* Schema.decodeUnknownEffect(SignedAnswer)(
		yield* caller.query({
			signed_documents: {
				where: { id: { eq: id } },
				fields: ['terms'],
				limit: 1,
				template_version: { fields: ['body'] }
			}
		})
	);
	const signed = required(signed_documents.rows[0]);
	return {
		body: render(signed.template_version.body, signed.terms),
		key: termsKey(signed.template_version.id, signed.terms)
	};
});
