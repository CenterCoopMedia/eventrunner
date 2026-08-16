# functions

Cloud Functions, one domain module per directory. `index.js` will be an export barrel only. Not landed yet.

The shared package is packed into `vendor/shared.tgz` by `prepare:functions` before deploy. See spec §1.1. That tarball is gitignored.
