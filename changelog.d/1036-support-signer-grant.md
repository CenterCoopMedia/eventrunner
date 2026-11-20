### Security

- Configured CCM support users also get `roles/iam.serviceAccountTokenCreator` on each client's
  existing compute runtime account, not on the whole project. With it, support can sign Firebase
  custom tokens for any site user and mint access tokens as the runtime account. This grant is
  separate from the #837 project Editor grant: removing Editor does not remove it, and offboarding
  must remove it as its own step. Provisioning retries restore a missing grant and keep other
  bindings (#1034). For ready and launched sites, the Provision client workflow's `sync_access`
  input repairs only this grant and reads the policy back, without a build or deploy (#1040).
