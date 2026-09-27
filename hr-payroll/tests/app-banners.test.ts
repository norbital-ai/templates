// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Every app the workspace ships states its card banner, and the banner is a shipped asset. The kiosk renders
 * chromeless and never appears on the overview, so it needs no card image.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src/app/', import.meta.url));
const apps = readdirSync(src, { recursive: true })
	.map(String)
	.filter((path) => path.endsWith('+app.ts'));

test('every carded app names an app-media banner the template ships', async () => {
	assert.ok(apps.length > 0);
	for (const path of apps) {
		const { name, spec } = (await import(`${src}${path}`)).default;
		if (name === 'hr_controller/kiosk') continue;
		assert.match(
			spec.banner ?? '',
			/^app-media\/[\w.-]+\.webp$/,
			`${name} has no app-media banner`
		);
		assert.ok(
			existsSync(fileURLToPath(new URL(`../assets/${spec.banner}`, import.meta.url))),
			`${name}: ${spec.banner} is not shipped`
		);
	}
});
