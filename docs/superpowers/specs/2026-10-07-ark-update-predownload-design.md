# ARK updates download before the servers stop

## Why

An ARK update stops every server on the machine, runs SteamCMD against the shared install, then
starts the servers again. The servers are down for the whole SteamCMD run, which grows with the
size of the patch, the connection and Steam's CDN. A failed download, or one that finds the same
build, still takes every server down. SteamCMD cannot replace files a running server holds open,
so the update cannot simply run while they are up.

## What changes

The update is downloaded into a copy of the install while the servers keep running. Only when the
new build is there are players warned and the servers stopped; the changed files are then moved
into the install and the servers start again. The downtime is the stop, the move of the changed
files, the per-server binary refresh and the restarts.

Manual updates (Settings → Mesh, Update ARK on a machine) and automatic updates (the 15-minute
poll with auto-update on) both take this path. In a mesh each machine still updates its own
install, one machine at a time. A first install, and the install from the ARK Installation page
while no server runs, are unchanged.

## The update, step by step

1. **Room.** The staging copy is the install's game files: everything in `AASMServer` except
   `ShooterGame/Saved` (every server's folder, the managed clusters and the shared config) and
   `steamapps/downloading` and `steamapps/temp`. The volume holding `AASMServer` needs that much
   free plus 10%. A staging folder left by an earlier update is removed first.
   - Not enough room: the update falls back to the in-place update (warn, stop, SteamCMD on the
     install, start), as before, and the log and status say why. Refusing would leave the servers
     on a build new game clients cannot join.
2. **Seed.** The game files are copied to `AASMServer-update`, a sibling folder on the same
   volume, keeping their timestamps. Links are not followed. A file that cannot be read (held
   open) is left out; SteamCMD's validate fetches it. Then the staging folder's files are listed
   (path, size, modified time).
3. **Download.** SteamCMD runs `app_update 2430930 validate` with `force_install_dir` set to the
   staging folder, so only the patch is downloaded. Progress shows as today. The two-hour
   ceiling applies.
   - SteamCMD fails, or the staging folder's build id is the installed one: the staging folder is
     removed, no server is warned or stopped, and the status says what happened. An unchanged
     build is handled as today (Steam's build is taken as installed, so the next poll does not
     start another update; the one-hour cooldown still applies).
4. **Warn.** Running servers are warned at 15, 10, 5, 4, 3, 2 and 1 minutes before the stop (the
   same marks as scheduled restarts), counted from the configured warning time, and at 0 with
   "restarting now". With nothing running there is no warning. App exit during the warning ends
   the update: the staging folder is removed and nothing is stopped.
5. **Stop.** Every running or starting server stops, as today (graceful, force-killed after five
   minutes). Server starts are refused from here until the files are in place.
6. **Put the new files in place.** The staging folder is listed again. Files that are new or
   whose size or modified time changed are moved into the install (a rename on the same volume;
   a copy where a rename fails). Files the old build had and the new one does not are deleted
   from the install. Nothing under `ShooterGame/Saved` is touched, nor any file the update did
   not change, such as one added to the install by hand. The Steam manifest goes last, so the
   install reports the new build only once everything else is in.
   - Any failure here: SteamCMD validates the install in place, as the old update did, before any
     server starts. The status reports it.
7. **Prepare and start.** Every server's own copy of the Win64 binaries is refreshed and the
   servers that were stopped start again, as today. The staging folder is removed.

## Status shown

The machine's update status (mesh node card, heartbeats) gains two phases for the time the
servers are still up: `copying` (the seed, with a percentage) and `downloading` (SteamCMD, with a
percentage). `updating` stays for SteamCMD on the install itself (the fallback, the repair).
`configuring` covers putting the new files in place and refreshing the servers' binaries. A
finished update says which build it reached, or that ARK was already up to date. A failure is
said again once the servers have started, so the card does not stay on "starting". The Update
ARK confirmation, the reply to a node update, and the Updates settings text say the download
happens first. The copy is removed after the servers have started, and the install lock is held
until then.

## Units

- `ark-update-staging.utils.ts` (new): the staging folder's path, the room check, seeding,
  listing a tree, the difference between two listings, and putting changed files in place. File
  system only, no SteamCMD, no servers.
- `ark-install.utils.ts`: `installArkServer` and `getCurrentInstalledVersion` take an optional
  install folder (default: the install).
- `ark-update.service.ts`: the update runs room → seed → download → warn → stop → put in place →
  prepare → start, under the install lock throughout; the warning uses the scheduled-restart
  marks.

## Testing

- Staging utils against real temporary folders: what the seed copies and leaves out, the room
  check, listings and their difference, moving files in place, deleting removed files, never
  touching `ShooterGame/Saved` or files the update did not change, the manifest going last.
- The update service with the file system and SteamCMD mocked: the order of the steps, no warning
  or stop when the download fails or finds the same build, the fallback when there is no room,
  the repair when putting the files in place fails, the warning marks, app exit during the
  warning, automatic and manual updates taking the same path.
