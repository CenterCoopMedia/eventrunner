// Save text the server sent as a file in the admin's browser (the attendee
// export, issue #184). The file never exists anywhere else: the endpoint
// returns it in the response body and this writes it to the download
// folder, with no copy in Storage or Firestore.
//
// The save itself is lib/materialsSource.js `saveBlobAs`, the one copy of
// the throwaway-anchor download: it revokes the object URL on the next
// tick, because revoking it in the same tick as the click can race the
// browser's own read of the blob in some engines.
import { saveBlobAs } from '../lib/materialsSource.js';

/**
 * @param {string} filename the name the browser saves the file under
 * @param {string} text the file's contents
 * @param {string} [type] the file's media type
 */
export function saveTextFile(filename, text, type = 'text/csv;charset=utf-8') {
  if (typeof document === 'undefined') return;
  saveBlobAs(new Blob([text], { type }), filename);
}
