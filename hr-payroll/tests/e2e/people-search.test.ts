/**
 * The people search: `$search` finds a profile by a word of its name, email or phone (a prefix or a slipped spelling)
 * and a contract by its employee number; `$similar` ranks profiles by the meaning of their address, embedded by the
 * platform run on the host's `default` model at 1536 dims (faked here: one axis per place a text names).
 */
import { existsSync } from 'node:fs';
import { expect, it } from '@effect/vitest';
import { Effect, Layer, Schema, Stream } from 'effect';
import { Ai, Port, type EmbedInput } from '@norbital-ai/bolt/engine';
import { respondSystem1, TestWorkspace } from '@norbital-ai/bolt/test';
import { fieldValue } from '../../src/lib/payroll_engine/foundation.ts';
import { workspace } from '../kit.ts';

const sample = existsSync(`${process.cwd()}/.norbital/seed/sample/pack.json`);
const DIM = 1536;
const axisOf = (text: string) =>
	/kuala lumpur|klang valley/i.test(text) ? 0 : /jakarta/i.test(text) ? 1 : 2;
const embed = (inputs: readonly EmbedInput[], model: string, dimensions?: number) =>
	Effect.sync(() => {
		expect({ model, dimensions }).toEqual({ model: 'default', dimensions: DIM });
		return inputs.map((input) => {
			const axis = axisOf(typeof input === 'string' ? input : '');
			return Array.from({ length: DIM }, (_, i) => (i === axis ? 1 : 0));
		});
	});
const ports = Layer.succeed(Ai, {
	ask: respondSystem1,
	maxChoices: undefined,
	models: ['default'],
	catalog: Port.unavailable('ai.catalog'),
	infer: () => Stream.fail(Port.failure('ai')(new Error('unused'))),
	embed
});

it.live(
	'a profile is found by a word of its name or email, and by the meaning of its address',
	() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = t.as(t.member(['hr_manager']));
			const profile = Effect.fnUntraced(function* (name: string, email: string, address: string) {
				const out = yield* hr.act('employment_profile.create', { name, email, address });
				if (out.kind !== 'committed') throw new Error(JSON.stringify(out));
				const row = out.records.find((record) => record.collection === 'employment_profile');
				if (row === undefined) throw new Error(`No profile row for ${name}`);
				return row.id;
			});
			const aisyah = yield* profile(
				'Aisyah Rahman',
				'aisyah.rahman@example.com',
				'12 Jalan Tun Razak, Kuala Lumpur'
			);
			const budi = yield* profile('Budi Santoso', 'budi@example.com', 'Jalan Sudirman 5, Jakarta');
			const chen = yield* profile('Chen Wei', 'chen.wei@example.com', '88 Nanjing Road, Shanghai');
			yield* t.runDue();
			expect(
				yield* t.db.rows(Schema.Struct({ n: Schema.Number }), {
					text: 'SELECT count(*)::int AS n FROM employment_profile WHERE bolt_embedding IS NULL AND address IS NOT NULL',
					params: []
				})
			).toEqual([{ n: 0 }]);
			const ids = Effect.fnUntraced(function* (
				where: { $search: string } | { $similar: string | { to: string; top: number } }
			) {
				return (yield* hr.read('employment_profile', { where, all: true })).rows
					.map((row) => row.id)
					.sort();
			});
			expect(yield* ids({ $search: 'aisyah' })).toEqual([aisyah]);
			expect(yield* ids({ $search: 'santusa' })).toEqual([budi]); // a slipped spelling (same consonants)
			expect(yield* ids({ $search: 'chen.wei@example.com' })).toEqual([chen]);
			expect(yield* ids({ $search: 'aisyah jakarta' })).toEqual([]); // every word, and the address is not text-searched
			expect(yield* ids({ $similar: 'staff living in the Klang Valley' })).toEqual([aisyah]);
			expect(yield* ids({ $similar: { to: 'commutes into Jakarta', top: 1 } })).toEqual([budi]);
		}).pipe(Effect.provide(workspace({ ports })))
);

it.live.skipIf(!sample)(
	'a sample contract is found by its employee number and its person by name',
	() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = t.as(t.member(['hr_manager']));
			const [contract] = (yield* hr.read('employment_contract', {
				where: { employee_number: { eq: 'NHPMY0191' } },
				limit: 1
			})).rows;
			if (contract === undefined) throw new Error('The sample needs employment NHPMY0191');
			const found = (yield* hr.read('employment_contract', {
				where: { $search: 'NHPMY0191' },
				all: true
			})).rows;
			expect(found.map((row) => row.id)).toContain(contract.id);
			const employee = yield* Effect.fromResult(
				fieldValue(contract.employee_id, 'employment_contract.employee_id')
			);
			const person = yield* hr.get('employment_profile', employee);
			if (person === null) throw new Error('The sample contract has no profile');
			const name = yield* Effect.fromResult(fieldValue(person.name, 'employment_profile.name'));
			const named = (yield* hr.read('employment_profile', {
				where: { $search: name },
				all: true
			})).rows;
			expect(named.map((row) => row.id)).toContain(person.id);
		}).pipe(Effect.provide(workspace({ sample: true }))),
	{ timeout: 600_000 }
);
