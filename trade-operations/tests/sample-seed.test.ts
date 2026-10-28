import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { expect, it as test } from '@effect/vitest';
import source from '../seed/seed.js';
import { fixtureId } from './test-runtime.js';

const SALES = fixtureId('sys_user', '00000000-0000-4000-8000-000000000901');

const temporaryBank = Effect.fnUntraced(function* () {
	const directory = yield* Effect.acquireRelease(
		Effect.sync(() => {
			const parent = join(tmpdir(), 'norbital-scratch');
			mkdirSync(parent, { recursive: true });
			return mkdtempSync(join(parent, 'trade-sample-'));
		}),
		(path) => Effect.sync(() => rmSync(path, { recursive: true, force: true }))
	);
	return {
		directory,
		has: (path: string) => existsSync(join(directory, path)),
		json: (path: string) =>
			Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(
				readFileSync(join(directory, path), 'utf8')
			)
	};
});

test.live(
	'duplicate sample identities and unknown sample teams are refused',
	() =>
		Effect.scoped(
			Effect.gen(function* () {
				const bank = yield* temporaryBank();
				writeFileSync(
					join(bank.directory, 'sys_user.json'),
					JSON.stringify([{ id: SALES }, { id: SALES }])
				);
				expect(() => source.rows(bank)).toThrow('Duplicate sample identity in sys_user.');
				writeFileSync(
					join(bank.directory, 'sys_user.json'),
					JSON.stringify([{ id: SALES, team: 'Warehouse' }])
				);
				expect(() => source.rows(bank)).toThrow('Unknown sample team Warehouse.');
			})
		)
);

