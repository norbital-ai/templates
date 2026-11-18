import { Base64 } from 'effect/encoding';

/** The standard signature table is a pair of signing areas, not a data table with a header. */
function signatureLayout(source: string) {
	const blocks = source.trimEnd().split(/\n\s*\n/);
	const table = blocks.at(-1) ?? '';
	const rows = table.split('\n').map((line) =>
		line
			.trim()
			.replace(/^\|\s*|\s*\|$/g, '')
			.split(/(?<!\\)\|/)
			.map((cell) => cell.trim().replace(/\\\|/g, '|'))
	);
	if (
		rows.length !== 5 ||
		rows.some((row) => row.length !== 2) ||
		!rows[0]?.every((cell) => /^(?:\\?_){3,}$/.test(cell)) ||
		!rows[1]?.every((cell) => /^:?-{3,}:?$/.test(cell)) ||
		!rows[2]?.every((cell) => cell.startsWith('Name: ')) ||
		!rows[3]?.every((cell) => cell.startsWith('Title: ')) ||
		!rows[4]?.every((cell) => cell.startsWith('For and on behalf of '))
	)
		return { body: source, signatures: null };
	blocks.pop();
	const introduction = blocks.at(-1)?.startsWith('Agreed by ') ? (blocks.pop() ?? '') : '';
	return {
		body: blocks.join('\n\n'),
		signatures: {
			introduction,
			parties: [0, 1].map((column) => rows.slice(2).map((row) => row[column] ?? ''))
		}
	};
}

export function documentLayout(source: string) {
	const blocks = source.split(/\n\s*\n/);
	if (blocks.length >= 4 && /^C&A:/i.test(blocks[0] ?? '') && /^# /.test(blocks[3] ?? ''))
		return {
			cover: {
				date: blocks[0] ?? '',
				provider: blocks[1] ?? '',
				company: blocks[2] ?? '',
				title: (blocks[3] ?? '').replace(/^# /, '')
			},
			...signatureLayout(blocks.slice(4).join('\n\n'))
		};
	return { cover: null, ...signatureLayout(source) };
}

/** Native PDF conversion uses Pandoc/Typst; apply the agreement's original paper and cover without changing clauses. */
export function documentForPdf(source: string, signature?: { mime: string; bytes: Uint8Array }) {
	const document = documentLayout(source);
	const text = (value: string) => JSON.stringify(value.replace(/^\*\*(.*)\*\*$/s, '$1'));
	const cover = document.cover;
	const layout = [
		'#set page(paper: "a4", margin: 25.4mm)',
		'#set text(font: "DejaVu Sans", size: 10pt)',
		'#set par(justify: false, leading: 2pt, spacing: 10pt)',
		'#show heading: set text(size: 10pt, weight: "bold")',
		...(cover === null
			? []
			: [
					`#place(top + right, text(size: 8pt, ${text(cover.date)}))`,
					`#place(top + center, dy: 55.6mm, text(${text(cover.provider)}))`,
					`#place(top + center, dy: 88.6mm, text(${text(cover.company)}))`,
					`#place(top + center, dy: 131.6mm, text(weight: "bold", ${text(cover.title)}))`,
					'#pagebreak()'
				])
	].join('\n');
	const raw = (value: string) => '```{=typst}\n' + value + '\n```';
	const signing = document.signatures;
	const footer =
		signing === null
			? ''
			: [
					raw(
						'#block(breakable: false)[\n' +
							(signing.introduction ? `#text(${text(signing.introduction)})\n#v(6mm)\n` : '') +
							'#grid(columns: (1fr, 1fr), column-gutter: 12mm, [\n#block(height: 24mm)['
					),
					...(signature
						? [`![](data:${signature.mime};base64,${Base64.encode(signature.bytes)}){height=22mm}`]
						: []),
					raw(
						']\n#line(length: 80%, stroke: 0.5pt)\n#v(3mm)\n' +
							signing.parties[0]?.map((line) => `#text(${text(line)})`).join('\n#v(2mm)\n') +
							'\n], [\n#block(height: 24mm)[]\n#line(length: 80%, stroke: 0.5pt)\n#v(3mm)\n' +
							signing.parties[1]?.map((line) => `#text(${text(line)})`).join('\n#v(2mm)\n') +
							'\n])\n]'
					)
				].join('\n\n');
	return raw(layout) + '\n\n' + document.body + (footer ? '\n\n' + footer : '');
}
