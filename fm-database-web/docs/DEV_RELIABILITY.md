# Local dev/build reliability

The recurring local failure is the **`EMFILE: too many open files`** Watchpack
flood that makes `next dev` and `next build` flaky or stuck. It is almost always
a low file-descriptor soft limit (macOS default ~256), made worse by Mutagen +
node + Chrome all being fd-hungry.

## First thing to run

```bash
npm run doctor
```

It checks `ulimit -n`, whether the `limit.maxfiles` LaunchDaemon is installed,
the Node version, `node_modules`, and `.env.local` — and prints the exact fix for
anything wrong. Run it whenever dev/build feels flaky.

## The permanent fix (raise the fd cap)

Install the bundled LaunchDaemon once — it survives reboot:

```bash
sudo cp ../scripts/limit.maxfiles.plist /Library/LaunchDaemons/
sudo chown root:wheel /Library/LaunchDaemons/limit.maxfiles.plist
sudo launchctl load -w /Library/LaunchDaemons/limit.maxfiles.plist
# open a fresh terminal, then verify:
ulimit -n        # → 65536 (or higher)
```

Full notes (verify/uninstall) are in the header of
[`scripts/limit.maxfiles.plist`](../../scripts/limit.maxfiles.plist).

## When the box is already wedged

If you hit `forkpty: Device not configured` or other resource-exhaustion
symptoms, clean-restart the Mac daemons (safe — touches no data, Fly stays up):

```bash
bash ../scripts/restart-mac-daemons.sh
```
