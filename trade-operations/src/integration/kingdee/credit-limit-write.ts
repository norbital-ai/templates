import { BigDecimal, Effect, Option, Schema } from 'effect';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { fixedDecimal } from '../../lib/purchase-listing.js';
import { kingdeeWriteTarget } from './configuration.js';
import { sourceInteger } from './order-batch.js';
import {
	columns,
	query,
	SourceRowInvalid,
	SourceUnavailable,
	type DatabaseContext,
	type SqlRow
} from './polling.js';
import { requireWriteAccount } from './sql.js';

const creditObjectGuardSql = (requireInsert: boolean) => {
	const perms = requireInsert ? 'SELECT/INSERT/UPDATE' : 'SELECT/UPDATE';
	const insertCheck = requireInsert
		? "\n OR HAS_PERMS_BY_NAME('dbo.ICCreditObject','OBJECT','INSERT')<>1"
		: '';
	return `IF OBJECT_ID('dbo.ICCreditObject','U') IS NULL
BEGIN
 SELECT 'denied' AS status, 'dbo.ICCreditObject table is unavailable' AS detail, '' AS customer_id, '' AS credit_limit, '0' AS credit_days;
 RETURN;
END;
IF HAS_PERMS_BY_NAME('dbo.ICCreditObject','OBJECT','SELECT')<>1${insertCheck}
 OR HAS_PERMS_BY_NAME('dbo.ICCreditObject','OBJECT','UPDATE')<>1
BEGIN
 SELECT 'denied' AS status, 'Msg 229: ${perms} permission was denied on dbo.ICCreditObject' AS detail, '' AS customer_id, '' AS credit_limit, '0' AS credit_days;
 RETURN;
END;`;
};

const creditCustomerLookupSql = `DECLARE @currency_id int;
SELECT TOP (1) @currency_id = FCurrencyID FROM dbo.t_Currency WHERE FDeleted=0 AND FNumber IN ('CNY','RMB') ORDER BY FCurrencyID;
IF @currency_id IS NULL SET @currency_id = 1;
IF NOT EXISTS (SELECT 1 FROM dbo.t_Organization WHERE FItemID=@cust AND FDeleted=0)
 BEGIN RAISERROR('Kingdee customer does not exist or is deleted',16,1); RETURN; END;`;

const selectCreditObjectSql = `DECLARE @selSql nvarchar(max);
IF COL_LENGTH('dbo.ICCreditObject','FCreditClass') IS NOT NULL
 SET @selSql = N'SELECT TOP (1) ''ok'' AS status, '''' AS detail, CONVERT(varchar(20),@cust) AS customer_id, CONVERT(varchar(100),FAmount) AS credit_limit, CONVERT(varchar(20),ISNULL(FCreditDays,0)) AS credit_days FROM dbo.ICCreditObject WHERE FCreditClass=0 AND FItemID=@cust';
ELSE
 SET @selSql = N'SELECT TOP (1) ''ok'' AS status, '''' AS detail, CONVERT(varchar(20),@cust) AS customer_id, CONVERT(varchar(100),FAmount) AS credit_limit, CONVERT(varchar(20),ISNULL(FCreditDays,0)) AS credit_days FROM dbo.ICCreditObject WHERE FItemID=@cust';
EXEC sys.sp_executesql @selSql, N'@cust int', @cust=@cust`;

/** Read-only check run by integration `test()` when `directWriteCreditLimit` is enabled. */
export const testCreditLimitWriteSql = `${requireWriteAccount}
${creditObjectGuardSql(true)}
SELECT 'ok' AS status, '' AS detail, '' AS customer_id, '0' AS credit_limit, '0' AS credit_days; /* kingdee-credit-limit-write-test */`;

/**
 * Upserts a customer's CNY credit limit and/or credit days in `dbo.ICCreditObject`.
 * Handles both full Kingdee KIS (`FCreditClass`/`FDayControl`) and minimal simulator schemas,
 * and surfaces missing `SELECT, INSERT, UPDATE` grants cleanly before running DML.
 */
export const writeCreditLimitSql = `SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;
${requireWriteAccount}
${creditObjectGuardSql(true)}
DECLARE @cust int = CAST(@party AS int);
DECLARE @amt decimal(28,4) = CASE WHEN @amount = '' THEN NULL ELSE CAST(@amount AS decimal(28,4)) END;
DECLARE @days int = CASE WHEN @credit_days = '' THEN NULL ELSE CAST(@credit_days AS int) END;
${creditCustomerLookupSql}
DECLARE @sql nvarchar(max);
IF COL_LENGTH('dbo.ICCreditObject','FCreditClass') IS NOT NULL
 SET @sql = N'
  IF EXISTS (SELECT 1 FROM dbo.ICCreditObject WITH (UPDLOCK,HOLDLOCK) WHERE FCreditClass=0 AND FItemID=@cust)
   UPDATE dbo.ICCreditObject
    SET FAmount = COALESCE(@amt, FAmount),
        FCreditDays = COALESCE(@days, FCreditDays),
        FDayControl = CASE WHEN COALESCE(@days, FCreditDays, 0) > 0 THEN 1 ELSE 0 END
    WHERE FCreditClass=0 AND FItemID=@cust;
  ELSE
   INSERT INTO dbo.ICCreditObject (FItemID, FCreditClass, FCreditLevel, FCurrencyID, FAmount, FQty, FDayControl, FCreditDays)
   VALUES (@cust, 0, '''', @currency_id, COALESCE(@amt, 0), 0, CASE WHEN COALESCE(@days, 0) > 0 THEN 1 ELSE 0 END, COALESCE(@days, 0));';
ELSE
 SET @sql = N'
  IF EXISTS (SELECT 1 FROM dbo.ICCreditObject WITH (UPDLOCK,HOLDLOCK) WHERE FItemID=@cust)
   UPDATE dbo.ICCreditObject
    SET FAmount = COALESCE(@amt, FAmount),
        FCreditDays = COALESCE(@days, FCreditDays)
    WHERE FItemID=@cust;
  ELSE
   INSERT INTO dbo.ICCreditObject (FItemID, FCurrencyID, FAmount, FCreditDays)
   VALUES (@cust, @currency_id, COALESCE(@amt, 0), COALESCE(@days, 0));';
EXEC sys.sp_executesql @sql,
 N'@cust int,@currency_id int,@amt decimal(28,4),@days int',
 @cust=@cust,@currency_id=@currency_id,@amt=@amt,@days=@days;
${selectCreditObjectSql}; /* kingdee-credit-limit-write */`;

/**
 * Idempotently raises `dbo.ICCreditObject.FAmount` / `FCreditDays` to at least `@target_amt` / `@target_days`
 * for an approved one-time delivery release. Retrying never double-adds.
 */
export const applyTempCreditBumpSql = `SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;
${requireWriteAccount}
${creditObjectGuardSql(true)}
DECLARE @cust int = CAST(@party AS int);
DECLARE @target_amt decimal(28,4) = CASE WHEN @amount = '' THEN NULL ELSE CAST(@amount AS decimal(28,4)) END;
DECLARE @target_days int = CASE WHEN @credit_days = '' THEN NULL ELSE CAST(@credit_days AS int) END;
${creditCustomerLookupSql}
DECLARE @sql nvarchar(max);
IF COL_LENGTH('dbo.ICCreditObject','FCreditClass') IS NOT NULL
 SET @sql = N'
  IF EXISTS (SELECT 1 FROM dbo.ICCreditObject WITH (UPDLOCK,HOLDLOCK) WHERE FCreditClass=0 AND FItemID=@cust)
   UPDATE dbo.ICCreditObject
    SET FAmount = CASE WHEN @target_amt IS NOT NULL AND FAmount < @target_amt THEN @target_amt ELSE FAmount END,
        FCreditDays = CASE WHEN @target_days IS NOT NULL AND ISNULL(FCreditDays,0) < @target_days THEN @target_days ELSE FCreditDays END,
        FDayControl = CASE WHEN CASE WHEN @target_days IS NOT NULL AND ISNULL(FCreditDays,0) < @target_days THEN @target_days ELSE ISNULL(FCreditDays,0) END > 0 THEN 1 ELSE 0 END
    WHERE FCreditClass=0 AND FItemID=@cust;
  ELSE
   INSERT INTO dbo.ICCreditObject (FItemID, FCreditClass, FCreditLevel, FCurrencyID, FAmount, FQty, FDayControl, FCreditDays)
   VALUES (@cust, 0, '''', @currency_id, COALESCE(@target_amt, 0), 0, CASE WHEN COALESCE(@target_days, 0) > 0 THEN 1 ELSE 0 END, COALESCE(@target_days, 0));';
ELSE
 SET @sql = N'
  IF EXISTS (SELECT 1 FROM dbo.ICCreditObject WITH (UPDLOCK,HOLDLOCK) WHERE FItemID=@cust)
   UPDATE dbo.ICCreditObject
    SET FAmount = CASE WHEN @target_amt IS NOT NULL AND FAmount < @target_amt THEN @target_amt ELSE FAmount END,
        FCreditDays = CASE WHEN @target_days IS NOT NULL AND ISNULL(FCreditDays,0) < @target_days THEN @target_days ELSE FCreditDays END
    WHERE FItemID=@cust;
  ELSE
   INSERT INTO dbo.ICCreditObject (FItemID, FCurrencyID, FAmount, FCreditDays)
   VALUES (@cust, @currency_id, COALESCE(@target_amt, 0), COALESCE(@target_days, 0));';
EXEC sys.sp_executesql @sql,
 N'@cust int,@currency_id int,@target_amt decimal(28,4),@target_days int',
 @cust=@cust,@currency_id=@currency_id,@target_amt=@target_amt,@target_days=@target_days;
${selectCreditObjectSql}; /* kingdee-temp-credit-bump-apply */`;

/**
 * Idempotently deducts a temporary one-time credit bump from `dbo.ICCreditObject.FAmount` / `FCreditDays`,
 * floored at `@floor_amt` / `@floor_days` so retries never double-deduct and concurrent raises are preserved.
 */
export const restoreTempCreditBumpSql = `SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;
${requireWriteAccount}
${creditObjectGuardSql(false)}
DECLARE @cust int = CAST(@party AS int);
DECLARE @floor_amt decimal(28,4) = CASE WHEN @floor_amount = '' THEN NULL ELSE CAST(@floor_amount AS decimal(28,4)) END;
DECLARE @bump_amt decimal(28,4) = CASE WHEN @bump_amount = '' THEN NULL ELSE CAST(@bump_amount AS decimal(28,4)) END;
DECLARE @floor_d int = CASE WHEN @floor_days = '' THEN NULL ELSE CAST(@floor_days AS int) END;
DECLARE @bump_d int = CASE WHEN @bump_days = '' THEN NULL ELSE CAST(@bump_days AS int) END;
DECLARE @sql nvarchar(max);
IF COL_LENGTH('dbo.ICCreditObject','FCreditClass') IS NOT NULL
 SET @sql = N'
  IF EXISTS (SELECT 1 FROM dbo.ICCreditObject WITH (UPDLOCK,HOLDLOCK) WHERE FCreditClass=0 AND FItemID=@cust)
   UPDATE dbo.ICCreditObject
    SET FAmount = CASE
          WHEN @bump_amt IS NOT NULL AND @floor_amt IS NOT NULL AND FAmount > @floor_amt
          THEN CASE WHEN FAmount - @bump_amt < @floor_amt THEN @floor_amt ELSE FAmount - @bump_amt END
          ELSE FAmount
        END,
        FCreditDays = CASE
          WHEN @bump_d IS NOT NULL AND @floor_d IS NOT NULL AND ISNULL(FCreditDays,0) > @floor_d
          THEN CASE WHEN ISNULL(FCreditDays,0) - @bump_d < @floor_d THEN @floor_d ELSE ISNULL(FCreditDays,0) - @bump_d END
          ELSE FCreditDays
        END,
        FDayControl = CASE
          WHEN CASE
            WHEN @bump_d IS NOT NULL AND @floor_d IS NOT NULL AND ISNULL(FCreditDays,0) > @floor_d
            THEN CASE WHEN ISNULL(FCreditDays,0) - @bump_d < @floor_d THEN @floor_d ELSE ISNULL(FCreditDays,0) - @bump_d END
            ELSE ISNULL(FCreditDays,0)
          END > 0 THEN 1 ELSE 0
        END
    WHERE FCreditClass=0 AND FItemID=@cust;';
ELSE
 SET @sql = N'
  IF EXISTS (SELECT 1 FROM dbo.ICCreditObject WITH (UPDLOCK,HOLDLOCK) WHERE FItemID=@cust)
   UPDATE dbo.ICCreditObject
    SET FAmount = CASE
          WHEN @bump_amt IS NOT NULL AND @floor_amt IS NOT NULL AND FAmount > @floor_amt
          THEN CASE WHEN FAmount - @bump_amt < @floor_amt THEN @floor_amt ELSE FAmount - @bump_amt END
          ELSE FAmount
        END,
        FCreditDays = CASE
          WHEN @bump_d IS NOT NULL AND @floor_d IS NOT NULL AND ISNULL(FCreditDays,0) > @floor_d
          THEN CASE WHEN ISNULL(FCreditDays,0) - @bump_d < @floor_d THEN @floor_d ELSE ISNULL(FCreditDays,0) - @bump_d END
          ELSE FCreditDays
        END
    WHERE FItemID=@cust;';
EXEC sys.sp_executesql @sql,
 N'@cust int,@floor_amt decimal(28,4),@bump_amt decimal(28,4),@floor_d int,@bump_d int',
 @cust=@cust,@floor_amt=@floor_amt,@bump_amt=@bump_amt,@floor_d=@floor_d,@bump_d=@bump_d;
IF EXISTS (SELECT 1 FROM dbo.ICCreditObject WHERE FItemID=@cust)
BEGIN
 ${selectCreditObjectSql};
END
ELSE
 SELECT 'ok' AS status, '' AS detail, CONVERT(varchar(20),@cust) AS customer_id, '0' AS credit_limit, '0' AS credit_days; /* kingdee-temp-credit-bump-restore */`;

const CreditWriteConfig = Schema.Struct({
	baseCurrency: Schema.String,
	directWriteCreditLimit: Schema.optionalKey(Schema.NullOr(Schema.Boolean))
});

export type WriteCreditLimitInput = {
	readonly partyCode: string;
	readonly limit?: string | null;
	readonly creditDays?: number | null;
};

export type ApplyTempCreditBumpInput = {
	readonly partyCode: string;
	readonly baseLimit: string | null;
	readonly bumpAmount: string | null;
	readonly baseDays: number | null;
	readonly bumpDays: number | null;
};

export type RestoreTempCreditBumpInput = {
	readonly partyCode: string;
	readonly floorLimit: string | null;
	readonly bumpAmount: string | null;
	readonly floorDays: number | null;
	readonly bumpDays: number | null;
};

const invalid = (message: string) => new FacilityFailure({ kind: 'invalid', message });

const parseDecimal = Effect.fnUntraced(function* (value: string, label: string) {
	const parsed = BigDecimal.fromString(value.trim());
	if (Option.isNone(parsed)) return yield* invalid(`Invalid ${label}: ${value}`);
	return parsed.value;
});

const parsePartyId = (partyCode: string) =>
	Effect.try({
		try: () => sourceInteger(partyCode, 'FItemID'),
		catch: (cause) => invalid(cause instanceof SourceRowInvalid ? cause.message : String(cause))
	});

const resolveCreditWriteAccount = Effect.fnUntraced(function* (
	configuration: unknown,
	failWhenUnpinned: boolean
) {
	const config = yield* Schema.decodeUnknownEffect(CreditWriteConfig)(configuration).pipe(
		Effect.mapError((cause) => invalid(String(cause)))
	);
	if (config.directWriteCreditLimit !== true) return null;
	const target = kingdeeWriteTarget(configuration);
	if (target === null || config.baseCurrency !== 'CNY') {
		if (!failWhenUnpinned) return null;
		return yield* invalid(
			'Direct Kingdee credit limit writes require CNY baseCurrency and a verified writeAccount pin.'
		);
	}
	return target.account;
});

const parseCreditWriteRow = Effect.fnUntraced(function* (rows: readonly SqlRow[]) {
	const row = rows[0];
	if (!row) return yield* invalid('Kingdee did not return the updated ICCreditObject row.');
	const header = yield* Effect.try({
		try: () => {
			const r = columns(row);
			return { status: r.text('status', 'ok'), detail: r.text('detail', 'Msg 229') };
		},
		catch: (cause) => invalid(cause instanceof Error ? cause.message : String(cause))
	});
	if (header.status === 'denied')
		return yield* invalid(
			`Kingdee SQL login lacks permission on dbo.ICCreditObject (${header.detail}). Ask DBA to run: GRANT SELECT, INSERT, UPDATE ON dbo.ICCreditObject TO <write_login>;`
		);
	return yield* Effect.try({
		try: () => {
			const r = columns(row);
			return {
				customerId: r.text('customer_id'),
				creditLimit: r.text('credit_limit'),
				creditDays: Number(r.text('credit_days', '0'))
			};
		},
		catch: (cause) => invalid(cause instanceof Error ? cause.message : String(cause))
	});
});

const executeCreditWrite = Effect.fnUntraced(function* (
	ctx: DatabaseContext,
	label: string,
	grants: string,
	stmt: string,
	params: string,
	args: Readonly<Record<string, string>>
) {
	const rows = yield* query(ctx, {
		op: 'call',
		procedure: { schema: 'sys', name: 'sp_executesql' },
		transaction: 'serializable',
		max_rows: 2,
		arguments: { stmt, params, ...args }
	}).pipe(
		Effect.mapError((cause) => {
			// Preserve transient transport/network failures so Bolt's outbox retries automatically on reconnect.
			if (
				cause._tag === 'Unavailable' ||
				(cause._tag === 'FacilityFailure' &&
					(cause.kind === 'upstream' || cause.kind === 'timeout' || cause.kind === 'rate_limited'))
			)
				return cause;
			const text = cause instanceof Error ? cause.message : String(cause);
			return invalid(
				`Kingdee ${label} failed (${text}). Verify writeAccount pin and SQL grants (GRANT ${grants} ON dbo.ICCreditObject).`
			);
		})
	);
	return yield* parseCreditWriteRow(rows);
});

/** Verifies `dbo.ICCreditObject` exists and is writable by the configured SQL login during connection test. */
export const testCreditLimitWrite = Effect.fnUntraced(function* (
	ctx: DatabaseContext,
	account: string
) {
	const rows = yield* query(ctx, {
		op: 'call',
		procedure: { schema: 'sys', name: 'sp_executesql' },
		max_rows: 1,
		arguments: {
			stmt: testCreditLimitWriteSql,
			params: '@write_account nvarchar(73)',
			write_account: account
		}
	});
	const row = rows[0];
	if (!row)
		return yield* new SourceUnavailable({
			reason: 'Kingdee did not return a permission check for dbo.ICCreditObject'
		});
	const parsed = yield* Effect.try({
		try: () => {
			const r = columns(row);
			return { status: r.text('status', 'ok'), detail: r.text('detail', 'Msg 229') };
		},
		catch: (cause) =>
			new SourceUnavailable({ reason: cause instanceof Error ? cause.message : String(cause) })
	});
	if (parsed.status === 'denied')
		return yield* new SourceUnavailable({
			reason: `Direct credit limit writes require dbo.ICCreditObject permission (${parsed.detail}). Ask DBA to run: GRANT SELECT, INSERT, UPDATE ON dbo.ICCreditObject TO <write_login>;`
		});
});

/** Temporarily bumps a customer's Kingdee credit limit/days for an approved one-time DO release (idempotent). */
export const applyTempCreditBump = Effect.fnUntraced(function* (
	input: ApplyTempCreditBumpInput,
	ctx: DatabaseContext & { readonly configuration: unknown }
) {
	const account = yield* resolveCreditWriteAccount(ctx.configuration, true);
	if (account === null) return null;
	let amountText = '';
	if (input.bumpAmount != null) {
		const bump = yield* parseDecimal(input.bumpAmount, 'bumpAmount');
		if (BigDecimal.isPositive(bump)) {
			const base =
				input.baseLimit != null
					? yield* parseDecimal(input.baseLimit, 'baseLimit')
					: BigDecimal.fromBigInt(0n);
			amountText = fixedDecimal(BigDecimal.sum(base, bump), 2);
		}
	}
	let daysText = '';
	if (input.bumpDays != null && input.bumpDays > 0) {
		daysText = String(Math.min(3660, Math.max(0, (input.baseDays ?? 0) + input.bumpDays)));
	}
	if (amountText === '' && daysText === '') return null;
	const party = yield* parsePartyId(input.partyCode);
	return yield* executeCreditWrite(
		ctx,
		'temporary credit bump',
		'SELECT, INSERT, UPDATE',
		applyTempCreditBumpSql,
		'@write_account nvarchar(73),@party varchar(20),@amount varchar(40),@credit_days varchar(20)',
		{ write_account: account, party, amount: amountText, credit_days: daysText }
	);
});

/** Deducts a previously applied temporary credit bump back down to the customer's baseline floor (idempotent). */
export const restoreTempCreditBump = Effect.fnUntraced(function* (
	input: RestoreTempCreditBumpInput,
	ctx: DatabaseContext & { readonly configuration: unknown }
) {
	const account = yield* resolveCreditWriteAccount(ctx.configuration, false);
	if (account === null) return null;
	let floorAmountText = '';
	let bumpAmountText = '';
	if (input.bumpAmount != null && input.floorLimit != null) {
		const bump = yield* parseDecimal(input.bumpAmount, 'bumpAmount');
		if (BigDecimal.isPositive(bump)) {
			const floor = yield* parseDecimal(input.floorLimit, 'floorLimit');
			floorAmountText = fixedDecimal(floor, 2);
			bumpAmountText = fixedDecimal(bump, 2);
		}
	}
	let floorDaysText = '';
	let bumpDaysText = '';
	if (input.bumpDays != null && input.bumpDays > 0 && input.floorDays != null) {
		floorDaysText = String(Math.max(0, input.floorDays));
		bumpDaysText = String(input.bumpDays);
	}
	if (bumpAmountText === '' && bumpDaysText === '') return null;
	const party = yield* parsePartyId(input.partyCode);
	return yield* executeCreditWrite(
		ctx,
		'temporary credit restore',
		'SELECT, UPDATE',
		restoreTempCreditBumpSql,
		'@write_account nvarchar(73),@party varchar(20),@floor_amount varchar(40),@bump_amount varchar(40),@floor_days varchar(20),@bump_days varchar(20)',
		{
			write_account: account,
			party,
			floor_amount: floorAmountText,
			bump_amount: bumpAmountText,
			floor_days: floorDaysText,
			bump_days: bumpDaysText
		}
	);
});

/** Writes a raised or reduced credit limit (and/or credit days) directly to Kingdee `ICCreditObject` when opt-in enabled. */
export const writeCustomerCreditLimit = Effect.fnUntraced(function* (
	input: WriteCreditLimitInput,
	ctx: DatabaseContext & { readonly configuration: unknown }
) {
	const account = yield* resolveCreditWriteAccount(ctx.configuration, true);
	if (account === null || (input.limit == null && input.creditDays == null)) return null;
	const party = yield* parsePartyId(input.partyCode);
	let amountText = '';
	if (input.limit != null) {
		const amount = yield* parseDecimal(input.limit, 'credit limit');
		if (BigDecimal.isNegative(amount))
			return yield* invalid('Kingdee credit limit must be nonnegative.');
		amountText = fixedDecimal(amount, 2);
	}
	let daysText = '';
	if (input.creditDays != null) {
		if (!Number.isInteger(input.creditDays) || input.creditDays < 0 || input.creditDays > 3660)
			return yield* invalid('Kingdee credit days must be an integer between 0 and 3660.');
		daysText = String(input.creditDays);
	}
	return yield* executeCreditWrite(
		ctx,
		'credit limit write',
		'SELECT, INSERT, UPDATE',
		writeCreditLimitSql,
		'@write_account nvarchar(73),@party varchar(20),@amount varchar(40),@credit_days varchar(20)',
		{ write_account: account, party, amount: amountText, credit_days: daysText }
	);
});
