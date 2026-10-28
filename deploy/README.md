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

### A deploy key that can only deploy

Today the CI key logs in as `ubuntu`, which has full sudo on a host shared with ArcRun, Kova and
sFace. A leaked key is then root everywhere. To contain it, give CI its own user whose only power is
this script. The script copies the bundle into root-owned `/opt/splits/releases/<sha>` before it
checks anything, and refuses a `compose.yml` that asks for bind mounts, privileges or host
namespaces, so the upload directory is the only thing that user can write.

```sh
sudo adduser --system --group --shell /bin/bash splits-ci
sudo install -d -o splits-ci -g splits-ci -m 700 /home/splits-ci/.ssh
# Paste the CI public key (the pair of the VPS_SSH_KEY secret) into authorized_keys:
sudo install -o splits-ci -g splits-ci -m 600 /dev/stdin /home/splits-ci/.ssh/authorized_keys
sudo chown splits-ci:splits-ci /opt/splits/incoming
echo 'splits-ci ALL=(root) NOPASSWD: /usr/local/sbin/splits-deploy' | sudo tee /etc/sudoers.d/splits-deploy
sudo chmod 440 /etc/sudoers.d/splits-deploy && sudo visudo -cf /etc/sudoers.d/splits-deploy
```

Then set the GitHub secret `VPS_USER` to `splits-ci`, remove that public key from `ubuntu`'s
`authorized_keys`, and run one deploy to confirm. The workflow's deploy job uses the `production`
environment: in the repository settings, give that environment a "main only" branch rule and move
the `VPS_*` secrets into it, so a workflow edited on another branch can't read them.

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
