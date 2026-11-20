import ScreenshotViewer from 'shared/ScreenshotViewer';
import { linkButtonClass } from './formControls.jsx';

export default function RequestScreenshots({ row, source, call }) {
  const count = row.screenshotDigests?.length ?? 0;
  if (count === 0) return null;
  return (
    <ScreenshotViewer
      count={count}
      readScreenshot={(index) => call('readRequestScreenshot', { source, id: row.id, index }, { freshToken: true })}
      className="mt-xs max-w-lg break-words text-admin-sm text-admin-ink"
      buttonClass={`mr-sm ${linkButtonClass}`}
    />
  );
}
