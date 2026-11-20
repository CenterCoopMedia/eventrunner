import ScreenshotField from 'shared/ScreenshotField';
import { linkButtonClass } from './formControls.jsx';

export default function AdminScreenshotField(props) {
  return (
    <ScreenshotField
      {...props}
      data-help-skip="The field includes instructions for choosing, pasting and dropping images."
      className="min-w-0 space-y-2xs border-admin-hairline border-dashed border-admin-rule-hairline px-sm pb-xs text-admin-sm text-admin-ink [&_legend]:px-2xs [&_legend]:font-semibold [&_li]:break-words"
      inputClass="w-full min-w-0 focus-visible:outline focus-visible:outline-2 file:mr-xs"
      buttonClass={linkButtonClass}
    />
  );
}
