// The event's social accounts (#231): config/event.social, edited on the
// event settings page.
//
// `handles` is `{ platform, handle?, url }[]` (ADR 0001 §2.2). The site
// footer (components/Layout.jsx) and the email footer
// (functions/src/email/templates/layout.cjs, html and text) both list it,
// in this order. `hashtag` sits in the same block and is stored only:
// nothing on the site or in the mail prints it.
//
// The rows follow the repeater the venue editor already uses
// (VenueReferenceEditor.jsx): a labelled field per value, an add control in
// the panel head, a remove control per row, and focus moved to a control
// that still exists after a row goes. One thing is added: "Add account"
// moves focus into the new row, so a keyboard user types there rather than
// tabbing back down through every row above it.
//
// THE CHECK RUNS AT SUBMIT (issue #219), the way the map's does:
// validateSocialHandles below is called from AdminEventSettings's submit,
// which marks the fields, moves focus to the first one, and sends nothing.
// The save control is never disabled for it. The link is checked with
// shared/urlSafety, the same check the shared schema runs on the server, so
// the form and the server cannot disagree about what a safe link is.
import { useRef, useState } from 'react';
import { MAX_SOCIAL_LABEL_LENGTH } from 'shared/config';
import { safeUrlHref } from 'shared/urlSafety';
import { Panel, TextField, dangerButtonClass, secondaryButtonClass } from './formControls.jsx';

const EMPTY_HANDLES = Object.freeze([]);

export const blankSocialHandle = () => ({ platform: '', handle: '', url: '' });

/**
 * The stored accounts as form rows: every value a string, so each field is
 * controlled from the first render.
 *
 * @param {unknown} social config/event.social
 * @returns {Array<{ platform: string, handle: string, url: string }>}
 */
export function normalizeSocialHandles(social) {
  const handles = Array.isArray(social?.handles) ? social.handles : [];
  return handles
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      platform: typeof entry.platform === 'string' ? entry.platform : '',
      handle: typeof entry.handle === 'string' ? entry.handle : '',
      url: typeof entry.url === 'string' ? entry.url : '',
    }));
}

/**
 * The rows as the stored list. A blank handle is left out rather than sent
 * empty, and a link is sent in the canonical form shared/urlSafety approved,
 * so the stored string is the one the footer renders.
 *
 * @param {Array<{ platform: string, handle: string, url: string }>} handles
 * @returns {Array<{ platform: string, handle?: string, url: string }>}
 */
export function socialHandlesPayload(handles) {
  return (handles ?? []).map((entry) => {
    const handle = String(entry.handle ?? '').trim();
    const url = String(entry.url ?? '').trim();
    return {
      platform: String(entry.platform ?? '').trim(),
      ...(handle ? { handle } : {}),
      url: safeUrlHref(url) || url,
    };
  });
}

/**
 * Every problem with the rows, keyed by the field path the server names, so
 * a server refusal and this one mark the same field.
 *
 * @param {Array<{ platform: string, handle: string, url: string }>} handles
 * @returns {Map<string, string>} field path → message
 */
export function validateSocialHandles(handles) {
  const errors = new Map();
  const seen = new Set();
  const tooLong = `Use ${MAX_SOCIAL_LABEL_LENGTH} characters or fewer.`;
  for (const [index, entry] of (handles ?? []).entries()) {
    const at = `social.handles[${index}]`;
    const platform = String(entry.platform ?? '').trim();
    const handle = String(entry.handle ?? '').trim();
    const href = safeUrlHref(String(entry.url ?? ''));
    if (!platform) {
      errors.set(`${at}.platform`, 'Enter the service name, such as Mastodon.');
    } else if (platform.length > MAX_SOCIAL_LABEL_LENGTH) {
      errors.set(`${at}.platform`, tooLong);
    }
    if (handle.length > MAX_SOCIAL_LABEL_LENGTH) errors.set(`${at}.handle`, tooLong);
    if (!href) {
      errors.set(`${at}.url`, 'Enter the full link, starting with https:// or http://.');
    } else if (platform) {
      const account = `${platform}\u0000${href}`;
      if (seen.has(account)) errors.set(`${at}.url`, 'This account is already listed.');
      seen.add(account);
    }
  }
  return errors;
}

function afterRender(callback) {
  setTimeout(callback, 0);
}

/**
 * @param {object} props
 * @param {{ hashtag: string, handles: Array<object> }} props.social the form's social slice
 * @param {(patch: object) => void} props.onChange merges a patch into that slice
 * @param {(field: string) => string|undefined} props.errorFor
 */
export default function SocialHandlesEditor({ social, onChange, errorFor }) {
  const [notice, setNotice] = useState('');
  const listRef = useRef(null);
  const addRef = useRef(null);
  const removeRefs = useRef([]);
  const handles = social.handles ?? EMPTY_HANDLES;

  const changeHandle = (index, patch) =>
    onChange({
      handles: handles.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...patch } : entry,
      ),
    });

  const addHandle = () => {
    onChange({ handles: [...handles, blankSocialHandle()] });
    setNotice('');
    afterRender(() => listRef.current?.lastElementChild?.querySelector('input')?.focus());
  };

  const removeHandle = (index) => {
    onChange({ handles: handles.filter((_, entryIndex) => entryIndex !== index) });
    setNotice('The account will be removed when you save.');
    afterRender(() =>
      (removeRefs.current[index] || removeRefs.current[index - 1] || addRef.current)?.focus(),
    );
  };

  return (
    <Panel
      title="Social accounts"
      description="The event’s own accounts. The site footer and the footer of every built-in email list them in this order. Leave the list empty and neither footer shows social links."
      actions={
        <button ref={addRef} type="button" className={secondaryButtonClass} onClick={addHandle}>
          Add account
        </button>
      }
    >
      <div className="flex flex-col gap-sm">
        <div className="grid gap-sm sm:grid-cols-2">
          <TextField
            label="Social hashtag"
            value={social.hashtag}
            onChange={(value) => onChange({ hashtag: value })}
            error={errorFor('social.hashtag')}
            hint="One word, such as #EventName. The site and its email do not show it."
          />
        </div>
        {notice ? (
          <p role="status" className="text-admin-sm text-admin-ink-secondary">
            {notice}
          </p>
        ) : null}
        {handles.length === 0 ? (
          <p className="text-admin-sm text-admin-ink-secondary">No social accounts configured yet.</p>
        ) : (
          <ol ref={listRef} className="flex flex-col">
            {handles.map((entry, index) => (
              <li
                key={index}
                className="mt-sm border-admin-rule-hairline border-t-admin-hairline pt-sm first:mt-0 first:border-t-0 first:pt-0"
              >
                <div className="grid gap-sm sm:grid-cols-3">
                  <TextField
                    label={`Account ${index + 1} service`}
                    value={entry.platform}
                    onChange={(value) => changeHandle(index, { platform: value })}
                    error={
                      errorFor(`social.handles[${index}].platform`)
                      ?? errorFor(`social.handles[${index}]`)
                    }
                    maxLength={MAX_SOCIAL_LABEL_LENGTH}
                    hint="The name readers see, such as Mastodon."
                  />
                  <TextField
                    label={`Account ${index + 1} handle`}
                    value={entry.handle}
                    onChange={(value) => changeHandle(index, { handle: value })}
                    error={errorFor(`social.handles[${index}].handle`)}
                    maxLength={MAX_SOCIAL_LABEL_LENGTH}
                    hint="Optional, such as @eventname. It tells two accounts on one service apart."
                  />
                  <TextField
                    label={`Account ${index + 1} link`}
                    type="url"
                    value={entry.url}
                    onChange={(value) => changeHandle(index, { url: value })}
                    error={errorFor(`social.handles[${index}].url`)}
                    hint="The full address of the account, starting with https://."
                    className="font-admin-data"
                  />
                </div>
                <button
                  ref={(node) => {
                    removeRefs.current[index] = node;
                  }}
                  type="button"
                  className={`${dangerButtonClass} mt-sm`}
                  onClick={() => removeHandle(index)}
                >
                  Remove account {index + 1}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Panel>
  );
}
