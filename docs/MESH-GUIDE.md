# Cerious AASM Mesh Guide

This guide covers the mesh: several machines running Cerious AASM, joined so you can run them as one.

## Contents

1. [What a mesh is](#what-a-mesh-is)
2. [Before you start](#before-you-start)
3. [Creating a mesh](#creating-a-mesh)
4. [Adding machines](#adding-machines)
5. [Accounts and roles in a mesh](#accounts-and-roles-in-a-mesh)
6. [Everyday use across machines](#everyday-use-across-machines)
7. [Restarts, changing a running server, and backup copies](#restarts-changing-a-running-server-and-backup-copies)
8. [Keeping machines up to date](#keeping-machines-up-to-date)
9. [Health and reachability](#health-and-reachability)
10. [Leaving and removing machines](#leaving-and-removing-machines)
11. [Server ports and the firewall](#server-ports-and-the-firewall)
12. [Other new features](#other-new-features)
13. [Troubleshooting](#troubleshooting)

---

## What a mesh is

A mesh is two or more machines running Cerious AASM that share a list of machines, servers, accounts and clusters. From the app on any machine in the mesh you see the servers on every machine (those your role lets you see), and you can start them, stop them, read their consoles and change their settings.

I built the mesh so that you never depend on one machine being "the main one". Every machine runs the full app, and the ARK servers on a machine are always run by that machine. If one machine goes offline, the servers on the others keep running and you can still manage them.

You might want a mesh if you:

- run more ARK servers than one machine can handle and want to manage them all in one place;
- want a cluster whose maps are spread across machines, with character and dino transfers between them;
- want to move a server to a less busy machine without copying files by hand;
- have machines in different places (your home and a friend's, or a rented server) and want one place to manage them.

### If you don't use a mesh

Nothing changes unless you create or join a mesh. A standalone install works as it always has: the desktop app doesn't ask you to sign in, there's no machine picker when you add a server, and none of the mesh's background work runs.

### A word about "majority"

Changes that affect the whole mesh must be agreed by more than half of its machines: adding a machine, creating an account, moving a server and so on. In this guide I call that a **majority**. The app's own messages sometimes call it a *quorum*. [Health and reachability](#health-and-reachability) explains what that means day to day. In short:

| Machines in the mesh | Needed to agree | Machines that can be offline while changes still work |
| --- | --- | --- |
| 1 | 1 | none |
| 2 | 2 | none |
| 3 | 2 | 1 |
| 4 | 3 | 1 |
| 5 | 3 | 2 |

That's why I recommend **three or more machines**. In a mesh of two, if either machine is off, nothing that changes the mesh can be done until it's back. Servers keep running either way.

---

## Before you start

Each machine needs:

- **The same version of Cerious AASM.** A machine on an older version can still be in the mesh, but some actions are refused until it's updated, with a message such as "*name* runs an older version of Cerious AASM. Update it to move servers from another node."
- **ARK installed.** Each machine has its own ARK install: open **Settings → ARK Installation** and choose **Install ARK Server**. **Auto-select** never picks a machine without ARK, and a server moved to such a machine can't start there.
- **A fixed local address.** Give each machine a DHCP reservation or a static IP on your router, so its address doesn't change under the mesh.
- **Network access to every other machine**, on two TCP ports:

| Port | Protocol | Name in the app | What it carries |
| --- | --- | --- | --- |
| 4747 | TCP | Connection port | Commands, status, server moves and cluster transfer files |
| 4002 | TCP | Database port | The shared list of machines, servers, accounts and clusters |

Each machine connects to every other machine on both ports. The web interface (port 3000 by default) isn't part of the mesh and doesn't need to be opened for it.

### Machines on the same network

Usually nothing else is needed. Two things to check:

- **Windows.** The first time a machine creates or joins a mesh, Windows may ask whether Cerious AASM and its mesh database may communicate on the network. Choose **Allow**. If someone cancels the prompt, other machines can't reach this one. Once the machine is in the mesh, **Open in Windows Firewall** (see [Server ports and the firewall](#server-ports-and-the-firewall)) opens these two ports along with the server ports, which covers a cancelled prompt too.
- **Linux.** If you use a firewall such as ufw, open TCP ports 4747 and 4002 on each machine:

  ```
  sudo ufw allow 4747/tcp
  sudo ufw allow 4002/tcp
  ```

### Machines on different networks

For a machine in another house or a data centre:

1. On each router, forward TCP ports 4747 and 4002 to the machine behind it. Each side forwards to its own machine.
2. Tell the mesh the address the others should use for that machine: its public IP address or a dynamic DNS name. You can do this when creating or joining (see **Use another address** below), or later with [Change address](#changing-a-machines-address).
3. If the router forwards different outside ports to 4747 and 4002, enter the outside ports in **Connection port** and **Database port**.

Machines on the same network as each other then also reach each other by that public address. That only works if your router supports NAT loopback (also called hairpinning). If it doesn't, use a dynamic DNS name that points to the local address inside your network, or a VPN.

A VPN such as Tailscale or WireGuard avoids port forwarding altogether: give each machine its VPN address. The mesh doesn't need a VPN.

### Docker

A Docker container can be a member like any other machine. The two mesh ports are published by default. The [Docker guide](DOCKER.md#joining-a-mesh) explains how to tell the others where to find the container.

---

## Creating a mesh

Create the mesh on one machine, then add the others to it.

1. Open **Settings → Mesh**. You'll see "This install is standalone. Create a mesh on this machine, or join one with a token from a member."
2. Check **How other machines reach this one**. It says something like "Other machines will reach this one at 192.168.1.20, on TCP ports 4747 and 4002". The app picks the machine's address on your local network. It passes over the virtual adapters that WSL, Hyper-V, VirtualBox, VMware and Docker add, and only offers a VPN address (Tailscale, ZeroTier and the like) when there's no local one. If the address still isn't the right one, or other machines reach this one from outside its network, choose **Use another address** and fill in **Address**, **Connection port** and **Database port**.
3. Under **Create a mesh**, give it a **Mesh name**.
4. If this machine has no accounts yet, you'll also see **Admin username** and **Admin password** (at least 8 characters). That account becomes the mesh's first Admin.
5. Choose **Create mesh**. You'll see "Mesh created."

Once this machine is in a mesh, the desktop app asks you to sign in (see [Accounts and roles](#accounts-and-roles-in-a-mesh)):

- If you entered an admin username and password in step 4, you're signed in as that account straight away.
- If the machine already had accounts, they become the mesh's accounts, and you sign in with one of them.

The servers and clusters already on this machine become part of the mesh.

Until a third machine joins, Settings → Mesh and the dashboard show: "With fewer than 3 machines, the mesh cannot make changes while any one of them is off. Servers keep running either way. A third machine avoids this." See the table in [A word about "majority"](#a-word-about-majority).

---

## Adding machines

Adding a machine takes two steps: make an **enrollment token** on a machine already in the mesh, then use it on the new machine. Only an Admin can make tokens.

### On a machine already in the mesh

1. Open **Settings → Mesh** and choose **Enrollment token** (top right of the mesh's card).
2. The card shows a **Join address** and a **Token**. Use **Copy address** and **Copy token** rather than retyping them.

Each token adds **one machine** and works for 15 minutes. The card says when it stops working. Make a new token for each machine.

### On the machine joining

1. Install Cerious AASM (the same version) and ARK on it.
2. Open **Settings → Mesh** and check **How other machines reach this one**, as when [creating a mesh](#creating-a-mesh).
3. Under **Join a mesh**, paste the **Join address** and the **Enrollment token**. You can type just the address (such as `192.168.1.20`): "https:// and port 4747 are filled in when left out."
4. Choose **Join mesh**. Joining can take a minute or two.

When the machine joins:

- **The mesh's accounts replace this machine's own.** This machine's admin password keeps working, as a new **Machine Admin** account for this machine. The message says which name to use, for example "Joined the mesh. This machine's admin password now signs in as admin2-garage." The name starts with `admin`, a number and the machine's name. You don't need to write it down: the sign-in page on this machine names it ("This machine's own admin password signs in as admin2-garage.") and fills it in for you. An Admin can also find the account under **Settings → Users & Roles** (role Machine Admin).
- If the machine had no admin password of its own (no accounts and no web login), sign in with any mesh account instead.
- **Its servers become part of the mesh** and stay on this machine.
- **Its clusters join the mesh's clusters.** A cluster with the same Cluster ID as one already in the mesh is merged into it.

### Naming machines

Each machine is named after its computer name when it joins. To rename one, open **Settings → Mesh**, choose **More actions** (the ⋯ button) on its card, then **Rename**. Type the new name (up to 64 characters) and choose **Save**. The new name shows on every machine and is kept if the machine later leaves and joins again. Only an Admin can rename machines.

### Changing a machine's address

If a machine's address changes, or you want the others to reach it by a public address or a dynamic DNS name:

1. In **Settings → Mesh**, choose **More actions** (⋯) on its card, then **Change address**.
2. Enter the **Address**, **Connection port** and **Database port** the other machines should use.
3. Choose **Save address**.

Before anything changes, every other machine checks that it can reach the machine at the new address. The app is covered with "Checking every machine can reach *name* at the new address… This can take a minute or two." If any machine can't reach it there, nothing changes and the message says which one and on which port.

**Change address** is only available while that machine can be reached, because the change is made by that machine and checked from the others. So change the address in the mesh first, and only then change the machine's real address (or router). If a machine's address has already changed and the others can't reach it, give it its old address back (a DHCP reservation on your router makes this easy), then change it here.

### Checking connections

The **Reachability** card on **Settings → Mesh** has a **Check reachability** button. It tries the connection port of every other machine and lists the answers in plain words, such as "asa-1 answered in 12 ms." or "s001 did not answer: connect ECONNREFUSED". It also checks the clocks: a machine whose clock is 2 seconds or more off gets a line such as "asa-1's clock is 5 seconds ahead of this machine's." The check can only tell that two clocks disagree, not which one is wrong, so compare each machine with a clock you trust, such as your phone. Then fix the wrong one, as a clock far off upsets sign-ins: on Windows, open **Settings → Time & language → Date & time**, turn on **Set time automatically** and choose **Sync now**. A Docker container takes its time from the computer it runs on, so fix that computer's clock.

The **WireGuard** card is optional. **Show config** gives you a WireGuard configuration for this machine, and **Apply on this host** applies it when WireGuard is installed.

---

## Accounts and roles in a mesh

### Signing in

In a mesh, everyone signs in with a mesh account, on the desktop app too:

- **On the desktop**, the app shows **Sign in** ("This machine is in a mesh. Sign in with your account.") each time it starts. Use a mesh account: one that came from the machine that created the mesh, the Machine Admin account made when this machine joined (the page names it and fills it in), or any account an Admin has added.
- **In the web interface**, sign-in is always on in a mesh, even if **Require an account to sign in** is off, and only mesh accounts work.
- Signing in works even when other machines can't be reached: each machine keeps its own copy of the accounts.
- To switch accounts on the desktop, open the user menu at the top right and choose **Sign out**. The app returns to the sign-in page. Otherwise you stay signed in until the app closes.

The sign-in page has its own title bar, so you can move, minimise, maximise and close the window before signing in.

In the rare case that a mesh has no accounts at all, the desktop shows **Create the mesh admin** instead, and the account you create becomes the first Admin.

### Accounts are shared

Accounts and roles are the same on every machine. Add a user under **Settings → Users & Roles** on any machine and they can sign in on all of them. Changing an account needs a majority of machines.

Most other settings belong to the machine you're using: **ARK Installation**, **Server Defaults** (including **Server Ports** and **Startup**), **Updates**, **Storage** and **Web Server**. **Users & Roles**, **Mesh** and **Clusters** are shared by the whole mesh.

### Roles

| Role | Meant for | Can | Can't |
| --- | --- | --- | --- |
| **Admin** | You, the owner | Everything, on every machine: make enrollment tokens, remove machines, rename them, change their addresses, turn **Skip new servers** on or off, manage accounts and clusters, change settings | |
| **Machine Admin** | The person who looks after one machine | See every server in the mesh. Run, configure, back up, add and delete the servers on their own machine. Move servers between machines. Change their machine's **Server Ports** and open them in Windows Firewall. Update ARK and the app on their machine (or on every machine, if an Admin turned on **May update ARK and the app on every machine**) | Control servers on other machines, add or remove machines, manage accounts, change other settings |
| **Operator** | Someone who runs a group (pool) of servers | Add, delete, run and configure the servers in their pool, on any machine, and manage the Server Managers, Attendants and Viewers in it | See other pools, move servers, change settings |
| **Server Manager** | Someone who looks after particular servers | Run the servers assigned to them: settings, mods, players, backups, RCON | Add or delete servers, manage accounts |
| **Attendant** | Someone who keeps servers up | Start and stop the servers assigned to them, read the console, see who's connected | Change settings, send commands, take backups |
| **Viewer** | Someone who only watches | See status, consoles and players in their pool | Change anything |

A Machine Admin's own machine is set under **Settings → Users & Roles**: edit the account and pick the **Machine**. Only an Admin can create or change a Machine Admin.

A Machine Admin doesn't hold **Change settings**, with one exception: the **Server Ports** of their own machine, including **Open in Windows Firewall**, since keeping that machine reachable is their job (see [Server ports and the firewall](#server-ports-and-the-firewall)). The **Start Cerious AASM when this computer starts** switch still needs an Admin.

The menus only offer what your role can do. For example, **Enrollment token** only shows for an Admin, and a role that can't change machines doesn't get the ⋯ menu on the machine cards.

---

## Everyday use across machines

### The server list

When servers run on more than one machine, the sidebar groups them by machine. Your own machine comes first, marked "this machine". Click a machine's name to fold its group away. On the dashboard, each server card shows the machine it runs on.

To group servers by operator first, turn on **Group servers by operator** in **Settings → Server Defaults → Server List**. This choice is kept in your browser.

### Starting and stopping

**Start**, **Stop** and **Force stop** work the same for every server, whichever machine it's on. **Start All Servers** and **Stop All Servers** (on the dashboard and in the sidebar) cover every machine. If a machine can't do its part, you'll see "*machine* could not start its servers: *reason*".

Starting or stopping a server **on another machine** needs a majority of machines. A machine's own servers can always be controlled from that machine, even when the others are unreachable.

### Creating a server on a chosen machine

When you choose **Add Server** in a mesh, the dialog has a **Machine** list:

- **Auto-select** picks the machine with the most free memory, disk and CPU, with fewer servers already on it. It skips machines without ARK installed and machines set to **Skip new servers**.
- Choose a machine by name to put the server there. Machines set to skip new servers are listed as "*name* (skipping new servers)" and can still be chosen.
- Only machines that can be reached right now are listed.

The same **Machine** list appears for **Clone Existing Server**: the copy goes to the machine you choose, not necessarily the one the original is on.

For **Import from Backup**, the list offers **This machine** or another machine. The backup is restored on this machine first, and the server then moves to the machine you chose. If the move fails, the server stays here and you'll see "Imported on this machine. It could not be moved to *name*".

A Machine Admin's new servers always go on their own machine.

### Moving a server to another machine

You can move a server that is **stopped** to any other machine that can be reached and isn't skipping new servers. Both machines must be on, and the move needs a majority.

1. Stop the server.
2. On its dashboard card, open **More actions** (⋯) and choose **Move to…**. On the server's own page, open **More actions** (⋯) next to **Force** and choose **Move to another machine…**.
3. Under **Move to**, choose the machine and click **Move**.

The dialog shows progress, such as "Copying *name* to *machine*: 2.1 GB of 5.4 GB (38%)". A large world can take several minutes. When it's done, you'll see "*name* is now on *machine*. It arrived stopped." Start it when you're ready.

| Moves with the server | Stays on the old machine |
| --- | --- |
| All its settings, including its mod list, cluster choice and who owns it | Its backups |
| Its saves: the world, player characters and tribes | Its logs and console history |
| Its whitelist | The old copy of its files, kept aside for 14 days, then removed |

A few more things to know:

- **Ports.** The server keeps its ports unless another server on the new machine already uses one, or a port is outside the new machine's [server ports](#server-ports-and-the-firewall). Then it takes free ports inside them. Check the address on its card before telling players where it is.
- **INI lines you added yourself.** Lines you typed into GameUserSettings.ini and Game.ini that the app has no setting for move with the server too.
- **Backups.** They stay on the old machine. If backup copies are on (see [Backup copies](#backup-copies-on-another-machine)), the latest one is also on another machine.
- **If a move fails part way**, the server stays where it was. If files had started to arrive: "What arrived on *machine* is kept for a day. Move again to carry on from where this attempt stopped."
- **Servers never move by themselves.** If a machine goes offline, its servers stay on it until it's back. A move needs the machine the server is on to be reachable.

Moving needs the **Move servers** permission, which Admins and Machine Admins have.

### Skip new servers

Each machine's card in **Settings → Mesh** has a **Skip new servers** switch. When it's on, Auto-select and moves don't put servers on that machine. Its own servers keep running. Use it for a machine that's full, about to be retired, or that you're working on. Only an Admin can change it.

### Servers on other machines: console, players, RCON, settings and plugins

Open a server on another machine the same way as one on this machine. The app talks to the machine it runs on for you:

- **Console** and **Players** show live output and who's connected. Reading them only needs that machine to be reachable.
- **RCON commands** go to the server's machine, and changes on its settings pages (including the **INI files**, **Mods** and **Cluster**) are saved there. Both need a majority.
- **ArkApi** plugins are listed, installed and removed on the server's machine. Installing from a ZIP file chosen on the desktop sends the file across for you.

**Backups**, the **whitelist**, and the server's **Automation**, **Discord** and **Broadcasts** pages work the same way: whichever machine you open them on, the app does the work on the server's own machine and shows you the result. Taking, restoring and deleting backups and changing these pages need a majority. Looking at them only needs the server's machine to be reachable. **Download** on a backup fetches it from the server's machine for you.

If the server's machine can't be reached, its card and page say **Unreachable**, the controls are greyed out, and its settings page says "The machine that runs *name* cannot be reached, so its settings cannot be changed. They can be once that machine answers again."

### Clusters across machines

Clusters let players move characters, items and dinos between servers. In a mesh, a cluster can include servers on any machines.

1. Open **Settings → Clusters**. Under **New cluster**, enter a **Name** and a **Cluster ID** (the ID ARK is given; it can't be changed later), then choose **Create cluster**.
2. On each server's **Cluster** page, choose the cluster. A change takes effect when the server next starts.

You don't need a shared folder. In a mesh, "The app keeps each cluster's transfer files on every machine in the mesh, over the mesh's own connection." Each cluster's card shows **Transfer files on each machine**, with states such as "Up to date · 12 files", "Sending 2", "Receiving 1" or "Unreachable".

With **Tell players when their upload is ready** on, a player who uploads gets a private chat message once their upload has reached every machine with a server in that cluster: "Your upload is ready on every server in the cluster. You can transfer now."

If two machines change the same player's file at the same moment, the first change is kept everywhere and the other is set aside. The card counts these as "set aside".

Removing a cluster takes its servers out of it at their next start. The transfer files stay on each machine.

Clusters work on a single machine as well. There, they're simply shared by the servers on that machine.

### What players connect to

A server's card and page show the address players connect to: the address of the machine it runs on, and its game port. If you've given a machine a public address or a dynamic DNS name with **Change address**, that's what players see.

Restarting servers, changing a server while it runs, and the copies of backups kept on other machines have a section of their own, next.

---

## Restarts, changing a running server, and backup copies

Restarts and changing a running server work on a single machine too. Backup copies need a mesh.

### Restarting a server

The server's page has a **Restart** button next to **Stop**. Anyone who can start and stop that server can use it, so Operators, Server Managers and Attendants can restart their servers without stopping and starting them by hand.

When you choose **Restart**, the app asks how:

- **Warn players and restart**: "Players are warned in game for 5 minutes, counting down to the restart, then the server saves and starts again. You can cancel it until then." The warning time is the server's own **Warning period**, from its **Automation** page (5 minutes unless you changed it).
- **Restart now** skips the warnings: "use it when nobody is playing."

While it counts down, the players get a chat message at each mark: "Server will restart in 5 minutes!", then 4, 3, 2 and 1, and "Server restarting now!" at the end. A longer warning adds the marks above 5: a 15-minute one warns at 15, 10, 5, 4, 3, 2 and 1 minutes. The page shows "Restarting in 4 min" in place of the button, with **Cancel restart**. Cancelling tells the players "The restart was cancelled."

If the server stopped during the countdown, it isn't started again at the end. In a mesh, the countdown runs on the server's own machine, and the other machines show it too.

### Restart all

The sidebar has a **Restart all servers** button next to **Start all servers** and **Stop all servers**. It's the easy way to pick up mod updates, which ARK fetches as a server starts. Only servers that are running are restarted.

- **Warn players and restart all**: "Players on every running server are warned in game for 15 minutes. Then each machine restarts its servers in order, the start delay apart, which also picks up mod updates. You can cancel it until then." The warning time is the one ARK updates use, in **Settings → Updates**.
- **Restart all now** skips the warnings.

While it counts down, the sidebar shows "Restarting all in 12 min" with a **Cancel** button. At the end, each machine stops its running servers, then starts them again one by one in sidebar order, with the **start delay** between them. In a mesh, every machine does this at the same time as the others, each with its own servers.

Cancelling a restart of all servers leaves alone any server that has a restart of its own counting down. Starting a restart of all servers takes over a server's own countdown.

### Several restarts a day

On a server's **Automation** page, under **Scheduled Restarts**, **Restart times** can now hold more than one time. Choose **Add a time** for each restart you want (for example 06:00 and 18:00), and the **×** next to a time to remove it. Every time uses the same **Restart frequency**, **Restart days** and **Warning period**.

### Changing a server while it runs

You no longer have to stop a server to change its settings. Change them while it runs and save as usual. ARK only reads its settings when it starts, so the changes take effect at the server's next restart:

- Each setting you've changed since the server started is marked **Next restart** on its settings page.
- A note at the top of the settings says how many: "3 settings saved since the server started take effect at its next restart." Its **Restart** button opens the same choice as the server's **Restart** button.
- Automation, Discord and Broadcasts settings take effect at once, so they're never marked.
- RCON keeps using the password and port the server started with until it restarts, so console commands keep working after you change them.

The settings are only locked when the server's machine can't be reached.

### Backup copies on another machine

In a mesh, each new backup of a server is also copied to another machine: the one with the most free disk that can be reached. That way a server's latest backup survives if its own machine is lost.

- Only the **latest** backup of each server is copied. Each new backup replaces the copy.
- No copy is made when no other machine can be reached. The next backup tries again.
- The server's **Backups** page shows where it is, under **Copy on Another Machine**: "The latest backup is also kept on asa-1, so it survives if this server's machine is lost." If that backup has since been deleted from the server's own machine, **Bring it back here** fetches it, so you can restore from it.

The machine holding copies lists them under **Settings → Storage**, in **Backups Kept for Other Machines**. If a machine is lost for good, choose **Restore here as a new server** next to one of its servers. Give the new server a name of its own: "the original may still be in the mesh." It's made on the machine you're using, from the copy.

---

## Keeping machines up to date

Each machine updates its own ARK install and its own app. Start both from the machine's card in **Settings → Mesh**. **Update one machine at a time.**

### Update ARK

**Update ARK** is only offered for a machine whose ARK is behind Steam's latest build. Each machine checks Steam itself and tells the others. Otherwise the button is greyed out, and hovering over it says why, for example "ARK is up to date on PC 1 (build 25763660)."

1. Choose **Update ARK** on the machine's card.
2. Confirm. The dialog explains: "The update downloads while its servers keep running. Once it is ready, players on its servers are warned in chat for that machine's warning time (Settings → Updates on that machine, 15 minutes unless changed), then its servers stop, the new files go in, and they start again. If none of its servers is running, the update starts at once."

The machine's card then shows how it's going:

- "Updating ARK: copying the install 40%, servers still up"
- "Updating ARK: downloading 62%, servers still up"
- "Updating ARK: warning players, 12 min left"
- "Updating ARK: stopping servers"
- "Updating ARK: putting the new files in place"
- "Updating ARK: starting servers"
- "ARK updated", or "ARK update failed: *reason*"

While one machine is updating ARK, **Update ARK** is greyed out for every machine ("A machine is updating ARK. Update one machine at a time."). This keeps the servers on the other machines up for your players.

The warning time comes from **Settings → Updates** on the machine being updated. If the update fails or finds no new build, no server is stopped. [ARK Updates](TROUBLESHOOTING.md#ark-updates) in the troubleshooting guide has more detail, including the disk space the download needs.

Each machine can also update ARK on its own: **Update the ARK server automatically** in **Settings → Updates**, set on each machine.

### Update app

1. Choose **Update app** on the machine's card.
2. Confirm: "The new version downloads, then the app on *machine* restarts. Any servers running there stop while it restarts, and players are not warned first."

Pick a quiet time, or stop that machine's servers first.

On Windows, the update installs without the installer's windows, then the app starts again by itself. Nobody needs to be at the machine. The one exception: if Cerious AASM was installed for all users of the computer, Windows may ask for permission on that machine's screen, so update it while you're there.

Why one at a time? While a machine's app restarts it can't take part in decisions. In a mesh of three, updating two at once leaves one of three, and changes stop until they're back.

**Update ARK** and **Update app** are greyed out for a machine that can't be reached. For another machine, they wait until a majority can be reached. You can always update the machine you're on. Hover over a greyed-out button to see why.

---

## Health and reachability

### The mesh indicator in the top bar

In a mesh, the top bar shows how the mesh stands. Click it to open **Settings → Mesh**, or hover over it for an explanation.

| What it shows | Colour | Meaning |
| --- | --- | --- |
| Mesh · 3 of 3 machines | Green | "Every machine in the mesh can be reached." |
| Mesh · 2 of 3 machines | Amber | Some machines can't be reached, but "The mesh can still agree on changes." |
| Mesh degraded · 1 of 3 machines | Red | Too few machines can be reached to make changes. "Each machine's own servers can still be controlled." |
| Mesh reconnecting | Grey | "This machine is getting back in touch with the mesh after a restart." |
| Removed from the mesh | Red | "The other machines removed this one from the mesh. Open Settings → Mesh to leave it." |

### Machine cards in Settings → Mesh

Each machine's card shows:

- its name, with **This machine** on the one you're using;
- **Connected** or **Unreachable**. A machine shows as unreachable about half a minute after it stops checking in;
- its app version ("Version not reported yet" until it first checks in);
- the address the others use for it, such as "203.0.113.5, on TCP ports 4747 and 4002";
- for other machines, **Last contact** (for example "Last contact 5 minutes ago") or "Never heard from";
- how an ARK update on it is going, while one runs;
- a warning when Windows Firewall keeps players out of its server ports (see [Server ports and the firewall](#server-ports-and-the-firewall)).

### The Machines card on the dashboard

In a mesh, the dashboard's **System Resources** card becomes **Machines**. It lists every machine with **Connected** or **Unreachable**, a line such as "2 of 3 servers running · Version 1.2.2" (and **Last contact** for a machine that can't be reached), and its CPU, memory and disk. **Manage** opens **Settings → Mesh**.

### When machines can't be reached

Your servers don't depend on the mesh. Every machine keeps running its own servers whatever happens to the others. What changes depends on how many machines can still be reached.

**While a majority can be reached** (amber in the top bar), everything works, except for the servers on the unreachable machines: their cards say **Unreachable**, and they can't be controlled or changed until their machine is back.

**When fewer than a majority can be reached** (red, "Mesh degraded"), Settings → Mesh explains: "Only 1 of 3 machines can be reached, and changes to the mesh need 2, so two halves of a split mesh can never both change it." The rule exists so that if your machines are split into two groups, both groups can't make conflicting changes.

| Still works | Waits until a majority is back |
| --- | --- |
| Every machine's servers keep running | Renaming machines, changing addresses, **Skip new servers** |
| Starting, stopping and configuring a machine's servers from that machine | Adding or removing machines |
| Signing in | Adding or changing accounts and roles |
| Reading consoles and player lists on machines that can be reached | Starting, stopping or changing servers on other machines |
| Updating ARK or the app on the machine you're using | Moving servers, creating servers on other machines |
| | Creating, renaming or removing clusters (clusters keep working) |

Greyed-out items say what they're waiting for, for example "Waits until 2 of the 3 machines can be reached."

For example, in a mesh of three:

- One machine is off for a reboot: 2 of 3 can be reached, which is a majority. Everything works except that machine's own servers.
- Two machines lose their internet connection: each can only reach itself, 1 of 3. Every machine keeps running its servers and you can manage each machine's servers from that machine. Mesh-wide changes wait.

If a machine is gone for good, you can take it out with [Force remove](#force-remove) so the rest can agree again.

### After a restart

When the app on a mesh machine starts, it gets back in touch with the others ("Mesh reconnecting"). Signing in works meanwhile. Once it's back, it starts the servers that were running on it before.

A mesh of two needs both machines running to get going again after one restarts: "This machine is in a mesh and is reconnecting to the other members. A mesh of two needs both machines running to get going again."

---

## Leaving and removing machines

While these run, the whole app is covered with a message such as "Leaving the mesh…" or "Removing *name*…". You can't use the app until the mesh answers, which can take a minute. Leaving, removing and force removing need an Admin.

### Leave

To take the machine you're using out of the mesh:

1. In **Settings → Mesh**, open **More actions** (⋯) on its own card and choose **Leave**.
2. Confirm: "Leave *mesh name*? This machine returns to standalone. Servers on it stay here."

Afterwards the machine is standalone again:

- Its servers stay on it and keep running. The rest of the mesh no longer lists them.
- The servers on other machines disappear from its list.
- The desktop app no longer asks you to sign in. The accounts it knew in the mesh stay on it.

### Remove another machine

To take another machine out, choose **Remove** from the ⋯ menu on its card. That machine is told, and goes back to standalone by itself. Its servers stay on it and the mesh forgets them. If you want its servers somewhere else in the mesh, move them before removing it.

If the machine is off when you remove it, it finds out when it comes back. Its top bar then says **Removed from the mesh**, and Settings → Mesh says "The other machines removed this one from the mesh while it could not be reached, and they no longer take it." Choose **Leave** there to make it standalone again.

### Force remove

**Remove** needs a majority. If a mesh has lost machines for good (a dead disk, a machine you gave away) and too few are left to agree, use **Force remove** instead.

1. In **Settings → Mesh**, open **More actions** (⋯) on the card of a machine that can't be reached, and choose **Force remove**. (It only appears while the mesh is degraded.)
2. Tick every machine that's gone for good. The dialog shows whether that's enough, for example "Leaves 2 machines, 2 of which can be reached; they need 2." If it says "Still too few: tick more of the machines that cannot be reached", tick more.
3. Choose **Force remove**. The machines that stay restart their part of the mesh, which can take a minute. You'll see "Removed. The mesh can agree again."

Game servers keep running throughout.

Only do this for a machine that's gone for good. If it comes back, the others refuse it. It must leave and join again, and its servers stay on it.

Example: in a mesh of four, two machines have died. Two of four can be reached, and three are needed. Force removing both dead machines leaves a mesh of two, both reachable, which is enough.

### Leave anyway

When the mesh can't agree, the **Leave** item on your own machine's card becomes **Leave anyway**. It takes this machine out without the others: "This machine returns to standalone; its servers and the accounts it knows stay here. Unless they removed it already, the others still count this machine until they remove it."

If the others can't be reached and you leave anyway, remove this machine from them later (with **Remove**, or **Force remove**). Otherwise they keep counting it when working out a majority.

### Joining again later

A machine that left or was removed can join again at any time with a new enrollment token, as in [Adding machines](#adding-machines). Its servers come back into the mesh as its own, and it keeps the name it had.

---

## Server ports and the firewall

This section applies to every install, standalone or mesh.

### Server ports

Each machine has ranges of ports its servers use. You'll find them in **Settings → Server Defaults**, in the **Server Ports** card.

| Range | Protocol | Default |
| --- | --- | --- |
| Game and peer ports | UDP | 7777 to 7900 |
| Query ports | UDP | 27015 to 27030 |
| RCON ports | TCP | 27020 to 27050 |

"Each server also uses the port after its game port", so the game range covers both. RCON stays closed to the internet: the app reaches it on the same machine, so you don't open or forward RCON ports.

How the ranges are used:

- **New servers** take the lowest free ports inside the ranges. You don't pick ports by hand, and two servers never clash.
- **A server moved here** from another machine gets ports inside them too, if its own are taken or outside them.
- **Changing a server's port** to one outside the ranges is refused: "The game port 8000 is outside this machine's game ports (7777–7900). Pick one inside them, or widen them in Settings → Server Defaults → Server Ports."
- **Servers Outside These Ports** lists servers created before the ranges, or with ports outside them, because "The firewall won't let players reach these ports." Change their ports in each server's settings, or widen the ranges.

With the defaults, the query range (16 ports) runs out first, so a machine has room for 16 servers. If you need more, widen the ranges and choose **Save**. When none are left, adding a server says "No ports are left in this machine's server ports (…). Widen them in Settings → Server Defaults → Server Ports."

### Windows Firewall

On Windows, the **Server Ports** card has a **Windows Firewall** section. It says one of:

- "Not open in Windows Firewall yet. Players can't reach servers here until they are, and Windows asks about each new server."
- "Windows Firewall opens other ports than these. Open these instead." (You changed the ranges since opening them.)
- "Open in Windows Firewall. Windows won't ask about new servers here."
- "Windows Firewall is off, so it does not block these ports."

To open them:

1. In the desktop app on that machine (signed in as an Admin, or as that machine's Machine Admin, when it's in a mesh), choose **Open in Windows Firewall**.
2. Windows asks for permission once. Answer **Yes**. The app waits with "Waiting for Windows to open the server ports… Answer Windows' permission prompt on this machine."
3. You'll see "The server ports are open. Windows won't ask about new servers here."

From the web interface, the card says to do this in the desktop app on that machine, because Windows asks on that machine's screen.

**Why this matters.** Without it, Windows asks about every new server the first time it starts, because each server runs its own copy of the ARK server program. In a mesh that's a real problem: when someone moves a server onto a machine nobody is sitting at, Windows asks there, nobody answers, and players can't connect. If someone answered **Cancel** to one of those prompts, Windows blocks that server ("Windows blocks 1 server here: someone answered Cancel when it asked about it. Opening the ports clears that.").

With the ports open once, every server on that machine can be reached, now and later. In Windows Defender Firewall, the rules appear as "Cerious AASM: ARK game ports" and "Cerious AASM: ARK query ports".

Until they're open, the desktop app reminds you on each server's page: "Windows Firewall is not open for this machine's server ports yet. Windows will ask about each new server, and players may not get in." Its **Open server ports** button takes you to the **Server Ports** card. The reminder goes once the ports are open.

In a mesh, a machine whose firewall keeps players out says so on its card in Settings → Mesh: "Windows Firewall keeps players out of its server ports. Open them in Settings → Server Defaults → Server Ports on *name*."

### Linux

On Linux, the **Server Ports** card shows **Linux Firewall** commands for ufw and firewalld that open the game and query ranges. "Run these once on this machine. Your router still needs to forward the same ports."

### Docker

In Docker the ranges are set in `docker-compose.yml`, which also publishes them, so the fields are greyed out: "change AASM_GAME_PORTS, AASM_QUERY_PORTS and AASM_RCON_PORTS there, then recreate the container." The [Docker guide](DOCKER.md#networking-and-ports) has the details.

### Your router

For players outside your network, forward the game and query ranges (UDP) on your router to the machine. Don't forward the RCON range.

### The Firewall page of a server

Each server has a **Firewall** page. **This Server's Ports** checks each of its ports against the ranges, for example "inside this machine's server ports 7777–7900", or "outside … so its firewall won't let players reach it". On Windows, its **Firewall Status** shows **Open** or **Blocked by Windows Firewall**. For a server on another mesh machine, it checks against that machine's ranges and firewall.

---

## Troubleshooting

Where the app shows a message, it's quoted here as you'll see it.

### A machine shows "Unreachable"

The other machines haven't heard from it for about half a minute. Its card shows **Last contact** with the time they last did.

1. Check that the machine is on, and that Cerious AASM is running on it. On a machine nobody sits at, see [Start Cerious AASM when this computer starts](#start-cerious-aasm-when-this-computer-starts).
2. Check that TCP ports 4747 and 4002 are open on it and, across networks, forwarded on its router. **Check reachability** in Settings → Mesh shows which machines answer. On a Windows machine, **Open in Windows Firewall** (in the desktop app on that machine) opens both, and undoes a Windows prompt that someone cancelled.
3. Check that its address hasn't changed. Compare the address on its card with the machine's real one. If it changed, give it the old address back, as described under [Changing a machine's address](#changing-a-machines-address).

Its servers keep running while it's unreachable. You just can't control them from other machines until it's back.

### "Mesh degraded", or "Waits until 2 of the 3 machines can be reached."

Fewer than a majority of machines can be reached, so changes to the mesh wait. Bring the missing machines back. If one is gone for good, [Force remove](#force-remove) it. Meanwhile, manage each machine's servers from that machine.

### "Too few machines of the mesh can be reached right now, so this waits until more of them answer. Servers keep running."

This means the same as "Mesh degraded": too few machines can be reached to agree. It also appears when you try to start, stop or change a server on another machine, or edit an account, while the mesh is degraded.

### "With fewer than 3 machines, the mesh cannot make changes while any one of them is off."

Your mesh has one or two machines. It works, but while any machine is off, changes to the mesh wait. Add a third machine to remove this limit.

### "Removed from the mesh"

The other machines removed this one while it was away. Open **Settings → Mesh** and choose **Leave**. Its servers stay on it. To come back, join again with a new token.

### "Mesh reconnecting", or "This machine is in a mesh and is reconnecting to the other members."

The app has just started and is getting back in touch. In a mesh of two, the other machine must be running too. Its servers start again once it's back in touch.

### Players can't reach a server on another machine

Check that machine's card in Settings → Mesh for "Windows Firewall keeps players out of its server ports." If you see it, sign in to the desktop app **on that machine** as an Admin and choose **Open in Windows Firewall** under **Settings → Server Defaults → Server Ports**. Also check that its router forwards the game and query ranges. See [Players Can't Connect](TROUBLESHOOTING.md#players-cant-connect) for more.

### "Windows asked for permission and it was not given, so nothing changed."

The Windows prompt was cancelled or nobody answered it. Choose **Open in Windows Firewall** again and answer **Yes** on that machine's screen. If you see "Windows Firewall did not take the rules. A policy set by your organisation can stop it.", a policy on that computer prevents the change; ask whoever manages it.

### Joining fails

- "This token was already used by another machine." or "This token expired: a token lasts 15 minutes." Make a new token on a machine in the mesh.
- "This mesh did not issue that token." Copy the token again with **Copy token**, whole.
- "That member's certificate authority does not match the token." The join address doesn't lead to the machine that made the token. Check the address. If it's right, something between the two machines (such as a proxy) is answering in its place.
- "These machines run versions of Cerious AASM that cannot work together (protocol … and …). Update them to the same version."
- "This node is already in a mesh. Leave it before joining another."
- "This machine cannot run the mesh database, so it cannot create or join a mesh." or "The mesh database is missing from this install." Something is wrong with this install. Reinstall Cerious AASM, and ask on Discord if it persists.
- "Joined, but the mesh database did not start on this machine. Restart the app to try again." Restart the app on this machine. It carries on joining as it starts.

### Signing in on the desktop fails: "Those credentials were not accepted."

Use a mesh account. This machine's own admin password works as the Machine Admin account made when it joined: the sign-in page names it and fills it in. If the page doesn't name one, or that account was turned off, sign in with an Admin account on any machine and look under **Settings → Users & Roles**.

### "Stop the server to move it.", or "No other machine can take it right now: every other member is unreachable or skipping new servers."

A server must be stopped before it can move, and the destination must be reachable and not set to **Skip new servers**.

### "No answer in time. The move may still be running: check which machine the server is on before trying again."

Large worlds take a while. Check the server list to see which machine the server is on before moving it again.

### "Only an Admin, or the Machine Admin of this machine, can change its server ports."

Each machine's **Server Ports** belong to it. Sign in on that machine as an Admin, or as its own Machine Admin.

### A restart doesn't happen

- A server that stopped during the countdown isn't started again at the end.
- Someone may have chosen **Cancel restart**, or **Cancel** next to "Restarting all in … min". The players were told "The restart was cancelled."
- For a server on another machine, that machine must be reachable to start the countdown, and a majority is needed. Once started, the countdown runs on the server's own machine, even if yours goes offline.

### A server's backup shows no "Copy on Another Machine"

Copies need a mesh with another machine that can be reached when the backup is taken. Take a new backup once one can be, or wait for the next scheduled one.

### "That server is on another machine. A machine admin changes only the servers on its own machine."

You're signed in as a Machine Admin. Ask an Admin, or sign in on the server's own machine with its Machine Admin account.

### "*name* runs an older version of Cerious AASM."

Update the app on that machine with **Update app** on its card, then try again.

### "This install is already on the latest version."

**Update app** found nothing newer for that machine.

### A port change or a new server is refused because of the server ports

See [Server ports](#server-ports). Widen the ranges in **Settings → Server Defaults → Server Ports**, then open the new ranges in your firewall again.
