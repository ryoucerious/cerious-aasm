# Electron Testing

Jest tests for the main-process code in `electron/`, config in `jest.electron.config.js`.

## Commands

```bash
npm run test:electron                # run the suite
npm run test:electron:watch          # watch mode
npm run test:electron:coverage       # with coverage, into coverage-electron/
npx tsc -p tsconfig.electron.test.json --noEmit   # type-check test files
```

## `test/setup.ts`

Loaded via `setupFilesAfterEnv`. It globally mocks `electron` (the mock includes `app`,
`ipcMain`, `shell`, `BrowserWindow`, and `dialog`), `fs`, `path`, `crypto`, `child_process`,
`bcrypt`, and `fs-extra`, so tests don't touch the real filesystem or spawn real processes. Many test
files re-mock `fs`/`path` locally with more specific behaviour, or pull in
`jest.requireActual` where they need real path or crypto semantics.

If production code starts calling a function these mocks don't provide (for example
`fs.fsyncSync`, `crypto.randomUUID`, `path.isAbsolute`), add it to the relevant mock in
`test/setup.ts`, or mock it locally in the affected test file.

## Handlers

Handlers register through `messagingService.on(channel, handler)`, not `ipcMain.on`
directly. Tests fish the handler out of `messagingService.on.mock.calls`.

## Coverage

`npm run test:electron:coverage` writes line/branch/function/statement reports to
`coverage-electron/` (gitignored).
