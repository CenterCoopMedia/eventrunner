// Where a rejected submit puts the reader.
import { afterEach, describe, expect, it } from 'vitest';
import { focusFirstError } from './focusFirstError.js';

/** Build a form in the document, so focus has somewhere real to go. */
function form(html) {
  const element = document.createElement('form');
  element.innerHTML = html;
  document.body.append(element);
  return element;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('focusFirstError', () => {
  it('focuses the first field the form marked invalid', () => {
    const element = form(`
      <input id="one" />
      <input id="two" aria-invalid="true" />
      <input id="three" aria-invalid="true" />
    `);
    expect(focusFirstError(element)).toBe(true);
    expect(document.activeElement.id).toBe('two');
  });

  it('takes document order, which is the order a reader meets the fields', () => {
    const element = form(`
      <input id="late" aria-invalid="true" />
      <input id="early" aria-invalid="true" />
    `);
    focusFirstError(element);
    expect(document.activeElement.id).toBe('late');
  });

  it('falls back to a field the browser rejected', () => {
    const element = form('<input id="mail" type="email" value="not-an-address" required />');
    expect(focusFirstError(element)).toBe(true);
    expect(document.activeElement.id).toBe('mail');
  });

  it('skips a field nobody can reach', () => {
    const element = form(`
      <input id="off" aria-invalid="true" disabled />
      <input id="on" aria-invalid="true" />
    `);
    focusFirstError(element);
    expect(document.activeElement.id).toBe('on');
  });

  it('says so when there is nothing to focus', () => {
    expect(focusFirstError(form('<input id="fine" />'))).toBe(false);
    expect(focusFirstError(null)).toBe(false);
    expect(focusFirstError(undefined)).toBe(false);
    expect(focusFirstError({})).toBe(false);
  });
});
