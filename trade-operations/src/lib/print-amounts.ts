import { BigDecimal } from 'effect';
import { numeric, type Terms } from './commercial.js';

const kilograms = new Set(['kg', 'kgs', '公斤', '千克']);
const tonnes = new Set(['t', 'mt', 'tonne', 'tonnes', '吨', '公吨']);
const digits = '零壹贰叁肆伍陆柒捌玖';
const places = ['', '拾', '佰', '仟'];

/** Financial uppercase CNY, from the retained value in fen. */
export function cnyInWords(total: string) {
	const [, integer, cents = ''] = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(total) ?? [];
	if (integer === undefined) return '';
	const whole = integer.padStart(12, '0');
	const fraction = cents.padEnd(2, '0');
	let result = '';
	let zero = false;
	for (let i = 0; i < whole.length; i++) {
		const digit = Number(whole[i]);
		const position = whole.length - i - 1;
		if (digit) {
			if (zero) result += '零';
			result += digits.charAt(digit) + (places[position % 4] ?? '');
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

/** A decimal string with its integer part grouped and its fraction kept as written. */
const grouped = (value: string) =>
	value.replace(/^(-?\d+)/, (whole) => whole.replace(/\B(?=(\d{3})+$)/g, ','));
const plain = (value: BigDecimal.BigDecimal) => BigDecimal.format(BigDecimal.normalize(value));

export function printAmounts(seal: Terms, locale: 'en' | 'zh' = 'en') {
	const money = new Intl.NumberFormat('en', {
		minimumFractionDigits:
			new Intl.NumberFormat('en', {
				style: 'currency',
				currency: seal.currency
			}).resolvedOptions().maximumFractionDigits ?? 2,
		maximumFractionDigits: 100
	});
	const lines = seal.lines.map((line, index) => {
		const unit = line.unit.trim().toLowerCase();
		// a quotation prints a kilogram line in tonnes: its quantity in tonnes and its price per tonne
		const kilogram = kilograms.has(unit);
		const shown = BigDecimal.fromStringUnsafe(line.unit_price);
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
			line,
			index,
			kilogram,
			shownPrice: BigDecimal.round(
				kilogram ? BigDecimal.multiply(shown, BigDecimal.fromBigInt(1000n)) : shown,
				{ scale: 2, mode: 'half-from-zero' }
			),
			quantity,
			exportUnit,
			gross,
			grossPerTonne:
				perTonne === null ? null : BigDecimal.multiply(gross, BigDecimal.fromNumberUnsafe(perTonne))
		};
	});
	return {
		fields: {
			currency_symbol:
				new Intl.NumberFormat('en', {
					style: 'currency',
					currency: seal.currency,
					currencyDisplay: 'narrowSymbol'
				})
					.formatToParts(0)
					.find((part) => part.type === 'currency')?.value ?? seal.currency,
			quantity_grouped:
				lines.length && new Set(lines.map(({ exportUnit }) => exportUnit)).size === 1
					? new Intl.NumberFormat('en', { maximumFractionDigits: 100 }).format(
							numeric(
								BigDecimal.format(
									BigDecimal.sumAll(
										seal.lines.map((line) => BigDecimal.fromStringUnsafe(line.quantity))
									)
								)
							)
						)
					: '',
			quantity_tonnes: lines.every(({ quantity }) => quantity !== null)
				? new Intl.NumberFormat('en', {
						useGrouping: false,
						minimumFractionDigits: 3,
						maximumFractionDigits: 3
					}).format(
						numeric(
							BigDecimal.format(
								BigDecimal.round(
									BigDecimal.sumAll(lines.flatMap(({ quantity }) => quantity ?? [])),
									{
										scale: 3
									}
								)
							)
						)
					)
				: '',
			total_cny_words: seal.currency === 'CNY' ? cnyInWords(seal.total) : '',
			total_grouped: money.format(numeric(seal.total)),
			net_grouped: money.format(numeric(seal.net)),
			tax_grouped: money.format(numeric(seal.tax))
		},
		lines: lines.map(
			({ line, index, kilogram, shownPrice, quantity, exportUnit, gross, grossPerTonne }) => ({
				line,
				line_number: String(index + 1),
				quantity_display: grouped(
					kilogram
						? plain(
								BigDecimal.divideUnsafe(
									BigDecimal.fromStringUnsafe(line.quantity),
									BigDecimal.fromBigInt(1000n)
								)
							)
						: line.quantity
				),
				unit_display:
					kilogram || line.unit.trim() === '吨' ? (locale === 'zh' ? '吨' : 'MT') : line.unit,
				unit_price_display: new Intl.NumberFormat('en', {
					minimumFractionDigits: 2,
					maximumFractionDigits: 2
				}).format(numeric(BigDecimal.format(shownPrice))),
				tax_rate_display: plain(BigDecimal.fromStringUnsafe(line.tax_rate)),
				quantity_grouped: new Intl.NumberFormat('en', { maximumFractionDigits: 100 }).format(
					numeric(line.quantity)
				),
				unit_export: exportUnit,
				unit_price_grouped: new Intl.NumberFormat('en', {
					minimumFractionDigits: 2,
					maximumFractionDigits: 100
				}).format(numeric(line.unit_price)),
				quantity_tonnes: quantity
					? new Intl.NumberFormat('en', {
							useGrouping: false,
							minimumFractionDigits: 3,
							maximumFractionDigits: 3
						}).format(numeric(BigDecimal.format(quantity)))
					: '',
				gross_unit_price: new Intl.NumberFormat('en', {
					useGrouping: false,
					minimumFractionDigits: 2,
					maximumFractionDigits: 2
				}).format(numeric(BigDecimal.format(BigDecimal.round(gross, { scale: 2 })))),
				gross_unit_price_per_tonne: grossPerTonne
					? new Intl.NumberFormat('en', {
							minimumFractionDigits: 2,
							maximumFractionDigits: 2
						}).format(numeric(BigDecimal.format(BigDecimal.round(grossPerTonne, { scale: 2 }))))
					: '',
				total_grouped: money.format(numeric(line.total)),
				net_grouped: money.format(numeric(line.net)),
				tax_grouped: money.format(numeric(line.tax))
			})
		)
	};
}
