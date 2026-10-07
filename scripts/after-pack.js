/**
 * electron-builder afterPack hook.
 *
 * On Linux, replace the Electron executable with a shell wrapper that can
 * start xvfb-run *before* the native binary loads GTK.  In-process JS
 * re-exec is unreliable: GTK can abort before main.js ever runs
 * (Gtk-ERROR: Can't create a GtkStyleContext without a display connection).
 */
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') {
    return;
  }

  // rqlited is the mesh database. A copy without the executable bit (a checkout on Windows, an
  // archive that dropped modes) left Linux installs unable to join a mesh.
  const rqliteRoot = path.join(context.appOutDir, 'resources', 'rqlite');
  if (fs.existsSync(rqliteRoot)) {
    for (const arch of fs.readdirSync(rqliteRoot)) {
      const dir = path.join(rqliteRoot, arch);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const name of fs.readdirSync(dir)) {
        fs.chmodSync(path.join(dir, name), 0o755);
        console.log(`[afterPack] Made rqlite/${arch}/${name} executable`);
      }
    }
  }

  const execName = context.packager.executableName;
  const execPath = path.join(context.appOutDir, execName);

  if (!fs.existsSync(execPath)) {
    console.warn(`[afterPack] Linux executable not found at ${execPath}; skipping wrapper`);
    return;
  }

  // Don't wrap twice (e.g. rebuild into the same out dir)
  const head = Buffer.alloc(2);
  const fd = fs.openSync(execPath, 'r');
  fs.readSync(fd, head, 0, 2, 0);
  fs.closeSync(fd);
  if (head.toString('utf8') === '#!') {
    console.log(`[afterPack] Wrapper already present for ${execName}`);
    return;
  }

  const realBinPath = `${execPath}.bin`;
  fs.renameSync(execPath, realBinPath);

  const wrapperSrc = path.join(__dirname, 'linux-electron-wrapper.sh');
  let wrapper = fs.readFileSync(wrapperSrc, 'utf8');
  // Ensure LF line endings for Linux shells even when built on Windows
  wrapper = wrapper.replace(/\r\n/g, '\n');
  fs.writeFileSync(execPath, wrapper, { mode: 0o755 });
  // writeFileSync's mode is masked by umask on some systems, so force executable
  fs.chmodSync(execPath, 0o755);
  fs.chmodSync(realBinPath, 0o755);

  console.log(`[afterPack] Installed Linux xvfb-aware launcher for ${execName} (-> ${execName}.bin)`);
};
