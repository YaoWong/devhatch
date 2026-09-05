# DevHatch

Local browser workspace for terminals, OpenCode sessions, launch configurations, and developer web apps.

- `apps/web`: React frontend
- `apps/server`: DevHatch server
- `crates/skillink`: standalone Skill management library and CLI
- `infra`: deployment configuration

## Development

```sh
npm ci
npm run dev
```

DevHatch listens on `127.0.0.1:4173`. On first start, the server prints a one-time setup token. Open the UI, enter that token, and create an administrator password of at least 12 characters.

Set `DEVHATCH_ADMIN_PASSWORD_FILE` to the path of a file containing only the administrator password as UTF-8 text, optionally followed by exactly one LF or CRLF. On Unix, DevHatch opens the file without following symlinks, then requires that the opened object is a regular file owned by the server's effective user with no group or other permission bits (`0600` or stricter). The file is limited to 1026 bytes; after removing the optional line ending, it must contain no other CR, LF, or NUL bytes, and authentication requires a 12–1024-byte password. This initializes credentials only on the first start; existing credentials are never overwritten. The environment variable contains only the file path, and DevHatch removes both `DEVHATCH_ADMIN_PASSWORD_FILE` and the unsupported legacy `DEVHATCH_ADMIN_PASSWORD` from child-process environments.

## Checks

```sh
npm test
npm run lint
npm run typecheck
npm run build
cargo fmt --all -- --check
cargo test --workspace --all-targets --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
```

## Production

```sh
npm ci
npm run build
npm start
```

`npm run build` builds both the web application and the release server. `npm start` rebuilds the web application before starting the release server. A relocatable production bundle can use either of these layouts:

DevHatch can install the running build as a user-level systemd service from **Settings → Help & setup**. The installer creates a versioned release under `~/.local/lib/devhatch`, writes `devhatch.service` under the active user systemd configuration directory, preserves the current data directory and supported runtime settings, and hands off the listening port after active requests complete. Existing managed files require explicit overwrite confirmation; unrelated units or installation files are never replaced. User lingering is reported but not enabled automatically, so the service may stop after the final host logout when lingering is disabled.

The setup form accepts only the server-local path to a Byte API key file. On Unix, the file must be regular, non-symlinked, owned by the server user, and inaccessible to group and other users (`0600` or stricter). DevHatch stores the path but never reads or copies the key value. Generic terminals, Agent processes, Web Apps, and repository commands do not inherit `BYTE_API_API_KEY`; the Pi launch configuration is responsible for loading the key from the configured file when needed.

```text
devhatch/
└── bin/
    ├── devhatch-server
    └── web/dist/index.html
```

```text
devhatch/
└── bin/
    ├── devhatch-server
    └── dist/index.html
```

Copy all generated files under `apps/web/dist`, not only `index.html`. The server selects the first directory containing `index.html` in this order: `DEVHATCH_WEB_DIST`, `web/dist` or `dist` beside the executable, `apps/web/dist` under the current working directory, then the compile-time development workspace path. Running `target/release/devhatch-server` from the repository root therefore continues to use `apps/web/dist`.

## HTTPS with Caddy

Keep DevHatch bound to loopback and set the exact public origin:

```sh
DEVHATCH_PUBLIC_ORIGIN=https://devhatch.example.com npm start
```

Set `DEVHATCH_DOMAIN=devhatch.example.com` for Caddy, then use `infra/Caddyfile.example`. Caddy must run on the same host so the backend and OpenDesign remain inaccessible directly from the network. Set `DEVHATCH_OPEN_DESIGN_URL=https://devhatch.example.com:8443` when launching DevHatch. The public origin must include the scheme and any non-default port, without a path.
