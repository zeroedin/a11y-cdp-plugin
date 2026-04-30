/**
 * Custom WTR plugin that fetches the accessibility tree via CDP directly,
 * replacing the deprecated `page.accessibility.snapshot()` API.
 *
 * Tree construction and "interesting node" filtering logic adapted from
 * Playwright's CRAXNode in crAccessibility.ts (Apache-2.0):
 * https://cdn.jsdelivr.net/npm/playwright-core@1.48.0/lib/server/chromium/crAccessibility.js
 *
 * @license Apache-2.0
 */

import type { TestRunnerPlugin } from '@web/test-runner-core';
import type { PlaywrightLauncher } from '@web/test-runner-playwright';

// ---------------------------------------------------------------------------
// CDP Accessibility types (subset of devtools-protocol)
// ---------------------------------------------------------------------------

export interface CDPAXValue {
  type: string;
  value?: unknown;
}

export interface CDPAXProperty {
  name: string;
  value: CDPAXValue;
}

export interface CDPAXNode {
  nodeId: string;
  ignored: boolean;
  role?: CDPAXValue;
  name?: CDPAXValue;
  value?: CDPAXValue;
  description?: CDPAXValue;
  properties?: CDPAXProperty[];
  childIds?: string[];
  backendDOMNodeId?: number;
}

// ---------------------------------------------------------------------------
// Serialized snapshot shape – matches what Playwright's old
// page.accessibility.snapshot() returned, which is what the existing
// A11yTreeSnapshot interface in a11y-snapshot.ts expects.
// ---------------------------------------------------------------------------

export interface SerializedAXNode {
  role: string;
  name: string;
  value?: string | number;
  children?: SerializedAXNode[];
  description?: string;
  keyshortcuts?: string;
  roledescription?: string;
  valuetext?: string;
  disabled?: boolean;
  expanded?: boolean;
  focused?: boolean;
  modal?: boolean;
  multiline?: boolean;
  multiselectable?: boolean;
  readonly?: boolean;
  required?: boolean;
  selected?: boolean;
  checked?: boolean | 'mixed';
  pressed?: boolean | 'mixed';
  level?: number;
  valuemin?: number;
  valuemax?: number;
  autocomplete?: string;
  haspopup?: string;
  invalid?: string;
  orientation?: string;
}

// ---------------------------------------------------------------------------
// CRAXNode – internal tree representation (mirrors Playwright's CRAXNode)
// ---------------------------------------------------------------------------

export class CRAXNode {
  readonly payload: CDPAXNode;
  children: CRAXNode[] = [];

  #richlyEditable = false;
  #editable = false;
  #focusable = false;
  #hidden = false;
  #name: string;
  #role: string;
  #cachedHasFocusableChild?: boolean;

  constructor(payload: CDPAXNode) {
    this.payload = payload;
    this.#name = payload.name?.value as string ?? '';
    this.#role = payload.role?.value as string ?? 'Unknown';
    for (const property of payload.properties ?? []) {
      if (property.name === 'editable') {
        this.#richlyEditable = property.value.value === 'richtext';
        this.#editable = true;
      }
      if (property.name === 'focusable') {
        this.#focusable = property.value.value as boolean;
      }
      if (property.name === 'hidden') {
        this.#hidden = property.value.value as boolean;
      }
    }
  }

  #isPlainTextField(): boolean {
    if (this.#richlyEditable) {
      return false;
    }
    if (this.#editable) {
      return true;
    }
    return (
      this.#role === 'textbox'
      || this.#role === 'ComboBox'
      || this.#role === 'searchbox'
    );
  }

  #isTextOnlyObject(): boolean {
    const role = this.#role;
    return (
      role === 'LineBreak'
      || role === 'text'
      || role === 'InlineTextBox'
      || role === 'StaticText'
    );
  }

  #hasFocusableChild(): boolean {
    if (this.#cachedHasFocusableChild === undefined) {
      this.#cachedHasFocusableChild = false;
      for (const child of this.children) {
        if (child.#focusable || child.#hasFocusableChild()) {
          this.#cachedHasFocusableChild = true;
          break;
        }
      }
    }
    return this.#cachedHasFocusableChild;
  }

  find(predicate: (x: CRAXNode) => boolean): CRAXNode | null {
    if (predicate(this)) {
      return this;
    }
    for (const child of this.children) {
      const result = child.find(predicate);
      if (result) {
        return result;
      }
    }
    return null;
  }

  isLeafNode(): boolean {
    if (!this.children.length) {
      return true;
    }
    if (this.#isPlainTextField() || this.#isTextOnlyObject()) {
      return true;
    }
    switch (this.#role) {
      case 'doc-cover':
      case 'graphics-symbol':
      case 'img':
      case 'Meter':
      case 'scrollbar':
      case 'slider':
      case 'separator':
      case 'progressbar':
        return true;
      default:
        break;
    }
    if (this.#hasFocusableChild()) {
      return false;
    }
    if (this.#focusable && this.#role !== 'WebArea' && this.#role !== 'RootWebArea' && this.#name) {
      return true;
    }
    if (this.#role === 'heading' && this.#name) {
      return true;
    }
    return false;
  }

  isControl(): boolean {
    switch (this.#role) {
      case 'button':
      case 'checkbox':
      case 'ColorWell':
      case 'combobox':
      case 'DisclosureTriangle':
      case 'listbox':
      case 'menu':
      case 'menubar':
      case 'menuitem':
      case 'menuitemcheckbox':
      case 'menuitemradio':
      case 'radio':
      case 'scrollbar':
      case 'searchbox':
      case 'slider':
      case 'spinbutton':
      case 'switch':
      case 'tab':
      case 'textbox':
      case 'tree':
        return true;
      default:
        return false;
    }
  }

  isInteresting(insideControl: boolean): boolean {
    if (this.#role === 'Ignored' || this.#hidden) {
      return false;
    }
    if (this.#focusable || this.#richlyEditable) {
      return true;
    }
    if (this.isControl()) {
      return true;
    }
    if (insideControl) {
      return false;
    }
    return this.isLeafNode() && !!this.#name;
  }

  normalizedRole(): string {
    switch (this.#role) {
      case 'RootWebArea':
        return 'WebArea';
      case 'StaticText':
        return 'text';
      default:
        return this.#role;
    }
  }

  serialize(): SerializedAXNode {
    const properties = new Map<string, unknown>();
    for (const property of this.payload.properties ?? []) {
      properties.set(property.name.toLowerCase(), property.value.value);
    }
    if (this.payload.description) {
      properties.set('description', this.payload.description.value);
    }

    const node: SerializedAXNode = {
      role: this.normalizedRole(),
      name: this.payload.name ? (this.payload.name.value as string) || '' : '',
    };

    const userStringProperties = [
      'description', 'keyshortcuts', 'roledescription', 'valuetext',
    ] as const;

    for (const key of userStringProperties) {
      if (properties.has(key)) {
        node[key] = properties.get(key) as string;
      }
    }

    const booleanProperties = [
      'disabled', 'expanded', 'focused', 'modal', 'multiline',
      'multiselectable', 'readonly', 'required', 'selected',
    ] as const;

    for (const key of booleanProperties) {
      if (key === 'focused' && (this.#role === 'WebArea' || this.#role === 'RootWebArea')) {
        continue;
      }
      const value = properties.get(key);
      if (!value) {
        continue;
      }
      node[key] = value as boolean;
    }

    const numericalProperties = ['level', 'valuemax', 'valuemin'] as const;
    for (const key of numericalProperties) {
      if (properties.has(key)) {
        node[key] = properties.get(key) as number;
      }
    }

    const tokenProperties = ['autocomplete', 'haspopup', 'invalid', 'orientation'] as const;
    for (const key of tokenProperties) {
      const value = properties.get(key) as string | undefined;
      if (!value || value === 'false') {
        continue;
      }
      node[key] = value;
    }

    if (this.payload.value) {
      node.value = this.payload.value.value as string | number;
    }

    if (properties.has('checked')) {
      const raw = properties.get('checked');
      node.checked = raw === 'mixed' ? 'mixed' : raw === 'true';
    }
    if (properties.has('pressed')) {
      const raw = properties.get('pressed');
      node.pressed = raw === 'mixed' ? 'mixed' : raw === 'true';
    }

    return node;
  }

  static createTree(payloads: CDPAXNode[]): CRAXNode | null {
    const nodeById = new Map<string, CRAXNode>();
    for (const payload of payloads) {
      nodeById.set(payload.nodeId, new CRAXNode(payload));
    }
    for (const node of nodeById.values()) {
      for (const childId of node.payload.childIds ?? []) {
        const child = nodeById.get(childId);
        if (child) {
          node.children.push(child);
        }
      }
    }
    return nodeById.values().next().value ?? null;
  }
}

// ---------------------------------------------------------------------------
// Tree serialization with "interesting" filtering
// ---------------------------------------------------------------------------

export function serializeTree(
  node: CRAXNode,
  interestingNodes?: Set<CRAXNode>,
): SerializedAXNode[] {
  const children: SerializedAXNode[] = [];
  for (const child of node.children) {
    children.push(...serializeTree(child, interestingNodes));
  }

  if (interestingNodes && !interestingNodes.has(node)) {
    return children;
  }

  const serializedNode = node.serialize();
  if (children.length) {
    serializedNode.children = children;
  }
  return [serializedNode];
}

export function collectInterestingNodes(
  collection: Set<CRAXNode>,
  node: CRAXNode,
  insideControl: boolean,
): void {
  if (node.isInteresting(insideControl)) {
    collection.add(node);
  }
  if (node.isLeafNode()) {
    return;
  }
  insideControl = insideControl || node.isControl();
  for (const child of node.children) {
    collectInterestingNodes(collection, child, insideControl);
  }
}

// ---------------------------------------------------------------------------
// Snapshot entry point – calls CDP and builds the tree
// ---------------------------------------------------------------------------

export async function getAccessibilitySnapshot(
  cdpSend: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
  rootBackendNodeId?: number,
): Promise<SerializedAXNode | null> {
  const response = await cdpSend('Accessibility.getFullAXTree') as {
    nodes?: CDPAXNode[];
  } | undefined;

  const nodes = response?.nodes;
  if (!nodes?.length) {
    return null;
  }

  const defaultRoot = CRAXNode.createTree(nodes);
  if (!defaultRoot) {
    return null;
  }

  let needle: CRAXNode | null = defaultRoot;
  if (rootBackendNodeId) {
    needle = defaultRoot.find(
      node => node.payload.backendDOMNodeId === rootBackendNodeId,
    );
  }
  if (!needle) {
    return null;
  }

  const interestingNodes = new Set<CRAXNode>();
  collectInterestingNodes(interestingNodes, needle, false);

  return serializeTree(needle, interestingNodes)[0] ?? null;
}

// ---------------------------------------------------------------------------
// WTR plugin
// ---------------------------------------------------------------------------

export interface A11ySnapshotPayload {
  selector?: string;
}

/** WTR plugin that fetches the accessibility tree via CDP directly. */
export function a11ySnapshotPlugin(): TestRunnerPlugin<A11ySnapshotPayload> {
  return {
    name: 'a11y-snapshot-command',

    async executeCommand({ command, payload, session }): Promise<unknown> {
      if (command !== 'a11y-snapshot') {
        return;
      }

      if (session.browser.type !== 'playwright') {
        throw new Error(
          `Accessibility snapshot is not supported for browser type ${session.browser.type}. `
          + `Only Playwright (Chromium) is supported.`,
        );
      }

      const page = (session.browser as PlaywrightLauncher).getPage(session.id);
      let cdp;
      try {
        cdp = await page.context().newCDPSession(page);
        const send = cdp.send.bind(cdp) as
          (method: string, params?: Record<string, unknown>) => Promise<unknown>;

        let rootBackendNodeId: number | undefined;

        if (payload?.selector) {
          const { root: { nodeId: documentNodeId } } = await send('DOM.getDocument') as {
            root: { nodeId: number };
          };
          const { nodeId } = await send('DOM.querySelector', {
            nodeId: documentNodeId,
            selector: payload.selector,
          }) as { nodeId: number };

          if (!nodeId) {
            throw new Error(
              `No element found for selector "${payload.selector}".`,
            );
          }
          const { node } = await send('DOM.describeNode', { nodeId }) as {
            node: { backendNodeId: number };
          };
          rootBackendNodeId = node.backendNodeId;
        }

        return await getAccessibilitySnapshot(send, rootBackendNodeId);
      } finally {
        await cdp?.detach().catch(() => void 0);
      }
    },
  };
}
