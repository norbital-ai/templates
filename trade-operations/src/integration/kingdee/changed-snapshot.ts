import { Effect, Schema } from 'effect';
import { checked } from './order-source.js';
import { columns, query, SourceRowInvalid, type DatabaseContext } from './polling.js';
import { requireReadAccount } from './sql.js';

export const snapshotFingerprint = Schema.String.check(Schema.isPattern(/^[0-9A-F]{64}$/));

/** Compare the fingerprint of the exact materialized payload before transferring it. */
export const snapshotStatement = (projection: string) => `${requireReadAccount}
DECLARE @data nvarchar(max) = (${projection});
SET @data=COALESCE(@data,N'[]');
DECLARE @fingerprint varchar(64) = CONVERT(varchar(64),HASHBYTES('SHA2_256',@data),2);
SELECT @fingerprint AS fingerprint,
 CONVERT(bit,CASE WHEN DATALENGTH(@data)>1000000 THEN 1 ELSE 0 END) AS oversized,
 CASE WHEN DATALENGTH(@data)<=1000000 AND @fingerprint<>@prior THEN @data END AS entries,
 CONVERT(varchar(33),SYSUTCDATETIME(),126)+'Z' AS observed_at;`;

export const readChangedSnapshot = Effect.fnUntraced(function* (
	ctx: DatabaseContext,
	stmt: string,
	account: string,
	prior: string,
	probe = false
) {
	const [row] = yield* query(ctx, {
		op: 'call',
		procedure: { schema: 'sys', name: 'sp_executesql' },
		maxRows: 1,
		arguments: {
			stmt,
			params: '@read_account nvarchar(73),@prior varchar(64),@probe bit',
			read_account: account,
			prior,
			probe
		}
	});
	if (!row)
		return yield* new SourceRowInvalid({
			column: '$result',
			reason: 'Missing source snapshot checkpoint'
		});
	return yield* checked(() => {
		const r = columns(row);
		if (r.bool('oversized'))
			throw new SourceRowInvalid({
				column: '$result',
				reason: 'Source snapshot exceeds its transfer bound'
			});
		const fingerprint = Schema.decodeUnknownSync(snapshotFingerprint)(r.text('fingerprint'));
		const entries = r.text('entries', null);
		if (entries === null && fingerprint !== prior)
			throw new SourceRowInvalid({
				column: '$result',
				reason: 'Incomplete source snapshot checkpoint'
			});
		return { fingerprint, entries, observed_at: r.instant('observed_at') };
	});
});
