import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
	if (specifier.endsWith('.js') && (specifier.startsWith('./') || specifier.startsWith('../'))) {
		const base = new URL(specifier, context.parentURL);
		const ts = fileURLToPath(base).replace(/\.js$/, '.ts');
		if (existsSync(ts)) return next(specifier.replace(/\.js$/, '.ts'), context);
	}
	return next(specifier, context);
}
