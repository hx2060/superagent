import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const port = Number(process.env.PORT) || 4173;

// Content directory backing `/local/*` requests. The local instance serves
// the real `local/` content; the test instance points at a directory of
// generated examples (see scripts/gen-examples.mjs) so the two ports differ
// only in content, never in code.
const contentFlagIndex = process.argv.indexOf('--content');
const contentDir = resolve(
  root,
  contentFlagIndex > 0 && process.argv[contentFlagIndex + 1]
    ? process.argv[contentFlagIndex + 1]
    : 'local'
);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/**
 * Map a request path to a file inside one of the served roots.
 *
 * - `/local/**` is served from the content directory (default `local/`), so a
 *   test instance never exposes the real local content.
 * - Everything else is served from the repository root.
 * - Dot-prefixed segments (`.git`, `.env`, …) are refused.
 *
 * @param {string} base absolute directory the path must stay inside
 * @param {string} pathname decoded request path
 * @returns {string|null} absolute file path, or null when refused
 */
export function resolveFilePath(base, pathname) {
  const requested = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  if (requested.split('/').some((segment) => segment.startsWith('.'))) return null;
  const filePath = normalize(join(base, requested));
  if (filePath !== base && !filePath.startsWith(`${base}${sep}`)) return null;
  return filePath;
}

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const isContent = pathname === '/local' || pathname.startsWith('/local/');
  const base = isContent ? contentDir : root;
  const relative = isContent ? pathname.slice('/local'.length) || '/' : pathname;
  const filePath = resolveFilePath(base, relative);

  if (!filePath) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      response.writeHead(302, { Location: `${pathname}/` }).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

// Only start listening when executed directly, so tests can import the pure
// path mapping without binding a port.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(port, '127.0.0.1', () => {
    console.log(`日程 demo running at http://127.0.0.1:${port}`);
    console.log(`内容目录（/local/*）：${contentDir}`);
  });
}
