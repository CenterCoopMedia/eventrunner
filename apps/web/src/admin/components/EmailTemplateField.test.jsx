import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { displayTemplate, storedTemplate, emailHtmlFromText, TemplateMessageField } from './EmailTemplateField.jsx';

describe('planner email fields', () => {
  it('round trips readable details and conditional sections to the existing template contract', () => {
    const original = '{{speaker_name}}: {{#if materials_sessions}}{{materials_sessions}}{{/if}} {{dashboard_url}} {{event_name}}';
    const shown = displayTemplate(original);
    expect(shown).not.toContain('{{');
    expect(shown).toContain('[Speaker name]');
    expect(storedTemplate(shown)).toBe(original);
  });
  it('keeps template links and escapes typed markup when updating the message', () => {
    const html = emailHtmlFromText('<script>alert("x")</script>\n\n{{invite_url}}');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<a href="{{invite_url}}">Invitation link</a>');
  });
  it('inserts a chosen detail at the cursor without showing its stored key', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(); return 1; });
    function Editor() {
      const [value, setValue] = useState('Hello there');
      return <TemplateMessageField label="Message" value={value} onChange={setValue} tokens={['speaker_name']} />;
    }
    render(<Editor />);
    const field = screen.getByLabelText('Message');
    field.setSelectionRange(6, 11);
    fireEvent.change(screen.getByLabelText('Add a detail to message'), { target: { value: 'speaker_name' } });
    expect(field).toHaveValue('Hello [Speaker name]');
  });
});
