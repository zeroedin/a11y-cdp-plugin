import { playwrightLauncher } from '@web/test-runner-playwright';
import { a11ySnapshotPlugin } from './a11y-cdp-plugin.js';

export default {
  nodeResolve: true,
  files: 'test/**/*.test.js',
  browsers: [playwrightLauncher({ product: 'chromium' })],
  plugins: [a11ySnapshotPlugin()],
};
