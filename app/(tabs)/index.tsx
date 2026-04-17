import { useCallback, useRef, useState, useEffect } from 'react';
import { View, Text, StatusBar, Alert, FlatList, Image, TouchableOpacity, Modal, ScrollView, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import type { CameraView as CameraViewType } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

import { saveToHistory, loadHistory, deleteRecord, clearHistory, formatDate, ScanRecord } from '@/utils/history';
import { styles, ACCENT } from '@/components/scanner/styles';

import PermissionScreen from '@/components/scanner/PermissionScreen';
import LegacyCamera from '@/components/scanner/LegacyCamera';
import ProcessingScreen from '@/components/scanner/ProcessingScreen';
import ResultScreen from '@/components/scanner/ResultScreen';
import CustomScannerScreen from '@/components/scanner/CustomScannerScreen';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export default function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraViewType>(null);
  const insets = useSafeAreaInsets();

  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrText, setOcrText] = useState('');
  const [ocrDetails, setOcrDetails] = useState<any[]>([]);
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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
  const [selectedRecord, setSelectedRecord] = useState<ScanRecord | null>(null);
  // When non-null: shows ResultScreen for a history item directly (Màn hình 3)
  const [historyDetail, setHistoryDetail] = useState<ScanRecord | null>(null);
  const [historyCopied, setHistoryCopied] = useState(false);

  const openHistoryDetail = (record: ScanRecord) => {
    setHistoryDetail(record);
  };
  const closeHistoryDetail = () => {
    setHistoryDetail(null);
    setHistoryCopied(false);
  };
  const copyHistoryText = async () => {
    if (!historyDetail) return;
    await Clipboard.setStringAsync(historyDetail.text);
    setHistoryCopied(true);
    setTimeout(() => setHistoryCopied(false), 2000);
  };

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

  if (!permission) return <View style={{ flex: 1, backgroundColor: styles.root.backgroundColor }} />;
  if (!permission.granted) {
    return <PermissionScreen insetsTop={insets.top} requestPermission={requestPermission} />;
  }

  const startDocumentScanner = async () => setUseCustomScanner(true);
  
  const handleCustomScannerSave = (uri: string, customPdfUri?: string) => {
    // Set capturedImage + isProcessing BEFORE closing scanner so ProcessingScreen
    // renders immediately. If we close first, there's a frame where neither the
    // scanner nor the processing screen is visible → black flash.
    setCapturedImage(uri);
    setIsProcessing(true);
    setUseCustomScanner(false);
    uploadToServer(uri);
  };

  const takeLegacyPicture = async () => {
    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({ quality: 1.0, skipProcessing: false, exif: false });
        setUseLegacyCamera(false);
        setCapturedImage(photo.uri);
        uploadToServer(photo.uri);
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
        uploadToServer(uri, false);
      }
    } catch (e) {}
  };

  const pickPdf = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setUseLegacyCamera(false);
        setCapturedImage(null);
        setIsPdf(true);
        setPdfFileName(asset.name);
        setTotalPages(0);
        uploadToServer(asset.uri, true, asset.name);
      }
    } catch (e) {
      Alert.alert('Lỗi', 'Không thể chọn file PDF.');
    }
  };

  const uploadToServer = async (uri: string, isPdfFlag = false, originalName?: string) => {
    setIsProcessing(true);
    setOcrText('');
    setTotalPages(0);
    try {
      const filename = originalName ?? (uri.split('/').pop() ?? 'file.jpg');
      const type = isPdfFlag ? 'application/pdf' : (() => { const m = /\.(\w+)$/.exec(filename); return m ? `image/${m[1]}` : 'image/jpeg'; })();

      const formData = new FormData();
      formData.append('file', { uri, name: filename, type } as unknown as Blob);

      const protocol = process.env.EXPO_PUBLIC_API_PROTOCOL ?? 'https';
      const host     = process.env.EXPO_PUBLIC_API_HOST ?? 'apiocr.aulacsoft.com';
      const port     = process.env.EXPO_PUBLIC_API_PORT ?? '443';

      if (!host) {
        setOcrText('⚠️ Chưa cấu hình API.\nHãy tạo file .env và điền EXPO_PUBLIC_API_HOST.');
        setIsProcessing(false); return;
      }

      const portPart = (port && port !== '80' && port !== '443') ? `:${port}` : '';
      const API_URL = `${protocol}://${host}${portPart}/api/extract-text`;

      const response = await fetch(API_URL, { method: 'POST', body: formData });
      const json = await response.json();
      if (json.status === 'success') {
        setOcrText(json.text);
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
          json.text,
          isPdfFlag,
          json.details ?? [],
          json.imageSize ?? { width: 1, height: 1 }
        );
        loadHistory().then(setRecords);
      } else {
        setOcrText('Lỗi: ' + (json.message ?? 'Không nhận dạng được văn bản.'));
      }
    } catch (e) {
      setOcrText(`Lỗi kết nối: Không thể truy cập Backend.\nChi tiết: ${e}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const resetScanner = () => {
    setCapturedImage(null); setOcrText(''); setOcrDetails([]);
    setCopied(false); setUseLegacyCamera(false); setIsPdf(false);
    setPdfFileName(''); setTotalPages(0);
  };

  const copyText = (text: string) => {
    Clipboard.setString(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ----- UI Renderers for History -----
  const renderRecordItem = ({ item }: { item: ScanRecord }) => (
    <TouchableOpacity style={styleBlocks.card} onPress={() => openHistoryDetail(item)} activeOpacity={0.75}>
      {item.isPdf ? (
        <View style={styleBlocks.thumbPdf}><Ionicons name="document-text" size={32} color="#f87171" /></View>
      ) : (
        <Image source={{ uri: item.imageUri }} style={styleBlocks.thumb} resizeMode="cover" />
      )}
      <View style={styleBlocks.cardInfo}>
        <Text style={styleBlocks.cardText} numberOfLines={3}>{item.text || '(Không có văn bản)'}</Text>
        <View style={styleBlocks.cardMeta}>
          <View style={styleBlocks.metaChip}>
            <Ionicons name="text-outline" size={11} color={ACCENT} />
            <Text style={styleBlocks.metaText}>{item.wordCount} từ</Text>
          </View>
          <View style={styleBlocks.metaChip}>
            <Ionicons name="time-outline" size={11} color="rgba(161,161,170,0.6)" />
            <Text style={[styleBlocks.metaText, { color: 'rgba(161,161,170,0.6)' }]}>{formatDate(item.createdAt)}</Text>
          </View>
        </View>
      </View>
      <TouchableOpacity style={styleBlocks.deleteBtn} onPress={() => handleDelete(item.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="trash-outline" size={18} color="rgba(239,68,68,0.7)" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      {!useCustomScanner && !useLegacyCamera && !capturedImage && !isPdf && (
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <View style={styles.headerLeft}>
            <View style={styles.headerDot} />
            <Text style={styles.headerTitle}>Tài Liệu Quét</Text>
          </View>
          {records.length > 0 && (
            <TouchableOpacity onPress={handleClearAll} style={styleBlocks.clearBtn}>
              <Ionicons name="trash" size={14} color="rgba(239,68,68,0.8)" />
              <Text style={styleBlocks.clearBtnText}>Xoá tất cả</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <View style={styles.content}>
        {/* STATE 0: HISTORY LIST (When not capturing) */}
        {!capturedImage && !useLegacyCamera && !useCustomScanner && !isPdf && (
           <View style={{ flex: 1 }}>
              {records.length === 0 ? (
                <View style={styleBlocks.empty}>
                  <View style={styleBlocks.emptyIconWrap}>
                    <View style={styleBlocks.emptyIconBg} />
                    <Ionicons name="document-text-outline" size={42} color="rgba(255,255,255,0.7)" style={{ position: 'absolute' }} />
                    <Ionicons name="scan-outline" size={84} color={ACCENT} />
                  </View>
                  <Text style={styleBlocks.emptyTitle}>Lịch sử trống</Text>
                  <Text style={styleBlocks.emptySubtitle}>Các tài liệu bạn quét hoặc tải lên sẽ được hiển thị sẵn sàng ở đây.</Text>
                  
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

              {/* Floating Dock (Bottom Center, Compact) */}
              <View style={[styleBlocks.dockContainer, { bottom: insets.bottom + 16 }]}>
                <TouchableOpacity style={[styleBlocks.dockBtnSmall, { backgroundColor: 'rgba(248,113,113,0.1)' }]} onPress={pickPdf}>
                    <Ionicons name="document-text" size={18} color="#f87171" />
                </TouchableOpacity>

                {/* Primary Action (Scan) */}
                <TouchableOpacity 
                   style={styleBlocks.dockBtnPrimary} 
                   onPress={isExpoGo ? () => setUseLegacyCamera(true) : startDocumentScanner}
                   activeOpacity={0.85}
                >
                   <Ionicons name={isExpoGo ? 'camera' : 'scan'} size={22} color="#0a0a0d" />
                </TouchableOpacity>

                <TouchableOpacity style={[styleBlocks.dockBtnSmall, { backgroundColor: 'rgba(255,255,255,0.08)' }]} onPress={pickImage}>
                    <Ionicons name="image" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
           </View>
        )}

        {/* STATE 1: CUSTOM SCANNER */}
        {useCustomScanner && (
           <CustomScannerScreen 
             onCancel={() => setUseCustomScanner(false)} 
             onSaveFoundDocument={handleCustomScannerSave} 
             onPickImage={pickImage}
             onPickPdf={pickPdf}
           />
        )}

        {/* STATE 2 — Legacy Camera */}
        {!capturedImage && useLegacyCamera && !useCustomScanner && !isPdf && (
           <LegacyCamera 
             insetsBottom={insets.bottom} cameraRef={cameraRef} facing={facing} setFacing={setFacing}
             closeLegacyCamera={() => setUseLegacyCamera(false)} takeLegacyPicture={takeLegacyPicture}
             pickImage={pickImage} pickPdf={pickPdf}
           />
        )}

        {/* STATE 3 — Processing */}
        {(capturedImage || isPdf) && isProcessing && (
           <ProcessingScreen isPdf={isPdf} />
        )}

        {/* STATE 4 — Results */}
        {(capturedImage || isPdf) && !isProcessing && ocrText !== '' && (
           <ResultScreen 
             insetsBottom={insets.bottom} isPdf={isPdf} pdfFileName={pdfFileName} totalPages={totalPages}
             capturedImage={capturedImage!} imageSize={imageSize} ocrDetails={ocrDetails} ocrText={ocrText} setOcrText={setOcrText}
             copied={copied} copyText={() => copyText(ocrText)} resetScanner={resetScanner}
           />
        )}
      </View>

      {/* History Detail — directly renders ResultScreen (Màn hình 3) */}
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
              setOcrText={() => {}}
              copied={historyCopied}
              copyText={copyHistoryText}
              resetScanner={closeHistoryDetail}
            />
          </View>
        </Modal>
      )}
    </View>
  );
}

const BG = '#09090b';
const SURFACE = '#18181b';
const BORDER = 'rgba(255,255,255,0.08)';

const styleBlocks = {
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

  modal: { flex: 1, backgroundColor: '#0c0c0f' } as any,
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: BORDER } as any,
  modalClose: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.07)', justifyContent: 'center', alignItems: 'center' } as any,
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#fff' } as any,
  copyBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(6,182,212,0.1)', justifyContent: 'center', alignItems: 'center' } as any,
  modalImage: { width: '100%', height: 220, borderRadius: 16, backgroundColor: '#111', marginBottom: 14 } as any,
  modalMeta: { flexDirection: 'row', gap: 10, marginBottom: 14, flexWrap: 'wrap' } as any,
  modalTextCard: { backgroundColor: SURFACE, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 16, marginBottom: 16 } as any,
  modalText: { color: '#f4f4f5', fontSize: 16, lineHeight: 28 } as any,
  modalActions: { flexDirection: 'row', gap: 12 } as any,
  actionPrimary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: ACCENT, paddingVertical: 14, borderRadius: 14 } as any,
  actionDanger: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(239,68,68,0.15)', paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)' } as any,
  actionText: { color: '#fff', fontSize: 15, fontWeight: '700' } as any,

  // Detail Header (Màn hình 3 từ lịch sử)
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: BORDER } as any,
  detailCloseBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.07)', justifyContent: 'center', alignItems: 'center' } as any,
  detailTitle: { fontSize: 17, fontWeight: '700', color: '#fff' } as any,
};
