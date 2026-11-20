import ScreenshotField from '@screenshot-ui/ScreenshotField.jsx';
import { secondaryActionClass } from '../controlClasses.js';

export default function PublicScreenshotField(props) {
  return (
    <ScreenshotField
      {...props}
      className="min-w-0 space-y-2xs rounded-brand border-hairline border-dashed border-rule-strong px-sm pb-xs text-caption text-text-secondary"
      legendClass="px-2xs font-semibold text-text-primary"
      inputClass="w-full min-w-0 rounded-brand focus-visible:outline focus-visible:outline-2"
      buttonClass={secondaryActionClass}
    />
  );
}
