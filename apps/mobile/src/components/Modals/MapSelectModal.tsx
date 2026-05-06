import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Modal, View, Pressable, StyleSheet, FlatList,
  TouchableOpacity, Animated, Dimensions, Platform,
  Linking, Alert,
} from 'react-native';
import { Text } from '../CustomText';
import { getApps } from 'react-native-map-link';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme, ThemeColors } from '../../context/ThemeContext';

interface MapApp {
  id: string;
  name: string;
  icon: number;
  open: () => Promise<void | null>; 
}

interface MapSelectModalProps {
  isVisible: boolean;
  onClose: () => void;
  lat: number;
  lon: number;
  title: string;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export const MapSelectModal = ({ isVisible, onClose, lat, lon, title }: MapSelectModalProps) => {
  const { colors } = useTheme();
  
  const [availableApps, setAvailableApps] = useState<MapApp[]>([]);
  
  const styles = useMemo(() => getStyles(colors), [colors]);
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (isVisible) {
      // Lightweight operation, but fetch logic could be moved to a hook if desired
      const fetchApps = async (): Promise<void> => {
        try {
          const result = await getApps({
            latitude: lat,
            longitude: lon,
            title,
            googleForceLatLon: true, // Forces the use of lat/lon instead of address for Google Maps
            directionsMode: 'car',
          });

          // Apple Maps with `daddr=` + `q=<name>` resolves the name via text
          // search and ignores the coordinates (e.g. "Parking Lot G7" → the
          // campus). Override the open() function so apple-maps uses
          // `ll=lat,lon&q=<name>&dirflg=d` instead, which anchors the pin to
          // the exact coordinates and uses the name only as a display label.
          const apps = (result as unknown as MapApp[]).map((app) => {
            if (app.id === 'apple-maps') {
              return {
                ...app,
                open: async () => {
                  const encodedTitle = encodeURIComponent(title);
                  const url = `maps://?ll=${lat},${lon}&q=${encodedTitle}&dirflg=d`;
                  try {
                    await Linking.openURL(url);
                  } catch (err) {
                    console.error('Failed to open Apple Maps:', err);
                    Alert.alert(
                      'Could not open Apple Maps',
                      'Please try a different navigation app.',
                    );
                  }
                },
              };
            }
            return app;
          });

          setAvailableApps(apps);
        } catch (error) {
          console.error("Failed to fetch map apps:", error);
        }
      };

      fetchApps();
    
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 50,
        friction: 10,
      }).start();
    }
  }, [isVisible, lat, lon, title]);

  const handleClose = (): void => {
    Animated.timing(slideAnim, {
      toValue: SCREEN_HEIGHT,
      duration: 200,
      useNativeDriver: true,
    }).start(() => onClose());
  };

  return (
    <Modal 
      visible={isVisible} 
      transparent 
      animationType="none"
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropPress} onPress={handleClose} />
        
        <Animated.View style={[styles.modal, { transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Navigate to {title}</Text>
            <TouchableOpacity
              onPress={handleClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Icon name="close" size={24} color={colors.textPrimary} accessible={false} />
            </TouchableOpacity>
          </View>

          {/* Map App List */}
          <FlatList
            data={availableApps}
            keyExtractor={(item: MapApp) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }: { item: MapApp }) => (
              <TouchableOpacity
                style={styles.appItem}
                accessibilityRole="button"
                accessibilityLabel={`Open in ${item.name}`}
                onPress={async () => {
                  try {
                    await item.open();
                  } catch (error) {
                    console.error(`[MapSelectModal] Failed to open map app (${item.name}):`, error);
                    
                    Alert.alert(
                      'Map Open Error',
                      'The app could not be opened. Please try again.',
                      [{ text: 'OK', style: 'cancel' }]
                    );
                  } finally {
                    handleClose();
                  }
                }}
              >
                <View style={styles.mapIcon}>
                  <Icon name="navigate-circle-outline" size={28} color={colors.darkGray} />
                </View>
                <Text style={styles.appName}>{item.name}</Text>
                <Icon name="chevron-forward" size={20} color={colors.toggleGray} accessible={false} />
              </TouchableOpacity>
            )}
          />
        </Animated.View>
      </View>
    </Modal>
  );
};

const getStyles = (
  colors: ThemeColors
) => StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
      justifyContent: 'flex-end',
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
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingBottom: Platform.OS === 'ios' ? 40 : 20, // Extra padding for iOS home indicator
      maxHeight: SCREEN_HEIGHT * 0.7,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 24,
      paddingVertical: 20,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderGray,
    },
    title: {
      color: colors.textPrimary,
      fontSize: 18,
      fontWeight: '700',
    },
    listContent: {
      paddingHorizontal: 24,
    },
    appItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderGray,
    },
    mapIcon: {
      width: 40,
      height: 40,
      borderRadius: 10,
      backgroundColor: colors.lightGray,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    appName: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '500',
    },
  });