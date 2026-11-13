import { BigDecimal } from 'effect';
import { dec, div, round, sum, text } from './values.js';
import type { Row } from '@norbital-ai/bolt';

type Seal = NonNullable<Row<'orders'>['sealed_snapshot']>;
const kilograms = new Set(['kg', 'kgs', '公斤', '千克']);
const tonnes = new Set(['t', 'mt', 'tonne', 'tonnes', '吨', '公吨']);
const digits = '零壹贰叁肆伍陆柒捌玖';
const places = ['', '拾', '佰', '仟'];

/** Financial uppercase CNY, from the retained value in fen. */
export function cnyInWords(total: string) {
	const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(total);
	if (!match) return '';
	const whole = match[1]!.padStart(12, '0');
	const fraction = (match[2] ?? '').padEnd(2, '0');
	let result = '';
	let zero = false;
	for (let i = 0; i < whole.length; i++) {
		const digit = Number(whole[i]);
		const position = whole.length - i - 1;
		if (digit) {
			if (zero) result += '零';
			result += digits[digit] + places[position % 4]!;
		}
		zero = digit === 0 && result !== '';
		if (position % 4 === 0 && /[1-9]/.test(whole.slice(i - 3, i + 1)))
			result += ['', '万', '亿'][position / 4];
	}
	const jiao = Number(fraction[0]);
	const fen = Number(fraction[1]);
	if (!result && !jiao && !fen) return '零元整';
	const yuan = result ? result + '元' : '';
	const jiaoText = jiao ? digits[jiao] + '角' : '';
	const fenText = fen ? (yuan && !jiao ? '零' : '') + digits[fen] + '分' : '整';
	return yuan + jiaoText + fenText;
}

export const grouped = (value: string) =>
	value.replace(/^-?\d+/, (whole) => whole.replace(/\B(?=(\d{3})+$)/g, ','));

function groupedWithPrecision(value: string, minimum: number) {
	const [whole = '', fraction = ''] = value.split('.');
	const retained = fraction.replace(/0+$/, '').padEnd(minimum, '0');
	return grouped(retained ? `${whole}.${retained}` : whole);
}

export function printAmounts(seal: Seal) {
	const lines = seal.lines.map((line) => {
		const unit = line.unit.trim().toLowerCase();
		const perTonne = kilograms.has(unit) ? 1000 : tonnes.has(unit) ? 1 : null;
		const exportUnit =
			kilograms.has(unit) && unit !== 'kgs' ? 'KGS' : unit === '吨' ? 'MT' : line.unit;
		const quantity = perTonne === null ? null : div(line.quantity, perTonne, 3);
		const price = dec(line.unit_price);
		const gross = seal.tax_inclusive
			? price
			: BigDecimal.multiply(price, BigDecimal.sum(div(line.tax_rate, 100, 4), dec(1)));
		return {
			quantity,
			exportUnit,
			gross,
			grossPerTonne: perTonne === null ? null : BigDecimal.multiply(gross, dec(perTonne))
		};
	});
	return {
		fields: {
			quantity_grouped:
				lines.length && new Set(lines.map(({ exportUnit }) => exportUnit)).size === 1
					? groupedWithPrecision(text(sum(seal.lines.map((line) => line.quantity))), 0)
					: '',
			quantity_tonnes: lines.every(({ quantity }) => quantity !== null)
				? text(round(sum(lines.flatMap(({ quantity }) => quantity ?? [])), 3))
				: '',
			total_cny_words: seal.currency === 'CNY' ? cnyInWords(seal.total) : '',
			total_grouped: grouped(seal.total),
			net_grouped: grouped(seal.net),
			tax_grouped: grouped(seal.tax)
		},
		lines: lines.map(({ quantity, exportUnit, gross, grossPerTonne }, index) => ({
			quantity_grouped: groupedWithPrecision(seal.lines[index]!.quantity, 0),
			unit_export: exportUnit,
			unit_price_grouped: groupedWithPrecision(seal.lines[index]!.unit_price, 2),
			quantity_tonnes: quantity ? text(quantity) : '',
			gross_unit_price: text(round(gross, 2)),
			gross_unit_price_per_tonne: grossPerTonne ? grouped(text(round(grossPerTonne, 2))) : '',
			total_grouped: grouped(seal.lines[index]!.total),
			net_grouped: grouped(seal.lines[index]!.net),
			tax_grouped: grouped(seal.lines[index]!.tax)
		}))
	};
}
