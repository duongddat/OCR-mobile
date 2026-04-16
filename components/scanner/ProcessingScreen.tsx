import { View, Image, Text, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { styles, ACCENT } from './styles';

type Props = {
  capturedImage: string | null;
  isPdf: boolean;
};

export default function ProcessingScreen({ capturedImage, isPdf }: Props) {
  return (
    <View style={styles.processingWrap}>
      <Image source={{ uri: capturedImage ?? undefined }} style={styles.blurBg} blurRadius={12} />
      <View style={styles.processingOverlay} />
      <View style={styles.processingCard}>
        <View style={styles.pulseOuter}>
          <View style={styles.pulseInner}>
             <Ionicons name="document-text" size={36} color={ACCENT} />
          </View>
        </View>
        <ActivityIndicator size="large" color={ACCENT} style={{ marginTop: 24 }} />
        <Text style={styles.processingTitle}>Đang Phân Tích</Text>
        <Text style={styles.processingSubtitle}>AI đang nhận dạng văn bản...</Text>
      </View>
    </View>
  );
}
