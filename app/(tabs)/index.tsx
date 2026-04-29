import { useCallback, useRef, useState, useEffect } from 'react';
import {
  View, Text, StatusBar, Alert, FlatList, Image, Platform,
  TouchableOpacity, Modal, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import type { CameraView as CameraViewType } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';

import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { saveToHistory, loadHistory, deleteRecord, clearHistory, formatDate, ScanRecord } from '@/utils/history';
import { styles, ACCENT } from '@/components/scanner/styles';

import PermissionScreen from '@/components/scanner/PermissionScreen';
import LegacyCamera from '@/components/scanner/LegacyCamera';
import ProcessingScreen from '@/components/scanner/ProcessingScreen';
import ResultScreen from '@/components/scanner/ResultScreen';
import CustomScanner from '@/components/scanner/CustomScanner';

// Native DocumentScanner — null on Expo Go
let DocumentScanner: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DocumentScanner = require('react-native-document-scanner-plugin').default;
} catch {
  console.log('Không thể tải DocumentScanner Native (Expo Go)');
}

const isExpoGo = Constants.appOwnership === 'expo';

const BG = '#09090b';
const SURFACE = '#18181b';
const BORDER = 'rgba(255,255,255,0.08)';

export default function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraViewType>(null);
  const insets = useSafeAreaInsets();

  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrText, setOcrText] = useState('');
  const [ocrDetails, setOcrDetails] = useState<any[]>([]);
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [facing, setFacing] = useState<'back' | 'front'>('back');

  const bounceAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(bounceAnim, { toValue: 8, duration: 800, useNativeDriver: true }),
        Animated.timing(bounceAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [bounceAnim]);

  const [isPdf, setIsPdf] = useState(false);
  const [pdfFileName, setPdfFileName] = useState('');
  const [totalPages, setTotalPages] = useState(0);
  const [useLegacyCamera, setUseLegacyCamera] = useState(false);
  const [useCustomScanner, setUseCustomScanner] = useState(false);

  // History State
  const [records, setRecords] = useState<ScanRecord[]>([]);
  const [historyDetail, setHistoryDetail] = useState<ScanRecord | null>(null);

  const openHistoryDetail = (record: ScanRecord) => setHistoryDetail(record);
  const closeHistoryDetail = () => setHistoryDetail(null);

  useFocusEffect(
    useCallback(() => {
      loadHistory().then(setRecords);
    }, [])
  );

  const handleDelete = (id: string) => {
    Alert.alert('Xoá bản ghi', 'Bạn có chắc muốn xoá bản ghi này không?', [
      { text: 'Huỷ', style: 'cancel' },
      {
        text: 'Xoá',
        style: 'destructive',
        onPress: async () => {
          const updated = await deleteRecord(id);
          setRecords(updated);
        },
      },
    ]);
  };

  const handleClearAll = () => {
    Alert.alert('Xoá tất cả', 'Bạn có muốn xoá toàn bộ lịch sử quét không?', [
      { text: 'Huỷ', style: 'cancel' },
      {
        text: 'Xoá tất cả',
        style: 'destructive',
        onPress: async () => {
          await clearHistory();
          setRecords([]);
        },
      },
    ]);
  };

  if (!permission) return <View style={{ flex: 1, backgroundColor: BG }} />;
  if (!permission.granted) {
    return <PermissionScreen insetsTop={insets.top} requestPermission={requestPermission} />;
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  const recognizeImage = async (uri: string, scanType?: 'document' | 'card') => {
    // Luôn gửi ảnh lên server (BE) thay vì OCR cục bộ
    await uploadToServer(uri, false, undefined, scanType);
  };

  const startDocumentScanner = async () => {
    if (isExpoGo) {
      Alert.alert(
        'Chế Độ Expo Go',
        'Camera Native cần build nên không chạy trên Expo Go. Bạn có muốn sử dụng Camera thường không?',
        [
          { text: 'Huỷ', style: 'cancel' },
          { text: 'Mở Camera Thường', onPress: () => setUseLegacyCamera(true) },
        ]
      );
      return;
    }

    try {
      setUseCustomScanner(true);
    } catch {
      Alert.alert('Lỗi', 'Không thể khởi động trình quét tài liệu.');
    }
  };

  const handleCustomScannerCapture = async (uri: string, corners?: any[], type?: 'document' | 'card') => {
    setUseCustomScanner(false);
    // Tạm thời bỏ qua màn hình crop 4 góc (CropEditor) cho bản demo
    // Feed vào hệ thống OCR hiện tại
    setUseLegacyCamera(false);
    setIsPdf(false);
    setCapturedImage(uri);
    await recognizeImage(uri, type);
  };

  const takeLegacyPicture = async () => {
    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 1.0, skipProcessing: false, exif: false,
        });
        setUseLegacyCamera(false);
        setCapturedImage(photo.uri);
        setIsPdf(false);
        await recognizeImage(photo.uri);
      } catch (e) {
        console.error('Camera Error:', e);
      }
    }
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1 });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setUseLegacyCamera(false);
        const uri = result.assets[0].uri;
        setCapturedImage(uri);
        setIsPdf(false);
        await recognizeImage(uri);
      }
    } catch {}
  };

  const pickPdf = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setUseLegacyCamera(false);
        setCapturedImage(null);
        setIsPdf(true);
        setPdfFileName(asset.name);
        setTotalPages(0);
        uploadToServer(asset.uri, true, asset.name);
      }
    } catch {
      Alert.alert('Lỗi', 'Không thể chọn file PDF.');
    }
  };

  const uploadToServer = async (uri: string, isPdfFlag = false, originalName?: string, scanType?: string) => {
    setIsProcessing(true);
    setOcrText('');
    setOcrDetails([]);
    setTotalPages(0);

    // ─ Auto-rotate image based on EXIF before uploading ─────────────────────
    // manipulateAsync with an empty actions array bakes the EXIF rotation
    // into the pixel data, producing an upright image the BE can read
    let finalUri = uri;
    if (!isPdfFlag) {
      try {
        const rotated = await manipulateAsync(uri, [], { format: SaveFormat.JPEG, compress: 0.92 });
        finalUri = rotated.uri;
      } catch (rotErr) {
        console.warn('[uploadToServer] rotate step failed, using original uri:', rotErr);
      }
    }

    // Chuẩn hóa URI trên Android
    const normalizedUri = Platform.OS === 'android' && !finalUri.startsWith('file://') && !finalUri.startsWith('content://') && finalUri.startsWith('/')
      ? `file://${finalUri}`
      : finalUri;

    try {
      let filename = originalName ?? (finalUri.split('/').pop() ?? 'file.jpg');
      if (!filename.includes('.')) filename += '.jpg';

      const type = isPdfFlag
        ? 'application/pdf'
        : (() => { const m = /\.(\w+)$/.exec(filename); return m ? `image/${m[1]}` : 'image/jpeg'; })();

      const formData = new FormData();
      formData.append('file', { uri: normalizedUri, name: filename, type } as unknown as Blob);
      // if (scanType) {
      //   formData.append('scanType', scanType);
      // }

      const protocol = process.env.EXPO_PUBLIC_API_PROTOCOL ?? 'https';
      const host     = process.env.EXPO_PUBLIC_API_HOST ?? 'apiocr.aulacsoft.com';
      const port     = process.env.EXPO_PUBLIC_API_PORT ?? '443';

      if (!host) {
        setOcrText('⚠️ Chưa cấu hình API.\nHãy tạo file .env và điền EXPO_PUBLIC_API_HOST.');
        setIsProcessing(false);
        return;
      }

      const portPart = (port && port !== '80' && port !== '443') ? `:${port}` : '';
      const API_URL = `${protocol}://${host}${portPart}/api/extract-text`;

      const response = await fetch(API_URL, { method: 'POST', body: formData });
      const json = await response.json();

      if (json.status === 'success') {
        // Guard: treat empty text as an error so we never enter a blank-screen limbo
        const resultText = (json.text ?? '').trim();
        if (!resultText) {
          setOcrText('⚠️')  // sentinel — triggers empty-result UI (see STATE 3.5)
          setOcrDetails([]);
          setImageSize(json.imageSize ?? { width: 1, height: 1 });
          return;
        }

        setOcrText(resultText);
        setOcrDetails(json.details ?? []);
        setImageSize(json.imageSize ?? { width: 1, height: 1 });
        if (json.pages) setTotalPages(json.pages);

        let savedImageUri = uri;
        if (json.pdfPreviewBase64) {
          savedImageUri = `data:image/jpeg;base64,${json.pdfPreviewBase64}`;
          setCapturedImage(savedImageUri);
        }
        await saveToHistory(
          savedImageUri,
          resultText,
          isPdfFlag,
          json.details ?? [],
          json.imageSize ?? { width: 1, height: 1 },
        );
        loadHistory().then(setRecords);
      } else {
        setOcrText('⚠️ Lỗi: ' + (json.message ?? 'Không nhận dạng được văn bản.'));
      }
    } catch (e: any) {
      setOcrText(`⚠️ Lỗi kết nối: Không thể truy cập Backend.\n${e.message || e}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const resetScanner = () => {
    setCapturedImage(null); setOcrText(''); setOcrDetails([]);
    setImageSize({ width: 1, height: 1 }); 
    setUseLegacyCamera(false); setIsPdf(false); setUseCustomScanner(false);
    setPdfFileName(''); setTotalPages(0);
  };

  // ─── Card renderer ────────────────────────────────────────────────────────
  const renderRecordItem = ({ item }: { item: ScanRecord }) => (
    <TouchableOpacity style={sb.card} onPress={() => openHistoryDetail(item)} activeOpacity={0.75}>
      {item.isPdf ? (
        <View style={sb.thumbPdf}><Ionicons name="document-text" size={32} color="#f87171" /></View>
      ) : (
        <Image source={{ uri: item.imageUri }} style={sb.thumb} resizeMode="cover" />
      )}
      <View style={sb.cardInfo}>
        <Text style={sb.cardText} numberOfLines={3}>{item.text || '(Không có văn bản)'}</Text>
        <View style={sb.cardMeta}>
          <View style={sb.metaChip}>
            <Ionicons name="text-outline" size={11} color={ACCENT} />
            <Text style={sb.metaText}>{item.wordCount} từ</Text>
          </View>
          <View style={sb.metaChip}>
            <Ionicons name="time-outline" size={11} color="rgba(161,161,170,0.6)" />
            <Text style={[sb.metaText, { color: 'rgba(161,161,170,0.6)' }]}>{formatDate(item.createdAt)}</Text>
          </View>
        </View>
      </View>
      <TouchableOpacity style={sb.deleteBtn} onPress={() => handleDelete(item.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="trash-outline" size={18} color="rgba(239,68,68,0.7)" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* Header — only on home screen */}
      {!useLegacyCamera && !useCustomScanner && !capturedImage && !isPdf && (
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <View style={styles.headerLeft}>
            <View style={styles.headerDot} />
            <Text style={styles.headerTitle}>Tài Liệu Quét</Text>
          </View>
          {records.length > 0 && (
            <TouchableOpacity onPress={handleClearAll} style={sb.clearBtn}>
              <Ionicons name="trash" size={14} color="rgba(239,68,68,0.8)" />
              <Text style={sb.clearBtnText}>Xoá tất cả</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <View style={styles.content}>
        {/* STATE 0: History List */}
        {!capturedImage && !useLegacyCamera && !useCustomScanner && !isPdf && (
          <View style={{ flex: 1 }}>
            {records.length === 0 ? (
              <View style={sb.empty}>
                <View style={sb.emptyIconWrap}>
                  <View style={sb.emptyIconBg} />
                  <Ionicons name="document-text-outline" size={42} color="rgba(255,255,255,0.7)" style={{ position: 'absolute' }} />
                  <Ionicons name="scan-outline" size={84} color={ACCENT} />
                </View>
                <Text style={sb.emptyTitle}>Lịch sử trống</Text>
                <Text style={sb.emptySubtitle}>Các tài liệu bạn quét hoặc tải lên sẽ được hiển thị sẵn sàng ở đây.</Text>

                <Animated.View style={{ marginTop: 40, opacity: 0.8, alignItems: 'center', transform: [{ translateY: bounceAnim }] }}>
                  <Text style={{ color: ACCENT, fontSize: 13, fontWeight: '700', marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>Bắt đầu quét ngay</Text>
                  <Ionicons name="chevron-down" size={20} color={ACCENT} />
                </Animated.View>
              </View>
            ) : (
              <FlatList
                data={records}
                keyExtractor={(item) => item.id}
                renderItem={renderRecordItem}
                contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 130 }}
                showsVerticalScrollIndicator={false}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              />
            )}

            {/* Floating Dock */}
            <View style={[sb.dockContainer, { bottom: insets.bottom + 16 }]}>
              <TouchableOpacity
                style={[sb.dockBtnSmall, { backgroundColor: 'rgba(248,113,113,0.1)' }]}
                onPress={pickPdf}
              >
                <Ionicons name="document-text" size={18} color="#f87171" />
              </TouchableOpacity>

              {/* Primary scan button */}
              <TouchableOpacity
                style={sb.dockBtnPrimary}
                onPress={isExpoGo ? () => setUseLegacyCamera(true) : startDocumentScanner}
                activeOpacity={0.85}
              >
                <Ionicons name={isExpoGo ? 'camera' : 'scan'} size={22} color="#0a0a0d" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[sb.dockBtnSmall, { backgroundColor: 'rgba(255,255,255,0.08)' }]}
                onPress={pickImage}
              >
                <Ionicons name="image" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* STATE 0.5: Custom Scanner */}
        {useCustomScanner && !capturedImage && !isPdf && (
           <CustomScanner 
             onCapture={handleCustomScannerCapture} 
             onCancel={() => setUseCustomScanner(false)} 
           />
        )}

        {/* STATE 1: Legacy Camera */}
        {!capturedImage && useLegacyCamera && !useCustomScanner && !isPdf && (
          <LegacyCamera
            insetsBottom={insets.bottom}
            cameraRef={cameraRef}
            facing={facing}
            setFacing={setFacing}
            closeLegacyCamera={() => setUseLegacyCamera(false)}
            takeLegacyPicture={takeLegacyPicture}
            pickImage={pickImage}
            pickPdf={pickPdf}
          />
        )}

        {/* STATE 2: Processing */}
        {(capturedImage || isPdf) && isProcessing && (
          <ProcessingScreen isPdf={isPdf} />
        )}

        {/* STATE 3.5: Empty result after processing — prevents blank screen */}
        {(capturedImage || isPdf) && !isProcessing && ocrText === '\u26a0\ufe0f' && (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: BG }}>
            <View style={{
              backgroundColor: SURFACE, borderRadius: 24, padding: 32,
              alignItems: 'center', gap: 16, borderWidth: 1, borderColor: BORDER, width: '100%',
            }}>
              <View style={{
                width: 72, height: 72, borderRadius: 36,
                backgroundColor: 'rgba(251,191,36,0.12)',
                justifyContent: 'center', alignItems: 'center',
              }}>
                <Ionicons name="alert-circle" size={36} color="#fbbf24" />
              </View>
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center' }}>
                Không nhận dạng được chữ
              </Text>
              <Text style={{ color: '#a1a1aa', fontSize: 14, lineHeight: 22, textAlign: 'center' }}>
                {'Ảnh có thể bị nghiêng, mờ hoặc không có văn bản.\nHãy thử lại với ảnh rõ hơn.'}
              </Text>
              <TouchableOpacity
                style={{
                  backgroundColor: ACCENT, borderRadius: 16, paddingVertical: 14,
                  paddingHorizontal: 32, width: '100%', alignItems: 'center',
                }}
                onPress={() => {
                  if (capturedImage) uploadToServer(capturedImage, isPdf);
                }}
              >
                <Text style={{ color: '#0a0a0d', fontSize: 15, fontWeight: '800' }}>Thử lại</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  borderRadius: 16, paddingVertical: 14, paddingHorizontal: 32,
                  width: '100%', alignItems: 'center',
                  borderWidth: 1, borderColor: BORDER,
                }}
                onPress={resetScanner}
              >
                <Text style={{ color: '#a1a1aa', fontSize: 15, fontWeight: '600' }}>← Quay lại</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* STATE 3: Results */}
        {(capturedImage || isPdf) && !isProcessing && ocrText !== '' && ocrText !== '\u26a0\ufe0f' && (
          <ResultScreen
            insetsBottom={insets.bottom}
            isPdf={isPdf}
            pdfFileName={pdfFileName}
            totalPages={totalPages}
            capturedImage={capturedImage!}
            imageSize={imageSize}
            ocrDetails={ocrDetails}
            ocrText={ocrText}
            resetScanner={resetScanner}
          />
        )}
      </View>

      {/* History Detail Modal */}
      {historyDetail && (
        <Modal visible animationType="slide" onRequestClose={closeHistoryDetail}>
          <View style={{ flex: 1, backgroundColor: '#09090b' }}>
            <StatusBar barStyle="light-content" />
            <ResultScreen
              insetsBottom={insets.bottom}
              isPdf={historyDetail.isPdf ?? false}
              pdfFileName={historyDetail.isPdf ? 'Tài liệu PDF' : (historyDetail.imageUri.split('/').pop() ?? 'file')}
              totalPages={0}
              capturedImage={historyDetail.imageUri}
              imageSize={historyDetail.imageSize ?? { width: 1, height: 1 }}
              ocrDetails={historyDetail.ocrDetails ?? []}
              ocrText={historyDetail.text}
              resetScanner={closeHistoryDetail}
            />
          </View>
        </Modal>
      )}
    </View>
  );
}

// ─── StyleBlocks ──────────────────────────────────────────────────────────────
const sb = {
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', backgroundColor: 'rgba(239,68,68,0.07)' } as any,
  clearBtnText: { color: 'rgba(239,68,68,0.8)', fontSize: 13, fontWeight: '600' } as any,

  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, marginTop: -40 } as any,
  emptyIconWrap: { width: 120, height: 120, justifyContent: 'center', alignItems: 'center', marginBottom: 24 } as any,
  emptyIconBg: { position: 'absolute', width: 90, height: 90, borderRadius: 28, backgroundColor: 'rgba(6,182,212,0.1)', transform: [{ rotate: '-10deg' }] } as any,
  emptyTitle: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 12, letterSpacing: 0.6 } as any,
  emptySubtitle: { fontSize: 14, color: '#a1a1aa', textAlign: 'center', lineHeight: 22, paddingHorizontal: 16 } as any,

  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: SURFACE, borderRadius: 16, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', padding: 12, gap: 12 } as any,
  thumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: '#000' } as any,
  thumbPdf: { width: 72, height: 72, borderRadius: 10, backgroundColor: 'rgba(248,113,113,0.1)', justifyContent: 'center', alignItems: 'center' } as any,
  cardInfo: { flex: 1 } as any,
  cardText: { color: '#e4e4e7', fontSize: 14, lineHeight: 20, marginBottom: 8 } as any,
  cardMeta: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' } as any,
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 4 } as any,
  metaText: { color: ACCENT, fontSize: 11, fontWeight: '500' } as any,
  deleteBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(239,68,68,0.07)', justifyContent: 'center', alignItems: 'center' } as any,

  dockContainer: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 50, backgroundColor: 'rgba(24,24,27,0.85)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 32, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', zIndex: 999 } as any,
  dockBtnPrimary: { width: 60, height: 60, borderRadius: 24, backgroundColor: ACCENT, justifyContent: 'center', alignItems: 'center', shadowColor: ACCENT, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 6 } as any,
  dockBtnSmall: { width: 50, height: 50, borderRadius: 19, justifyContent: 'center', alignItems: 'center' } as any,
};
