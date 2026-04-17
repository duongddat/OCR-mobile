import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ACCENT } from './styles';

type Props = {
  isPdf?: boolean;
  message?: string;
};

export default function ProcessingScreen({ isPdf = false, message }: Props) {
  return (
    <View style={s.wrap}>
      <View style={s.iconWrap}>
        <View style={s.iconInner}>
          <Ionicons name={isPdf ? 'document-text' : 'scan-outline'} size={40} color={ACCENT} />
        </View>
      </View>
      <ActivityIndicator size="large" color={ACCENT} style={{ marginTop: 28 }} />
      <Text style={s.title}>Đang Phân Tích</Text>
      <Text style={s.subtitle}>
        {message ?? 'AI đang nhận dạng văn bản...'}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: '#09090b',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  iconWrap: {
    width: 120,
    height: 120,
    borderRadius: 34,
    backgroundColor: 'rgba(6,182,212,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(6,182,212,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconInner: {
    width: 84,
    height: 84,
    borderRadius: 24,
    backgroundColor: 'rgba(6,182,212,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    marginTop: 20,
    letterSpacing: 0.3,
  },
  subtitle: {
    color: '#a1a1aa',
    fontSize: 15,
    marginTop: 8,
    textAlign: 'center',
  },
});
