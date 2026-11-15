### Fixed

- Enroll a newly built client's environment for automatic deployments after its full deploy succeeds. Rehearsals stay excluded, archive and purge remove the client first, and restore enrolls it again through the same serialized update and readback (#669).
