### Changed

- New client databases enable Firestore delete protection. A build retry enables it on an existing unprotected database without changing other database settings (#671).
- Manual and scheduled purges refuse protected databases before creating an irreversible deletion record or deleting resources. An operator must explicitly disable database protection before an approved purge (#671).
