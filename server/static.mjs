export const ASSETS = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/briefs.js": ["briefs.js", "text/javascript; charset=utf-8"],
  "/theme.js": ["theme.js", "text/javascript; charset=utf-8"],
  "/favicon.svg": ["favicon.svg", "image/svg+xml"],
  "/source-sans.woff2": ["source-sans.woff2", "font/woff2"],
  "/spectral-regular.woff2": ["spectral-regular.woff2", "font/woff2"],
  "/spectral-semibold.woff2": ["spectral-semibold.woff2", "font/woff2"],
  "/OFL-SourceSans3.txt": ["OFL-SourceSans3.txt", "text/plain; charset=utf-8"],
  "/OFL-Spectral.txt": ["OFL-Spectral.txt", "text/plain; charset=utf-8"],
};

export function assetHeaders(path, type) {
  return {
    "Content-Type": type,
    "Cache-Control": path === "/" ? "no-cache" : "public, max-age=900",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
  };
}
