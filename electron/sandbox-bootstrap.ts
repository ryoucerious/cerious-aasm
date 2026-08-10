// Must load before `electron` so Chromium sees this during native bootstrap.
// AppImages cannot chmod chrome-sandbox to root:4755 under /tmp/.mount_*.
if (process.platform === 'linux') {
  process.env.ELECTRON_DISABLE_SANDBOX = '1';
}
