// components/SubHeader.tsx
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from '../CustomText';
import { COLORS, TYPOGRAPHY, SPACING } from '../../constants/theme';

interface SubHeaderProps {
  title: string;
  onBack: () => void;
  backgroundColor?: string;
}

export function SubHeader({ title, onBack, backgroundColor = COLORS.primary }: SubHeaderProps) {
  return (
    <View style={[styles.header, { backgroundColor }]}>
      <View style={styles.headerContent}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title} accessibilityRole="header">{title}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: SPACING.xxxl,
    paddingTop: SPACING.xxxl,
    paddingVertical: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderGray,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    padding: SPACING.xs,
    marginRight: SPACING.lg,
  },
  backIcon: {
    fontSize: TYPOGRAPHY.fontSize.xxxxl,
    color: COLORS.mediumGray,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize.xxl,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    paddingTop: SPACING.md,
    color: COLORS.textPrimary,
  },
});