import React from 'react';
import { TouchableOpacity, View, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/Ionicons';
import { HomeScreen as LongTerm, MapScreen, ProfileScreen, ShortTermForecastScreen } from '../screens';
import { Text } from '../components/CustomText';
import { TYPOGRAPHY, SPACING } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import type { RootTabParamList, MapStackParamList } from '../types/navigation';

const Tab = createBottomTabNavigator<RootTabParamList>();
const Stack = createStackNavigator<MapStackParamList>();

// Inline sign-in prompt screen shown in the Profile tab for guests
const GuestSignInScreen: React.FC = () => {
  const { colors } = useTheme();
  const { login, exitGuestMode, isLoading } = useAuth();

  const handleLogin = async () => {
    try {
      exitGuestMode();
      await login();
    } catch {
      // login() will throw on cancel — re-enter guest mode
      exitGuestMode();
    }
  };

  return (
    <View style={[guestStyles.container, { backgroundColor: colors.lightGray }]}>
      <Icon name="person-circle-outline" size={72} color={colors.primary} />
      <Text style={[guestStyles.title, { color: colors.textPrimary }]}>Sign in to SharkPark</Text>
      <Text style={[guestStyles.subtitle, { color: colors.gray }]}>
        Create reports, save favourite lots, and get personalised alerts.
      </Text>
      <TouchableOpacity
        style={[guestStyles.button, { backgroundColor: colors.primary, opacity: isLoading ? 0.6 : 1 }]}
        onPress={handleLogin}
        disabled={isLoading}
      >
        <Text style={[guestStyles.buttonText, { color: colors.white }]}>
          {isLoading ? 'Authenticating...' : 'Login with CSULB SSO'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const guestStyles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xxxl, gap: SPACING.lg },
  title: { fontSize: TYPOGRAPHY.fontSize.xxl, fontFamily: TYPOGRAPHY.fontFamily.bold, textAlign: 'center' },
  subtitle: { fontSize: TYPOGRAPHY.fontSize.md, textAlign: 'center', lineHeight: 22 },
  button: { width: '100%', paddingVertical: SPACING.lg, borderRadius: SPACING.md, alignItems: 'center', marginTop: SPACING.md },
  buttonText: { fontSize: TYPOGRAPHY.fontSize.lg, fontFamily: TYPOGRAPHY.fontFamily.semibold },
});

// Stack Navigator for Map and Short Term Forecast
const MapStack: React.FC = () => {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MapMain" component={MapScreen} />
      <Stack.Screen name="Short Term Forecast" component={ShortTermForecastScreen} />
    </Stack.Navigator>
  );
};

const MainTabNavigator: React.FC = () => {
  const { colors } = useTheme();
  const { isGuest } = useAuth();
  
  return (
    <Tab.Navigator
      initialRouteName="Map"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.gray,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopWidth: 1,
          borderTopColor: colors.borderGray,
          paddingTop: SPACING.md,
          paddingBottom: SPACING.xxxl - SPACING.xs, // 30px equivalent
          height: 90, // Tab bar specific height
        },
        tabBarLabelStyle: {
          fontSize: TYPOGRAPHY.fontSize.sm,
          fontFamily: TYPOGRAPHY.fontFamily.semibold,
        },
      }}
    >
      <Tab.Screen 
        name="Long Term" 
        component={LongTerm}
        options={{
          tabBarIcon: ({ focused, color, size }) => (
            <Icon 
              name={focused ? 'bar-chart' : 'bar-chart-outline'} 
              size={size} 
              color={color} 
            />
          ),
        }}
      />
      <Tab.Screen 
        name="Map" 
        component={MapStack}
        options={{
          tabBarIcon: ({ focused, color, size }) => (
            <Icon 
              name={focused ? 'map' : 'map-outline'} 
              size={size} 
              color={color} 
            />
          ),
        }}
      />
      <Tab.Screen 
        name="Profile" 
        component={isGuest ? GuestSignInScreen : ProfileScreen}
        options={{
          tabBarLabel: isGuest ? 'Sign In' : 'Profile',
          tabBarIcon: ({ focused, color, size }) => (
            <Icon 
              name={isGuest ? (focused ? 'log-in' : 'log-in-outline') : (focused ? 'person' : 'person-outline')} 
              size={size} 
              color={color} 
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
};

export default MainTabNavigator;
