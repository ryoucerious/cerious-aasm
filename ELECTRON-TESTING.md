# Electron Testing Setup

This project includes a comprehensive testing setup for the Electron backend code using Jest.

## Test Scripts

- `npm run test:electron` - Run all Electron tests
- `npm run test:electron:watch` - Run tests in watch mode
- `npm run test:electron:coverage` - Run tests with coverage report

## Test Structure

```
electron/
├── services/
│   ├── *.service.ts        # Service classes
│   └── *.service.test.ts   # Corresponding test files
├── handlers/
│   ├── *.handler.ts        # IPC handlers
│   └── *.handler.test.ts   # Handler tests
└── utils/
    ├── *.utils.ts          # Utility functions
    └── *.utils.test.ts     # Utility tests

test/
└── setup.ts                # Global test setup and mocks
```

## Writing Tests

### Basic Test Structure

```typescript
import { MyService } from '../services/my.service';

describe('MyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('myMethod', () => {
    it('should do something', () => {
      // Arrange
      const expected = 'result';

      // Act
      const result = MyService.myMethod();

      // Assert
      expect(result).toBe(expected);
    });
  });
});
```

### Mocking Dependencies

The test setup automatically mocks common Node.js modules and Electron APIs:

- `fs` - File system operations
- `path` - Path utilities
- `child_process` - Process spawning
- `electron` - All Electron APIs (app, BrowserWindow, ipcMain, etc.)

### Testing Services

Services are tested by mocking their dependencies:

```typescript
import * as fs from 'fs';
import { MyService } from '../services/my.service';

const mockFs = fs as jest.Mocked<typeof fs>;

describe('MyService', () => {
  it('should read a file', () => {
    // Arrange
    mockFs.readFileSync.mockReturnValue('file content');

    // Act
    const result = MyService.readFile('test.txt');

    // Assert
    expect(mockFs.readFileSync).toHaveBeenCalledWith('test.txt', 'utf8');
    expect(result).toBe('file content');
  });
});
```

### Testing IPC Handlers

For IPC handlers, mock the `ipcMain` and test the event handling:

```typescript
import { ipcMain } from 'electron';
import { MyHandler } from '../handlers/my.handler';

const mockIpcMain = ipcMain as jest.Mocked<typeof ipcMain>;

describe('MyHandler', () => {
  it('should handle my-event', () => {
    // Arrange
    const mockEvent = { reply: jest.fn() };
    const mockCallback = jest.fn();

    MyHandler.register();
    mockIpcMain.on.mock.calls.find(call => call[0] === 'my-event')[1](mockEvent, 'data');

    // Assert
    expect(mockEvent.reply).toHaveBeenCalledWith('my-event-reply', expect.any(Object));
  });
});
```

## Coverage

Coverage reports are generated in the `coverage-electron/` directory. The configuration includes:

- Line coverage
- Branch coverage
- Function coverage
- Statement coverage

Coverage excludes:
- Test files
- Type definition files
- Generated JavaScript files

## Best Practices

1. **Mock External Dependencies**: Always mock file system, network, and Electron APIs
2. **Test One Thing**: Each test should verify one specific behavior
3. **Arrange-Act-Assert**: Structure tests with clear setup, execution, and verification phases
4. **Descriptive Names**: Use descriptive test and describe block names
5. **Clean Up**: Use `beforeEach` to reset mocks between tests
6. **Test Error Cases**: Include tests for error conditions and edge cases

## Example Test Files

- `log.service.test.ts` - Example of testing a utility service with file system operations
- Add more test files following the same pattern for other services and handlers

## Running Tests in CI/CD

The test setup is designed to work in headless environments. Make sure to:

1. Install dependencies: `npm install`
2. Run tests: `npm run test:electron`
3. Check coverage: `npm run test:electron:coverage`

## Troubleshooting

### Common Issues

1. **Mock Not Working**: Ensure mocks are cleared in `beforeEach`
2. **Type Errors**: The TypeScript checker may show Jasmine types, but Jest works at runtime
3. **Path Issues**: Use absolute paths or properly mock the `path` module
4. **Electron APIs**: All Electron APIs are pre-mocked in the setup file

### Debug Mode

Run tests with additional logging:

```bash
DEBUG=jest:* npm run test:electron
```