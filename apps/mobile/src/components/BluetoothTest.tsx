/**
 * Simple test to verify car Bluetooth detection
 */
import React, { useState, useEffect } from 'react';
import { View, Text, Button, Alert } from 'react-native';
import carBluetooth from '../services/carBluetooth';

export const BluetoothTest: React.FC = () => {
  const [isCarConnected, setIsCarConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const checkBluetoothState = async () => {
    setLoading(true);
    try {
      const connected = await carBluetooth.isConnected();
      setIsCarConnected(connected);
      Alert.alert(
        'Car Bluetooth State',
        `Car Bluetooth is ${connected ? 'CONNECTED' : 'DISCONNECTED'}`,
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('Error checking car Bluetooth state:', error);
      Alert.alert('Error', 'Failed to check car Bluetooth state');
      setIsCarConnected(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkBluetoothState();

    // Listen for real-time connect/disconnect events
    const connectSub = carBluetooth.onConnect(() => setIsCarConnected(true));
    const disconnectSub = carBluetooth.onDisconnect(() => setIsCarConnected(false));

    return () => {
      connectSub.remove();
      disconnectSub.remove();
    };
  }, []);

  return (
    <View style={{ padding: 20, alignItems: 'center' }}>
      <Text style={{ fontSize: 18, marginBottom: 20 }}>Car Bluetooth Test</Text>
      
      <Text style={{ marginBottom: 4 }}>
        Module available: {carBluetooth.isAvailable ? 'YES' : 'NO'}
      </Text>
      <Text style={{ marginBottom: 10 }}>
        Car connected: {
          isCarConnected === null ? 'Unknown' : 
          isCarConnected ? 'YES' : 'NO'
        }
      </Text>
      
      <Button
        title={loading ? 'Checking...' : 'Check Car Bluetooth'}
        onPress={checkBluetoothState}
        disabled={loading}
      />
    </View>
  );
};
