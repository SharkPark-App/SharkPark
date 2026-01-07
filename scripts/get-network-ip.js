#!/usr/bin/env node
/**
 * Development Helper - Get Local Network IP
 * Run this script to get your machine's local IP for mobile development
 */

const { networkInterfaces } = require('os');

function getLocalNetworkIP() {
  const nets = networkInterfaces();
  
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  
  return 'localhost';
}

const networkIP = getLocalNetworkIP();

console.log('\nDevelopment Network Configuration');
console.log('=====================================');
console.log(`Your local network IP: ${networkIP}`);
console.log('\nMobile Development:');
console.log(`• Android Emulator: Uses 10.0.2.2 (automatically configured)`);
console.log(`• iOS Simulator: Uses localhost (automatically configured)`);
console.log(`• iOS Physical Device: Update API config to use ${networkIP}`);
console.log('\nTo use physical iOS device:');
console.log(`1. Edit apps/mobile/src/services/api/config.ts`);
console.log(`2. Change iOS case to return 'http://${networkIP}:3000/api/v1'`);
console.log(`3. Make sure backend is running with: pnpm dev (from apps/backend)`);
console.log('\nTip: This IP may change when you connect to different networks');
console.log('');
