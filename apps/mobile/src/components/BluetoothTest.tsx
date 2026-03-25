/**
 * Simple test to verify Bluetooth functionality
 */
import React, { useState, useEffect } from 'react';
import { View, Text, Button, Alert } from 'react-native';
import BluetoothStatus from 'react-native-bluetooth-status';

export const BluetoothTest: React.FC = () => {
  const [bluetoothState, setBluetoothState] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const checkBluetoothState = async () => {
    setLoading(true);
    try {
      const isEnabled = await BluetoothStatus.state();
      setBluetoothState(isEnabled);
      Alert.alert(
        'Bluetooth State',
        `Bluetooth is ${isEnabled ? 'ENABLED' : 'DISABLED'}`,
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('Error checking Bluetooth state:', error);
      Alert.alert('Error', 'Failed to check Bluetooth state');
      setBluetoothState(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Automatically check on component mount
    checkBluetoothState();
  }, []);

  return (
    <View style={{ padding: 20, alignItems: 'center' }}>
      <Text style={{ fontSize: 18, marginBottom: 20 }}>Bluetooth Test</Text>
      
      <Text style={{ marginBottom: 10 }}>
        Current State: {
          bluetoothState === null ? 'Unknown' : 
          bluetoothState ? 'ENABLED' : 'DISABLED'
        }
      </Text>
      
      <Button
        title={loading ? 'Checking...' : 'Check Bluetooth State'}
        onPress={checkBluetoothState}
        disabled={loading}
      />
    </View>
  );
};
