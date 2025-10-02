#!/usr/bin/env node

// Test script to verify Linux dependency checking works on different distributions
const path = require('path');

// Add the compiled electron directory to the path for testing
const electronUtilsPath = path.join(__dirname, '..', 'electron', 'utils');

try {
  const { 
    checkAllDependencies, 
    getPackageManagerInfo, 
    generateInstallInstructions,
    LINUX_DEPENDENCIES 
  } = require(path.join(electronUtilsPath, 'linux-deps-utils.js'));

  async function testDependencyChecking() {
    console.log('🧪 Testing Linux Dependency Checking System\n');

    // Test 1: Package manager detection
    console.log('1. Testing package manager detection...');
    const pkgInfo = getPackageManagerInfo();
    if (pkgInfo) {
      console.log(`✅ Detected package manager: ${pkgInfo.manager}`);
      console.log(`   Install command: ${pkgInfo.installCmd}`);
      console.log(`   Update command: ${pkgInfo.updateCmd}`);
    } else {
      console.log('❌ No package manager detected');
    }
    console.log();

    // Test 2: List all dependencies
    console.log('2. Dependencies to check:');
    LINUX_DEPENDENCIES.forEach((dep, index) => {
      const packageName = typeof dep.packageName === 'string' 
        ? dep.packageName 
        : (pkgInfo ? dep.packageName[pkgInfo.manager] : 'unknown');
      console.log(`   ${index + 1}. ${dep.name} (${packageName}) - ${dep.required ? 'Required' : 'Optional'}`);
    });
    console.log();

    // Test 3: Check dependencies
    console.log('3. Checking dependencies...');
    try {
      const results = await checkAllDependencies();
      
      results.forEach(result => {
        const status = result.installed ? '✅' : '❌';
        const version = result.version ? ` (${result.version})` : '';
        console.log(`   ${status} ${result.dependency.name}${version}`);
      });

      const missing = results.filter(r => !r.installed);
      const missingRequired = missing.filter(r => r.dependency.required);

      console.log();
      if (missing.length === 0) {
        console.log('🎉 All dependencies are installed!');
      } else {
        console.log(`⚠️  Missing dependencies: ${missing.length} total, ${missingRequired.length} required`);
        
        if (missingRequired.length > 0) {
          console.log('\n4. Installation instructions for missing required dependencies:');
          console.log(generateInstallInstructions(missingRequired.map(r => r.dependency)));
        }
      }

    } catch (error) {
      console.error('❌ Error checking dependencies:', error.message);
    }
  }

  testDependencyChecking().catch(console.error);

} catch (error) {
  console.error('❌ Error loading dependency checking modules:', error.message);
  console.log('\nMake sure to run "npm run electron:build" first to compile the TypeScript files.');
}
