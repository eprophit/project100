/**
 * Lets plain `node` run the `src/lib` modules directly.
 *
 * The source uses extensionless relative imports because that's what the Next
 * bundler expects; Node's ESM resolver requires an extension. This hook retries
 * failed relative specifiers with `.ts`, and maps the `@/` alias, so the
 * smoke-test scripts can import application code without a build step.
 */
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = pathToFileURL(path.join(process.cwd(), 'src') + path.sep).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      specifier = new URL(specifier.slice(2), root).href;
    }

    const hasExtension = /\.[cm]?[jt]sx?$/.test(specifier);
    if (!hasExtension && (specifier.startsWith('.') || specifier.startsWith('file:'))) {
      for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
        try {
          return nextResolve(candidate, context);
        } catch {
          // fall through to the next candidate
        }
      }
    }

    return nextResolve(specifier, context);
  },
});
