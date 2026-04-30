import { expect } from '@esm-bundle/chai';

import {
  CRAXNode,
  collectInterestingNodes,
  serializeTree,
  getAccessibilitySnapshot,
} from '../../a11y-cdp-plugin.js';
import type { CDPAXNode, SerializedAXNode } from '../../a11y-cdp-plugin.js';

function node(
  overrides: Partial<CDPAXNode> & { nodeId: string },
): CDPAXNode {
  return { ignored: false, ...overrides };
}

// ---------------------------------------------------------------------------
// CRAXNode.createTree
// ---------------------------------------------------------------------------

describe('CRAXNode.createTree', () => {
  it('builds a tree from a flat CDP node array', () => {
    const payloads: CDPAXNode[] = [
      node({ nodeId: '1', role: { type: 'role', value: 'RootWebArea' }, childIds: ['2', '3'] }),
      node({ nodeId: '2', role: { type: 'role', value: 'heading' }, name: { type: 'computedString', value: 'Title' } }),
      node({ nodeId: '3', role: { type: 'role', value: 'button' }, name: { type: 'computedString', value: 'OK' } }),
    ];
    const root = CRAXNode.createTree(payloads)!;
    expect(root).to.not.be.null;
    expect(root.children).to.have.lengthOf(2);
    expect(root.children[0].payload.nodeId).to.equal('2');
    expect(root.children[1].payload.nodeId).to.equal('3');
  });

  it('returns null for an empty array', () => {
    expect(CRAXNode.createTree([])).to.be.null;
  });
});

// ---------------------------------------------------------------------------
// serialize
// ---------------------------------------------------------------------------

describe('CRAXNode#serialize', () => {
  it('maps role and name', () => {
    const tree = CRAXNode.createTree([
      node({ nodeId: '1', role: { type: 'role', value: 'button' }, name: { type: 'computedString', value: 'Save' } }),
    ])!;
    const serialized = tree.serialize();
    expect(serialized.role).to.equal('button');
    expect(serialized.name).to.equal('Save');
  });

  it('normalizes RootWebArea to WebArea', () => {
    const tree = CRAXNode.createTree([
      node({ nodeId: '1', role: { type: 'role', value: 'RootWebArea' }, name: { type: 'computedString', value: '' } }),
    ])!;
    expect(tree.serialize().role).to.equal('WebArea');
  });

  it('normalizes StaticText to text', () => {
    const tree = CRAXNode.createTree([
      node({ nodeId: '1', role: { type: 'role', value: 'StaticText' }, name: { type: 'computedString', value: 'hello' } }),
    ])!;
    expect(tree.serialize().role).to.equal('text');
  });

  it('includes description when present', () => {
    const tree = CRAXNode.createTree([
      node({
        nodeId: '1',
        role: { type: 'role', value: 'img' },
        name: { type: 'computedString', value: 'logo' },
        description: { type: 'computedString', value: 'Company logo' },
      }),
    ])!;
    expect(tree.serialize().description).to.equal('Company logo');
  });

  it('serializes boolean properties', () => {
    const tree = CRAXNode.createTree([
      node({
        nodeId: '1',
        role: { type: 'role', value: 'textbox' },
        name: { type: 'computedString', value: 'Email' },
        properties: [
          { name: 'disabled', value: { type: 'boolean', value: true } },
          { name: 'required', value: { type: 'boolean', value: true } },
        ],
      }),
    ])!;
    const s = tree.serialize();
    expect(s.disabled).to.be.true;
    expect(s.required).to.be.true;
  });

  it('serializes checked as boolean or mixed', () => {
    const makeChecked = (val: string) => CRAXNode.createTree([
      node({
        nodeId: '1',
        role: { type: 'role', value: 'checkbox' },
        name: { type: 'computedString', value: 'opt' },
        properties: [{ name: 'checked', value: { type: 'tristate', value: val } }],
      }),
    ])!.serialize();

    expect(makeChecked('true').checked).to.be.true;
    expect(makeChecked('false').checked).to.be.false;
    expect(makeChecked('mixed').checked).to.equal('mixed');
  });

  it('serializes pressed as boolean or mixed', () => {
    const makePressed = (val: string) => CRAXNode.createTree([
      node({
        nodeId: '1',
        role: { type: 'role', value: 'button' },
        name: { type: 'computedString', value: 'toggle' },
        properties: [{ name: 'pressed', value: { type: 'tristate', value: val } }],
      }),
    ])!.serialize();

    expect(makePressed('true').pressed).to.be.true;
    expect(makePressed('false').pressed).to.be.false;
    expect(makePressed('mixed').pressed).to.equal('mixed');
  });

  it('includes numerical properties', () => {
    const tree = CRAXNode.createTree([
      node({
        nodeId: '1',
        role: { type: 'role', value: 'heading' },
        name: { type: 'computedString', value: 'Title' },
        properties: [{ name: 'level', value: { type: 'integer', value: 2 } }],
      }),
    ])!;
    expect(tree.serialize().level).to.equal(2);
  });

  it('includes value when present', () => {
    const tree = CRAXNode.createTree([
      node({
        nodeId: '1',
        role: { type: 'role', value: 'textbox' },
        name: { type: 'computedString', value: 'Name' },
        value: { type: 'computedString', value: 'Alice' },
      }),
    ])!;
    expect(tree.serialize().value).to.equal('Alice');
  });

  it('includes token properties when truthy', () => {
    const tree = CRAXNode.createTree([
      node({
        nodeId: '1',
        role: { type: 'role', value: 'textbox' },
        name: { type: 'computedString', value: 'Search' },
        properties: [
          { name: 'autocomplete', value: { type: 'token', value: 'list' } },
          { name: 'haspopup', value: { type: 'token', value: 'false' } },
        ],
      }),
    ])!;
    const s = tree.serialize();
    expect(s.autocomplete).to.equal('list');
    expect(s.haspopup).to.be.undefined;
  });
});

// ---------------------------------------------------------------------------
// isLeafNode / isControl / isInteresting
// ---------------------------------------------------------------------------

describe('CRAXNode#isLeafNode', () => {
  it('returns true for nodes with no children', () => {
    const tree = CRAXNode.createTree([
      node({ nodeId: '1', role: { type: 'role', value: 'button' }, name: { type: 'computedString', value: 'OK' } }),
    ])!;
    expect(tree.isLeafNode()).to.be.true;
  });

  it('returns true for img role even with children', () => {
    const tree = CRAXNode.createTree([
      node({ nodeId: '1', role: { type: 'role', value: 'img' }, name: { type: 'computedString', value: 'logo' }, childIds: ['2'] }),
      node({ nodeId: '2', role: { type: 'role', value: 'StaticText' }, name: { type: 'computedString', value: 'alt' } }),
    ])!;
    expect(tree.isLeafNode()).to.be.true;
  });

  it('returns true for heading with name and no focusable children', () => {
    const tree = CRAXNode.createTree([
      node({ nodeId: '1', role: { type: 'role', value: 'heading' }, name: { type: 'computedString', value: 'Title' }, childIds: ['2'] }),
      node({ nodeId: '2', role: { type: 'role', value: 'StaticText' }, name: { type: 'computedString', value: 'Title' } }),
    ])!;
    expect(tree.isLeafNode()).to.be.true;
  });
});

describe('CRAXNode#isControl', () => {
  const controlRoles = [
    'button', 'checkbox', 'combobox', 'listbox', 'menu', 'menubar',
    'menuitem', 'menuitemcheckbox', 'menuitemradio', 'radio', 'scrollbar',
    'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'textbox', 'tree',
  ];

  for (const role of controlRoles) {
    it(`returns true for role="${role}"`, () => {
      const tree = CRAXNode.createTree([
        node({ nodeId: '1', role: { type: 'role', value: role }, name: { type: 'computedString', value: 'x' } }),
      ])!;
      expect(tree.isControl()).to.be.true;
    });
  }

  it('returns false for non-control roles', () => {
    const tree = CRAXNode.createTree([
      node({ nodeId: '1', role: { type: 'role', value: 'heading' }, name: { type: 'computedString', value: 'x' } }),
    ])!;
    expect(tree.isControl()).to.be.false;
  });
});

describe('CRAXNode#isInteresting', () => {
  it('returns false for Ignored role', () => {
    const tree = CRAXNode.createTree([
      node({ nodeId: '1', role: { type: 'role', value: 'Ignored' } }),
    ])!;
    expect(tree.isInteresting(false)).to.be.false;
  });

  it('returns false for hidden nodes', () => {
    const tree = CRAXNode.createTree([
      node({
        nodeId: '1',
        role: { type: 'role', value: 'button' },
        name: { type: 'computedString', value: 'x' },
        properties: [{ name: 'hidden', value: { type: 'boolean', value: true } }],
      }),
    ])!;
    expect(tree.isInteresting(false)).to.be.false;
  });

  it('returns true for focusable nodes', () => {
    const tree = CRAXNode.createTree([
      node({
        nodeId: '1',
        role: { type: 'role', value: 'generic' },
        name: { type: 'computedString', value: '' },
        properties: [{ name: 'focusable', value: { type: 'boolean', value: true } }],
      }),
    ])!;
    expect(tree.isInteresting(false)).to.be.true;
  });

  it('returns true for controls', () => {
    const tree = CRAXNode.createTree([
      node({ nodeId: '1', role: { type: 'role', value: 'button' }, name: { type: 'computedString', value: 'OK' } }),
    ])!;
    expect(tree.isInteresting(false)).to.be.true;
  });

  it('returns false for named leaf inside a control', () => {
    const tree = CRAXNode.createTree([
      node({ nodeId: '1', role: { type: 'role', value: 'heading' }, name: { type: 'computedString', value: 'Title' } }),
    ])!;
    expect(tree.isInteresting(true)).to.be.false;
  });

  it('returns true for named leaf outside a control', () => {
    const tree = CRAXNode.createTree([
      node({ nodeId: '1', role: { type: 'role', value: 'heading' }, name: { type: 'computedString', value: 'Title' } }),
    ])!;
    expect(tree.isInteresting(false)).to.be.true;
  });
});

// ---------------------------------------------------------------------------
// collectInterestingNodes + serializeTree
// ---------------------------------------------------------------------------

describe('collectInterestingNodes + serializeTree', () => {
  it('prunes uninteresting nodes from the tree', () => {
    const payloads: CDPAXNode[] = [
      node({
        nodeId: '1',
        role: { type: 'role', value: 'RootWebArea' },
        name: { type: 'computedString', value: '' },
        properties: [{ name: 'focusable', value: { type: 'boolean', value: true } }],
        childIds: ['2', '3'],
      }),
      node({
        nodeId: '2',
        role: { type: 'role', value: 'generic' },
        name: { type: 'computedString', value: '' },
        childIds: ['4'],
      }),
      node({
        nodeId: '3',
        role: { type: 'role', value: 'button' },
        name: { type: 'computedString', value: 'Submit' },
      }),
      node({
        nodeId: '4',
        role: { type: 'role', value: 'heading' },
        name: { type: 'computedString', value: 'Hello' },
        properties: [{ name: 'level', value: { type: 'integer', value: 1 } }],
      }),
    ];

    const root = CRAXNode.createTree(payloads)!;
    const interesting = new Set<CRAXNode>();
    collectInterestingNodes(interesting, root, false);
    const [serialized] = serializeTree(root, interesting);

    expect(serialized.role).to.equal('WebArea');
    expect(serialized.children).to.have.lengthOf(2);

    const names = serialized.children!.map(c => c.name);
    expect(names).to.include('Hello');
    expect(names).to.include('Submit');
  });
});

// ---------------------------------------------------------------------------
// getAccessibilitySnapshot (with mock cdpSend)
// ---------------------------------------------------------------------------

describe('getAccessibilitySnapshot', () => {
  const fakeNodes: CDPAXNode[] = [
    node({
      nodeId: '1',
      role: { type: 'role', value: 'RootWebArea' },
      name: { type: 'computedString', value: 'Page' },
      properties: [{ name: 'focusable', value: { type: 'boolean', value: true } }],
      childIds: ['2', '3'],
      backendDOMNodeId: 100,
    }),
    node({
      nodeId: '2',
      role: { type: 'role', value: 'heading' },
      name: { type: 'computedString', value: 'Title' },
      properties: [{ name: 'level', value: { type: 'integer', value: 1 } }],
      backendDOMNodeId: 200,
    }),
    node({
      nodeId: '3',
      role: { type: 'role', value: 'button' },
      name: { type: 'computedString', value: 'OK' },
      backendDOMNodeId: 300,
    }),
  ];

  const mockCdpSend = async () => ({ nodes: fakeNodes });

  it('returns the full tree when no rootBackendNodeId is given', async () => {
    const snap = await getAccessibilitySnapshot(mockCdpSend);
    expect(snap).to.not.be.null;
    expect(snap!.role).to.equal('WebArea');
    expect(snap!.children).to.be.an('array');
  });

  it('roots at a specific backendDOMNodeId', async () => {
    const snap = await getAccessibilitySnapshot(mockCdpSend, 200);
    expect(snap).to.not.be.null;
    expect(snap!.role).to.equal('heading');
    expect(snap!.name).to.equal('Title');
  });

  it('returns null when the target node is not found', async () => {
    const snap = await getAccessibilitySnapshot(mockCdpSend, 999);
    expect(snap).to.be.null;
  });

  it('returns null when CDP returns no nodes', async () => {
    const empty = async () => ({ nodes: [] });
    const snap = await getAccessibilitySnapshot(empty);
    expect(snap).to.be.null;
  });

  it('returns null when CDP returns undefined', async () => {
    const bad = async () => undefined;
    const snap = await getAccessibilitySnapshot(bad);
    expect(snap).to.be.null;
  });

  it('returns null when CDP response has no nodes property', async () => {
    const bad = async () => ({});
    const snap = await getAccessibilitySnapshot(bad);
    expect(snap).to.be.null;
  });
});
