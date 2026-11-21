import AdminPendingSave, { useAdminSaveState } from './AdminPendingSave.jsx';
import { useEffect, useRef, useState } from 'react';
import { isDrawable } from '../../contexts/ContentContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { DELETE_FIELD_SENTINEL, toEditableContent, validateRequiredContent } from '../contentDoc.js';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { uniqueEditorialId } from '../editorialId.js';
import { byStoredOrder, nextStoredOrder } from '../reorder.js';
import { summarizePublish } from '../publishResult.js';
import { EditorActionFeedback } from './ActionFeedback.jsx';
import { Notice, Panel, ServerErrorSummary, TextField, primaryButtonClass, secondaryButtonClass } from './formControls.jsx';
import ImagePicker from './media/ImagePicker.jsx';
import { ImagePlacementFields, ImagePlacementPreview } from './media/ImagePlacementEditor.jsx';
import BusyLabel from '../../components/BusyLabel.jsx';

// Both entry points edit cmsContent/hero__<field>. Theme configuration never
// holds a second copy. Read merged live/draft rows, as the content editor does.
const EDITED_FIELDS = ['url', 'alt', 'captionMode', 'captionAlign'];

export default function HomeHeroImageEditor({ page, rows, ready, disabled = false, branding = false, onEditStateChange }) {
  const call = useAdminApi();
  const { eventConfig } = useEventConfig();
  const section = page?.current?.sections?.find((item) => item.id === 'hero');
  const blocks = byStoredOrder(rows.filter((row) => row.current?.section === 'hero'));
  const image = blocks.find((row) => row.current?.blockType === 'image' && isDrawable(row.current));
  const imageId = image?.id ?? null;
  const [edit, setEdit] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [savedField, setSavedField] = useState(null);
  const { action: busy, set: setBusy, begin: beginSave, capture: captureUnconfirmed, unconfirmed, offline } = useAdminSaveState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const observedImage = useRef(null);
  const errorRef = useRef(null);
  const values = edit ?? toEditableContent(image?.current, 'image').values;
  const dirty = edit !== null && EDITED_FIELDS.some((field) => edit[field] !== baseline?.[field]);
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
    if (busy || unavailable || disabled) return;
    setError(null);
    setStatus('');
    const cleanValues = { ...values, url: values.url.trim(), alt: values.alt.trim() };
    const fields = { url: cleanValues.url, alt: cleanValues.alt };
    for (const key of ['captionMode', 'captionAlign']) {
      if (values[key]) fields[key] = values[key];
      else if (baseline?.[key] || image?.current?.[key]) fields[key] = DELETE_FIELD_SENTINEL;
    }
    const fieldErrors = validateRequiredContent({ blockType: 'image', values: fields });
    if (fieldErrors.length) {
      setError({ message: 'Choose a picture and describe it first.', fieldErrors, clientValidation: true });
      return;
    }
    if (!beginSave(true)) return;
    const existingField = image?.current?.field ?? savedField;
    const field = existingField ?? uniqueEditorialId('image', blocks.map((row) => row.current.field));
    let draftSaved = false;
    try {
      const response = await call(existingField ? 'cmsUpdateContent' : 'cmsCreateContent', {
        section: 'hero',
        field,
        // A partial update preserves any caption text, crop, order and visibility.
        fields: existingField ? fields : { blockType: 'image', ...fields, order: nextStoredOrder(blocks) },
        ...(!existingField ? { pageId: page.id, visible: true } : {}),
      });
      setSavedField(field);
      setBaseline(cleanValues);
      setEdit((current) => current === values ? cleanValues : current);
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
      if (captureUnconfirmed(err)) return;
      setError(draftSaved ? { ...err, message: `The image draft is saved, but it was not published. ${err.message}` } : err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel help="Choose the picture shown at the top of the home page." title={branding ? 'Homepage hero image' : 'Hero image'}>
      <fieldset
        disabled={busy || disabled || unavailable}
        className="flex min-w-0 flex-col gap-sm"
        onKeyDown={(event) => {
          // These content inputs sit inside Branding's theme form. Enter
          // must not submit the theme while someone edits the picture.
          if (event.key === 'Enter' && event.target.tagName === 'INPUT') event.preventDefault();
        }}
      >
        <ImagePicker help="Choose or upload a picture for the top of the home page."
          label={branding ? 'Homepage hero image' : 'Hero image'}
          folder="cms-images"
          value={values.url}
          onChange={(value) => change('url', value)}
          hint={branding ? 'The picture at the top of your home page.' : null}
          error={fieldErrors.get('url')}
        />
        <TextField help="Describe the picture for people who can’t see it."
          label="Alt text"
          value={values.alt}
          onChange={(value) => change('alt', value)}
          aria-required="true"
          
          error={fieldErrors.get('alt')}
        />
        {values.url ? (
          <div className="grid gap-sm sm:grid-cols-2">
            <ImagePlacementFields values={values} onChange={change} errorFor={(field) => fieldErrors.get(field)} />
          </div>
        ) : null}
        <ImagePlacementPreview image={{ ...values, descriptionOverride: image?.current?.descriptionOverride }} hero="home" eventName={eventConfig.name} />
        <div className="flex flex-wrap gap-xs">
          <button type="button" className={secondaryButtonClass} disabled={unconfirmed} onClick={() => save(false)}>
            <BusyLabel busy={busy} pending="Saving the draft…">Save draft</BusyLabel>
          </button>
          <button type="button" className={primaryButtonClass} disabled={unconfirmed} onClick={() => save(true)}>
            Publish
          </button>
        </div>
      </fieldset>
      {unavailable ? <Notice tone="caution" message={!ready
        ? 'Loading the home page…'
        : full
          ? `The top of your home page is full (${maxBlocks} items). Remove one to add a picture.`
          : 'This home page has no place for a picture at the top.'} /> : null}
      <AdminPendingSave busy={busy} unconfirmed={unconfirmed} offline={offline} />
      <ServerErrorSummary error={error} errorRef={errorRef} title="The image was not saved or published" />
      <EditorActionFeedback status={status} error={error} />
    </Panel>
  );
}
