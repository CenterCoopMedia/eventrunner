import { afterEach, describe, expect, it } from 'vitest';
import { available, wrapModalTab } from './modalFocus.js';

const dialogs = [];

function modal(content) {
  const dialog = document.createElement('dialog');
  dialog.open = true;
  dialog.tabIndex = -1;
  dialog.innerHTML = content;
  dialog.addEventListener('keydown', wrapModalTab);
  document.body.append(dialog);
  dialogs.push(dialog);
  return dialog;
}

function pressTab(target, options = {}) {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab', bubbles: true, cancelable: true, ...options,
  });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  dialogs.splice(0).forEach((dialog) => dialog.remove());
});

describe('modal focus boundaries', () => {
  it('wraps the first and last controls and leaves middle traversal native', () => {
    const dialog = modal('<button id="first">First</button><input id="middle"><button id="last">Last</button>');
    const first = dialog.querySelector('#first');
    const middle = dialog.querySelector('#middle');
    const last = dialog.querySelector('#last');

    last.focus();
    expect(pressTab(last).defaultPrevented).toBe(true);
    expect(first).toHaveFocus();
    expect(pressTab(first, { shiftKey: true }).defaultPrevented).toBe(true);
    expect(last).toHaveFocus();

    middle.focus();
    for (const shiftKey of [false, true]) {
      expect(pressTab(middle, { shiftKey }).defaultPrevented).toBe(false);
      // jsdom does not perform native Tab traversal. Only the boundary
      // helper's focus moves are asserted here; hosted browsers cover Tab.
      expect(middle).toHaveFocus();
    }
  });

  it.each([
    ['native disabled', '<button disabled>Unavailable</button>'],
    ['disabled fieldset', '<fieldset disabled><button>Unavailable</button></fieldset>'],
    ['hidden ancestor', '<div hidden><button>Hidden</button></div>'],
    ['inert ancestor', '<div inert><button>Inert</button></div>'],
    ['display none', '<div style="display: none"><button>Hidden</button></div>'],
    ['visibility hidden', '<div style="visibility: hidden"><button>Hidden</button></div>'],
    ['visibility collapse', '<div style="visibility: collapse"><button>Hidden</button></div>'],
    ['hidden input', '<input type="hidden" tabindex="0">'],
    ['negative tab index', '<button tabindex="-1">Programmatic focus only</button>'],
    ['closed nested dialog', '<dialog><button>Closed dialog control</button></dialog>'],
  ])('excludes %s controls from both boundaries', (_name, excluded) => {
    const dialog = modal(`${excluded}<button id="first">First</button><button id="last">Last</button>${excluded}`);
    const first = dialog.querySelector('#first');
    const last = dialog.querySelector('#last');
    last.focus();
    pressTab(last);
    expect(first).toHaveFocus();
    pressTab(first, { shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('retains focusable aria-disabled controls while updating native disabled boundaries', () => {
    const dialog = modal('<button id="first" aria-disabled="true">Cancel unavailable</button><button id="last" aria-disabled="true" aria-busy="true">Sending feedback</button>');
    const first = dialog.querySelector('#first');
    const last = dialog.querySelector('#last');
    last.focus();
    pressTab(last);
    expect(first).toHaveFocus();
    pressTab(first, { shiftKey: true });
    expect(last).toHaveFocus();

    // Recompute on every keypress: a rerender can disable a control while
    // the dialog remains open, leaving one available Tab stop.
    first.disabled = true;
    for (const shiftKey of [false, true]) {
      expect(pressTab(last, { shiftKey }).defaultPrevented).toBe(true);
      expect(last).toHaveFocus();
    }
  });

  it('enters the appropriate boundary from the dialog itself', () => {
    const dialog = modal('<button id="first">First</button><button id="last">Last</button>');
    dialog.focus();
    pressTab(dialog);
    expect(dialog.querySelector('#first')).toHaveFocus();
    dialog.focus();
    pressTab(dialog, { shiftKey: true });
    expect(dialog.querySelector('#last')).toHaveFocus();
  });

  it('keeps a dialog with no available controls focused', () => {
    const dialog = modal('<button disabled>Unavailable</button>');
    for (const shiftKey of [false, true]) {
      expect(pressTab(dialog, { shiftKey }).defaultPrevented).toBe(true);
      expect(dialog).toHaveFocus();
    }
  });

  it('wraps from programmatic focus outside the tabbable range', () => {
    const dialog = modal('<h2 id="heading" tabindex="-1">Receipt</h2><button id="close">Close</button><p id="result" tabindex="-1">Details</p>');
    const heading = dialog.querySelector('#heading');
    const close = dialog.querySelector('#close');
    const result = dialog.querySelector('#result');
    heading.focus();
    expect(pressTab(heading, { shiftKey: true }).defaultPrevented).toBe(true);
    expect(close).toHaveFocus();
    result.focus();
    expect(pressTab(result).defaultPrevented).toBe(true);
    expect(close).toHaveFocus();

    heading.focus();
    expect(pressTab(heading).defaultPrevented).toBe(false);
  });

  it('preserves native traversal from a focused consequence between controls', () => {
    const dialog = modal('<button>Close</button><h2 id="consequence" tabindex="-1">Delete file</h2><button>Delete</button><button>Keep file</button>');
    const heading = dialog.querySelector('#consequence');
    heading.focus();
    for (const shiftKey of [false, true]) {
      expect(pressTab(heading, { shiftKey }).defaultPrevented).toBe(false);
      expect(heading).toHaveFocus();
    }
  });

  it('leaves nested modal events to the nested dialog', () => {
    const outer = modal('<button>Outer first</button><dialog open tabindex="-1"><button id="inner-first">Inner first</button><button id="inner-last">Inner last</button></dialog><button>Outer last</button>');
    const inner = outer.querySelector('dialog');
    const first = inner.querySelector('#inner-first');
    const last = inner.querySelector('#inner-last');
    last.focus();
    expect(pressTab(last).defaultPrevented).toBe(false);
    expect(last).toHaveFocus();

    inner.addEventListener('keydown', wrapModalTab);
    expect(pressTab(last).defaultPrevented).toBe(true);
    expect(first).toHaveFocus();
  });

  it.each([{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { key: 'Enter' }])('leaves modified Tab and other keys alone: %j', (options) => {
    const dialog = modal('<button>Only control</button>');
    const button = dialog.querySelector('button');
    button.focus();
    expect(pressTab(button, options).defaultPrevented).toBe(false);
    expect(button).toHaveFocus();
  });

  it('respects a key event already handled by a child control', () => {
    const dialog = modal('<button>First</button><button id="last">Last</button>');
    const last = dialog.querySelector('#last');
    last.addEventListener('keydown', (event) => event.preventDefault());
    last.focus();
    pressTab(last);
    expect(last).toHaveFocus();
  });
});

describe('focus return availability', () => {
  it('rejects a disconnected opener and controls in a closed dialog', () => {
    const dialog = modal('<button>Close</button>');
    const button = dialog.querySelector('button');
    expect(available(button)).toBe(true);
    dialog.open = false;
    expect(available(button)).toBe(false);
    dialog.open = true;
    button.remove();
    expect(available(button)).toBe(false);
    expect(available(null)).toBe(false);
  });
});
