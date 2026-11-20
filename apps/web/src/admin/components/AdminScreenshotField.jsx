import ScreenshotField from '@screenshot-ui/ScreenshotField.jsx';
import { linkButtonClass } from './formControls.jsx';

export default function AdminScreenshotField(props) {
  return (
    <ScreenshotField
      {...props}
      data-help-skip="The field includes instructions for choosing, pasting and dropping images."
      className="min-w-0 space-y-2xs border-admin-hairline border-dashed border-admin-rule-hairline px-sm pb-xs text-admin-sm text-admin-ink"
      legendClass="px-2xs font-semibold"
      inputClass="w-full min-w-0 focus-visible:outline focus-visible:outline-2"
      buttonClass={linkButtonClass}
    />
  );
}
