// Save text the server sent as a file in the admin's browser (the attendee
// export, issue #184). The file never exists anywhere else: the endpoint
// returns it in the response body and this writes it to the download
// folder, with no copy in Storage or Firestore.
//
// The revoke is deferred for the reason materialsSource.js gives: revoking
// the object URL in the same tick as the click can race the browser's own
// read of the blob in some engines, and the download then fails.

/**
 * @param {string} filename the name the browser saves the file under
 * @param {string} text the file's contents
 * @param {string} [type] the file's media type
 */
export function saveTextFile(filename, text, type = 'text/csv;charset=utf-8') {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
