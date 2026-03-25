import React from 'react';
import { View, StyleSheet, ImageSourcePropType } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '../components';
import { useTheme } from '../context/ThemeContext';

const LongTermForecastScreen: React.FC = () => {
  const { colors } = useTheme();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const logo = require('../assets/images/SharkParkV4.webp') as ImageSourcePropType;

  return (
    <View style={[styles.container, { backgroundColor: colors.lightGray }]}>
      <Header logo={logo} />
      <SafeAreaView style={styles.content} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});

export default LongTermForecastScreen;
