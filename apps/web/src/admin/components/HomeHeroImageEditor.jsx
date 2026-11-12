import { useEffect, useRef, useState } from 'react';
import { isDrawable } from '../../contexts/ContentContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { toEditableContent, validateRequiredContent } from '../contentDoc.js';
import { uniqueEditorialId } from '../editorialId.js';
import { byStoredOrder, nextStoredOrder } from '../reorder.js';
import { summarizePublish } from '../publishResult.js';
import { EditorActionFeedback } from './ActionFeedback.jsx';
import { ActionLabel, Notice, Panel, ServerErrorSummary, TextField, primaryButtonClass, secondaryButtonClass } from './formControls.jsx';
import ImagePicker from './media/ImagePicker.jsx';

// Both entry points edit cmsContent/hero__<field>. Theme configuration never
// holds a second copy. Read merged live/draft rows, as the content editor does.
export default function HomeHeroImageEditor({ page, rows, ready, disabled = false, branding = false, onEditStateChange }) {
  const call = useAdminApi();
  const section = page?.current?.sections?.find((item) => item.id === 'hero');
  const blocks = byStoredOrder(rows.filter((row) => row.current?.section === 'hero'));
  const image = blocks.find((row) => row.current?.blockType === 'image' && isDrawable(row.current));
  const imageId = image?.id ?? null;
  const [edit, setEdit] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [savedField, setSavedField] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const pending = useRef(false);
  const observedImage = useRef(null);
  const errorRef = useRef(null);
  const values = edit ?? toEditableContent(image?.current, 'image').values;
  const dirty = edit !== null && (edit.url !== baseline?.url || edit.alt !== baseline?.alt);
  const maxBlocks = Number.isFinite(section?.maxBlocks) ? section.maxBlocks : Infinity;
  const full = !image && !savedField && blocks.length >= maxBlocks;
  const unavailable = !ready || !section || (!image && !section.allowedBlocks?.includes('image')) || full;
  const fieldErrors = new Map((error?.fieldErrors ?? []).map((item) => [item.field, item.message]));

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    onEditStateChange({ dirty, busy });
  }, [dirty, busy, onEditStateChange]);

  useEffect(() => () => onEditStateChange({ dirty: false, busy: false }), [onEditStateChange]);

  useEffect(() => {
    if (!ready || busy) return;
    if (observedImage.current && !imageId) {
      setSavedField(null);
      if (!dirty) {
        setEdit(null);
        setBaseline(null);
      }
      setError(null);
      setStatus('');
    }
    observedImage.current = imageId;
  }, [ready, busy, imageId, dirty]);

  function change(name, value) {
    if (edit === null) setBaseline(values);
    setEdit((current) => ({ ...(current ?? values), [name]: value }));
    setStatus('');
  }

  async function save(publish) {
    if (pending.current || unavailable || disabled) return;
    setError(null);
    setStatus('');
    const fields = { url: values.url.trim(), alt: values.alt.trim() };
    const fieldErrors = validateRequiredContent({ blockType: 'image', values: fields });
    if (fieldErrors.length) {
      setError({ message: 'Choose a picture and describe it first.', fieldErrors, clientValidation: true });
      return;
    }
    pending.current = true;
    setBusy(true);
    const existingField = image?.current?.field ?? savedField;
    const field = existingField ?? uniqueEditorialId('image', blocks.map((row) => row.current.field));
    let draftSaved = false;
    try {
      const response = await call(existingField ? 'cmsUpdateContent' : 'cmsCreateContent', {
        section: 'hero',
        field,
        // A partial update preserves the caption, crop, order and visibility.
        fields: existingField ? fields : { blockType: 'image', ...fields, order: nextStoredOrder(blocks) },
        ...(!existingField ? { pageId: page.id, visible: true } : {}),
      });
      setSavedField(field);
      setBaseline(fields);
      setEdit((current) => current === values ? fields : current);
      draftSaved = true;
      if (!publish) {
        setStatus('Draft saved. Publish to show it on your site.');
        return;
      }
      const docId = response.docId ?? `hero__${field}`;
      const result = await call('cmsPublish', { collection: 'cmsContent', docIds: [docId] });
      const verdict = summarizePublish(result, 'cmsContent', [docId]);
      if (!verdict.ok) throw new Error(verdict.message);
      setStatus(verdict.message);
    } catch (err) {
      setError(draftSaved ? { ...err, message: `The image draft is saved, but it was not published. ${err.message}` } : err);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Panel title={branding ? 'Homepage hero image' : 'Hero image'}>
      <fieldset
        disabled={busy || disabled || unavailable}
        className="flex min-w-0 flex-col gap-sm"
        onKeyDown={(event) => {
          // These content inputs sit inside Branding's theme form. Enter
          // must not submit the theme while someone edits the picture.
          if (event.key === 'Enter' && event.target.tagName === 'INPUT') event.preventDefault();
        }}
      >
        <ImagePicker
          label={branding ? 'Homepage hero image' : 'Hero image'}
          folder="cms-images"
          value={values.url}
          onChange={(value) => change('url', value)}
          hint={branding ? 'The picture at the top of your home page.' : null}
          error={fieldErrors.get('url')}
        />
        <TextField
          label="Alt text"
          value={values.alt}
          onChange={(value) => change('alt', value)}
          aria-required="true"
          hint="Describe the picture for people who can’t see it."
          error={fieldErrors.get('alt')}
        />
        <div className="flex flex-wrap gap-xs">
          <button type="button" className={secondaryButtonClass} onClick={() => save(false)}>
            <ActionLabel busy={busy} pending="Saving…">Save draft</ActionLabel>
          </button>
          <button type="button" className={primaryButtonClass} onClick={() => save(true)}>
            Publish
          </button>
        </div>
      </fieldset>
      {unavailable ? <Notice tone="caution" message={!ready
        ? 'Loading…'
        : full
          ? `The top of your home page is full (${maxBlocks} items). Remove one to add a picture.`
          : 'This home page has no place for a picture at the top.'} /> : null}
      <ServerErrorSummary error={error} errorRef={errorRef} title="The image was not saved or published" />
      <EditorActionFeedback status={status} error={error} />
    </Panel>
  );
}
