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

/**
 * Attribute filters surfaced as toggle chips in the Parking tab. Each chip is a
 * pure client-side predicate over the optional fields on `LotSummary`. When one
 * or more chips are active, lots that fail the predicate are visually dimmed
 * and excluded from the result set on Apply (see `matchesAttributes`).
 *
 * Keep the keys stable — they are persisted to AsyncStorage under
 * `filter:attributes` and round-tripped through MapScreen.
 */
export interface LotAttributePredicate {
  key: string;
  label: string;
  test: (lot: LotSummary) => boolean;
}

export const ATTRIBUTE_FILTERS: readonly LotAttributePredicate[] = [
  { key: 'ev', label: 'EV charging', test: (l) => (l.ev_charging_stations ?? 0) > 0 },
  { key: 'low_emission', label: 'Low-emission', test: (l) => (l.low_emission_spaces ?? 0) > 0 },
  { key: 'accessible', label: 'Accessible', test: (l) => (l.accessible_spaces ?? 0) > 0 },
  { key: 'motorcycle', label: 'Motorcycle', test: (l) => (l.motorcycle_spaces ?? 0) > 0 },
  { key: 'daily_permit', label: 'Accepts daily', test: (l) => l.daily_permit_allowed === true },
  { key: 'pay_station', label: 'Pay station', test: (l) => (l.pay_stations ?? 0) > 0 },
  { key: 'parkmobile', label: 'ParkMobile', test: (l) => (l.park_mobile_zones?.length ?? 0) > 0 },
  { key: 'covered', label: 'Covered', test: (l) => l.is_covered === true },
] as const;

/**
 * AND-combine every active attribute. An empty `activeKeys` matches all lots.
 */
export function matchesAttributes(lot: LotSummary, activeKeys: string[]): boolean {
  if (activeKeys.length === 0) return true;
  for (const key of activeKeys) {
    const filter = ATTRIBUTE_FILTERS.find((f) => f.key === key);
    if (filter && !filter.test(lot)) return false;
  }
  return true;
}

export interface LotSummary {
  lot_id: string;
  lot_type: 'STUDENT' | 'EMPLOYEE';
  // Optional attribute fields used by ATTRIBUTE_FILTERS. Absent in lightweight
  // test fixtures — predicates treat missing values as "does not have".
  ev_charging_stations?: number;
  low_emission_spaces?: number;
  accessible_spaces?: number;
  motorcycle_spaces?: number;
  daily_permit_allowed?: boolean;
  pay_stations?: number;
  park_mobile_zones?: string[];
  is_covered?: boolean;
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
  /** Active attribute filter keys (subset of ATTRIBUTE_FILTERS[].key). */
  selectedAttributes?: string[];
  onApplyAttributeFilter?: (attributeKeys: string[]) => void;
}

export function LotFilterModal({
  isOpen,
  onClose,
  lots,
  selectedLots,
  onApplyFilter,
  routes,
  hiddenRouteIds,
  onApplyTransitFilter,
  selectedAttributes = [],
  onApplyAttributeFilter,
}: LotFilterModalProps) {
  const { colors, spacing, typography } = useTheme();
  const [activeTab, setActiveTab] = useState<'parking' | 'transit'>('parking');
  const [scrolledTab, setScrolledTab] = useState<'parking' | 'transit'>('parking');
  const [tempSelected, setTempSelected] = useState<string[]>(selectedLots);
  const [tempAttributes, setTempAttributes] = useState<string[]>(selectedAttributes);
  const [tempHiddenRouteIds, setTempHiddenRouteIds] = useState<string[]>(hiddenRouteIds);
  const [pageWidth, setPageWidth] = useState(0);
  const [pageHeight, setPageHeight] = useState(0);
  const pageScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (isOpen) {
      setTempSelected(selectedLots);
      setTempAttributes(selectedAttributes);
      setTempHiddenRouteIds(hiddenRouteIds);
    }
  }, [isOpen, selectedLots, selectedAttributes, hiddenRouteIds]);

  const styles = useMemo(() => getStyles(colors, spacing, typography), [colors, spacing, typography]);

  const generalLots = useMemo(() => lots.filter(l => l.lot_type === 'STUDENT'), [lots]);
  const employeeLots = useMemo(() => lots.filter(l => l.lot_type === 'EMPLOYEE'), [lots]);

  // Memoised per-lot match against the active attribute chips. Lots that fail
  // are dimmed + disabled and excluded from section "Select all" / Apply.
  const matchingIds = useMemo(() => {
    const set = new Set<string>();
    for (const l of lots) if (matchesAttributes(l, tempAttributes)) set.add(l.lot_id);
    return set;
  }, [lots, tempAttributes]);

  const toggleLot = (lotId: string) => {
    setTempSelected(
      prev => prev.includes(lotId)
        ? prev.filter(id => id !== lotId)
        : [...prev, lotId]
    );
  };

  const toggleAttribute = (key: string) => {
    setTempAttributes(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const toggleRoute = (routeId: string) => {
    setTempHiddenRouteIds(
      prev => prev.includes(routeId)
        ? prev.filter(id => id !== routeId)
        : [...prev, routeId]
    );
  };

  // Section-level helpers. Operate only on attribute-matching lots so the
  // header toggle never reaches into dimmed rows.
  const sectionMatchingIds = (sectionLots: LotSummary[]) =>
    sectionLots.filter(l => matchingIds.has(l.lot_id)).map(l => l.lot_id);

  const sectionSelectionState = (sectionLots: LotSummary[]): 'all' | 'some' | 'none' => {
    const eligible = sectionMatchingIds(sectionLots);
    if (eligible.length === 0) return 'none';
    const selectedCount = eligible.filter(id => tempSelected.includes(id)).length;
    if (selectedCount === 0) return 'none';
    if (selectedCount === eligible.length) return 'all';
    return 'some';
  };

  const selectSection = (sectionLots: LotSummary[]) => {
    const eligible = sectionMatchingIds(sectionLots);
    setTempSelected(prev => Array.from(new Set([...prev, ...eligible])));
  };

  const clearSection = (sectionLots: LotSummary[]) => {
    const sectionIds = new Set(sectionLots.map(l => l.lot_id));
    setTempSelected(prev => prev.filter(id => !sectionIds.has(id)));
  };

  const handleClose = () => {
    setTempSelected(selectedLots);
    setTempAttributes(selectedAttributes);
    setTempHiddenRouteIds(hiddenRouteIds);
    onClose();
  };

  const handleApply = () => {
    onApplyFilter(tempSelected);
    onApplyAttributeFilter?.(tempAttributes);
    onApplyTransitFilter(tempHiddenRouteIds);
    onClose();
  };

  const handleToggleAll = () => {
    if (activeTab === 'parking') {
      // Footer "Select All" honours the active attribute filter so it can't
      // re-select dimmed lots behind the user's back.
      const eligible = lots.filter(l => matchingIds.has(l.lot_id)).map(l => l.lot_id);
      const alreadyAll = eligible.length > 0 && eligible.every(id => tempSelected.includes(id));
      setTempSelected(alreadyAll ? [] : eligible);
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
    ? (() => {
        const eligible = lots.filter(l => matchingIds.has(l.lot_id)).map(l => l.lot_id);
        const allSelected = eligible.length > 0 && eligible.every(id => tempSelected.includes(id));
        return allSelected ? 'Clear All' : 'Select All';
      })()
    : (tempHiddenRouteIds.length === 0 ? 'Hide All' : 'Show All');

  const renderLotSection = ({
    title,
    sectionLots,
    accessibilityNoun,
  }: {
    title: string;
    sectionLots: LotSummary[];
    accessibilityNoun: string;
  }) => {
    const state = sectionSelectionState(sectionLots);
    const matchingCount = sectionMatchingIds(sectionLots).length;
    const hasAttributeFilter = tempAttributes.length > 0;
    const selectAllDisabled = matchingCount === 0 || state === 'all';
    const clearDisabled = state === 'none';

    return (
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionTitleColumn}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {hasAttributeFilter && (
              <Text style={styles.sectionMatchCount}>
                {matchingCount} of {sectionLots.length} match
              </Text>
            )}
          </View>
          <View style={styles.sectionHeaderActions}>
            <TouchableOpacity
              onPress={() => selectSection(sectionLots)}
              style={styles.sectionActionButton}
              accessibilityRole="button"
              accessibilityLabel={`Select all ${title.toLowerCase()} lots`}
              accessibilityState={{ disabled: selectAllDisabled }}
              disabled={selectAllDisabled}
            >
              <Text
                style={[
                  styles.sectionActionText,
                  !selectAllDisabled && styles.sectionActionTextActive,
                  selectAllDisabled && styles.sectionActionTextDisabled,
                ]}
              >
                Select all
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => clearSection(sectionLots)}
              style={styles.sectionActionButton}
              accessibilityRole="button"
              accessibilityLabel={`Clear ${title.toLowerCase()} lot selection`}
              accessibilityState={{ disabled: clearDisabled }}
              disabled={clearDisabled}
            >
              <Text
                style={[
                  styles.sectionActionText,
                  !clearDisabled && styles.sectionActionTextActive,
                  clearDisabled && styles.sectionActionTextDisabled,
                ]}
              >
                Clear
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.grid}>
          {sectionLots.map((lot) => {
            const isSelected = tempSelected.includes(lot.lot_id);
            const isDimmed = !matchingIds.has(lot.lot_id);
            return (
              <TouchableOpacity
                key={lot.lot_id}
                onPress={() => toggleLot(lot.lot_id)}
                disabled={isDimmed}
                style={[styles.lotButton, isDimmed && styles.lotButtonDimmed]}
                accessibilityLabel={`${isSelected ? 'Deselect' : 'Select'} ${accessibilityNoun} ${lot.lot_id}${isDimmed ? ' (does not match active filters)' : ''}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected, disabled: isDimmed }}
              >
                <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                  {isSelected && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.lotLabel}>{lot.lot_id}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <Modal
      visible={isOpen}
      transparent
      onRequestClose={handleClose}
      accessibilityViewIsModal={true}
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
                  {/* Attribute chip row */}
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Show only lots with</Text>
                    <View style={styles.chipRow}>
                      {ATTRIBUTE_FILTERS.map((attr) => {
                        const isActive = tempAttributes.includes(attr.key);
                        return (
                          <TouchableOpacity
                            key={attr.key}
                            onPress={() => toggleAttribute(attr.key)}
                            style={[styles.chip, isActive && styles.chipActive]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: isActive }}
                            accessibilityLabel={`${isActive ? 'Disable' : 'Enable'} ${attr.label} filter`}
                          >
                            <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                              {attr.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {tempAttributes.length > 0 && (
                      <TouchableOpacity
                        onPress={() => setTempAttributes([])}
                        accessibilityRole="button"
                        accessibilityLabel="Clear attribute filters"
                        style={styles.chipClearButton}
                      >
                        <Text style={styles.chipClearText}>Clear attributes</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <View style={styles.divider} />

                  {renderLotSection({
                    title: 'General Lot',
                    sectionLots: generalLots,
                    accessibilityNoun: 'general parking lot',
                  })}

                  <View style={styles.divider} />

                  {renderLotSection({
                    title: 'Employee Lot',
                    sectionLots: employeeLots,
                    accessibilityNoun: 'employee parking lot',
                  })}
                </ScrollView>

                {/* Transit page */}
                <ScrollView
                  style={{ width: pageWidth, height: pageHeight }}
                  contentContainerStyle={styles.pageContent}
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.section}>
                    <View style={styles.sectionHeaderRow}>
                      <View style={styles.sectionTitleColumn}>
                        <Text style={styles.sectionTitle}>Shuttle Routes</Text>
                      </View>
                      {routes.length > 0 && (() => {
                        const allVisible = tempHiddenRouteIds.length === 0;
                        const allHidden = tempHiddenRouteIds.length === routes.length;
                        return (
                          <View style={styles.sectionHeaderActions}>
                            <TouchableOpacity
                              onPress={() => setTempHiddenRouteIds([])}
                              disabled={allVisible}
                              style={styles.sectionActionButton}
                              accessibilityRole="button"
                              accessibilityLabel="Show all routes"
                              accessibilityState={{ disabled: allVisible }}
                            >
                              <Text
                                style={[
                                  styles.sectionActionText,
                                  !allVisible && styles.sectionActionTextActive,
                                  allVisible && styles.sectionActionTextDisabled,
                                ]}
                              >
                                Show all
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => setTempHiddenRouteIds(routes.map(r => r.id))}
                              disabled={allHidden}
                              style={styles.sectionActionButton}
                              accessibilityRole="button"
                              accessibilityLabel="Hide all routes"
                              accessibilityState={{ disabled: allHidden }}
                            >
                              <Text
                                style={[
                                  styles.sectionActionText,
                                  !allHidden && styles.sectionActionTextActive,
                                  allHidden && styles.sectionActionTextDisabled,
                                ]}
                              >
                                Hide all
                              </Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })()}
                    </View>
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
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitleColumn: {
    flex: 1,
  },
  sectionMatchCount: {
    color: colors.mediumGray,
    fontSize: typography.fontSize.sm,
    marginTop: -spacing.md,
    marginBottom: spacing.md,
  },
  sectionHeaderActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  sectionActionButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sectionActionText: {
    color: colors.primary,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.medium,
  },
  sectionActionTextActive: {
    fontFamily: typography.fontFamily.bold,
  },
  sectionActionTextDisabled: {
    color: colors.mediumGray,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderGray,
    backgroundColor: colors.white,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    color: colors.textPrimary,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.medium,
  },
  chipTextActive: {
    color: colors.white,
  },
  chipClearButton: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
  },
  chipClearText: {
    color: colors.primary,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.medium,
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
  lotButtonDimmed: {
    opacity: 0.35,
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
