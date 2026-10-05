/** The app's own version. A packaged build and the container both ship this package.json. */
export function appVersion(): string {
  try {
    const pkg = require('../../package.json') as { version?: string };
    if (pkg?.version) return String(pkg.version);
  } catch {
    // Tests that load the module without the repo package still get a version string.
  }
  return '0.0.0';
}
