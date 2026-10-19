/**
 * Resolves a public `/data/...` asset URL against Vite's `import.meta.env.BASE_URL`
 * so the site works seamlessly on both root domains (`/`) and GitHub Pages subpaths (`/<repo-name>/`).
 */
export function resolveAssetUrl(path: string | null | undefined): string {
  if (!path) return '';
  if (path.startsWith('/data/')) {
    const base = import.meta.env.BASE_URL || '/';
    const cleanBase = base.endsWith('/') ? base : `${base}/`;
    return `${cleanBase}${path.slice(1)}`;
  }
  return path;
}
