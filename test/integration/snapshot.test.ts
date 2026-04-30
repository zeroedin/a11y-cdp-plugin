import { expect } from '@esm-bundle/chai';
import { executeServerCommand } from '@web/test-runner-commands';

import type { SerializedAXNode, A11ySnapshotPayload } from '../../a11y-cdp-plugin.js';

function findByRole(
  node: SerializedAXNode,
  role: string,
): SerializedAXNode | undefined {
  if (node.role === role) return node;
  for (const child of node.children ?? []) {
    const found = findByRole(child, role);
    if (found) return found;
  }
}

function findByName(
  node: SerializedAXNode,
  name: string,
): SerializedAXNode | undefined {
  if (node.name === name) return node;
  for (const child of node.children ?? []) {
    const found = findByName(child, name);
    if (found) return found;
  }
}

function setupFixture(): void {
  const container = document.createElement('div');
  container.id = 'fixture';
  container.innerHTML = `
    <h1>Heading</h1>
    <nav aria-label="Main">
      <a href="#one">Link one</a>
      <a href="#two">Link two</a>
    </nav>
    <main id="main-content">
      <button>Click me</button>
      <input type="text" aria-label="Name" value="Alice">
      <input type="checkbox" aria-label="Agree" checked>
      <select aria-label="Color">
        <option>Red</option>
        <option selected>Blue</option>
      </select>
    </main>
  `;
  document.body.appendChild(container);
}

describe('a11y-snapshot integration', () => {
  before(() => {
    setupFixture();
  });

  after(() => {
    document.getElementById('fixture')?.remove();
  });

  describe('full-page snapshot', () => {
    let snap: SerializedAXNode;

    before(async () => {
      snap = (await executeServerCommand<SerializedAXNode, undefined>('a11y-snapshot'))!;
    });

    it('returns a WebArea root', () => {
      expect(snap).to.not.be.null;
      expect(snap.role).to.equal('WebArea');
    });

    it('contains the expected heading', () => {
      const heading = findByRole(snap, 'heading');
      expect(heading).to.not.be.undefined;
      expect(heading!.name).to.equal('Heading');
    });

    it('contains a button', () => {
      const button = findByName(snap, 'Click me');
      expect(button).to.not.be.undefined;
      expect(button!.role).to.equal('button');
    });

    it('contains a textbox with value', () => {
      const textbox = findByName(snap, 'Name');
      expect(textbox).to.not.be.undefined;
      expect(textbox!.role).to.equal('textbox');
      expect(textbox!.value).to.equal('Alice');
    });

    it('contains a checked checkbox', () => {
      const checkbox = findByName(snap, 'Agree');
      expect(checkbox).to.not.be.undefined;
      expect(checkbox!.role).to.equal('checkbox');
      expect(checkbox!.checked).to.be.true;
    });

    it('contains links', () => {
      const link = findByName(snap, 'Link one');
      expect(link).to.not.be.undefined;
      expect(link!.role).to.equal('link');
    });
  });

  describe('scoped snapshot with selector', () => {
    let buttonSnap: SerializedAXNode;
    let navSnap: SerializedAXNode;

    before(async () => {
      buttonSnap = (await executeServerCommand<SerializedAXNode, A11ySnapshotPayload>(
        'a11y-snapshot',
        { selector: '#fixture button' },
      ))!;
      navSnap = (await executeServerCommand<SerializedAXNode, A11ySnapshotPayload>(
        'a11y-snapshot',
        { selector: '#fixture nav' },
      ))!;
    });

    it('returns the subtree rooted at the button', () => {
      expect(buttonSnap).to.not.be.null;
      expect(buttonSnap.role).to.equal('button');
      expect(buttonSnap.name).to.equal('Click me');
    });

    it('returns the subtree rooted at the nav landmark', () => {
      expect(navSnap).to.not.be.null;
      const link = findByName(navSnap, 'Link one');
      expect(link).to.not.be.undefined;
      expect(link!.role).to.equal('link');
    });

    it('excludes elements outside the scoped subtree', () => {
      const button = findByName(navSnap, 'Click me');
      expect(button).to.be.undefined;
    });
  });

  describe('edge cases', () => {
    it('throws for a non-existent selector', async () => {
      let error: Error | undefined;
      try {
        await executeServerCommand<SerializedAXNode, A11ySnapshotPayload>(
          'a11y-snapshot',
          { selector: '#does-not-exist' },
        );
      } catch (e) {
        error = e as Error;
      }
      expect(error).to.be.an.instanceOf(Error);
      expect(error!.message).to.include('#does-not-exist');
    });
  });
});
