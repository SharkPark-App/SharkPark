// Quick test to verify module resolution
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ParkingValidator } = require('./src/validation');
  console.log(' Successfully imported ParkingValidator');
  console.log('Available methods:', Object.getOwnPropertyNames(ParkingValidator));
  
  // Test the device hash function
  const hash = ParkingValidator.generateDeviceHash('test-user');
  console.log(' Device hash generated:', hash);
} catch (error) {
  console.error(' Import failed:', error.message);
}
