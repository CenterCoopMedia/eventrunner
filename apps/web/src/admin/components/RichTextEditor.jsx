import { useEffect, useId, useRef, useState } from 'react';
import Quill, { Delta } from 'quill/core.js';
import { BlockEmbed } from 'quill/blots/block.js';
import Bold from 'quill/formats/bold.js';
import Italic from 'quill/formats/italic.js';
import Underline from 'quill/formats/underline.js';
import Strike from 'quill/formats/strike.js';
import Link from 'quill/formats/link.js';
import Header from 'quill/formats/header.js';
import List from 'quill/formats/list.js';
import Blockquote from 'quill/formats/blockquote.js';
import CodeBlock, { Code } from 'quill/formats/code.js';
import { hasRichTextContent, isSafeRichTextHref } from 'shared/richText';
import { sanitizeHtml } from '../../lib/sanitizeHtml.js';
import {
  FieldError,
  fieldHintClass,
  fieldLabelClass,
  inputClass,
  secondaryButtonClass,
} from './formControls.jsx';

// Quill 2.0.3's HTML exporter has a published advisory involving its
// formula and video blots. This editor never imports or registers those
// blots (or images), limits the runtime to the shared allowlist below, and
// still sanitizes every paste, load, and export. The Functions write seam
// repeats that sanitizer authoritatively before storage.
class SafeLink extends Link {
  static sanitize(value) {
    return isSafeRichTextHref(value) ? value.trim() : '';
  }

  static create(value) {
    const node = super.create(value);
    node.removeAttribute('target');
    if (!isSafeRichTextHref(value)) node.removeAttribute('href');
    return node;
  }
}

class Divider extends BlockEmbed {
  static blotName = 'divider';
  static tagName = 'HR';
}

Quill.register(
  {
    'formats/bold': Bold,
    'formats/italic': Italic,
    'formats/underline': Underline,
    'formats/strike': Strike,
    'formats/link': SafeLink,
    'formats/header': Header,
    'formats/list': List,
    'formats/blockquote': Blockquote,
    'formats/code': Code,
    'formats/code-block': CodeBlock,
    'formats/divider': Divider,
  },
  true,
);

const FORMATS = Object.freeze([
  'bold',
  'italic',
  'underline',
  'strike',
  'link',
  'header',
  'list',
  'blockquote',
  'code',
  'code-block',
  'divider',
]);

const INLINE_FORMATS = Object.freeze([
  { label: 'Bold', format: 'bold', shortcut: 'Control+B' },
  { label: 'Italic', format: 'italic', shortcut: 'Control+I' },
  { label: 'Underline', format: 'underline', shortcut: 'Control+U' },
  { label: 'Strike', format: 'strike' },
  { label: 'Inline code', format: 'code' },
]);

const BLOCK_FORMATS = Object.freeze([
  { label: 'Heading 2', format: 'header', value: 2 },
  { label: 'Heading 3', format: 'header', value: 3 },
  { label: 'Heading 4', format: 'header', value: 4 },
  { label: 'Bulleted list', format: 'list', value: 'bullet' },
  { label: 'Numbered list', format: 'list', value: 'ordered' },
  { label: 'Quote', format: 'blockquote', value: true },
  { label: 'Code block', format: 'code-block', value: true },
]);

const toolbarButtonClass =
  'inline-flex min-h-admin-control items-center justify-center rounded-admin border-admin-hairline ' +
  'border-admin-rule-strong bg-admin-ground-raised px-sm py-xs font-admin-ui text-admin-sm ' +
  'font-medium text-admin-ink hover:border-admin-action-soft-hover hover:bg-admin-action-soft ' +
  'hover:text-admin-ink-link aria-pressed:border-admin-action aria-pressed:bg-admin-action-soft ' +
  'aria-pressed:text-admin-ink-link disabled:cursor-not-allowed disabled:opacity-60';

function outputHtml(quill) {
  // Quill encodes ordinary spaces next to inline formats as non-breaking
  // spaces. Store regular spaces so opening an unchanged record does not
  // create a whitespace-only draft revision.
  const clean = sanitizeHtml(quill.getSemanticHTML()).replace(/(?:&nbsp;|\u00a0)/g, ' ');
  return hasRichTextContent(clean) ? clean : '';
}

function characterCount(quill) {
  // Quill always ends its document with one structural newline.
  return Array.from(quill.getText().replace(/\n$/, '')).length;
}

function active(format, value, formats) {
  if (value === undefined || value === true) return Boolean(formats[format]);
  return formats[format] === value;
}

/**
 * A controlled editor for the registry's richtext fields. The parent still
 * owns the draft value and the ordinary content-block save flow.
 */
export default function RichTextEditor({ label, value, onChange, error, required = false }) {
  const generatedId = useId();
  const editorId = `richtext-${generatedId}`;
  const labelId = `${editorId}-label`;
  const hintId = `${editorId}-hint`;
  const countId = `${editorId}-count`;
  const errorId = `${editorId}-error`;
  const noticeId = `${editorId}-notice`;
  const mountRef = useRef(null);
  const quillRef = useRef(null);
  const initialValueRef = useRef(value ?? '');
  const onChangeRef = useRef(onChange);
  const lastValueRef = useRef('');
  const lastSelectionRef = useRef({ index: 0, length: 0 });
  const linkButtonRef = useRef(null);
  const linkInputRef = useRef(null);
  const [formats, setFormats] = useState({});
  const [count, setCount] = useState(0);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [linkError, setLinkError] = useState('');
  const [notice, setNotice] = useState('');

  onChangeRef.current = onChange;

  useEffect(() => {
    const mount = mountRef.current;
    const quill = new Quill(mount, {
      formats: FORMATS,
      modules: { history: { delay: 600, maxStack: 100, userOnly: true } },
      placeholder: 'Write formatted text',
    });
    quillRef.current = quill;
    quill.root.id = editorId;
    quill.root.classList.add('admin-rich-text');
    quill.root.setAttribute('role', 'textbox');
    quill.root.setAttribute('aria-multiline', 'true');
    quill.root.setAttribute('aria-labelledby', labelId);
    if (required) quill.root.setAttribute('aria-required', 'true');

    function updateToolbar(range = quill.getSelection()) {
      const selected = range ?? lastSelectionRef.current;
      setFormats(quill.getFormat(selected));
      setCount(characterCount(quill));
      setHistory({
        undo: quill.history.stack.undo.length > 0,
        redo: quill.history.stack.redo.length > 0,
      });
    }

    const supplied = initialValueRef.current;
    const safeInitial = sanitizeHtml(supplied);
    quill.clipboard.dangerouslyPasteHTML(safeInitial, 'silent');
    quill.history.clear();
    const normalized = outputHtml(quill);
    lastValueRef.current = normalized;
    if (normalized !== supplied) {
      setNotice('Unsupported formatting was removed from this saved text. Save to store the cleaned version.');
      onChangeRef.current(normalized);
    }
    updateToolbar({ index: 0, length: 0 });

    const rememberSelection = (range) => {
      if (range) lastSelectionRef.current = range;
      updateToolbar(range);
    };
    const emitValue = (_delta, _old, source) => {
      updateToolbar();
      if (source !== 'user') return;
      const next = outputHtml(quill);
      lastValueRef.current = next;
      onChangeRef.current(next);
    };
    const sanitizePaste = (event) => {
      const pastedHtml = event.clipboardData?.getData('text/html');
      if (!pastedHtml) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const safeHtml = sanitizeHtml(pastedHtml);
      if (safeHtml !== pastedHtml) setNotice('Unsupported formatting was removed from the pasted text.');
      const range = quill.getSelection() ?? lastSelectionRef.current;
      const pasted = quill.clipboard.convert({
        html: safeHtml,
        text: event.clipboardData?.getData('text/plain') ?? '',
      });
      quill.updateContents(
        new Delta().retain(range.index).delete(range.length).concat(pasted),
        'user',
      );
      quill.setSelection(range.index + pasted.length(), 0, 'silent');
    };

    quill.on('selection-change', rememberSelection);
    quill.on('text-change', emitValue);
    quill.root.addEventListener('paste', sanitizePaste, true);
    return () => {
      quill.off('selection-change', rememberSelection);
      quill.off('text-change', emitValue);
      quill.root.removeEventListener('paste', sanitizePaste, true);
      quillRef.current = null;
      mount.replaceChildren();
    };
  }, [editorId, labelId, required]);

  useEffect(() => {
    const quill = quillRef.current;
    const supplied = value ?? '';
    const safe = sanitizeHtml(supplied);
    if (!quill || safe === lastValueRef.current || supplied === lastValueRef.current) return;
    quill.clipboard.dangerouslyPasteHTML(safe, 'silent');
    quill.history.clear();
    const normalized = outputHtml(quill);
    lastValueRef.current = normalized;
    setCount(characterCount(quill));
    setFormats(quill.getFormat(lastSelectionRef.current));
    setHistory({ undo: false, redo: false });
    if (normalized !== supplied) {
      setNotice('Unsupported formatting was removed from this saved text. Save to store the cleaned version.');
      onChangeRef.current(normalized);
    }
  }, [value]);

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) return;
    const describedBy = [hintId, countId, notice ? noticeId : null, error ? errorId : null]
      .filter(Boolean)
      .join(' ');
    quill.root.setAttribute('aria-describedby', describedBy);
    if (error) quill.root.setAttribute('aria-invalid', 'true');
    else quill.root.removeAttribute('aria-invalid');
  }, [countId, error, errorId, hintId, notice, noticeId]);

  useEffect(() => {
    if (linkOpen) linkInputRef.current?.focus();
  }, [linkOpen]);

  function restoreSelection() {
    const quill = quillRef.current;
    if (!quill) return null;
    quill.setSelection(lastSelectionRef.current, 'silent');
    quill.focus();
    return quill;
  }

  function toggleInline(format) {
    const quill = restoreSelection();
    if (!quill) return;
    const next = !quill.getFormat(lastSelectionRef.current)[format];
    quill.format(format, next, 'user');
  }

  function setBlock(format, value) {
    const quill = restoreSelection();
    if (!quill) return;
    const current = quill.getFormat(lastSelectionRef.current)[format];
    quill.formatLine(
      lastSelectionRef.current.index,
      Math.max(lastSelectionRef.current.length, 1),
      format,
      current === value ? false : value,
      'user',
    );
  }

  function setParagraph() {
    const quill = restoreSelection();
    if (!quill) return;
    quill.formatLine(
      lastSelectionRef.current.index,
      Math.max(lastSelectionRef.current.length, 1),
      { header: false, list: false, blockquote: false, 'code-block': false },
      'user',
    );
  }

  function insertDivider() {
    const quill = restoreSelection();
    if (!quill) return;
    const index = lastSelectionRef.current.index;
    quill.insertEmbed(index, 'divider', true, 'user');
    quill.setSelection(index + 1, 0, 'silent');
  }

  function openLink() {
    const quill = quillRef.current;
    const current = quill?.getFormat(lastSelectionRef.current)?.link;
    setLinkValue(typeof current === 'string' ? current : '');
    setLinkError('');
    setLinkOpen(true);
  }

  function closeLink() {
    setLinkOpen(false);
    setLinkError('');
    linkButtonRef.current?.focus();
  }

  function applyLink() {
    if (!isSafeRichTextHref(linkValue)) {
      setLinkError('Enter a relative link or an address that starts with http, https, mailto, or tel.');
      return;
    }
    restoreSelection()?.format('link', linkValue.trim(), 'user');
    closeLink();
  }

  function removeLink() {
    restoreSelection()?.format('link', false, 'user');
    closeLink();
  }

  function changeHistory(direction) {
    const quill = quillRef.current;
    if (!quill) return;
    quill.focus();
    quill.history[direction]();
  }

  return (
    <div className="flex flex-col gap-3xs">
      <label id={labelId} htmlFor={editorId} className={fieldLabelClass}>
        {label}
      </label>
      <p id={hintId} className={fieldHintClass}>
        Format selected text with the toolbar. Standard undo, redo, and text-formatting shortcuts also work.
      </p>
      <div
        className={`rounded-admin border-admin-hairline bg-admin-ground-input ${
          error ? 'border-admin-rule-alarm' : 'border-admin-rule-control'
        }`}
      >
        <div
          className="flex flex-wrap gap-2xs border-b-admin-hairline border-admin-rule-control bg-admin-ground-soft p-2xs"
          role="toolbar"
          aria-label={`${label} formatting`}
          aria-controls={editorId}
        >
          <button
            type="button"
            className={toolbarButtonClass}
            aria-pressed={Object.keys(formats).every((name) => !['header', 'list', 'blockquote', 'code-block'].includes(name))}
            onClick={setParagraph}
          >
            Paragraph
          </button>
          {INLINE_FORMATS.map((item) => (
            <button
              key={item.format}
              type="button"
              className={toolbarButtonClass}
              aria-pressed={active(item.format, true, formats)}
              aria-keyshortcuts={item.shortcut}
              onClick={() => toggleInline(item.format)}
            >
              {item.label}
            </button>
          ))}
          {BLOCK_FORMATS.map((item) => (
            <button
              key={`${item.format}-${String(item.value)}`}
              type="button"
              className={toolbarButtonClass}
              aria-pressed={active(item.format, item.value, formats)}
              onClick={() => setBlock(item.format, item.value)}
            >
              {item.label}
            </button>
          ))}
          <button type="button" className={toolbarButtonClass} onClick={insertDivider}>
            Divider
          </button>
          <button
            ref={linkButtonRef}
            type="button"
            className={toolbarButtonClass}
            aria-pressed={active('link', true, formats)}
            onClick={openLink}
          >
            Link
          </button>
          <button
            type="button"
            className={toolbarButtonClass}
            disabled={!history.undo}
            onClick={() => changeHistory('undo')}
          >
            Undo
          </button>
          <button
            type="button"
            className={toolbarButtonClass}
            disabled={!history.redo}
            onClick={() => changeHistory('redo')}
          >
            Redo
          </button>
        </div>
        {linkOpen ? (
          <div className="flex flex-wrap items-end gap-xs border-b-admin-hairline border-admin-rule-control bg-admin-ground-raised p-xs">
            <div className="min-w-64 flex-1">
              <label htmlFor={`${editorId}-link`} className={fieldLabelClass}>
                Link address
              </label>
              <input
                ref={linkInputRef}
                id={`${editorId}-link`}
                type="url"
                className={inputClass}
                value={linkValue}
                aria-invalid={linkError ? 'true' : undefined}
                aria-describedby={linkError ? `${editorId}-link-error` : undefined}
                onChange={(event) => {
                  setLinkValue(event.target.value);
                  setLinkError('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    applyLink();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeLink();
                  }
                }}
              />
              <FieldError id={`${editorId}-link-error`} message={linkError} />
            </div>
            <button type="button" className={secondaryButtonClass} onClick={applyLink}>
              Apply link
            </button>
            <button type="button" className={secondaryButtonClass} onClick={removeLink}>
              Remove link
            </button>
            <button type="button" className={secondaryButtonClass} onClick={closeLink}>
              Cancel
            </button>
          </div>
        ) : null}
        <div ref={mountRef} />
      </div>
      <p id={countId} className={fieldHintClass}>
        {count.toLocaleString()} {count === 1 ? 'character' : 'characters'}
      </p>
      {notice ? (
        <p id={noticeId} role="status" className="text-admin-sm text-admin-state-caution">
          {notice}
        </p>
      ) : null}
      <FieldError id={errorId} message={error} />
    </div>
  );
}
