import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ACCENT = '#06b6d4';

function TabBarBackground() {
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(9,9,11,0.97)', borderTopColor: 'rgba(255,255,255,0.07)', borderTopWidth: 1 }]} />;
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACCENT,
        tabBarInactiveTintColor: 'rgba(161,161,170,0.6)',
        tabBarBackground: () => <TabBarBackground />,
        tabBarStyle: {
          position: 'absolute',
          borderTopWidth: 1,
          borderTopColor: 'rgba(255,255,255,0.07)',
          height: 64 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 8,
          backgroundColor: 'transparent',
          elevation: 0,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: 0.4,
          marginTop: 2,
        },
        tabBarIconStyle: {
          marginBottom: -2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'ScanDoc',
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.iconWrap, focused && styles.iconActive]}>
              <Ionicons name={focused ? 'scan' : 'scan-outline'} size={22} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Lịch Sử',
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.iconWrap, focused && styles.iconActive]}>
              <Ionicons name={focused ? 'time' : 'time-outline'} size={22} color={color} />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconActive: {
    backgroundColor: 'rgba(6,182,212,0.15)',
  },
});
