import { Stack } from 'expo-router';
import React from 'react';


export default function TabLayout() {


  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#09090b' }, 
      }}
    >
      <Stack.Screen name="index" />
    </Stack>
  );
}
