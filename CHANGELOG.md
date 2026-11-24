# Changelog

All notable changes to this project are documented here.

---

## 0.2.0 — 2026-11-24

### Breaking Changes

- Node.js 22 or newer is now required (it was 20), because the terminal UI moved to Ink 8. ([7087e77](https://github.com/kud/harness-fme-cli/commit/7087e7720d7b587eff3004ebd4e99b871edb585c))

### Highlights

- New `compare <flag>` shows one flag across environments side by side and marks the fields that differ; `--env a,b` narrows the environments. ([8c8c0cf](https://github.com/kud/harness-fme-cli/commit/8c8c0cf10b23fd0dd7573fa861e438ce79607125))
- New `history <flag> --env <env>` lists a flag's changes, newest first, with a field-level diff for each; `--limit` caps the list. It reads published change requests, so only changes made through an approval flow appear. ([8c8c0cf](https://github.com/kud/harness-fme-cli/commit/8c8c0cf10b23fd0dd7573fa861e438ce79607125))
- JSON output now carries an ISO 8601 twin beside every epoch-millisecond time, for example `lastUpdateTimeIso`. ([8c8c0cf](https://github.com/kud/harness-fme-cli/commit/8c8c0cf10b23fd0dd7573fa861e438ce79607125))

<details>
<summary>Internal (2 commits)</summary>

- Upgraded to Ink 8 with React in production mode, bumped `@kud/harness-fme` to 0.2.0, and pointed the package homepage at the kud.io project page. ([7087e77](https://github.com/kud/harness-fme-cli/commit/7087e7720d7b587eff3004ebd4e99b871edb585c), [32b8c14](https://github.com/kud/harness-fme-cli/commit/32b8c145ffafcc170c89162c6ab90bae42245890))

</details>

---
