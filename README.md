# DevHatch

Local browser workspace for terminals, OpenCode sessions, launch configurations, and developer web apps.

- `apps/web`: React frontend
- `apps/server`: DevHatch server
- `crates/skillink`: standalone Skill management library and CLI
- `infra`: deployment configuration

## Development

```sh
npm install
npm run dev
```

DevHatch listens on `127.0.0.1:4173`. On first start, the server prints a one-time setup token. Open the UI, enter that token, and create an administrator password of at least 12 characters.

## Checks

```sh
npm run lint
npm run typecheck
npm run build
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

## HTTPS with Caddy

Keep DevHatch bound to loopback and set the exact public origin:

```sh
DEVHATCH_PUBLIC_ORIGIN=https://devhatch.example.com DEVHATCH_SECURE_COOKIE=1 npm start
```

Set `DEVHATCH_DOMAIN=devhatch.example.com` for Caddy, then use `infra/Caddyfile.example`. Caddy must run on the same host so the backend and OpenDesign remain inaccessible directly from the network. Set `DEVHATCH_OPEN_DESIGN_URL=https://devhatch.example.com:8443` when launching DevHatch. The public origin must include the scheme and any non-default port, without a path.
