# a11y-cdp-plugin

A [Web Test Runner](https://modern-web.dev/docs/test-runner/overview/) plugin that fetches the Chrome accessibility tree directly via the [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) (CDP).

## Why this plugin?

Playwright's `page.accessibility.snapshot()` API was deprecated in v1.25 and removed in v1.57. While it nominally supported Firefox and WebKit, the tree output [varied significantly across engines](https://github.com/microsoft/playwright/issues/16159), making cross-browser snapshot assertions unreliable in practice. This plugin provides a drop-in alternative that talks directly to Chrome's `Accessibility.getFullAXTree` CDP method — the same stable, Chrome-versioned protocol Playwright used under the hood for Chromium. The tree construction and "interesting node" filtering logic is adapted from Playwright's own `CRAXNode` internals ([source](https://cdn.jsdelivr.net/npm/playwright-core@1.48.0/lib/server/chromium/crAccessibility.js)), so snapshot output stays consistent with what `page.accessibility.snapshot()` used to return.

> **Chromium only.** Programmatic accessibility-tree access currently requires CDP, which is only available in Chromium-based browsers. Puppeteer faces the same limitation — its Firefox support runs over WebDriver BiDi, which [does not yet include an accessibility module](https://github.com/w3c/webdriver-bidi/issues/443), and WebKit is not supported at all. In practice, Chromium is the only engine with reliable, programmatic access to the full accessibility tree.

## Install

```bash
npm install a11y-cdp-plugin
```

### Peer dependencies

This plugin requires a Playwright-backed Web Test Runner setup:

- `@web/test-runner-core` >= 0.11.0
- `@web/test-runner-playwright` >= 0.9.0

## Usage

### Register the plugin

Add the plugin to your Web Test Runner config:

```js
// web-test-runner.config.js
import { a11ySnapshotPlugin } from 'a11y-cdp-plugin';
import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  browsers: [playwrightLauncher({ product: 'chromium' })],
  plugins: [a11ySnapshotPlugin()],
};
```

### Take snapshots in tests

Use the `executeServerCommand` helper from `@web/test-runner-commands` to request a snapshot:

```js
import { executeServerCommand } from '@web/test-runner-commands';

it('has an accessible name', async () => {
  const snapshot = await executeServerCommand('a11y-snapshot');
  // snapshot is a SerializedAXNode tree
});
```

#### Scoping to a subtree

Pass a CSS `selector` to root the snapshot at a specific element:

```js
const snapshot = await executeServerCommand('a11y-snapshot', {
  selector: '#my-component',
});
```

### Snapshot shape

The returned tree matches the `SerializedAXNode` interface — the same shape Playwright's old `page.accessibility.snapshot()` produced:

```ts
interface SerializedAXNode {
  role: string;
  name: string;
  value?: string | number;
  children?: SerializedAXNode[];
  description?: string;
  disabled?: boolean;
  expanded?: boolean;
  focused?: boolean;
  checked?: boolean | 'mixed';
  pressed?: boolean | 'mixed';
  level?: number;
  // … and more boolean / string / numeric a11y properties
}
```

## How it works

1. The plugin opens a CDP session on the Playwright page.
2. It calls `Accessibility.getFullAXTree` to retrieve every node in the accessibility tree.
3. It builds an in-memory tree using the same `CRAXNode` logic Playwright uses internally.
4. If a `selector` is provided, it resolves the element via `DOM.querySelector` / `DOM.describeNode` and roots the tree at that node.
5. "Interesting" nodes are collected (controls, focusable elements, named leaves) and the tree is serialized, filtering out noise — identical to Playwright's old behavior.

## License

Apache-2.0
