import type { Terms } from './commercial.js';
import { BigDecimal } from 'effect';

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

export function printAmounts(seal: Terms) {
	const money = new Intl.NumberFormat('en', {
		minimumFractionDigits:
			new Intl.NumberFormat('en', {
				style: 'currency',
				currency: seal.currency
			}).resolvedOptions().maximumFractionDigits ?? 2,
		maximumFractionDigits: 100
	});
	const lines = seal.lines.map((line) => {
		const unit = line.unit.trim().toLowerCase();
		const perTonne = kilograms.has(unit) ? 1000 : tonnes.has(unit) ? 1 : null;
		const exportUnit =
			kilograms.has(unit) && unit !== 'kgs' ? 'KGS' : unit === '吨' ? 'MT' : line.unit;
		const quantity =
			perTonne === null
				? null
				: BigDecimal.round(
						BigDecimal.divideUnsafe(
							BigDecimal.fromStringUnsafe(line.quantity),
							BigDecimal.fromNumberUnsafe(perTonne)
						),
						{ scale: 3 }
					);
		const price = BigDecimal.fromStringUnsafe(line.unit_price);
		const gross = seal.tax_inclusive
			? price
			: BigDecimal.multiply(
					price,
					BigDecimal.sum(
						BigDecimal.round(
							BigDecimal.divideUnsafe(
								BigDecimal.fromStringUnsafe(line.tax_rate),
								BigDecimal.fromBigInt(100n)
							),
							{ scale: 4 }
						),
						BigDecimal.fromBigInt(1n)
					)
				);
		return {
			quantity,
			exportUnit,
			gross,
			grossPerTonne:
				perTonne === null ? null : BigDecimal.multiply(gross, BigDecimal.fromNumberUnsafe(perTonne))
		};
	});
	return {
		fields: {
			quantity_grouped:
				lines.length && new Set(lines.map(({ exportUnit }) => exportUnit)).size === 1
					? new Intl.NumberFormat('en', { maximumFractionDigits: 100 }).format(
							BigDecimal.format(
								BigDecimal.sumAll(
									seal.lines.map((line) => BigDecimal.fromStringUnsafe(line.quantity))
								)
							) as Intl.StringNumericLiteral
						)
					: '',
			quantity_tonnes: lines.every(({ quantity }) => quantity !== null)
				? new Intl.NumberFormat('en', {
						useGrouping: false,
						minimumFractionDigits: 3,
						maximumFractionDigits: 3
					}).format(
						BigDecimal.format(
							BigDecimal.round(BigDecimal.sumAll(lines.flatMap(({ quantity }) => quantity ?? [])), {
								scale: 3
							})
						) as Intl.StringNumericLiteral
					)
				: '',
			total_cny_words: seal.currency === 'CNY' ? cnyInWords(seal.total) : '',
			total_grouped: money.format(seal.total as Intl.StringNumericLiteral),
			net_grouped: money.format(seal.net as Intl.StringNumericLiteral),
			tax_grouped: money.format(seal.tax as Intl.StringNumericLiteral)
		},
		lines: lines.map(({ quantity, exportUnit, gross, grossPerTonne }, index) => ({
			quantity_grouped: new Intl.NumberFormat('en', { maximumFractionDigits: 100 }).format(
				seal.lines[index]!.quantity as Intl.StringNumericLiteral
			),
			unit_export: exportUnit,
			unit_price_grouped: new Intl.NumberFormat('en', {
				minimumFractionDigits: 2,
				maximumFractionDigits: 100
			}).format(seal.lines[index]!.unit_price as Intl.StringNumericLiteral),
			quantity_tonnes: quantity
				? new Intl.NumberFormat('en', {
						useGrouping: false,
						minimumFractionDigits: 3,
						maximumFractionDigits: 3
					}).format(BigDecimal.format(quantity) as Intl.StringNumericLiteral)
				: '',
			gross_unit_price: new Intl.NumberFormat('en', {
				useGrouping: false,
				minimumFractionDigits: 2,
				maximumFractionDigits: 2
			}).format(
				BigDecimal.format(BigDecimal.round(gross, { scale: 2 })) as Intl.StringNumericLiteral
			),
			gross_unit_price_per_tonne: grossPerTonne
				? new Intl.NumberFormat('en', {
						minimumFractionDigits: 2,
						maximumFractionDigits: 2
					}).format(
						BigDecimal.format(
							BigDecimal.round(grossPerTonne, { scale: 2 })
						) as Intl.StringNumericLiteral
					)
				: '',
			total_grouped: money.format(seal.lines[index]!.total as Intl.StringNumericLiteral),
			net_grouped: money.format(seal.lines[index]!.net as Intl.StringNumericLiteral),
			tax_grouped: money.format(seal.lines[index]!.tax as Intl.StringNumericLiteral)
		}))
	};
}
