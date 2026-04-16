import { View, Text, TouchableOpacity, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { styles, ACCENT } from './styles';

type Props = {
  insetsTop: number;
  requestPermission: () => void;
};

export default function PermissionScreen({ insetsTop, requestPermission }: Props) {
  return (
    <View style={[styles.permScreen, { paddingTop: insetsTop + 20 }]}>
      <StatusBar barStyle="light-content" />
      <View style={styles.permIcon}>
        <Ionicons name="camera" size={48} color={ACCENT} />
      </View>
      <Text style={styles.permTitle}>Cần Quyền Camera</Text>
      <Text style={styles.message}>
        Ứng dụng cần truy cập camera để quét và nhận dạng văn bản.
      </Text>
      <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
        <Ionicons name="checkmark-circle" size={20} color="#fff" />
        <Text style={styles.permBtnText}>Cho Phép Truy Cập</Text>
      </TouchableOpacity>
    </View>
  );
}
