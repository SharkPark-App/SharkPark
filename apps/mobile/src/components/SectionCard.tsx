import { View, StyleSheet, ViewStyle } from 'react-native';
import { Text } from './CustomText';
import { ReactNode } from 'react';
import { TYPOGRAPHY, SPACING, SHADOWS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';

interface SectionCardProps {
  title: string;
  children: ReactNode;
  style?: ViewStyle;
}

export function SectionCard({ title, children, style }: SectionCardProps) {
  const { colors } = useTheme();
  
  return (
    <View style={[
      styles.section, 
      { 
        backgroundColor: colors.white, 
        shadowColor: colors.shadowDark 
      }, 
      style
    ]}>
      <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderRadius: SPACING.lg,
    padding: SPACING.xxxl,
    ...SHADOWS.card,
    marginBottom: SPACING.xxxl,
  },
  
  sectionTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    marginBottom: SPACING.lg,
  },
});