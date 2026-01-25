#!/usr/bin/env node
const { spawn } = require('child_process');
const os = require('os');

console.log('🔧 Starting safe native dependency installation...');
console.log(`Platform: ${os.platform()}`);
console.log(`Architecture: ${os.arch()}`);

// Set environment variables for better Python/node-gyp compatibility
process.env.PYTHON = process.env.PYTHON || 'python';
process.env.npm_config_python = process.env.npm_config_python || 'python';

// Try to install app deps with electron-builder
const isWindows = os.platform() === 'win32';
const command = isWindows ? 'npx.cmd' : 'npx';
const args = ['electron-builder', 'install-app-deps'];

console.log(`🚀 Running: ${command} ${args.join(' ')}`);

const child = spawn(command, args, {
  stdio: 'inherit',
  env: process.env,
  shell: true
});

child.on('close', (code) => {
  if (code === 0) {
    console.log('✅ Native dependencies installed successfully!');
  } else {
    console.log(`⚠️  Native dependency installation failed with code ${code}`);
    console.log('This may affect some functionality, but the app should still work.');
    console.log('You can try running "npm rebuild" manually if needed.');
    
    // Exit with 0 to not fail the entire install process
    process.exit(0);
  }
  process.exit(code);
});

child.on('error', (err) => {
  console.error('❌ Error running electron-builder install-app-deps:', err.message);
  console.log('Continuing with installation...');
  process.exit(0);
});