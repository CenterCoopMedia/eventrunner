// The public form controls, in four states.
//
// The shape is the same on the public site and in the admin, because
// accessibility is not a tier: a real label tied by id and sitting above
// its own input, the hint under the label, a boundary that clears 3:1
// against the ground, and the error under the field as text.
//
// A label above its own input is the one thing the eyebrow ban does not
// touch. It is a control label, not an eyebrow.
//
// THE CHECKBOX AND THE RADIO ARE NOT HERE. They were composed in this file
// out of native inputs while the shared module was being written, and a
// native input is painted by the operating system: a client's palette and
// dark mode both stop at its edge. components/forms/Choice.jsx now draws
// them from the tokens, so they are shared controls and they are drawn with
// the other controls in the section above.
import { useState } from 'react';
import { inputClass } from '../../../components/controlClasses.js';
import { SelectField, TextAreaField, TextField } from '../../../components/forms/publicForm.jsx';
import Figure from '../Figure.jsx';
import SpecimenSection from '../SpecimenSection.jsx';
import { FORCED_FOCUS } from '../controls/states.js';
import { eventConfig } from '@generated/eventConfig.js';

const FIELD_STATES = Object.freeze(['Rest', 'Focus-visible', 'Error', 'Disabled']);

const ROOM_OPTIONS = eventConfig.venue.places.map((place) => ({
  value: place.id,
  label: place.name,
}));

function StateColumn({ label, children }) {
  return (
    <div className="flex flex-col gap-2xs">
      <p className="font-data text-caption text-text-secondary">{label}</p>
      {children}
    </div>
  );
}

function TextFieldStates() {
  const [value, setValue] = useState('Marisol Reyes');
  return (
    <div className="grid gap-lg sm:grid-cols-2">
      <StateColumn label={FIELD_STATES[0]}>
        <TextField label="Your name" value={value} onChange={setValue} />
      </StateColumn>
      <StateColumn label={FIELD_STATES[1]}>
        <TextField
          label="Your name"
          value={value}
          onChange={setValue}
          className={`${inputClass} ${FORCED_FOCUS}`}
        />
      </StateColumn>
      <StateColumn label={FIELD_STATES[2]}>
        <TextField
          label="Your name"
          value=""
          onChange={() => {}}
          error="Enter the name you want on your badge."
        />
      </StateColumn>
      <StateColumn label={FIELD_STATES[3]}>
        <TextField label="Your name" value={value} onChange={() => {}} disabled />
      </StateColumn>
    </div>
  );
}

function SelectFieldStates() {
  const [room, setRoom] = useState(ROOM_OPTIONS[0].value);
  return (
    <div className="grid gap-lg sm:grid-cols-2">
      <StateColumn label={FIELD_STATES[0]}>
        <SelectField label="Room" value={room} onChange={setRoom} options={ROOM_OPTIONS} />
      </StateColumn>
      <StateColumn label={FIELD_STATES[1]}>
        <SelectField
          label="Room"
          value={room}
          onChange={setRoom}
          options={ROOM_OPTIONS}
          className={`${inputClass} ${FORCED_FOCUS}`}
        />
      </StateColumn>
      <StateColumn label={FIELD_STATES[2]}>
        <SelectField
          label="Room"
          value={room}
          onChange={() => {}}
          options={ROOM_OPTIONS}
          error="Pick the room this session runs in."
        />
      </StateColumn>
      <StateColumn label={FIELD_STATES[3]}>
        <SelectField
          label="Room"
          value={room}
          onChange={() => {}}
          options={ROOM_OPTIONS}
          disabled
        />
      </StateColumn>
    </div>
  );
}

function TextAreaStates() {
  const [note, setNote] = useState(
    'Setting up a cross-newsroom reporting partnership, from shared documents to shared bylines.',
  );
  return (
    <div className="grid gap-lg sm:grid-cols-2">
      <StateColumn label={FIELD_STATES[0]}>
        <TextAreaField label="Session description" value={note} onChange={setNote} />
      </StateColumn>
      <StateColumn label={FIELD_STATES[1]}>
        <TextAreaField
          label="Session description"
          value={note}
          onChange={setNote}
          className={`${inputClass} ${FORCED_FOCUS}`}
        />
      </StateColumn>
      <StateColumn label={FIELD_STATES[2]}>
        <TextAreaField
          label="Session description"
          value=""
          onChange={() => {}}
          error="Describe the session in one or two sentences."
        />
      </StateColumn>
      <StateColumn label={FIELD_STATES[3]}>
        <TextAreaField label="Session description" value={note} onChange={() => {}} disabled />
      </StateColumn>
    </div>
  );
}

export default function InputsSection({ folio }) {
  return (
    <SpecimenSection
      id="specimen-inputs"
      title="Inputs"
      folio={folio}
      standfirst="Four states for every field: at rest, under the keyboard, refused, and unavailable."
    >
      <Figure
        name="Text field"
        file="components/forms/publicForm.jsx"
        contract="--color-border-control-rgb"
        note="The boundary reads the control token, never the hairline: a hairline is tuned for low-contrast structure and falls short of 3:1."
      >
        <TextFieldStates />
      </Figure>

      <Figure
        name="Select field"
        file="components/forms/publicForm.jsx"
        contract="--color-border-control-rgb"
        note="A native select. The error sits under the field and is named by aria-describedby."
      >
        <SelectFieldStates />
      </Figure>

      <Figure
        name="Text area"
        file="components/forms/publicForm.jsx"
        contract="--color-border-control-rgb"
        note="Same field shape at three rows. Nothing about the error is colour alone."
      >
        <TextAreaStates />
      </Figure>
    </SpecimenSection>
  );
}
