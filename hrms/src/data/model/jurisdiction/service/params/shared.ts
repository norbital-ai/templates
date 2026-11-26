import { Schema } from 'effect';

export const empty = Schema.Struct({});
export const num = Schema.Number;
export const str = Schema.String;
export const bool = Schema.Boolean;
export const opt = Schema.optional;
export const arr = Schema.Array;
export const struct = Schema.Struct;
export const optNum = opt(num);
export const optStr = opt(str);
export const optBool = opt(bool);
export const strArr = arr(str);
export const numArr = arr(num);
export const upTo = Schema.Union([Schema.Null, num]);

export const rateBands = arr(struct({ rate: num, up_to: upTo }));
export const amountBrackets = arr(struct({ amount: num, up_to: upTo }));
export const amountBands = arr(struct({ amount: num, up_to: num }));
export const offsetBands = arr(struct({ offset: num, rate: num, up_to: upTo }));
export const excessBands = arr(struct({ base: num, from: num, rate: num }));
export const serviceBands = arr(struct({ days: num, service_months: num }));
export const daysByRegion = arr(struct({ days: num, region: str }));
export const paidShareByRegion = arr(struct({ region: str, share: num }));
export const paySteps = arr(struct({ unpaid_share: num, until_month: upTo }));
export const leaveAccounts = arr(struct({ account: str, code: str, measure: str }));
export const accountPosts = struct({
	accounts: arr(struct({ account: str, code: str, measure: str, operation: str }))
});

export const belowZero = struct({ below_zero: str });
export const rateOnly = struct({ rate: num });
export const employerRateOnly = struct({ employer_rate: num });
export const daysOnly = struct({ days: num });
export const monthsOnly = struct({ months: num });
export const grantWindow = struct({ grant_days: num, window: str });

export const mapOf = <S extends Schema.Top>(
	codes: readonly string[],
	schema: S
): Readonly<Record<string, S>> => Object.fromEntries(codes.map((code) => [code, schema]));
