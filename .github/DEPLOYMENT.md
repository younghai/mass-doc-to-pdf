# GitHub Deployment Guide

This repository is prepared for GitHub-based deployment with:

1. CI verification on pull requests and `main`.
2. Docker image publishing to GitHub Container Registry (GHCR).
3. SSH-based deployment to a Docker host using `docker-compose.prod.yml`.

## Required GitHub repository settings

Enable Actions for the repository. The workflows use the default `GITHUB_TOKEN` for GHCR publishing.

If GHCR packages remain private, the deploy server must be able to authenticate to GHCR. Add:

- `GHCR_USERNAME`: GitHub username or bot account.
- `GHCR_TOKEN`: a GitHub token with package read access.

If packages are public, these two secrets can be omitted.

## Required GitHub Actions secrets

For `.github/workflows/deploy-ssh.yml`:

| Secret | Description |
| --- | --- |
| `DEPLOY_HOST` | Server hostname or IP address. |
| `DEPLOY_USER` | SSH user with Docker permission. |
| `DEPLOY_SSH_KEY` | Private SSH key for the deploy user. |
| `DEPLOY_PATH` | Directory on the server, for example `/opt/mass-doc-to-pdf`. |
| `PRODUCTION_ENV` | Full contents of `.env.production` for the target server. |
| `GHCR_USERNAME` | Optional, needed for private GHCR images. |
| `GHCR_TOKEN` | Optional, needed for private GHCR images. |

`PRODUCTION_ENV` should be based on `.env.production.example`, with real secrets filled in.
Do not commit `.env.production`.

## Publish images

Run the workflow:

1. GitHub → Actions → `Publish Images to GHCR`
2. Choose `Run workflow`
3. Use `latest` or a release tag such as `v0.1.0`

The workflow publishes:

- `ghcr.io/<owner>/<repo>-api:<tag>`
- `ghcr.io/<owner>/<repo>-web:<tag>`
- `ghcr.io/<owner>/<repo>-hwp-sidecar:<tag>`

## Deploy to server

Run the workflow:

1. GitHub → Actions → `Deploy over SSH`
2. Choose the same image tag published above.

The workflow copies these files to `DEPLOY_PATH`:

- `docker-compose.prod.yml`
- `.env.production` generated from the `PRODUCTION_ENV` secret

Then it runs:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --remove-orphans
```

## Google OAuth callback

Register this redirect URI in Google Cloud:

```text
https://your-domain.example/api/auth/callback/google
```

The domain must match `WEB_ORIGIN` in `.env.production`.

## Server requirements

- Docker Engine
- Docker Compose plugin (`docker compose`) or legacy `docker-compose`
- Enough disk space for LibreOffice/H2Orestart image layers
- Reverse proxy or firewall rules for your public domain

By default `WEB_PORT=8081`; place Nginx/Caddy/Traefik in front of it for HTTPS.
