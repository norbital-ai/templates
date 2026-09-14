/**
 * Per-bank payment files.
 *
 * A bank file is a contract with one bank, not a generic listing: the layout, the originator
 * header, the amount encoding and even the name are that bank's. The generic CSV this module
 * replaces was uploadable nowhere. Each supported bank gets an exact formatter here, chosen by the
 * originator account's `bank_code` (the payer's BIC), because the file is uploaded to the payer's
 * bank and it is the payer's format that governs.
 *
 * A payer whose bank has no formatter yields `null`; the caller keeps the generic CSV rather than
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
	contentType: 'CSV' | 'TEXT';
	content: string | (string | number)[][];
	/** Which formatter produced it; `generic` is the fallback instruction listing. */
	format: string;
}>;

const digitsOnly = (value: string): string => value.replace(/\D/g, '');

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
 */
const OCBC_HEADER_LENGTH = 1_000;
const OCBC_FAST_FLAG_AT = 205;
const OCBC_PROCESSING_DATE_AT = 225;
const OCBC_DETAIL_NAME_AT = 45;
const OCBC_DETAIL_AMOUNT_AT = 188;
const OCBC_DETAIL_CODE_AT = 240;
const OCBC_ACCOUNT_DIGITS = 9;
const OCBC_AMOUNT_DIGITS = 17;

export function ocbcFastFile(request: BankFileRequest): BankFile {
	const payer = request.payer;
	if (!payer.bank_code.startsWith('OCBCSG'))
		throw new Error(`Not an OCBC originator: ${payer.bank_code}`);
	const sequence = (request.fileSequence ?? '0001').padStart(4, '0').slice(-4);
	const valueDate = compactDate(request.payDate);
	const headerCore = `3${sequence}${valueDate}${payer.bank_code}${payer.bank_account_number}`;
	let header = headerCore.padEnd(OCBC_FAST_FLAG_AT, ' ');
	header += 'FAST'.padEnd(OCBC_PROCESSING_DATE_AT - OCBC_FAST_FLAG_AT, ' ');
	header = header.padEnd(OCBC_PROCESSING_DATE_AT, ' ');
	header += dayMonthYear(request.payDate);

	const lines = [header.padEnd(OCBC_HEADER_LENGTH, ' ')];
	for (const payment of request.payments) {
		const account = digitsOnly(payment.bank.account_number).padStart(OCBC_ACCOUNT_DIGITS, '0');
		const beneficiary = `${payment.bank.bank_code}${account}`.padEnd(OCBC_DETAIL_NAME_AT, ' ');
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
		content: `${lines.join('\n')}\n`,
		format: 'ocbc-fast'
	};
}

/** OCBC Singapore is the one bank this build formats for; any other payer keeps the generic listing. */
export const bankFileFor = (request: BankFileRequest): BankFile | null =>
	request.payer.bank_code.slice(0, 6).toUpperCase() === 'OCBCSG' ? ocbcFastFile(request) : null;
