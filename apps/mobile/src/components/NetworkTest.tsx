import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { apiService } from '../services/api';
import API_CONFIG from '../services/api/config';
import { COLORS, SPACING, TYPOGRAPHY } from '../constants/theme';

export function NetworkTest() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const testConnection = async () => {
    setIsLoading(true);
    setResult(null);
    
    try {
      console.log('Testing API connection to:', API_CONFIG.BASE_URL);
      
      // Simple fetch test first
      const response = await fetch(`${API_CONFIG.BASE_URL.replace('/api/v1', '')}/api/v1/health`);
      const healthData = await response.text();
      
      console.log('Health check response:', healthData);
      setResult(`Connection successful!\nHealth: ${healthData}`);
      
    } catch (error) {
      console.error('Network test error:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      setResult(`Connection failed!\nError: ${errorMsg}\nURL: ${API_CONFIG.BASE_URL}`);
      Alert.alert('Network Error', errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const testLotsAPI = async () => {
    setIsLoading(true);
    setResult(null);
    
    try {
      console.log('Testing lots API...');
      const response = await apiService.get('/lots');
      console.log('Lots API response:', response);
      
      setResult(`Lots API successful!\nFound ${response.count || 0} parking lots`);
      
    } catch (error) {
      console.error('Lots API test error:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      setResult(`Lots API failed!\nError: ${errorMsg}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Network Connection Test</Text>
      <Text style={styles.url}>API URL: {API_CONFIG.BASE_URL}</Text>
      
      <TouchableOpacity 
        style={[styles.button, isLoading && styles.buttonDisabled]}
        onPress={testConnection}
        disabled={isLoading}
      >
        <Text style={styles.buttonText}>
          {isLoading ? 'Testing...' : 'Test Health Check'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity 
        style={[styles.button, isLoading && styles.buttonDisabled]}
        onPress={testLotsAPI}
        disabled={isLoading}
      >
        <Text style={styles.buttonText}>
          {isLoading ? 'Testing...' : 'Test Lots API'}
        </Text>
      </TouchableOpacity>

      {result && (
        <View style={styles.result}>
          <Text style={styles.resultText}>{result}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: SPACING.xl,
    alignItems: 'center',
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  url: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.gray,
    marginBottom: SPACING.xl,
    textAlign: 'center',
  },
  button: {
    backgroundColor: COLORS.secondary,
    padding: SPACING.lg,
    borderRadius: SPACING.md,
    marginVertical: SPACING.sm,
    minWidth: 200,
  },
  buttonDisabled: {
    backgroundColor: COLORS.toggleGray,
  },
  buttonText: {
    color: COLORS.white,
    textAlign: 'center',
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    fontSize: TYPOGRAPHY.fontSize.md,
  },
  result: {
    marginTop: SPACING.xl,
    padding: SPACING.lg,
    backgroundColor: COLORS.lightGray,
    borderRadius: SPACING.md,
    maxWidth: '100%',
  },
  resultText: {
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
});
