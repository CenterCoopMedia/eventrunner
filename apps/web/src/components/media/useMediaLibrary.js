// The media library's data layer: the media_assets index, the four
// endpoints that mutate it, and the usage scan behind the delete warning.
//
// Reads come straight from Firestore (firestore.rules make media_assets
// admin-readable) so the grid updates the moment an upload lands, without
// polling an endpoint. Writes never do: every mutation is a POST to an
// admin-gated function, because storage.rules deny client writes to
// cms-images/ and branding/ entirely (spec §8.5).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { subscribeAdminCollection } from '../../admin/adminSource.js';
import { useAdminApi } from '../../admin/adminApi.js';
import { fileToBase64 } from '../../lib/mediaSource.js';

/** Newest first — an upload is nearly always the thing you came to use. */
function byNewest(a, b) {
  return millis(b.createdAt) - millis(a.createdAt);
}

/** Firestore Timestamp | Date | ISO string → epoch ms (0 when unusable). */
function millis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * @param {{ folder?: string }} [options] restrict the rows to one namespace
 *   (the branding picker wants `branding`, the page editor `cms-images`).
 */
export function useMediaLibrary({ folder = null } = {}) {
  const call = useAdminApi();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  /** path → [{ docPath, field }], filled in by scanUsage on demand. */
  const [usage, setUsage] = useState({});

  useEffect(() => {
    return subscribeAdminCollection(
      'media_assets',
      (docs) => {
        setRows(docs);
        setError(null);
      },
      (err) => setError(err),
    );
  }, []);

  const assets = useMemo(() => {
    const all = rows ?? [];
    const scoped = folder ? all.filter((row) => row.folder === folder) : all;
    return [...scoped].sort(byNewest);
  }, [rows, folder]);

  /** Scan the library (or specific paths) so the UI can warn before deleting. */
  const scanUsage = useCallback(
    async (paths = null) => {
      const response = await call('scanMediaUsage', paths ? { paths } : {});
      const scanned = response?.usage ?? {};
      setUsage((current) => ({ ...current, ...scanned }));
      return scanned;
    },
    [call],
  );

  const upload = useCallback(
    async ({ file, folder: target, alt = '', title = '' }) => {
      const data = await fileToBase64(file);
      const response = await call('mediaUpload', {
        folder: target,
        filename: file.name,
        contentType: file.type,
        data,
        alt,
        title,
      });
      return response?.asset ?? null;
    },
    [call],
  );

  const updateMetadata = useCallback(
    ({ assetId, alt, title }) => call('mediaUpdateMetadata', { assetId, alt, title }),
    [call],
  );

  /**
   * Delete one asset. Without `force` the server answers 409 when the path
   * is referenced anywhere; the caller catches that and shows the list
   * carried on the error, rather than this hook deciding for them.
   */
  const remove = useCallback(
    ({ assetId, force = false }) => call('mediaDelete', { assetId, force }),
    [call],
  );

  return {
    assets,
    loading: rows === null,
    error,
    usage,
    scanUsage,
    upload,
    updateMetadata,
    remove,
  };
}
