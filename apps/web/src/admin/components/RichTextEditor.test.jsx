import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Quill from 'quill/core.js';
import RichTextEditor from './RichTextEditor.jsx';

const MAP_URL = 'https://www.google.com/maps/embed?pb=fixture&hl=en';
const MAP_IFRAME = `<iframe src="${MAP_URL.replaceAll('&', '&amp;')}"></iframe>`;

beforeAll(() => {
  // Quill asks the browser for the selection rectangle when toolbar focus
  // moves away from the editor. jsdom has no layout, so it omits both APIs.
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => ({
      bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0,
      toJSON() {},
    });
  }
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [];
});

function renderEditor(props = {}) {
  const onChange = props.onChange ?? vi.fn();
  render(
    <RichTextEditor
      label="answer"
      value="<p>Starting text</p>"
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange };
}

describe('RichTextEditor', () => {
  it('offers the allowlisted formats as native keyboard controls', async () => {
    renderEditor({ required: true });
    const editor = await screen.findByRole('textbox', { name: 'answer' });
    expect(editor).toHaveAttribute('contenteditable', 'true');
    expect(editor).toHaveAttribute('aria-required', 'true');
    const toolbar = screen.getByRole('toolbar', { name: 'answer formatting' });
    for (const name of [
      'Paragraph', 'Bold', 'Italic', 'Underline', 'Strike', 'Inline code',
      'Heading 2', 'Heading 3', 'Heading 4', 'Bulleted list', 'Numbered list',
      'Quote', 'Code block', 'Divider', 'Link', 'Undo', 'Redo',
    ]) {
      expect(toolbar).toContainElement(screen.getByRole('button', { name }));
    }
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-keyshortcuts', 'Control+B');
    expect(screen.getByText('13 characters')).toBeInTheDocument();
  });

  it('sanitizes stored HTML without reporting an edit or a public formatting change', async () => {
    const onNormalize = vi.fn();
    const value = '<p onclick="bad()"><strong>Safe</strong></p><img src="x">' +
      '<iframe class="ql-video">gone</iframe><span class="ql-formula" data-value="x"></span>';
    const { onChange } = renderEditor({
      value,
      onNormalize,
    });
    const editor = await screen.findByRole('textbox', { name: 'answer' });
    expect(onNormalize).toHaveBeenCalledWith(value, '<p><strong>Safe</strong></p>');
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.innerHTML).toBe('<p><strong>Safe</strong></p>');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    Quill.find(editor.parentElement).setSelection(4, 0, 'user');
    fireEvent.paste(editor, { clipboardData: { getData: (type) => type === 'text/plain' ? ' copy' : '' } });
    expect(editor).toHaveTextContent('Safe copy');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('sanitizes HTML paste before Quill converts it', async () => {
    const { onChange } = renderEditor({ value: '' });
    const editor = await screen.findByRole('textbox', { name: 'answer' });
    fireEvent.paste(editor, {
      clipboardData: {
        getData(type) {
          if (type === 'text/html') {
            return '<p onclick="bad()"><em>Pasted</em></p><img src="x"><video>gone</video>';
          }
          return 'Pasted';
        },
      },
    });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('<p><em>Pasted</em></p>'));
    expect(editor.innerHTML).toBe('<p><em>Pasted</em></p>');
    expect(screen.getByRole('status')).toHaveTextContent('pasted text');
  });

  it.each([
    ['plain clipboard source', '', '<div><b>A tag soup fragment</b></div>'],
    ['plain embed source after a heading', '', 'Look here\n<embed src="https://example.org/file">'],
    ['source wrapped by rich clipboard HTML', '<pre>&lt;script&gt;example&lt;/script&gt;</pre>', '<script>example</script>'],
    ['escaped HTML-only source', '<p>&lt;div&gt;source&lt;/div&gt;</p>', ''],
    ['HTML-only object', '<object data="https://example.org/file">fallback</object>', ''],
  ])('rejects %s without changing selected text', async (_name, html, text) => {
    const { onChange } = renderEditor({ newMapBlockHref: '/admin/content/travel/travel_map/_new' });
    const editor = await screen.findByRole('textbox', { name: 'answer' });
    Quill.find(editor.parentElement).setSelection(0, 8, 'user');

    fireEvent.paste(editor, { clipboardData: { getData: (type) => type === 'text/html' ? html : text } });

    expect(editor).toHaveTextContent('Starting text');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Pasted HTML won’t appear on the page.');
    expect(screen.queryByRole('link', { name: /Add a Map block/ })).not.toBeInTheDocument();
  });

  it.each(['text/plain', 'text/html'])('offers the validated Map link for an iframe on %s', async (clipboardType) => {
    renderEditor({ newMapBlockHref: '/admin/content/travel/travel_map/_new' });
    const editor = await screen.findByRole('textbox', { name: 'answer' });

    fireEvent.paste(editor, { clipboardData: { getData: (type) => type === clipboardType ? MAP_IFRAME : '' } });

    const action = screen.getByRole('link', { name: 'Add a Map block with this map (opens in a new tab)' });
    const url = new URL(action.href);
    expect(url.pathname).toBe('/admin/content/travel/travel_map/_new');
    expect(url.searchParams.get('mapEmbed')).toBe(MAP_URL);
    expect(action).toHaveAttribute('target', '_blank');
    expect(editor).toHaveTextContent('Starting text');
    expect(editor).toHaveAccessibleDescription(expect.stringContaining('Pasted HTML won’t appear on the page.'));
    fireEvent.keyDown(editor, { key: 'Tab' });
    expect(action).toHaveFocus();
  });

  it('keeps ordinary plain clipboard text and clears the previous Map offer', async () => {
    renderEditor({ value: '', newMapBlockHref: '/admin/content/travel/travel_map/_new' });
    const editor = await screen.findByRole('textbox', { name: 'answer' });
    Quill.find(editor.parentElement).setSelection(0, 0, 'user');
    const paste = (text) => fireEvent.paste(editor, {
      clipboardData: { getData: (type) => type === 'text/plain' ? text : '' },
    });

    paste(MAP_IFRAME);
    paste('<https://example.org> 2 < 3');

    expect(editor).toHaveTextContent('<https://example.org> 2 < 3');
    expect(screen.queryByRole('link', { name: /Add a Map block/ })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('keeps a text selection when toolbar focus applies formatting', async () => {
    const { onChange } = renderEditor({ value: '<p>Select me</p>' });
    const editor = await screen.findByRole('textbox', { name: 'answer' });
    const quill = Quill.find(editor.parentElement);
    quill.setSelection(0, 6, 'user');
    expect(quill.getSelection()).toMatchObject({ index: 0, length: 6 });

    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('<p><strong>Select</strong> me</p>'));
    expect(editor.innerHTML).toBe('<p><strong>Select</strong> me</p>');
  });

  it('shows field and link errors in the accessible descriptions', async () => {
    renderEditor({ error: 'answer: is required.' });
    const editor = await screen.findByRole('textbox', { name: 'answer' });
    expect(editor).toHaveAttribute('aria-invalid', 'true');
    expect(editor).toHaveAccessibleDescription(expect.stringContaining('answer: is required.'));

    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    const input = screen.getByRole('textbox', { name: 'Link address' });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: 'javascript:bad()' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply link' }));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(/relative link|starts with http/i);
  });
});
