// DefaultAvatarPicker — the neutral stand-ins a person may choose instead
// of uploading anything (issue #175).
//
// A RADIO GROUP, because "which of these six" is one choice from a fixed
// set, and a radio group is the control the keyboard already drives: arrow
// keys move within the group, tab reaches it and leaves it. The images are
// decoration beside the words — each choice's name is in its label, so the
// group reads correctly without seeing a single one.
//
// A chosen default is stored as a reserved `default-avatars/<file>` path —
// no upload, no storage object (lib/mediaSource.js). "None" is in the
// group, because a control that can only add is half a control.
import { DEFAULT_AVATARS } from '../../lib/mediaSource.js';
import { Radio } from '../forms/Choice.jsx';

/**
 * @param {{
 *   value: string,             // the current photoPath, whatever kind it is
 *   onChange: (path: string) => void,
 *   namePrefix: string,        // unique per field: 'profile' | 'speaker'
 * }} props
 */
export default function DefaultAvatarPicker({ value, onChange, namePrefix }) {
  const selected = DEFAULT_AVATARS.some((avatar) => avatar.path === value) ? value : 'none';
  return (
    <fieldset className="mt-sm">
      <legend className="font-data text-caption font-semibold text-text-primary">
        Or pick a neutral avatar
      </legend>
      <div className="mt-xs grid grid-cols-2 gap-xs sm:grid-cols-4">
        <Radio
          name={`${namePrefix}-default-avatar`}
          value="none"
          label="None"
          checked={selected === 'none'}
          onChange={() => onChange('')}
        />
        {DEFAULT_AVATARS.map((avatar) => (
          <Radio
            key={avatar.path}
            name={`${namePrefix}-default-avatar`}
            value={avatar.path}
            label={avatar.label}
            checked={selected === avatar.path}
            onChange={() => onChange(avatar.path)}
          />
        ))}
      </div>
    </fieldset>
  );
}
