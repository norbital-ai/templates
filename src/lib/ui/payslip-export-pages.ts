import { Schema } from 'effect';

const pageSchema = Schema.Struct({
	artefacts: Schema.Array(
		Schema.Struct({
			files: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String }))
		})
	),
	next_payslip_offset: Schema.NullOr(Schema.Int)
});
export type PayslipExportFile = { readonly id: string; readonly name: string };

/** One click follows bounded server pages; only persisted references accumulate in the browser. */
export async function collectPayslipPages(
	fetchPage: (offset: number) => Promise<unknown>,
	onPage: (files: readonly PayslipExportFile[]) => void = () => {}
): Promise<readonly PayslipExportFile[]> {
	const files: PayslipExportFile[] = [];
	let offset = 0;
	while (true) {
		const page = Schema.decodeUnknownSync(pageSchema)(await fetchPage(offset));
		const added = page.artefacts.flatMap((artefact) => artefact.files);
		if (added.length > 5) throw new Error('Payslip export exceeded its bounded page.');
		files.push(...added);
		onPage([...files]);
		if (page.next_payslip_offset == null) return files;
		if (page.next_payslip_offset <= offset)
			throw new Error('Payslip export continuation did not advance.');
		offset = page.next_payslip_offset;
	}
}
