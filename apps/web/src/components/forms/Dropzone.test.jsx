// Dropzone: a real file input inside a ruled region, a stated progress line,
// and a sent list with a state word.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Dropzone from './Dropzone.jsx';
import { renderInEveryStyle } from '../../test/everyStyle.jsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexCss = fs.readFileSync(path.resolve(here, '..', '..', 'index.css'), 'utf8');

const file = (name) => new File(['x'], name, { type: 'application/pdf' });

describe('Dropzone', () => {
  it('holds a real, labelled file input inside the region', () => {
    render(<Dropzone label="Session slides" hint="PDF, up to 5 MB." onFiles={() => {}} accept={['application/pdf']} />);
    const input = screen.getByLabelText('Session slides');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', 'application/pdf');
    expect(input.closest('.dropzone')).not.toBeNull();
    expect(input).toHaveAccessibleDescription('PDF, up to 5 MB.');
  });

  it('hands over a picked file and a dropped file the same way', () => {
    const onFiles = vi.fn();
    render(<Dropzone label="Session slides" onFiles={onFiles} />);
    const input = screen.getByLabelText('Session slides');
    fireEvent.change(input, { target: { files: [file('deck.pdf')] } });
    expect(onFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'deck.pdf' })]);
    const region = input.closest('.dropzone');
    fireEvent.drop(region, { dataTransfer: { files: [file('notes.pdf')] } });
    expect(onFiles).toHaveBeenLastCalledWith([expect.objectContaining({ name: 'notes.pdf' })]);
  });

  it('takes one file unless told it may take several', () => {
    const onFiles = vi.fn();
    const { rerender } = render(<Dropzone label="Slides" onFiles={onFiles} />);
    fireEvent.change(screen.getByLabelText('Slides'), { target: { files: [file('a.pdf'), file('b.pdf')] } });
    expect(onFiles).toHaveBeenLastCalledWith([expect.objectContaining({ name: 'a.pdf' })]);
    rerender(<Dropzone label="Slides" onFiles={onFiles} multiple />);
    fireEvent.change(screen.getByLabelText('Slides'), { target: { files: [file('a.pdf'), file('b.pdf')] } });
    expect(onFiles.mock.lastCall[0]).toHaveLength(2);
  });

  it('marks the region while a file is held over it, and clears the mark', () => {
    render(<Dropzone label="Slides" onFiles={() => {}} />);
    const region = screen.getByLabelText('Slides').closest('.dropzone');
    fireEvent.dragOver(region);
    expect(region).toHaveAttribute('data-dragging', 'true');
    fireEvent.dragLeave(region);
    expect(region).not.toHaveAttribute('data-dragging');
  });

  it('states the progress with a progress element, never a spinner', () => {
    const { container } = render(
      <Dropzone label="Slides" onFiles={() => {}} progress={{ value: 1, max: 3 }} />,
    );
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('1 of 3 files sent');
    expect(container.querySelector('[class*="animate-"]')).toBeNull();
  });

  it('is busy while files go, and says so on the region', () => {
    const { rerender } = render(
      <Dropzone label="Slides" onFiles={() => {}} progress={{ value: 1, max: 3 }} />,
    );
    const region = screen.getByLabelText('Slides').closest('.dropzone');
    expect(region).toHaveAttribute('aria-busy', 'true');
    rerender(<Dropzone label="Slides" onFiles={() => {}} progress={null} />);
    expect(region).not.toHaveAttribute('aria-busy');
  });

  it('announces the progress line and the sent list through one status region', () => {
    render(
      <Dropzone
        label="Slides"
        onFiles={() => {}}
        progress={{ value: 1, max: 2 }}
        sent={[{ id: '1', name: 'deck.pdf', state: 'sent' }]}
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toContainElement(screen.getByRole('progressbar'));
    expect(status).toContainElement(screen.getByRole('list'));
  });

  it('invites the drop in one sentence and keeps the control its own label', () => {
    render(<Dropzone label="Slides" onFiles={() => {}} />);
    expect(screen.getByText('Drop a file here.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeInTheDocument();
    expect(screen.queryByText(/here, or/u)).toBeNull();
  });

  it('lists what was sent with a state word per file', () => {
    render(
      <Dropzone
        label="Slides"
        onFiles={() => {}}
        sent={[
          { id: '1', name: 'deck.pdf', state: 'sent' },
          { id: '2', name: 'notes.pdf', state: 'failed', detail: 'Too large.' },
          { id: '3', name: 'more.pdf', state: 'sending' },
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual(['deck.pdfSent', 'notes.pdfFailed — Too large.', 'more.pdfSending…']);
  });

  it('states a refusal under the region and marks the input invalid', () => {
    render(<Dropzone label="Slides" onFiles={() => {}} error="That file is 9 MB. The limit is 5 MB." />);
    const input = screen.getByLabelText('Slides');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('That file is 9 MB. The limit is 5 MB.');
  });

  it('draws the alarm rule on the region in error, so the refusal is never the red sentence alone', () => {
    const { rerender } = render(<Dropzone label="Slides" onFiles={() => {}} error="Too large." />);
    const region = screen.getByLabelText('Slides').closest('.dropzone');
    expect(region).toHaveAttribute('data-invalid', 'true');
    rerender(<Dropzone label="Slides" onFiles={() => {}} />);
    expect(region).not.toHaveAttribute('data-invalid');
    // The rule is the state grammar's: the strong width in the danger ink,
    // the same alarm a checkbox in error draws (index.css).
    const rule = indexCss.match(/\.dropzone\[data-invalid='true'\] \{[^}]*\}/u)?.[0] ?? '';
    expect(rule).toContain('border-width: var(--rule-strong-width)');
    expect(rule).toContain('--semantic-danger-rgb');
  });

  it('widens the rule as well as solidifying it while a file is held over the region', () => {
    // A style whose rest rule is already solid (Atlas, Zine) would otherwise
    // show the drag-over state by colour alone.
    const rule = indexCss.match(/\.dropzone\[data-dragging='true'\] \{[^}]*\}/u)?.[0] ?? '';
    expect(rule).toContain('border-style: solid');
    expect(rule).toContain('border-width: var(--dropzone-drag-rule-width)');
  });

  it('opens the picker from the stated control', () => {
    render(<Dropzone label="Slides" onFiles={() => {}} />);
    const input = screen.getByLabelText('Slides');
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Choose a file' }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('renders in every style and both modes', () => {
    renderInEveryStyle(<Dropzone label="Slides" onFiles={() => {}} />, (container, pair) => {
      expect(container.querySelector('.dropzone input[type="file"]'), `${pair.style} ${pair.mode}`).not.toBeNull();
    });
  });
});
