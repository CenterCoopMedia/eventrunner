### Fixed

- First-time site publisher setup provisions the registry, job, and executor binding before Deploy. Follow Deploy Runbook §9.1 before enabling the publisher. Deploy checks those resources and updates the job without writing IAM policy (#1087).
