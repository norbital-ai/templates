import type { FileRef } from '@norbital-ai/bolt';

export const MAX_INFERENCE_REASON_CHARS = 600;
export const MAX_ASSET_NAME_CHARS = 256;

export const clipText = (value: string, maximum: number): string =>
	value.length <= maximum ? value : `${value.slice(0, maximum - 12)}…[clipped]`;

export const assetName = (photo: { readonly photo: FileRef }) =>
	clipText(photo.photo.name, MAX_ASSET_NAME_CHARS);
