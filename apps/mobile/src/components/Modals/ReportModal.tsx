import { useState, useMemo } from 'react';
import {
  View, Modal,
  TouchableOpacity,
  ScrollView, StyleSheet,
} from 'react-native';
import { Text } from '../CustomText';
import { TextInput } from '../CustomTextInput';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { TYPOGRAPHY } from '../../constants/theme';

interface ReportModalProps {
  lotId: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (report: IncidentReport) => void;
}

export interface IncidentReport {
  lotId: string;
  type: 'blockage' | 'crash' | 'other';
  message: string;
  timestamp: Date;
}

export function ReportModal({ lotId, isOpen, onClose, onSubmit }: ReportModalProps) {
  const [selectedType, setSelectedType] = useState<'blockage' | 'crash' | 'other' | null>(null);
  const [message, setMessage] = useState('');
  const { colors } = useTheme();

  const styles = useMemo(() => getStyles(colors), [colors]);

  const handleClose = () => {
    setSelectedType(null);
    setMessage('');
    onClose();
  };

  const handleSubmit = () => {
    if (!selectedType) return;
    if (selectedType === 'other' && !message.trim()) return;

    onSubmit({
      lotId,
      type: selectedType,
      message,
      timestamp: new Date(),
    });

    handleClose();
  };

  const incidentTypes = [
    {
      id: 'blockage' as const,
      label: 'Blockage',
      description: 'Road or entrance blocked',
      icon: '🚧',
      color: colors.lightGray,
    },
    {
      id: 'crash' as const,
      label: 'Crash',
      description: 'Traffic accident',
      icon: '🚗',
      color: colors.warningLight,
    },
    {
      id: 'other' as const,
      label: 'Other',
      description: 'Custom incident report',
      icon: '⚠️',
      color: colors.errorLight,
    },
  ];

  return (
    <Modal
      visible={isOpen}
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity 
          style={styles.backdropTouchable}
          activeOpacity={1}
          onPress={handleClose}
        />
        
        <View style={styles.modal}>
          {/* Modal Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Report Incident</Text>
              <Text style={styles.subtitle}>Parking Lot {lotId}</Text>
            </View>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={styles.closeButtonText} accessible={false}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Modal Content */}
          <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
            {/* Incident Type Selection */}
            <View style={styles.section}>
              <Text style={styles.label}>Select Incident Type</Text>
              <View style={styles.typeGrid}>
                {incidentTypes.map((type) => (
                  <TouchableOpacity
                    key={type.id}
                    onPress={() => setSelectedType(type.id)}
                    style={[
                      styles.typeButton,
                      selectedType === type.id && styles.typeButtonSelected
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selectedType === type.id }}
                    accessibilityLabel={`${type.label}: ${type.description}`}
                  >
                    <View style={[styles.iconContainer, { backgroundColor: type.color }]}>
                      <Text style={styles.icon}>{type.icon}</Text>
                    </View>
                    <View style={styles.typeTextContainer}>
                      <Text style={styles.typeLabel}>{type.label}</Text>
                      <Text style={styles.typeDescription}>{type.description}</Text>
                    </View>
                    <View style={[
                      styles.radio,
                      selectedType === type.id && styles.radioSelected
                    ]}>
                      {selectedType === type.id && (
                        <View style={styles.radioDot} />
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Message Field */}
            {selectedType === 'other' && (
              <View style={styles.section}>
                <Text style={styles.label}>
                  Additional Details {selectedType === 'other' && <Text style={styles.required}>*</Text>}
                </Text>
                <TextInput
                  value={message}
                  onChangeText={setMessage}
                  placeholder="Describe the incident..."
                  accessibilityLabel="Additional details"
                  accessibilityHint="Describe the incident"
                  placeholderTextColor={colors.darkGray}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  style={styles.textArea}
                />
                <Text style={styles.helperText}>
                  {selectedType === 'other' 
                    ? 'Please provide details about the incident'
                    : 'Optional: Add any additional information'
                  }
                </Text>
              </View>
            )}

            {/* Submit Button */}
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={!selectedType || (selectedType === 'other' && !message.trim())}
              style={[
                styles.submitButton,
                (!selectedType || (selectedType === 'other' && !message.trim())) && styles.submitButtonDisabled
              ]}
              accessibilityRole="button"
              accessibilityLabel="Submit report"
              accessibilityState={{ disabled: !selectedType || (selectedType === 'other' && !message.trim()) }}
            >
              <Text style={styles.submitButtonText}>Submit Report</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (
  colors: ThemeColors
) =>  StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)', // low opacity
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  backdropTouchable: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },

  // Actual Modal
  modal: {
    backgroundColor: colors.white,
    borderRadius: 24,
    width: '100%',
    maxWidth: 448,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderGray,
  },
  title: {
    fontSize: 18,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: colors.gray,
    marginTop: 2,
  },
  closeButton: {
    padding: 8,
    borderRadius: 20,
  },
  closeButtonText: {
    fontSize: 24,
    color: colors.mediumGray,
  },

  // Modal content
  content: {
    paddingHorizontal: 24,
  },
  contentContainer: {
    paddingVertical: 24,
    paddingBottom: 48,
  },
  section: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: 12,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
  required: {
    color: colors.error,
  },
  
  // Indicident Type
  typeGrid: {
    gap: 12,
  },
  typeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.borderGray,
    backgroundColor: colors.white,
    gap: 16,
  },
  typeButtonSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.backgroundLight,
  },

  // Incident Sections
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: {
    fontSize: 24,
  },
  typeTextContainer: {
    flex: 1,
  },
  typeLabel: {
    fontSize: 16,
    color: colors.textPrimary,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
  typeDescription: {
    fontSize: 14,
    color: colors.mediumGray,
    marginTop: 2,
  },

  // Radio buttons
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.borderGray,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.white,
  },

  // Additional Details Section
  textArea: {
    borderWidth: 2,
    borderColor: colors.borderGray,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: colors.darkGray,
    minHeight: 100,
  },
  helperText: {
    fontSize: 14,
    color: colors.mediumGray,
    marginTop: 8,
  },

  // Submit Button
  submitButton: {
    backgroundColor: colors.black,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: colors.white,
    fontSize: 16,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
});