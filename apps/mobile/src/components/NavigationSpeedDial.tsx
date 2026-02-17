import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, SPACING } from '../constants/theme';

interface NavigationSpeedDialProps {
  onSelectRecommended: () => void;
  onSelectFavorites: () => void;
  // Passing in the navigation button from the MapScreen
  renderTrigger: (isOpen: boolean, toggle: () => void) => React.ReactNode;
}

export const NavigationSpeedDial = ({ onSelectRecommended, onSelectFavorites, renderTrigger }: NavigationSpeedDialProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleMenu = () => {
    setIsOpen(!isOpen);
  };

  const handleAction = (action: () => void) => {
    action();
    setIsOpen(false); // Close menu after selection
  };

  return (
    <View style={styles.container} pointerEvents="box-none">
      {isOpen && (
        <View style={styles.pillContainer}>
          <TouchableOpacity
            style={styles.pill}
            onPress={() => handleAction(onSelectRecommended)}
          >
            <Text style={styles.pillText}>Recommended</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.pill}
            onPress={() => handleAction(onSelectFavorites)}
          >
            <Text style={styles.pillText}>Favorite Lots</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Render NavigateButton from MapScreen */}
      {renderTrigger(isOpen, toggleMenu)}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: SPACING.xxl, // Same as filter button
    right: SPACING.xxl, // Symmetric position on the right
    alignItems: 'flex-end',
  },
  pillContainer: {
    marginBottom: SPACING.md,
    gap: SPACING.sm,
  },
  pill: {
    backgroundColor: COLORS.white,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    elevation: 4,
    shadowColor: COLORS.shadowDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  pillText: {
    color: COLORS.secondary,
    fontWeight: '600',
  },
});