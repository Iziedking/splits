# Splits production deploy

`mysplits.xyz` runs on the shared host as the compose project `splits`:

- `splits-api` (image `splits-api:<commit sha>`, built from `web/Dockerfile`) listens on 3930 and
  joins ArcRun's external network `deploy_default`, where `arcrun-caddy` proxies to it. The site
  block lives in ArcRun's tracked `deploy/caddy/Caddyfile`.
- `splits-db` (Postgres 17) is on the project's internal network only, with a named volume.

`.github/workflows/deploy.yml` builds and tests every push to `main`, saves the image with
`compose.yml` and `SHA256SUMS`, copies them to `/opt/splits/incoming/<sha>` and runs
`sudo -n /usr/local/sbin/splits-deploy <sha>`. The script verifies checksums, loads the image, dumps
the database to `/opt/splits/backups`, runs `docker compose up -d` (never `down`), waits up to 120s
for `splits-api` to report healthy, and rolls back to the previous image if it doesn't. It keeps the
last 5 releases (bundle, release dir, image) and the last 10 pre-release dumps.

The app applies `web/drizzle/` migrations itself when it starts serving. A rollback restores the old
image, not the old schema: if a release's migration has to be undone, restore the matching
`pre-release-*.dump` by hand.

## One-time server install

Prerequisites: `/opt/splits/prod.env` (mode 600) with `DATABASE_URL`, `POSTGRES_PASSWORD` and the
app settings; `/opt/splits/{incoming,releases,backups}` owned by `ubuntu`; ArcRun's
`deploy_default` network and `arcrun-caddy` running.

From a checkout of this repo on the host (or after copying `deploy/splits-deploy` there):

```sh
sudo install -o root -g root -m 755 deploy/splits-deploy /usr/local/sbin/splits-deploy
# Let the CI user run exactly this script without a password (ubuntu already has full sudo;
# skip this if that is unchanged).
echo 'ubuntu ALL=(root) NOPASSWD: /usr/local/sbin/splits-deploy' | sudo tee /etc/sudoers.d/splits-deploy
sudo chmod 440 /etc/sudoers.d/splits-deploy && sudo visudo -cf /etc/sudoers.d/splits-deploy
```

Then add the `mysplits.xyz` block to ArcRun's Caddyfile (tracked in the ArcRun repo) and reload:

```sh
docker exec arcrun-caddy caddy reload --config /etc/caddy/Caddyfile
```

GitHub settings for this repo: secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`,
`VPS_HOST_FINGERPRINT` (optional `VPS_SSH_PORT`), and the variable (or secret)
`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. Without `VPS_HOST` the workflow tests and builds but does
not deploy.

## Rollback

Any of the last 5 releases can be redeployed by its commit SHA:

```sh
ls -t /opt/splits/releases            # newest first; `current` points at what is serving
sudo /usr/local/sbin/splits-deploy <previous-sha>
```

Restore a database dump (stops the app first so nothing writes during the restore):

```sh
sudo docker stop splits-api
# Dumps are root-only (mode 600).
sudo cat /opt/splits/backups/pre-release-<time>-<sha>.dump |
  sudo docker exec -i splits-db pg_restore -U splits -d splits --clean --if-exists
sudo /usr/local/sbin/splits-deploy <sha-matching-that-schema>
```
