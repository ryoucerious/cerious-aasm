#!/usr/bin/env node

const os = require('os');
const fs = require('fs');
const path = require('path');

const platform = os.platform();
const arch = os.arch();

if (platform === 'win32') {
  console.log('✓ Windows detected - native ARK server support available');
} else if (platform === 'linux') {
  console.log('✓ Linux detected - will use Proton for ARK server compatibility');
  
  // Check for required Linux dependencies
  const requiredPackages = [
    'curl',
    'tar',
    'gzip'
  ];
  
  const { spawn } = require('child_process');
  
  requiredPackages.forEach(pkg => {
    try {
      const result = spawn('which', [pkg], { stdio: 'pipe' });
      result.on('close', (code) => {
        if (code === 0) {
          console.log(`✓ ${pkg} is available`);
        } else {
          console.log(`✗ ${pkg} is missing - please install it`);
        }
      });
    } catch (e) {
      console.log(`✗ ${pkg} is missing - please install it`);
    }
  });
  
  console.log('\nNote: Proton will be automatically installed when needed');
  console.log('Run "npm run setup-linux" to install additional Linux-specific dependencies');
} else if (platform === 'darwin') {
  console.log('⚠ macOS detected - ARK Survival Ascended server is not officially supported');
  console.log('  This application primarily supports Windows and Linux platforms');
} else {
  console.log(`⚠ Unsupported platform: ${platform}`);
  console.log('  This application supports Windows and Linux platforms');
  process.exit(1);
}
