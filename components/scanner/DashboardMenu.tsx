import { ScrollView, View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { styles, ACCENT } from './styles';

type Props = {
  startDocumentScanner: () => void;
  pickImage: () => void;
  pickPdf: () => void;
  openLegacyCamera: () => void;
  isExpoGo: boolean;
};

export default function DashboardMenu({ startDocumentScanner, pickImage, pickPdf, openLegacyCamera, isExpoGo }: Props) {
  return (
    <ScrollView contentContainerStyle={styles.dashboardWrap} showsVerticalScrollIndicator={false} bounces={false}>
      <View style={styles.dashboardIconWrap}>
        <Ionicons name="scan-outline" size={72} color={ACCENT} />
      </View>
      <Text style={styles.dashboardTitle}>Trình Quét Tài Liệu AI</Text>
      <Text style={styles.dashboardDesc}>
        Công nghệ tự động nhận diện khung viền, loại bỏ nền thừa và bóp méo hình ảnh thông minh trước khi phân tích OCR.
      </Text>

      <TouchableOpacity style={styles.scanActionBtn} onPress={startDocumentScanner}>
        <Ionicons name="scan" size={24} color="#fff" />
        <Text style={styles.scanActionText}>Bắt Đầu Quét Tài Liệu</Text>
      </TouchableOpacity>

      <View style={{ flexDirection: 'row', gap: 12, width: '100%', marginTop: 20 }}>
        <TouchableOpacity style={[styles.secondaryActionBtn, { flex: 1, marginTop: 0, paddingHorizontal: 8, justifyContent: 'center' }]} onPress={pickImage}>
          <Ionicons name="images-outline" size={18} color="#a1a1aa" />
          <Text style={[styles.secondaryActionText, { fontSize: 14 }]}>Ảnh từ máy</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.pdfActionBtn, { flex: 1, marginTop: 0, paddingHorizontal: 8, justifyContent: 'center' }]} onPress={pickPdf}>
          <Ionicons name="document-outline" size={18} color="#f87171" />
          <Text style={[styles.pdfActionText, { fontSize: 14 }]}>Tệp PDF</Text>
        </TouchableOpacity>
      </View>

      {isExpoGo && (
        <View style={[styles.expoWarning, { width: '100%' }]}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Ionicons name="warning-outline" size={18} color="#fbbf24" style={{ marginTop: 2 }} />
            <Text style={[styles.expoWarningText, { flex: 1 }]}>
              Đang chạy trên Expo Go: Để dùng Trình Quét AI, bạn cần build file APK. Nhấn để mở Camera thường (Test API).
            </Text>
          </View>
          <TouchableOpacity onPress={openLegacyCamera} style={{ marginTop: 12, alignSelf: 'flex-end' }}>
            <Text style={{ color: ACCENT, fontWeight: '700' }}>Mở Camera Thường →</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}
