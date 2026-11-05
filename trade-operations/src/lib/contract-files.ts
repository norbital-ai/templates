/** A draft selects its files while the order retains every sealed version's native file holders. */
export function selectedContractDocuments<T extends { readonly id: string }>(
	registry: readonly T[] | null | undefined,
	selection: readonly string[] | null | undefined
): readonly T[] {
	const files = registry ?? [];
	if (selection == null) return files;
	const selected = new Set(selection);
	return files.filter((file) => selected.has(file.id));
}

/** Keep sealed files readable under their original upload field without selecting them for the draft. */
export function retainedContractDocuments<T extends { readonly id: string }>(
	sealed: readonly (readonly T[] | null | undefined)[],
	draft: readonly T[]
): readonly T[] {
	const registry = new Map<string, T>();
	for (const file of [...sealed.flatMap((files) => files ?? []), ...draft])
		if (!registry.has(file.id)) registry.set(file.id, file);
	return [...registry.values()];
}
