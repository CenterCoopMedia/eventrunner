import ScreenshotField from 'shared/ScreenshotField';
import { secondaryActionClass } from '../controlClasses.js';

export default function PublicScreenshotField(props) {
  return (
    <ScreenshotField
      {...props}
      className="min-w-0 space-y-2xs rounded-brand border-hairline border-dashed border-rule-strong px-sm pb-xs text-caption text-text-secondary [&_legend]:px-2xs [&_legend]:font-semibold [&_legend]:text-text-primary [&_li]:break-words"
      inputClass="w-full min-w-0 rounded-brand focus-visible:outline focus-visible:outline-2 file:mr-xs"
      buttonClass={secondaryActionClass}
    />
  );
}
