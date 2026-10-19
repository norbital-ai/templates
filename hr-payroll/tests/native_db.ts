import { PgliteDb, TenantDb, type DbError } from '@norbital-ai/bolt/engine';
import { Context, Effect, Layer } from 'effect';
import { workspace, type WorkspaceOptions } from './kit.js';

/** Fail the real database after seeding, without replacing the native workspace reader. */
export class ReadFault extends Context.Service<
	ReadFault,
	{
		readonly arm: (error: DbError) => void;
		readonly clear: () => void;
		readonly calls: () => number;
	}
>()('hr/test/ReadFault') {}

export function faultWorkspace(options: WorkspaceOptions) {
	return Layer.unwrap(
		Effect.sync(() => {
			let failure: DbError | undefined;
			let calls = 0;
			const db = Layer.effect(
				TenantDb,
				Effect.map(TenantDb, (inner) =>
					TenantDb.typed({
						read: (statements) =>
							Effect.suspend(() => {
								calls++;
								return failure === undefined ? inner.read(statements) : Effect.fail(failure);
							}),
						write: inner.write,
						transaction: inner.transaction
					})
				)
			).pipe(Layer.provide(PgliteDb.layer()));
			return Layer.merge(
				workspace({ ...options, db }),
				Layer.succeed(ReadFault, {
					arm: (error) => {
						failure = error;
						calls = 0;
					},
					clear: () => {
						failure = undefined;
						calls = 0;
					},
					calls: () => calls
				})
			);
		})
	);
}
