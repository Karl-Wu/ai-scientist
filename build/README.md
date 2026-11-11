# Offline Build and Deployment

## Build

```bash
cd /Users/yr/PycharmProjects/ai-scientist
build/build.sh
```

The output is a Linux x86_64 offline installer under `build/dist/`. The server
and web runtimes are packaged separately under `build/dist/packages/`; the
installer embeds those two components, the Linux Node runtime, uv, the Python
3.12 wheelhouse, platform scripts, the official ADE Linux x86_64 offline
package, and ADE bootstrap tools. The installed platform is not a raw source
tree: only the packaged server/web runtime components are extracted.

## Directory Ownership

```text
build/template/       Files copied into the deployment package
build/dist/           Final deployable archives
build/cache/frontend/ Reusable Next.js production builds
build/cache/node/     Node fallback cache (only for --no-ade)
build/cache/uv/       uv binaries and host resolver cache
build/cache/wheelhouse/ Scientific preview wheel caches
```

`build/cache` is build-machine state and is never packaged directly. With the
default ADE-enabled build, the Node runtime is extracted from the official ADE
offline package, so AI Scientist does not keep a duplicate Node download.
`--no-ade` is the only path that uses `build/cache/node/`.
During remote installation, ADE's installer also sees the platform's final
Node/npm path and records it in `runtime.json`, avoiding a second extracted
Node runtime under `ADE_HOME/vendor`.

There are no persistent `.work`, `.build`, or `ade/` directories. Deployment
uses a temporary directory removed on exit, and build scratch state lives under
the system temporary directory with an exit trap.

Useful flags:

- `--reuse-frontend`: reuse the cached frontend build with the same source digest.
- `--no-skills`: omit the local project skill snapshot.
- `--no-wheelhouse`: omit Python preview dependencies (not a fully offline build).
- `--ade-package PATH`: use an explicit ADE offline archive.
- `--no-ade`: build the platform without ADE.

The Linux uv binary is reused from `build/cache/uv/`, recovered from a previous
installer when possible, or extracted from a PyPI wheel. GitHub release downloads
are no longer used for uv. Override the wheel index with:

```bash
UV_PYPI_INDEX_URL=https://pypi.example/simple build/build.sh
```

## Deploy

Defaults match the current deployment target:

```bash
build/deploy.sh
```

```bash
build/deploy.sh --host 10.201.0.131 --user root \
  --dir /data/ai-scientist-new --frontend-port 9018 --backend-port 18000 \
  --https-port 9019 --ade-target /data/ade
```

Remote deployment requires key-based SSH access to the target host. This avoids
storing passwords in environment files or passing them through helper scripts.

## Manual Offline Install

Extract the offline installer and run:

```bash
tar -xzf ai-scientist-<version>-linux-x64.tar.gz
cd ai-scientist-offline-<version>-linux-x64
./install-offline.sh --target /data/ai-scientist \
  --frontend-port 3000 --backend-port 8000 \
  --https-port 3001 --public-host <host> --ade-target /data/ade
```

The installer verifies component checksums, extracts the server and web
packages, installs ADE, writes `platform.env`, and starts the service. Port and
host changes after installation only require editing `platform.env` and running
`./platform.sh restart`.
It also creates the `ade-bootstrap` prompt template in every existing project
under `<target>/projects/*/sandbox/.pi/prompts/`; projects created later receive
the same template when Kady initializes their prompts. ADE and sandbox paths are
derived from `--target`, the project, and `--ade-target`.

## Operate on the server

```bash
cd /data/ai-scientist2
./platform.sh start
./platform.sh stop
./platform.sh restart
./platform.sh status
```

`platform.env` controls ports. If omitted:

- backend `KADY_PORT=8000`
- frontend `KADY_FRONTEND_PORT=3000`

The launcher derives the allowed browser origin from
`KADY_PUBLIC_HOST` and `KADY_FRONTEND_PORT`; set `KADY_ALLOWED_ORIGINS`
explicitly to allow additional domains. `build/deploy.sh` writes the public
origin into the generated remote `platform.env`.

The requested deployment sets `KADY_FRONTEND_PORT=9018`. Only the frontend
port needs public firewall access; the backend is private behind `/api/kady`.
The deployment also enables HTTPS on port 9019 with a self-signed IP-SAN
certificate. Use `https://139.9.229.238:9019` for uploads when a network
intermediary blocks multipart uploads over plain HTTP.

The chat "+" file path uses 8MB binary chunks through `PUT /sandbox/file` with
a `transferId`; the legacy multipart endpoint remains available for older
clients. `build.sh` overlays current tracked working-tree files onto its Git
HEAD baseline so reviewed deployment fixes are included without requiring a
temporary commit.

## ADE Integration

`install-offline.sh` extracts the bundled official ADE archive and runs its own
`install-offline.sh --target "$ADE_HOME"`; ai-scientist no longer maintains a
second Python/Malloy installer for ADE. The deployment writes:

- runtime/config: `/data/ade/etc/ade.env`
- command: `/data/ade/bin/ade`
- bootstrap: `/data/ade/bin/ade-bootstrap`
- skills: `/data/ade/skills`
- business workspace: `/data/ade/workspace`

The platform exports `ADE_HOME`, `ADE_PROJECT`, `ADE_BIN`,
`ADE_SKILLS_DIR`, `ADE_MALLOY_HOME`, `ADE_NODE_BINARY`, and `ADE_PYTHON`. It
copies missing canonical ADE skills into every project's
`sandbox/.pi/skills`, while preserving user edits, disables, and deletes.
