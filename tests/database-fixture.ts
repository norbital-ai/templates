import { sqlServerDatabase } from '@norbital-ai/bolt-server';
import type { DatabaseRequest } from '@norbital-ai/bolt/engine';
import { Effect, Schema } from 'effect';
class FixtureWriteInvalid extends Schema.TaggedError<FixtureWriteInvalid>()('FixtureWriteInvalid', {
	message: Schema.String
}) {}
/** Only local simulation fixtures call the SQL Server driver directly; production algorithms are isolated template functions. */
export function databaseFixture(
	dsn: string,
	driver: ReturnType<typeof sqlServerDatabase> = sqlServerDatabase()
) {
	if (
		!/^Server=127\.0\.0\.1,(14339|14340);/i.test(dsn) ||
		!/;Database=TradeSimulation_[a-f0-9]+;/i.test(dsn)
	)
		throw new Error('A dedicated local TradeSimulation database is required');
	const request = (op: DatabaseRequest) => driver.query(dsn, op);
	return {
		request,
		query: (query: DatabaseRequest) => driver.query(dsn, query),
		write: Effect.fnUntraced(function* (submission: {
			key: string;
			hash: string;
			find: string;
			statement: string;
			parameters: Readonly<Record<string, string | number | boolean | null>>;
		}) {
			const result = yield* driver.query(dsn, {
				transaction: 'serializable',
				maxRows: 1,
				parameters: { ...submission.parameters, key: submission.key, hash: submission.hash },
				statement: `DECLARE @existing table(__key nvarchar(512),__hash varchar(64)); INSERT @existing ${submission.find};
				 IF (SELECT COUNT(*) FROM @existing)>1 OR EXISTS(SELECT 1 FROM @existing WHERE __hash<>@hash) THROW 51000,'Fixture submission changed',1;
				 IF NOT EXISTS(SELECT 1 FROM @existing) BEGIN ${submission.statement}; INSERT @existing ${submission.find}; END;
				 SELECT __key,__hash FROM @existing;`
			});
			const rows = yield* Schema.decodeUnknownEffect(
				Schema.Array(Schema.Struct({ __key: Schema.String, __hash: Schema.String }))
			)(result.rows);
			const receipt = rows[0];
			if (rows.length !== 1 || receipt?.__hash !== submission.hash)
				return yield* Effect.fail(
					new FixtureWriteInvalid({ message: 'Fixture batch did not verify' })
				);
			return { remote: receipt.__key, hash: receipt.__hash };
		})
	};
}
