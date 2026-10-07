# Running Cerious AASM in Docker

The Docker image runs the same app as a headless Linux install. You manage everything from the web interface in your browser: installing the ARK dedicated server, creating and running servers, mods, backups, automation, and user accounts. The only thing missing is the desktop window, which you don't need because the browser does its job.

You can run it on a Linux server or on your own Windows or Mac machine with Docker Desktop. This guide walks through installing it, getting your first server running, and the handful of settings you're likely to change.

## What you'll need

You need Docker with Compose v2. On Linux that means Docker Engine and the Compose plugin; on Windows or Mac, install Docker Desktop, which includes both. Run `docker compose version` to check what you have. You need Compose 2.23.1 or newer: the Compose file passes the CurseForge key to builds as a secret, which older versions can't read. The host networking option described later needs Compose 2.24 or newer.

ARK: Survival Ascended is heavy. Plan for about 20 GB of disk before you create any servers, most of it the ARK server files, plus room for saves and backups. Each running server uses around 10 GB of memory, so a machine with 16 GB can run one server comfortably and you'll want 32 GB or more for two or three.

On Windows, Docker Desktop runs containers inside a WSL 2 virtual machine, and by default that VM only gets half of your computer's memory. If your servers crash or stall during startup, raise the limit by adding a `memory=` line under `[wsl2]` in `%UserProfile%\.wslconfig`, then restart Docker Desktop.

On a Mac, Docker Desktop's virtual machine has its own memory limit too, under Settings → Resources. Give it at least 12 GB for one server.

### Apple Silicon Macs

The ARK server, SteamCMD, and Proton only exist for Intel and AMD processors, so on an Apple Silicon Mac the container runs under emulation. Before you start, open Docker Desktop's settings and, under General, turn on **Use Rosetta for x86_64/amd64 emulation on Apple Silicon**. Then use the ARM override file alongside the main one:

```bash
curl -fsSLO https://raw.githubusercontent.com/ryoucerious/cerious-aasm/main/docker-compose.arm64.yml
docker compose -f docker-compose.yml -f docker-compose.arm64.yml up -d
```

Pass both files to every Compose command, including `pull` and `down`. The override asks for the Intel image explicitly and tells SteamCMD to use its 64-bit build, because the 32-bit one crashes under emulation. Expect everything to be slower than on an Intel or AMD machine.

## Installing

Make a folder for Cerious AASM and download the Compose file into it. If you plan to run on a Linux server with host networking (explained below), grab the second file as well.

```bash
mkdir cerious-aasm && cd cerious-aasm
curl -fsSLO https://raw.githubusercontent.com/ryoucerious/cerious-aasm/main/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/ryoucerious/cerious-aasm/main/docker-compose.host.yml
```

Cloning the whole repository works just as well. The Compose file is at its root.

Start it:

```bash
docker compose up -d
```

The first run downloads the release image from `ghcr.io/ryoucerious/cerious-aasm`. Once it's running, open `http://localhost:3000`, or use your server's address instead of `localhost` if Docker is on another machine.

The dedicated server itself isn't in the image; it's far too big for that. Open the settings panel from the gear at the bottom of the sidebar, go to ARK Installation, and install it. The app downloads SteamCMD, Proton, and the ARK server files, which takes a while the first time. After that you can create servers and start them like you would in the desktop app.

## Where your data lives

Everything that matters is kept in two Docker volumes, so you can stop, recreate, or update the container without losing anything:

- `aasm-data` holds the ARK server files, SteamCMD, Proton, your servers and their saves, backups, and the account database.
- `aasm-config` holds the app's own logs and a little Proton configuration.

Docker prefixes volume names with the project name, which is the folder the Compose file sits in, so in practice they're called something like `cerious-aasm_aasm-data`. Run `docker volume ls` to see the exact names.

### Using folders on the host instead

You can swap either volume for a folder on the host, for example on a NAS or on Unraid, where the appdata share is the usual place. The app runs as its own user inside the container, so it needs to own those folders. Tell it which user and group should own them with `PUID` and `PGID` in your `.env` file:

```bash
PUID=99
PGID=100
```

Those are Unraid's `nobody` and `users`. Anywhere else, `id -u` and `id -g` print your own. When the container starts it makes everything in both folders owned by that user and group, including folders nested inside them and files left behind by an earlier run as a different user. It only changes the files whose owner is wrong, so later starts don't have to touch everything again. Set `UMASK` too if you want new files to be group-writable, for example `UMASK=002`.

Leave `PUID` and `PGID` unset with the regular Docker volumes; the app already owns those.

The app has its own per-server backups, and that's the easiest way to protect your saves. If you want a copy of everything, stop your servers first and archive the whole data volume:

```bash
docker run --rm -v cerious-aasm_aasm-data:/data:ro -v "$PWD":/backup busybox \
  tar czf /backup/aasm-data.tgz -C /data .
```

## Turning on sign-in

Out of the box the web interface has no login, which is fine on your own machine but not on anything reachable from a network you don't control. To require a login, create a file called `.env` next to `docker-compose.yml`:

```bash
AASM_AUTH_ENABLED=true
AASM_USERNAME=admin
AASM_PASSWORD=pick-something-long
```

Then apply it with `docker compose up -d`.

The password has to be at least 8 characters. It's reapplied every time the container starts, which makes the `.env` file the one place to change it; you can't change it from inside the app. That's deliberate: if you ever lock yourself out, editing `.env` and restarting gets you back in. Other people can have their own accounts, with their own passwords and roles, which you add from the Users & Roles section of the settings panel.

If you'd rather serve the web interface on a different port, set `AASM_PORT` in the same file.

## Networking and ports

This is the part that trips people up, so it's worth understanding how the container reaches the network. There are two ways to set it up.

### Published ports (the default)

Normally a container has its own private network, and Docker only lets through the ports you list in the Compose file. Cerious AASM publishes the web interface plus three ranges for your ARK servers:

| Port | Protocol | Default range | Setting |
| --- | --- | --- | --- |
| Game port | UDP | 7777–7900 | `AASM_GAME_PORTS` |
| Query port | UDP | 27015–27030 | `AASM_QUERY_PORTS` |
| RCON port | TCP | 27020–27050 | `AASM_RCON_PORTS` |

Whatever ports you give a server in the app have to fall inside these ranges. If they don't, the server starts fine but nobody can reach it. Watch out for the peer port: it isn't a setting of its own, it's always the game port plus one. A server on 7900, the top of the range, puts its peer port on 7901, just outside. The Firewall page in each server's settings checks all of this for you and flags any port that's out of range.

The query range stops at 27030 on purpose. If you run the Steam client on the same machine, it already uses UDP 27031 to 27036, and Docker can't start the container while those ports are taken.

To change a range, add it to your `.env` file and run `docker compose up -d` again:

```bash
AASM_GAME_PORTS=7777-7800
AASM_QUERY_PORTS=27015-27025
AASM_RCON_PORTS=27020-27040
```

Compose uses the same values to publish the ports and to tell the app about them, so the Firewall page always matches what's actually open.

There's one surprise on Linux hosts. Docker opens published ports with its own firewall rules, and those take effect before ufw's. A published port is reachable whether or not ufw allows it, and a ufw rule won't close it. You don't need ufw rules for these ports, and don't count on ufw to block them. On Docker Desktop the traffic arrives through Docker Desktop itself; if Windows or macOS asks whether to allow it through the firewall, say yes.

This is the setup to use with Docker Desktop, and it works fine on Linux too.

### Host networking (Linux servers)

On a Linux server there's a simpler option: let the container share the host's network. There are no ranges to stay inside, because every port a server opens is a port on the host, exactly as if you'd installed Cerious AASM directly. It also takes Docker's port forwarding out of the path of the game's UDP traffic, which makes it the more reliable choice for game servers.

Start it with the extra Compose file:

```bash
docker compose -f docker-compose.yml -f docker-compose.host.yml up -d
```

You'll need to pass both files every time you run a Compose command, including `pull` and `down`. The extra file also tells the app you're on host networking, so the Firewall page switches back to showing ufw and firewalld commands for each server. Run those on the host, not inside the container. For a server on the default ports, that looks like:

```bash
sudo ufw allow 3000/tcp
sudo ufw allow 7777:7778/udp
sudo ufw allow 27020/tcp
```

Host networking doesn't work properly with Docker Desktop on Windows or Mac, which run containers inside a virtual machine. Stick with published ports there.

### Your router

Whichever setup you use, players outside your home or office network can only reach your server if your router forwards the game port to the machine running Docker. The Firewall page lists which ports each server needs.

### Behind a reverse proxy

To serve the web interface over HTTPS you can put a reverse proxy such as nginx in front of it. Three things need attention:

- **Forward the Host header.** The web interface talks to the app over a WebSocket at `/ws`, and the app refuses a connection whose `Origin` doesn't match the request's `Host`, and says so in its log (`Refused a WebSocket from origin`). In nginx the fix is `proxy_set_header Host $host;` (use `$http_host` instead if the site is on a non-default port, since the port has to match too). If your proxy has to rewrite `Host`, send the original in `X-Forwarded-Host` instead; the app accepts either.
- **Pass WebSocket upgrades for `/ws`.** Without them the page loads but never shows live data.
- **Tell the app which proxy to believe.** By default it ignores `X-Forwarded-For` and `X-Forwarded-Proto`, because any client could send them. Then the sign-in limiter (10 attempts per username and address in 15 minutes) sees the proxy's address for every client, so one person guessing a username can lock it out for everyone, and the session cookie is marked `Secure` only when the app sees HTTPS itself, which behind a proxy it never does. Set `AASM_TRUST_PROXY` to the proxy's address, a subnet, `loopback`, or the number of proxies in front (`1`), and the app uses each client's real address and marks the cookie `Secure` when the proxy took HTTPS. Name only proxies you run: a trusted address can claim to be any client. The cookie is `HttpOnly` and `SameSite=Strict` either way.

A minimal nginx location:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

### Joining a mesh

A container can be a member of a Cerious AASM mesh with machines elsewhere, on the same network or another one. Members reach each other on two TCP ports, published by default:

| What | Protocol | Default | Setting |
| --- | --- | --- | --- |
| Mesh peer API | TCP | 4747 | `AASM_PEER_PORT` |
| Mesh database (Raft) | TCP | 4002 | `AASM_RAFT_PORT` |

Three things to get right:

- **Tell the others where to find this container.** In the default bridge network the container only knows its internal `172.x` address. Set `AASM_ADVERTISE_HOST` to the address the other members use for this machine: its LAN address, its VPN address (WireGuard, Tailscale), or a name that resolves to it.
- **When the ports differ outside**, because of a port forward, a proxy or two containers on one machine, set the full addresses instead: `AASM_ADVERTISE_PEER_URL` (for example `https://mesh-a.example.com:443`) and `AASM_ADVERTISE_RAFT_ADDR` (for example `mesh-a.example.com:14002`). These are read when the container creates or joins a mesh and kept after that. To change them later, use **Change address** on the container's card in Settings → Mesh. That page also takes an address when you create or join.
- **Pass TLS through; do not end it.** Members prove who they are with certificates, end to end. A proxy in front of these two ports must forward raw TCP (nginx `stream`, a Traefik TCP router with TLS passthrough, HAProxy in TCP mode) or be a plain port forward or VPN. A proxy that decrypts the traffic removes the certificates, and members refuse it; joining checks the mesh's certificate against the join token and stops before sending anything.

**Sign-in is always on in a mesh, with mesh accounts only.** A member's web interface controls servers on every member, so it asks for a mesh account even with `AASM_AUTH_ENABLED=false`. The single `AASM_USERNAME`/`AASM_PASSWORD` login does not sign in there. Joining brings that password with it instead, as a machine admin for the container named `admin<N>-<its name in the mesh>`, for example `admin3-docker-1`; the join message and the mesh page show the name. Leaving the mesh puts the container's own login back.

A mesh of two needs both members running to get going again after one restarts: the restarted member waits, with its mesh page saying it is reconnecting, until the other is up.

**Clusters work across members with no shared folder.** Make a cluster in Settings → Clusters, then choose it on each server's Cluster tab. The app keeps the cluster's transfer files on every member over the same peer port, so a player can upload on a server here and download on one elsewhere. In the container they live in the data volume, in `AASMServer/ShooterGame/Saved/AASMClusters/` next to the servers. There is nothing to mount.

A minimal nginx `stream` block forwarding public 443 to the peer API:

```nginx
stream {
    server {
        listen 443;
        proxy_pass 127.0.0.1:4747;
    }
}
```

The web interface on port 3000 is separate and can sit behind an ordinary HTTPS proxy as above.

## Updating

Settings, Mesh lists every machine and can start an ARK update or an app update on the one you pick. Each machine updates its own install.

An app update inside this container downloads `cerious-aasm-runtime.tar.gz` from the release, writes it onto the data volume, and restarts the app process. The container keeps running, so you do not run `docker compose pull` for that. Server data in the volumes stays put. Update one voting machine at a time: restarting the app also restarts that machine's vote.

A release published before this archive existed, or an image you built yourself, still updates from the Docker host:

```bash
docker compose pull
docker compose up -d
```

The container is recreated from the new image and your data volumes carry over untouched. A newer image wins over an older in-place update. Stop your ARK servers first if you'd rather not have them cut off mid-game. After an in-place app update, servers that are supposed to be running come back when the app is up.

## Building the image yourself

If you'd rather build from source, for example to test a change, clone the repository and build with a local image name so a later `docker compose pull` doesn't replace your build:

```bash
git clone https://github.com/ryoucerious/cerious-aasm.git
cd cerious-aasm
AASM_IMAGE=cerious-aasm:local docker compose up -d --build
```

Mod browsing needs a CurseForge API key, which the release image already includes. A build of your own only has it if you set `CURSEFORGE_API_KEY=your-key` in the environment of the same command. Compose hands it to the build as a build secret, so it isn't stored in the image or its history. Leave it unset and the image still builds, without mod browsing.

To build with `docker build` instead of Compose, pass the key as a secret (this needs BuildKit, the default in current Docker):

```bash
CURSEFORGE_API_KEY=your-key docker build --secret id=curseforge_api_key,env=CURSEFORGE_API_KEY -t cerious-aasm:local .
```

`--build-arg` is no longer used: the Dockerfile reads the key only from the build secret, so `--build-arg CURSEFORGE_API_KEY=...` has no effect.

## Checking the container is healthy

The image has a Docker `HEALTHCHECK` that polls the web server every 30 seconds. In
`docker compose ps` and `docker ps` the container shows `starting` while the app boots
(Xvfb and Electron take a while) and `healthy` once the web server answers. It shows
`unhealthy` after three failed checks in a row, not counting the first 40 seconds after start.

## When something goes wrong

The app's own log is the first place to look:

```bash
docker compose logs -f aasm
```

Each ARK server writes its own log too. It's inside the data volume at `AASMServer/ShooterGame/Saved/Logs/ShooterGame.log`, and the Proton output for a server is in `AASMServer/ShooterGame/Saved/Servers/<server id>/stderr.log`.

**A server fails to start with a namespace error from Proton.** Proton needs to create user namespaces, which some hosts don't allow a container to do. The Compose file already gives the container the permissions that usually covers. If it still fails, uncomment `privileged: true` on the `aasm` service and run `docker compose up -d`.

**Installing the ARK server fails with "Failed to download."** The log shows `[steamcmd] Init attempt 1 exited with code 1` several times first. SteamCMD could not finish its first-time update. The app then fetches SteamCMD's update itself, and if that fails too, the install stops with a message saying why. Check that the container can reach `client-update.steamstatic.com` and try again. On an Apple Silicon Mac, also check that you started it with `docker-compose.arm64.yml`.

**"Permission denied" or `EACCES` errors in the log, and the container stops.** The data or config folder is a host folder the app doesn't own. Set `PUID` and `PGID` to the user and group that should own it, as described under [Using folders on the host instead](#using-folders-on-the-host-instead).

**Players can't connect.** Check the Firewall page for that server. In the default setup, a port outside the published ranges is the usual cause. After that, check the port forwarding on your router.

**Your server doesn't show up in the in-game server list.** Give it a minute or two after the log says the server is advertising for join. If it has a join password, turn on the in-game filter for password-protected servers and search for it by name; ARK hides those servers by default. You can always join directly by opening the in-game console and typing `open <ip>:<game port>`.

## Settings reference

All of these go in the `.env` file next to `docker-compose.yml`. Run `docker compose up -d` after changing any of them.

| Setting | Default | What it does |
| --- | --- | --- |
| `AASM_PORT` | `3000` | Port for the web interface |
| `AASM_AUTH_ENABLED` | `false` | Set to `true` to require a login |
| `AASM_USERNAME` | `admin` | Admin login name when sign-in is on |
| `AASM_PASSWORD` | none | Admin password when sign-in is on, at least 8 characters |
| `AASM_GAME_PORTS` | `7777-7900` | Game and peer ports available to servers (UDP) |
| `AASM_QUERY_PORTS` | `27015-27030` | Query ports available to servers (UDP) |
| `AASM_RCON_PORTS` | `27020-27050` | RCON ports available to servers (TCP) |
| `AASM_TRUST_PROXY` | none | Proxies whose `X-Forwarded-*` headers the web interface believes: addresses, subnets, `loopback`, or a count such as `1` |
| `AASM_PEER_PORT` | `4747` | Mesh peer API port (TCP) |
| `AASM_RAFT_PORT` | `4002` | Mesh database port (TCP) |
| `AASM_ADVERTISE_HOST` | first LAN address | The address other mesh members use for this machine |
| `AASM_ADVERTISE_PEER_URL` | `https://` host and peer port | Full peer API address other members dial, when it differs outside |
| `AASM_ADVERTISE_RAFT_ADDR` | host and Raft port | Full Raft address other members dial, when it differs outside |
| `AASM_NODE_NAME` | container id | The name every member shows for this container. Read when the container first makes its identity; after that, rename it from Settings → Mesh |
| `PUID` | none | User ID that owns the data folders when they're host folders (Unraid: `99`) |
| `PGID` | none | Group ID that owns the data folders when they're host folders (Unraid: `100`) |
| `UMASK` | none | Permissions mask for new files, such as `002` for group-writable |
| `AASM_IMAGE` | `ghcr.io/ryoucerious/cerious-aasm:latest` | The image to run. Set a local name when building from source. |
| `CURSEFORGE_API_KEY` | none | Only used when building the image yourself, passed to the build as a secret |

## For developers

The Compose file has a few extra services that stay out of the way unless you ask for them:

```bash
docker compose --profile test run --rm test
docker compose --profile dev up headless-dev
docker compose --profile debug run --rm shell
```

`test` runs the Electron test suite. `headless-dev` mounts your working copy, builds it, and serves it on port 3000. `shell` gives you a shell with the Linux `node_modules` from the image.
