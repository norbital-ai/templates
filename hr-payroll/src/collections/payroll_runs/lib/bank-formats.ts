/**
 * Per-bank payment files.
 *
 * A bank file is a contract with one bank, not a generic listing: the layout, the originator
 * header, the amount encoding and even the name are that bank's. The generic CSV this module
 * replaces was uploadable nowhere. Each supported bank gets an exact formatter here, held in a
 * registry and chosen by the originator account's `bank_code` (the payer's BIC), because the file
 * is uploaded to the payer's bank and it is the payer's format that governs.
 *
 * A new method is one registry entry: `matches` picks the payer it governs, `build` writes the
 * bytes. A payer no method matches yields `null`; the caller keeps the generic CSV rather than
 * emitting a fixed-width file the bank would reject.
 */

import { Schema } from 'effect';

const trimmed = Schema.Trimmed.check(Schema.isMinLength(1));
export const payerAccountSchema = Schema.Struct({
	bank_name: trimmed,
	bank_code: trimmed,
	bank_account_number: trimmed,
	bank_account_name: trimmed
});
export type PayerAccount = Schema.Schema.Type<typeof payerAccountSchema>;

type BankPayment = Readonly<{
	employeeNumber: string;
	currency: string;
	net: number;
	bank: Readonly<{
		account_name: string;
		bank_code: string;
		bank_name: string;
		account_number: string;
	}>;
}>;

type BankFileRequest = Readonly<{
	/** ISO calendar day the money leaves, `YYYY-MM-DD`. */
	payDate: string;
	period: string;
	payer: PayerAccount;
	payments: readonly BankPayment[];
	/** The bank file's own sequence field; the Velocity spec states its source, which we do not hold. */
	fileSequence?: string;
}>;

type BankFile = Readonly<{
	name: string;
	/**
	 * The media label the client turns into a blob type. The format itself, extension included,
	 * is `name`: the client writes the attachment under exactly that name and appends nothing.
	 */
	contentType: 'CSV' | 'TEXT';
	content: string | (string | number)[][];
	/** Which formatter produced it, and the manifest's `bank_format`; `generic` is the fallback listing. */
	format: string;
}>;

/** One bank's payment-file method: the payers it governs and the bytes it writes. */
type BankFileMethod = Readonly<{
	/** Stable id, also reported by the built file as its `format`. */
	id: string;
	matches: (payer: PayerAccount) => boolean;
	build: (request: BankFileRequest) => BankFile;
}>;

const digitsOnly = (value: string): string => value.replace(/\D/g, '');

/** A numeric account number, separators allowed, refusing anything normalising would rewrite. */
const accountDigits = (value: string, what: string): string => {
	if (!/^[\d\s-]+$/.test(value)) throw new Error(`${what} is not a numeric account: ${value}`);
	return digitsOnly(value);
};

/** `YYYY-MM-DD` to `YYYYMMDD`, refusing anything that is not a day. */
const compactDate = (iso: string): string => {
	const compact = digitsOnly(iso);
	if (compact.length !== 8) throw new Error(`Not a calendar day: ${iso}`);
	return compact;
};

/** `YYYY-MM-DD` to `DDMMYYYY`. */
const dayMonthYear = (iso: string): string => {
	const [year, month, day] = iso.split('-');
	if (year === undefined || month === undefined || day === undefined)
		throw new Error(`Not a calendar day: ${iso}`);
	return `${day}${month}${year}`;
};

/**
 * OCBC Velocity FAST, as its own upload files spell it: 1000-character fixed-width records, a `3`
 * originator header carrying the payer BIC and account, then one `D` detail per payment with the
 * receiving BIC, a nine-digit account, the beneficiary name, a 17-digit zero-padded amount in
 * cents, and the `SALA` transaction code. Field offsets are taken from the bank's own files.
 *
 * The file ends with the 100-character blank trailer the bank's generator writes: three spaces, a
 * newline, then 97 more, and no trailing newline. Its blank fields are the totals the generator
 * leaves unfilled, and it is reproduced because every reference file carries it.
 */
const OCBC_HEADER_LENGTH = 1_000;
const OCBC_BIC_LENGTH = 11;
const OCBC_FAST_FLAG_AT = 205;
const OCBC_PROCESSING_DATE_AT = 225;
const OCBC_DETAIL_NAME_AT = 45;
const OCBC_DETAIL_AMOUNT_AT = 188;
const OCBC_DETAIL_CODE_AT = 240;
const OCBC_ACCOUNT_DIGITS = 9;
const OCBC_AMOUNT_DIGITS = 17;
const OCBC_TRAILER = `   \n${' '.repeat(97)}`;

/** A payer's BIC, refusing one that would shift every field after it. */
const bic = (value: string, what: string): string => {
	const code = value.trim();
	if (code.length !== OCBC_BIC_LENGTH)
		throw new Error(`${what} is not an ${OCBC_BIC_LENGTH}-character BIC: ${value}`);
	return code;
};

export function ocbcFastFile(request: BankFileRequest): BankFile {
	const payer = request.payer;
	const payerBic = bic(payer.bank_code, 'Originator bank code');
	if (!payerBic.startsWith('OCBCSG')) throw new Error(`Not an OCBC originator: ${payer.bank_code}`);
	const sequence = (request.fileSequence ?? '0001').padStart(4, '0').slice(-4);
	const valueDate = compactDate(request.payDate);
	const payerAccount = accountDigits(payer.bank_account_number, 'Originator account number');
	const headerCore = `3${sequence}${valueDate}${payerBic}${payerAccount}`;
	let header = headerCore.padEnd(OCBC_FAST_FLAG_AT, ' ');
	header += 'FAST'.padEnd(OCBC_PROCESSING_DATE_AT - OCBC_FAST_FLAG_AT, ' ');
	header = header.padEnd(OCBC_PROCESSING_DATE_AT, ' ');
	header += dayMonthYear(request.payDate);

	const lines = [header.padEnd(OCBC_HEADER_LENGTH, ' ')];
	for (const payment of request.payments) {
		const receivingBic = bic(payment.bank.bank_code, `Bank code for ${payment.employeeNumber}`);
		const account = accountDigits(
			payment.bank.account_number,
			`Account number for ${payment.employeeNumber}`
		).padStart(OCBC_ACCOUNT_DIGITS, '0');
		const beneficiary = `${receivingBic}${account}`.padEnd(OCBC_DETAIL_NAME_AT, ' ');
		const name = payment.bank.account_name
			.slice(0, OCBC_DETAIL_AMOUNT_AT - OCBC_DETAIL_NAME_AT)
			.padEnd(OCBC_DETAIL_AMOUNT_AT - OCBC_DETAIL_NAME_AT, ' ');
		const amount = Math.round(payment.net * 100)
			.toString()
			.padStart(OCBC_AMOUNT_DIGITS, '0');
		let line = `${beneficiary}${name}${amount}`;
		line = line.padEnd(OCBC_DETAIL_CODE_AT, ' ');
		line += 'SALA';
		lines.push(line.padEnd(OCBC_HEADER_LENGTH, ' '));
	}
	return {
		name: `ocbc_fast_${valueDate}.txt`,
		contentType: 'TEXT',
		content: `${lines.join('\n')}\n${OCBC_TRAILER}`,
		format: 'ocbc-fast'
	};
}

/** Every method this build knows, tried in order; the first whose `matches` holds governs. */
const BANK_FILE_METHODS: readonly BankFileMethod[] = [
	{
		id: 'ocbc-fast',
		matches: (payer) => payer.bank_code.slice(0, 6).toUpperCase() === 'OCBCSG',
		build: ocbcFastFile
	}
];

/** The method that governs this payer, or `null` when none does — the caller keeps the generic CSV. */
export const bankFileFor = (request: BankFileRequest): BankFile | null => {
	const method = BANK_FILE_METHODS.find((candidate) => candidate.matches(request.payer));
	return method === undefined ? null : method.build(request);
};
