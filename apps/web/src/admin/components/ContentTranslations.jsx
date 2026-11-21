import { lazy, Suspense } from 'react';
import { resolveContentVariant, richVariantFields, variantFields } from 'shared/contentLanguages';
import EditorDisclosure from './EditorDisclosure.jsx';
import { TextAreaField, TextField, secondaryButtonClass } from './formControls.jsx';

const RichTextEditor = lazy(() => import('./RichTextEditor.jsx'));
const BILINGUAL = { contentLanguages: { default: 'en', available: ['en', 'es'] } };
const LABELS = { label: 'Label', title: 'Heading', description: 'Description', value: 'Text',
  alt: 'Alternative text', caption: 'Caption', takeaway: 'Finding', note: 'Note', text: 'Text',
  question: 'Question', answer: 'Answer', benefits: 'Benefits' };

/** Paired content uses the same Save draft / Publish actions as its source. */
export default function ContentTranslations({ kind, record, onChange, onNormalize, labels = {}, errorFor }) {
  const fields = variantFields(kind, record);
  if (!fields.length) return null;
  const spanish = record.translations?.es ?? {};
  const rich = kind === 'block' ? richVariantFields(record) : [];
  const complete = resolveContentVariant(record, kind, 'es', BILINGUAL).language === 'es';
  const change = (field, value) => onChange({ es: { ...spanish, [field]: value } });
  return (
    <EditorDisclosure title="Spanish translation" className="sm:col-span-2" help="Save and publish the English source and Spanish translation together."
      reveal={fields.some((field) => errorFor?.(`translations.es.${field}`))}>
      <p className="text-admin-sm text-admin-ink-secondary">
        Save both languages as one draft. Publishing approves both together. English stays in the main fields.
        {' '}{complete ? 'This translation is complete.' : 'Until every source field is translated, this whole item falls back to English.'}
      </p>
      <div className="flex flex-col gap-sm">
        {fields.map((field) => {
          const props = {
            label: `Spanish ${labels[field] ?? LABELS[field] ?? field}`,
            value: spanish[field] ?? '', onChange: (value) => change(field, value),
            error: errorFor?.(`translations.es.${field}`),
          };
          if (rich.includes(field)) return (
            <Suspense key={field} fallback={<p role="status">Loading formatted text editor…</p>}>
              <RichTextEditor {...props} onNormalize={(stored, normalized) => onNormalize?.(field, stored, normalized, 'es')}
                help="Enter the reviewed Spanish wording. Leave unfinished text in the draft until it is ready to publish." />
            </Suspense>
          );
          return field === 'description' || field === 'text'
            ? <TextAreaField key={field} {...props} rows={4} help="Enter the reviewed Spanish wording. Leave unfinished text in the draft until it is ready to publish." />
            : <TextField key={field} {...props} help="Enter the reviewed Spanish wording. Leave unfinished text in the draft until it is ready to publish." />;
        })}
        {record.translations && Object.keys(record.translations).length > 0 ? (
          <button type="button" className={secondaryButtonClass} onClick={() => onChange({})}>Remove Spanish translation</button>
        ) : null}
      </div>
    </EditorDisclosure>
  );
}
