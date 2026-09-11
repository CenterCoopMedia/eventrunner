// The crop step (issue #175): what the keyboard can do, and what Apply and
// Cancel hand back. jsdom lays out nothing, loads no images, and draws no
// canvas, so the test stands in for each of those and asserts what the
// component does with them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PhotoCrop from './PhotoCrop.jsx';

function aFile(name = 'photo.jpg') {
  return new File(['bytes'], name, { type: 'image/jpeg' });
}

// A stand-in for the picture: loads immediately, and knows a wide shape so
// the pan maths has somewhere to travel.
class FakeImage {
  constructor() {
    this.naturalWidth = 400;
    this.naturalHeight = 200;
    this.onload = null;
    this.srcValue = '';
  }
  set src(value) {
    this.srcValue = value;
    queueMicrotask(() => this.onload?.());
  }
  get src() {
    return this.srcValue;
  }
}

function renderCrop(props = {}) {
  const onApply = vi.fn();
  const onCancel = vi.fn();
  render(
    <PhotoCrop
      file={aFile()}
      label="your profile photo"
      onApply={onApply}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onApply, onCancel };
}

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage);
  // jsdom ships neither object URLs nor canvas; the component needs both
  // to exist, and the assertions only need them to record.
  URL.createObjectURL = vi.fn(() => 'blob:fixture');
  URL.revokeObjectURL = vi.fn();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete HTMLCanvasElement.prototype.toBlob;
});

describe('PhotoCrop', () => {
  it('the arrow keys move the crop, and Shift moves it faster', async () => {
    renderCrop();
    const box = await screen.findByRole('application');
    box.focus();

    const x = () => Number(box.querySelector('img')?.getAttribute('data-offset-x'));
    const before = x();
    fireEvent.keyDown(box, { key: 'ArrowLeft' });
    const oneStep = x();
    expect(oneStep).toBe(before - 12);

    fireEvent.keyDown(box, { key: 'ArrowLeft', shiftKey: true });
    expect(x()).toBe(oneStep - 60);
  });

  it('the arrow keys stay inside the picture at the smallest zoom', async () => {
    renderCrop();
    const box = await screen.findByRole('application');

    for (let index = 0; index < 20; index += 1) {
      fireEvent.keyDown(box, { key: 'ArrowRight' });
    }
    // The picture is 400×200 in a 224px square: the HEIGHT governs the
    // cover, so the drawn width is 448 and the travel is (448 − 224) / 2.
    const x = () => Number(box.querySelector('img')?.getAttribute('data-offset-x'));
    expect(x()).toBeCloseTo(112, 6);
  });

  it('the zoom slider is a native range input the keyboard already drives', () => {
    renderCrop();
    const zoom = screen.getByLabelText('Zoom');
    expect(zoom).toHaveAttribute('type', 'range');
    expect(zoom).toHaveAttribute('min', '1');
  });

  it('Apply hands the field a square File with its own name', async () => {
    const toBlob = vi.fn((callback) => callback(new Blob(['x'], { type: 'image/jpeg' })));
    HTMLCanvasElement.prototype.toBlob = toBlob;
    const { onApply } = renderCrop();

    // The button is disabled until the picture has loaded.
    const box = await screen.findByRole('application');
    await vi.waitFor(() => expect(box.querySelector('img')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Use this crop' }));
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    const file = onApply.mock.calls[0][0];
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('cropped.jpg');
  });

  it('Cancel hands nothing back', () => {
    const { onApply, onCancel } = renderCrop();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('states what the square shows is what gets saved', () => {
    renderCrop();
    expect(
      screen.getByText(/What the square shows is what gets saved/),
    ).toBeInTheDocument();
  });
});
