# Restoring telemetry.lmhstech.com

This app is paused. The real source is untouched in `./paused-backup/src/`;
`./src/index.js` serves a "We are paused at this time" page instead.

## Restore

```sh
cd ..
rm -rf src
mv paused-backup/src src
rmdir paused-backup
npx wrangler deploy
```

## Or revert the pause commit

```sh
git revert <pause-commit-sha>
npx wrangler deploy
```

## Or roll back on Cloudflare without touching git

Pre-pause version of the `lmhs-telemetry` Worker:

```sh
npx wrangler rollback bf67f4a7-33f8-4371-a37c-e52e0a45022b --name lmhs-telemetry
```

## Notes

- Bindings (D1, AI, KV) were left in place in the wrangler config on purpose, so
  the databases stay attached and restoring does not need them re-created.
- Data is not in git. SQL exports of all four D1 databases are in
  `~/lmhstech-backup-2026-08-11/d1-exports/`.
- Full off-repo backup: `~/lmhstech-backup-2026-08-11/`
