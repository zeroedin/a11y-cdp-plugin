---
"a11y-cdp-plugin": minor
---

`a11ySnapshotPlugin()`: initial release. 

Web Test Runner plugin that fetches the Chrome accessibility tree via CDP, replacing Playwright's deprecated `page.accessibility.snapshot()` API. Calls `Accessibility.getFullAXTree` directly over a CDP session, producing the same `SerializedAXNode` tree shape. Supports scoping snapshots to a subtree via a CSS selector.
