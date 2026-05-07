import { useState, useMemo, useEffect, useRef } from 'react';
import {
  View, Modal,
  TouchableOpacity, ScrollView,
  StyleSheet, Pressable,
  type LayoutChangeEvent,
} from 'react-native';
import { Text } from '../CustomText';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { SPACING, TYPOGRAPHY } from '../../constants/theme';
import type { MapRoute } from '../../types/transit';

interface LotSummary {
  lot_id: string;
  lot_type: 'STUDENT' | 'EMPLOYEE';
}

interface LotFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  lots: LotSummary[];
  selectedLots: string[];
  onApplyFilter: (selectedLots: string[]) => void;
  routes: MapRoute[];
  hiddenRouteIds: string[];
  onApplyTransitFilter: (hiddenRouteIds: string[]) => void;
}

export function LotFilterModal({ isOpen, onClose, lots, selectedLots, onApplyFilter, routes, hiddenRouteIds, onApplyTransitFilter }: LotFilterModalProps) {
  const { colors, spacing, typography } = useTheme();
  const [activeTab, setActiveTab] = useState<'parking' | 'transit'>('parking');
  const [scrolledTab, setScrolledTab] = useState<'parking' | 'transit'>('parking');
  const [tempSelected, setTempSelected] = useState<string[]>(selectedLots);
  const [tempHiddenRouteIds, setTempHiddenRouteIds] = useState<string[]>(hiddenRouteIds);
  const [pageWidth, setPageWidth] = useState(0);
  const [pageHeight, setPageHeight] = useState(0);
  const pageScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (isOpen) {
      setTempSelected(selectedLots);
      setTempHiddenRouteIds(hiddenRouteIds);
    }
  }, [isOpen, selectedLots, hiddenRouteIds]);

  const styles = useMemo(() => getStyles(colors, spacing, typography), [colors, spacing, typography]);

  const generalLots = useMemo(() => lots.filter(l => l.lot_type === 'STUDENT'), [lots]);
  const employeeLots = useMemo(() => lots.filter(l => l.lot_type === 'EMPLOYEE'), [lots]);

  const toggleLot = (lotId: string) => {
    setTempSelected(
      prev => prev.includes(lotId)
        ? prev.filter(id => id !== lotId)
        : [...prev, lotId]
    );
  };

  const toggleRoute = (routeId: string) => {
    setTempHiddenRouteIds(
      prev => prev.includes(routeId)
        ? prev.filter(id => id !== routeId)
        : [...prev, routeId]
    );
  };

  const handleClose = () => {
    setTempSelected(selectedLots);
    setTempHiddenRouteIds(hiddenRouteIds);
    onClose();
  };

  const handleApply = () => {
    onApplyFilter(tempSelected);
    onApplyTransitFilter(tempHiddenRouteIds);
    onClose();
  };

  const handleToggleAll = () => {
    if (activeTab === 'parking') {
      setTempSelected(tempSelected.length === 0 ? lots.map(l => l.lot_id) : []);
    } else {
      setTempHiddenRouteIds(tempHiddenRouteIds.length === 0 ? routes.map(r => r.id) : []);
    }
  };

  const handleTabPress = (tab: 'parking' | 'transit') => {
    setActiveTab(tab);
    // Don't update scrolledTab here — let onMomentumScrollEnd do it once the
    // animation settles. Changing contentOffset mid-animation cancels it.
    pageScrollRef.current?.scrollTo({
      x: tab === 'transit' ? pageWidth : 0,
      animated: true,
    });
  };

  const handlePageWrapperLayout = (e: LayoutChangeEvent) => {
    setPageWidth(e.nativeEvent.layout.width);
    setPageHeight(e.nativeEvent.layout.height);
  };

  const toggleAllLabel = activeTab === 'parking'
    ? (tempSelected.length === 0 ? 'Select All' : 'Clear All')
    : (tempHiddenRouteIds.length === 0 ? 'Hide All' : 'Show All');

  return (
    <Modal
      visible={isOpen}
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropPress} onPress={handleClose} />

        <View style={styles.modal}>
          {/* Tab bar + close button */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'parking' && styles.tabActive]}
              onPress={() => handleTabPress('parking')}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'parking' }}
            >
              <Text style={[styles.tabText, activeTab === 'parking' && styles.tabTextActive]}>
                Parking
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'transit' && styles.tabActive]}
              onPress={() => handleTabPress('transit')}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'transit' }}
            >
              <Text style={[styles.tabText, activeTab === 'transit' && styles.tabTextActive]}>
                Transit
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeButton}
              accessibilityLabel="Close filter modal"
              accessibilityRole="button"
            >
              <Text style={styles.closeIcon}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Swipeable page area */}
          <View style={styles.pageWrapper} onLayout={handlePageWrapperLayout}>
            {pageWidth > 0 && pageHeight > 0 && (
              <ScrollView
                ref={pageScrollRef}
                horizontal
                pagingEnabled
                bounces={false}
                showsHorizontalScrollIndicator={false}
                scrollEventThrottle={16}
                contentOffset={{ x: scrolledTab === 'transit' ? pageWidth : 0, y: 0 }}
                onScroll={(e) => {
                  const idx = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
                  const tab = idx === 0 ? 'parking' : 'transit';
                  if (tab !== activeTab) setActiveTab(tab);
                }}
                onMomentumScrollEnd={(e) => {
                  const idx = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
                  const tab = idx === 0 ? 'parking' : 'transit';
                  setActiveTab(tab);
                  setScrolledTab(tab);
                }}
              >
                {/* Parking page */}
                <ScrollView
                  style={{ width: pageWidth, height: pageHeight }}
                  contentContainerStyle={styles.pageContent}
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>General Lot</Text>
                    <View style={styles.grid}>
                      {generalLots.map((lot) => (
                        <TouchableOpacity
                          key={lot.lot_id}
                          onPress={() => toggleLot(lot.lot_id)}
                          style={styles.lotButton}
                          accessibilityLabel={`${tempSelected.includes(lot.lot_id) ? 'Deselect' : 'Select'} general parking lot ${lot.lot_id}`}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: tempSelected.includes(lot.lot_id) }}
                        >
                          <View style={[styles.checkbox, tempSelected.includes(lot.lot_id) && styles.checkboxSelected]}>
                            {tempSelected.includes(lot.lot_id) && <Text style={styles.checkmark}>✓</Text>}
                          </View>
                          <Text style={styles.lotLabel}>{lot.lot_id}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <View style={styles.divider} />

                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Employee Lot</Text>
                    <View style={styles.grid}>
                      {employeeLots.map((lot) => (
                        <TouchableOpacity
                          key={lot.lot_id}
                          onPress={() => toggleLot(lot.lot_id)}
                          style={styles.lotButton}
                          accessibilityLabel={`${tempSelected.includes(lot.lot_id) ? 'Deselect' : 'Select'} employee parking lot ${lot.lot_id}`}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: tempSelected.includes(lot.lot_id) }}
                        >
                          <View style={[styles.checkbox, tempSelected.includes(lot.lot_id) && styles.checkboxSelected]}>
                            {tempSelected.includes(lot.lot_id) && <Text style={styles.checkmark}>✓</Text>}
                          </View>
                          <Text style={styles.lotLabel}>{lot.lot_id}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </ScrollView>

                {/* Transit page */}
                <ScrollView
                  style={{ width: pageWidth, height: pageHeight }}
                  contentContainerStyle={styles.pageContent}
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Shuttle Routes</Text>
                    {routes.length === 0 ? (
                      <Text style={styles.emptyRoutes}>No routes available.</Text>
                    ) : (
                      routes.map((route) => {
                        const isVisible = !tempHiddenRouteIds.includes(route.id);
                        return (
                          <TouchableOpacity
                            key={route.id}
                            onPress={() => toggleRoute(route.id)}
                            style={styles.routeRow}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: isVisible }}
                            accessibilityLabel={`${isVisible ? 'Hide' : 'Show'} ${route.name} route`}
                          >
                            <View style={[styles.checkbox, isVisible && styles.checkboxSelected]}>
                              {isVisible && <Text style={styles.checkmark}>✓</Text>}
                            </View>
                            <View style={[styles.routeBadge, { backgroundColor: route.color }]}>
                              <Text style={styles.routeBadgeText}>{route.shortName}</Text>
                            </View>
                            <Text style={styles.routeLabel}>{route.name}</Text>
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </View>
                </ScrollView>
              </ScrollView>
            )}
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity
              onPress={handleToggleAll}
              style={styles.clearButton}
              accessibilityLabel={toggleAllLabel}
              accessibilityRole="button"
            >
              <Text style={styles.clearButtonText}>{toggleAllLabel}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleApply}
              style={styles.applyButton}
              accessibilityLabel="Apply filters"
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

const getStyles = (
  colors: ThemeColors,
  spacing: typeof SPACING,
  typography: typeof TYPOGRAPHY
) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  backdropPress: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modal: {
    backgroundColor: colors.white,
    borderRadius: spacing.xl,
    width: '100%',
    maxWidth: 448,
    height: '80%',
    overflow: 'hidden',
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.borderGray,
    paddingHorizontal: spacing.xxl,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -1,
  },
  tabActive: {
    borderBottomColor: colors.primary,
  },
  tabText: {
    fontSize: typography.fontSize.xl,
    fontFamily: typography.fontFamily.bold,
    color: colors.mediumGray,
  },
  tabTextActive: {
    fontSize: typography.fontSize.xl,
    fontFamily: typography.fontFamily.bold,
    color: colors.primary,
  },
  closeButton: {
    padding: spacing.sm,
    borderRadius: spacing.md,
    marginLeft: spacing.sm,
  },
  closeIcon: {
    color: colors.mediumGray,
    fontSize: spacing.xxl,
    fontFamily: typography.fontFamily.regular,
  },
  pageWrapper: {
    flex: 1,
  },
  pageContent: {
    paddingHorizontal: spacing.xxl,
    paddingTop: 20,
    paddingBottom: spacing.xl,
  },
  section: {
    marginBottom: spacing.xxl,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: typography.fontSize.xl,
    fontFamily: typography.fontFamily.medium,
    marginBottom: spacing.xl,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  lotButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    width: '30%',
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  routeBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  routeBadgeText: {
    color: '#ffffff',
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.bold,
  },
  routeLabel: {
    color: colors.textPrimary,
    fontSize: typography.fontSize.md,
    flex: 1,
  },
  emptyRoutes: {
    color: colors.mediumGray,
    fontSize: typography.fontSize.md,
    fontStyle: 'italic',
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: spacing.sm,
    borderWidth: spacing.xs,
    borderColor: colors.borderGray,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkmark: {
    color: colors.white,
    fontSize: 20,
    fontFamily: typography.fontFamily.bold,
  },
  lotLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    flex: 1,
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: colors.borderGray,
    marginVertical: spacing.xxl,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.borderGray,
  },
  clearButton: {
    flex: 1,
    paddingVertical: spacing.lg,
    backgroundColor: colors.lightGray,
    borderRadius: spacing.md,
    alignItems: 'center',
  },
  clearButtonText: {
    color: colors.textPrimary,
    fontSize: typography.fontSize.xl,
    fontFamily: typography.fontFamily.medium,
  },
  applyButton: {
    flex: 1,
    paddingVertical: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: spacing.md,
    alignItems: 'center',
  },
  applyButtonText: {
    color: colors.white,
    fontSize: typography.fontSize.xl,
    fontFamily: typography.fontFamily.semibold,
  },
});
