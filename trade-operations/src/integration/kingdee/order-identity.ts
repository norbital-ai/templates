/** Imported orders keep their native UUID, scoped to the verified account set and branch. */
const guid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const imported = new RegExp(`^kingdee:(${guid}/${guid}):([^:]+):(${guid})$`, 'i');
export const importedOrderKey = (account: string, branch: string, uuid: string) =>
	`kingdee:${account.toLowerCase()}:${encodeURIComponent(branch)}:${uuid.toLowerCase()}`;
export function importedOrderIdentity(key: string) {
	const match = imported.exec(key);
	return match
		? { account: match[1]?.toLowerCase(), branch: match[2], uuid: match[3]?.toLowerCase() }
		: null;
}
