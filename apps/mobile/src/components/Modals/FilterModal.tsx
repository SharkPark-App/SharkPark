import { useState } from 'react';
import {
  View, Modal,
  TouchableOpacity, ScrollView,
  StyleSheet, Pressable,
} from 'react-native';
import { Text } from '../CustomText';
import { COLORS, SPACING, TYPOGRAPHY } from '../../constants/theme';

interface LotFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLots: string[];
  onApplyFilter: (selectedLots: string[]) => void;
}

interface LotOption {
  id: string;
  label: string;
  category: 'general' | 'employee';
}

export function LotFilterModal({ isOpen, onClose, selectedLots, onApplyFilter }: LotFilterModalProps) {  
  const [tempSelected, setTempSelected] = useState<string[]>(selectedLots);

  const generalLots: LotOption[] = [
    { id: 'G1', label: 'G1', category: 'general' },
    { id: 'G2', label: 'G2', category: 'general' },
    { id: 'G3', label: 'G3', category: 'general' },
    { id: 'G4', label: 'G4', category: 'general' },
    { id: 'G5', label: 'G5', category: 'general' },
    { id: 'G6', label: 'G6', category: 'general' },
    { id: 'G7', label: 'G7', category: 'general' },
    { id: 'G8', label: 'G8', category: 'general' },
    { id: 'G9', label: 'G9', category: 'general' },
    { id: 'G10', label: 'G10', category: 'general' },
    { id: 'G11', label: 'G11', category: 'general' },
    { id: 'G12', label: 'G12', category: 'general' },
    { id: 'G13', label: 'G13', category: 'general' },
    { id: 'G14', label: 'G14', category: 'general' },
    { id: 'PVN', label: 'Palo Verde N.', category: 'general' },
    { id: 'PVS', label: 'Palo Verde S.', category: 'general' },
    { id: 'PYR', label: 'Pyramid', category: 'general' },
  ];
  const employeeLots: LotOption[] = [
    { id: 'E1', label: 'E1', category: 'employee' },
    { id: 'E2', label: 'E2', category: 'employee' },
    { id: 'E3', label: 'E3', category: 'employee' },
    { id: 'E4', label: 'E4', category: 'employee' },
    { id: 'E5', label: 'E5', category: 'employee' },
    { id: 'E6', label: 'E6', category: 'employee' },
    { id: 'E7', label: 'E7', category: 'employee' },
    { id: 'E8', label: 'E8', category: 'employee' },
    { id: 'E9', label: 'E9', category: 'employee' },
    { id: 'E10', label: 'E10', category: 'employee' },
    { id: 'E11', label: 'E11', category: 'employee' },
  ];

  const allLots = [...generalLots, ...employeeLots];

  const toggleLot = (lotId: string) => {    
    setTempSelected(
      // if selected, filter from incoming (+) array; otherwise add as is
      prev => prev.includes(lotId)? 
        // both return respective array
        prev.filter(id => id !== lotId) : [...prev, lotId]
    );    
  };

  const handleApply = () => {
    // pass local state to parent
    onApplyFilter(tempSelected);
    onClose();
  };

  const handleToggleAll = () => { // toggle between Select or Clear All
    if (tempSelected.length === 0) {
      // Select all
      setTempSelected(allLots.map(lot => lot.id));
    } else {
      // Clear all
      setTempSelected([]);
    }
  };

  return (
    <Modal
      visible={isOpen}
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        {/* Backdrop touchable (dismiss modal) */}
        <Pressable style={styles.backdropPress} onPress={onClose} />
        
        {/* Modal */}
        <View style={styles.modal}>
          {/* Content */}
          <ScrollView style={styles.content}>
            {/* General Lot Section */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>General Lot</Text>
                {/* Close (X) Button*/}
                <TouchableOpacity 
                  onPress={onClose} 
                  style={styles.closeButton}
                  accessibilityLabel="Close filter modal"
                  accessibilityRole="button"
                >
                  <Text style={styles.closeIcon}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.grid}>
                {generalLots.map((lot) => (
                  <TouchableOpacity
                    key={lot.id}
                    onPress={() => toggleLot(lot.id)}
                    style={styles.lotButton}
                    accessibilityLabel={`${tempSelected.includes(lot.id) ? 'Deselect' : 'Select'} general parking lot ${lot.label}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: tempSelected.includes(lot.id) }}
                  >
                    <View style={[
                        styles.checkbox,
                        tempSelected.includes(lot.id) && styles.checkboxSelected]}>
                      {/* short-circuit rendering */}
                      {tempSelected.includes(lot.id) && (<Text style={styles.checkmark}>✓</Text>)}
                    </View>
                    
                    <Text style={styles.lotLabel}>{lot.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Divider */}
            <View style={styles.divider} />

            {/* Employee Lot Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitleEmployee}>Employee Lot</Text>
              <View style={styles.grid}>
                {employeeLots.map((lot) => (
                  <TouchableOpacity
                    key={lot.id}
                    onPress={() => toggleLot(lot.id)}
                    style={styles.lotButton}
                    accessibilityLabel={`${tempSelected.includes(lot.id) ? 'Deselect' : 'Select'} employee parking lot ${lot.label}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: tempSelected.includes(lot.id) }}
                  >
                    <View style={[
                      styles.checkbox,
                      tempSelected.includes(lot.id) && styles.checkboxSelected]}>
                      {tempSelected.includes(lot.id) && (<Text style={styles.checkmark}>✓</Text>)}
                    </View>
                    <Text style={styles.lotLabel}>{lot.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            {/* Select/Clear All Button */}
            <TouchableOpacity
              onPress={handleToggleAll}
              style={styles.clearButton}
              accessibilityLabel={tempSelected.length === 0 ? 'Select all parking lots' : 'Clear all selected parking lots'}
              accessibilityRole="button"
            >
              <Text style={styles.clearButtonText}>
                {tempSelected.length === 0 ? 'Select All' : 'Clear All'}
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={handleApply}
              style={styles.applyButton}
              accessibilityLabel="Apply selected parking lot filters"
              accessibilityRole="button"
            >
              <Text style={styles.applyButtonText}>Apply Filter</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Filter Modal Specific Style
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  backdropPress: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modal: {
    backgroundColor: COLORS.white,
    borderRadius: SPACING.xl,
    width: '100%',
    maxWidth: 448,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  content: {
    paddingHorizontal: SPACING.xxl,
    paddingTop: 20,
    paddingBottom: SPACING.xl,
  },
  section: {
    marginBottom: SPACING.xxl,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.xl,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
  sectionTitleEmployee: {
    color: COLORS.mediumGray,
    fontSize: TYPOGRAPHY.fontSize.xl,
    marginBottom: SPACING.xl,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
  closeButton: {
    padding: SPACING.sm,
    borderRadius: SPACING.md,
  },
  closeIcon: {
    color: COLORS.mediumGray,
    fontSize: SPACING.xxl,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.lg,
  },
  lotButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    width: '30%',
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: SPACING.sm,
    borderWidth: SPACING.xs,
    borderColor: COLORS.borderGray,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  checkmark: {
    color: COLORS.white,
    fontSize: 20,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
  },
  lotLabel: {
    color: COLORS.textPrimary,
    fontSize: 14,
    flex: 1,
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: COLORS.borderGray,
    marginVertical: SPACING.xxl,
  },
  footer: {
    flexDirection: 'row',
    gap: SPACING.lg,
    paddingHorizontal: SPACING.xxl,
    paddingVertical: SPACING.xl,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderGray,
  },
  clearButton: {
    flex: 1,
    paddingVertical: SPACING.lg,
    backgroundColor: COLORS.lightGray,
    borderRadius: SPACING.md,
    alignItems: 'center',
  },
  clearButtonText: {
    color: COLORS.textPrimary,
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
  applyButton: {
    flex: 1,
    paddingVertical: SPACING.lg,
    backgroundColor: COLORS.primary,
    borderRadius: SPACING.md,
    alignItems: 'center',
  },
  applyButtonText: {
    color: COLORS.white,
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
});