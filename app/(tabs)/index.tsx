import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState, useRef } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  StyleSheet, Text, TouchableOpacity, View,
  ActivityIndicator, ScrollView, TextInput, Image,
  Platform, Clipboard, StatusBar, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CameraView as CameraViewType } from 'expo-camera';
import { PinchGestureHandler, State } from 'react-native-gesture-handler';
import { saveToHistory } from '@/utils/history';

const { width: SCREEN_W } = Dimensions.get('window');
const ACCENT = '#06b6d4';
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
  const [copied, setCopied] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [containerSize, setContainerSize] = useState({ width: SCREEN_W - 34, height: 300 });
  const [zoom, setZoom] = useState(0);
  const baseZoom = useRef(0);

  const zoomIn = () => setZoom(prev => { const n = Math.min(prev + 0.1, 1); baseZoom.current = n; return n; });
  const zoomOut = () => setZoom(prev => { const n = Math.max(prev - 0.1, 0); baseZoom.current = n; return n; });

  const onPinchEvent = (event: any) => {
    const scale = event.nativeEvent.scale;
    // zoom factor can be adjusted. (scale - 1) is how much the pinch expands/shrinks.
    const newZoom = baseZoom.current + (scale - 1) * 0.5;
    setZoom(Math.max(0, Math.min(1, newZoom)));
  };

  const onPinchStateChange = (event: any) => {
    if (event.nativeEvent.state === State.END) {
      baseZoom.current = zoom;
    }
  };

  // ── Permission screen ──────────────────────────────────────────────────────
  if (!permission) return <View style={{ flex: 1, backgroundColor: BG }} />;

  if (!permission.granted) {
    return (
      <View style={[styles.permScreen, { paddingTop: insets.top + 20 }]}>
        <StatusBar barStyle="light-content" />
        <View style={styles.permIcon}>
          <Ionicons name="camera" size={48} color={ACCENT} />
        </View>
        <Text style={styles.permTitle}>Cần Quyền Camera</Text>
        <Text style={styles.message}>
          Ứng dụng cần truy cập camera để quét và nhận dạng văn bản từ tài liệu.
        </Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Ionicons name="checkmark-circle" size={20} color="#fff" />
          <Text style={styles.permBtnText}>Cho Phép Truy Cập</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Camera logic ───────────────────────────────────────────────────────────
  const takePicture = async () => {
    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 1.0,
          skipProcessing: false,
          exif: false,
        });
        setCapturedImage(photo.uri);
        uploadToServer(photo.uri);
      } catch (e) {
        console.error('Camera Error:', e);
      }
    }
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const uri = result.assets[0].uri;
        setCapturedImage(uri);
        uploadToServer(uri);
      }
    } catch (e) {
      console.error('Image Picker Error:', e);
    }
  };

  const uploadToServer = async (uri: string) => {
    setIsProcessing(true);
    setOcrText('');
    try {
      const filename = uri.split('/').pop() ?? 'image.jpg';
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : 'image/jpeg';

      const formData = new FormData();
      formData.append('image', { uri, name: filename, type } as unknown as Blob);

      // Đọc cấu hình từ file .env
      // Để thay đổi: chỉnh EXPO_PUBLIC_API_HOST trong file .env rồi restart expo
      const protocol = process.env.EXPO_PUBLIC_API_PROTOCOL ?? 'https';
      const host     = process.env.EXPO_PUBLIC_API_HOST ?? 'apiocr.aulacsoft.com';
      const port     = process.env.EXPO_PUBLIC_API_PORT ?? '443';

      if (!host) {
        setOcrText('⚠️ Chưa cấu hình API.\nHãy tạo file .env và điền EXPO_PUBLIC_API_HOST.');
        setIsProcessing(false);
        return;
      }

      // Xử lý loại bỏ cổng nếu bị bỏ trống
      const portPart = (port && port !== '80' && port !== '443') ? `:${port}` : '';
      const API_URL = `${protocol}://${host}${portPart}/api/extract-text`;

      const response = await fetch(API_URL, {
        method: 'POST',
        body: formData,
      });

      const json = await response.json();
      if (json.status === 'success') {
        setOcrText(json.text);
        setOcrDetails(json.details ?? []);
        setImageSize(json.imageSize ?? { width: 1, height: 1 });
        // Lưu vào lịch sử
        await saveToHistory(uri, json.text);
      } else {
        setOcrText('Lỗi: ' + (json.message ?? 'Không nhận dạng được văn bản.'));
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      setOcrText(`Lỗi kết nối: Không thể truy cập Backend.\nChi tiết: ${errorMessage}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const resetScanner = () => {
    setCapturedImage(null);
    setOcrText('');
    setOcrDetails([]);
    setCopied(false);
  };

  const copyText = () => {
    Clipboard.setString(ocrText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerLeft}>
          <View style={styles.headerDot} />
          <Text style={styles.headerTitle}>AI Scanner</Text>
        </View>
        <Text style={styles.headerBadge}>DEEPMIND</Text>
      </View>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <View style={styles.content}>

        {/* STATE 1 — Camera */}
        {!capturedImage && (
          <View style={styles.cameraContainer}>
            <PinchGestureHandler
              onGestureEvent={onPinchEvent}
              onHandlerStateChange={onPinchStateChange}
            >
              <View style={{ flex: 1 }}>
                <CameraView style={styles.camera} facing={facing} ref={cameraRef} zoom={zoom} />
              </View>
            </PinchGestureHandler>
            {/* Dimmed corners */}
            <View style={[styles.overlayTop, { pointerEvents: 'none' }]} />
            <View style={[styles.overlayBottom, { pointerEvents: 'none' }]} />
            <View style={[styles.overlayLeft, { pointerEvents: 'none' }]} />
            <View style={[styles.overlayRight, { pointerEvents: 'none' }]} />

            {/* Scanner frame */}
            <View style={[styles.scanFrame, { pointerEvents: 'none' }]}>
              <View style={[styles.corner, styles.tl]} />
              <View style={[styles.corner, styles.tr]} />
              <View style={[styles.corner, styles.bl]} />
              <View style={[styles.corner, styles.br]} />
              <Text style={styles.frameHint}>Đặt văn bản vào khung</Text>
            </View>

            {/* Zoom Controls */}
            <View style={styles.zoomControls}>
              <TouchableOpacity style={styles.zoomBtn} onPress={zoomIn}>
                <Ionicons name="add" size={24} color="#fff" />
              </TouchableOpacity>
              <View style={styles.zoomTextContainer}>
                <Text style={styles.zoomText}>{(zoom * 4 + 1).toFixed(1)}x</Text>
              </View>
              <TouchableOpacity style={styles.zoomBtn} onPress={zoomOut}>
                <Ionicons name="remove" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* Camera Controls */}
            <View style={[styles.camControls, { paddingBottom: insets.bottom + 80 }]}>
              {/* Flip camera */}
              <TouchableOpacity
                style={styles.ctrlBtn}
                onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')}
              >
                <Ionicons name="camera-reverse-outline" size={24} color="#fff" />
              </TouchableOpacity>

              {/* Shutter */}
              <TouchableOpacity style={styles.shutter} onPress={takePicture}>
                <View style={styles.shutterRing}>
                  <View style={styles.shutterCore} />
                </View>
              </TouchableOpacity>

              {/* Gallery / Media picker */}
              <TouchableOpacity style={styles.ctrlBtn} onPress={pickImage}>
                <Ionicons name="images-outline" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* STATE 2 — Processing */}
        {capturedImage && isProcessing && (
          <View style={styles.processingWrap}>
            <Image source={{ uri: capturedImage }} style={styles.blurBg} blurRadius={12} />
            <View style={styles.processingOverlay} />
            <View style={styles.processingCard}>
              {/* Animated pulse rings */}
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
        )}

        {/* STATE 3 — Results */}
        {capturedImage && !isProcessing && ocrText !== '' && (
          <View style={styles.resultWrap}>
            <ScrollView
              style={styles.scroll}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
            >
              {/* Image preview */}
              <View style={styles.imgCard}>
                <View style={{ width: '100%', alignItems: 'center', backgroundColor: '#000', paddingVertical: 10 }}>
                  {(() => {
                     const ratio = imageSize.width / imageSize.height || 1;
                     // Available width in container is SCREEN_W - 32 (margins) - 2 (borders)
                     const maxW = SCREEN_W - 34;
                     const maxH = 350;
                     
                     let renderW = maxW;
                     let renderH = renderW / ratio;
                     
                     if (renderH > maxH) {
                       renderH = maxH;
                       renderW = renderH * ratio;
                     }

                     return (
                       <View style={{ width: renderW, height: renderH, position: 'relative' }}>
                         <Image 
                           source={{ uri: capturedImage }} 
                           style={{ width: '100%', height: '100%' }} 
                           resizeMode="stretch" 
                         />
                         
                         {/* Bounding Boxes */}
                         <View style={{ ...StyleSheet.absoluteFillObject, pointerEvents: 'none' }}>
                           {ocrDetails.map((detail, index) => {
                             const box = detail.box;
                             const xs = box.map((p: any) => p[0]);
                             const ys = box.map((p: any) => p[1]);
                             const minX = Math.min(...xs);
                             const maxX = Math.max(...xs);
                             const minY = Math.min(...ys);
                             const maxY = Math.max(...ys);

                             const leftPct = (minX / imageSize.width) * 100;
                             const topPct = (minY / imageSize.height) * 100;
                             const widthPct = ((maxX - minX) / imageSize.width) * 100;
                             const heightPct = ((maxY - minY) / imageSize.height) * 100;

                             return (
                               <View
                                 key={index}
                                 style={[
                                   styles.bbox,
                                   {
                                     left: `${leftPct}%`,
                                     top: `${topPct}%`,
                                     width: `${widthPct}%`,
                                     height: `${heightPct}%`,
                                   },
                                 ]}
                               />
                             );
                           })}
                         </View>
                       </View>
                     );
                  })()}
                </View>
                
                <View style={styles.imgBadge}>
                  <Ionicons name="checkmark-circle" size={14} color={ACCENT} />
                  <Text style={styles.imgBadgeText}>Đã nhận dạng {ocrDetails.length} vùng chữ</Text>
                </View>
              </View>

              {/* Text result */}
              <View style={styles.textCard}>
                <View style={styles.textCardHeader}>
                  <View style={styles.textCardLeft}>
                    <Ionicons name="text" size={18} color={ACCENT} />
                    <Text style={styles.textCardTitle}>Kết Quả Trích Xuất</Text>
                  </View>
                  <TouchableOpacity style={styles.copyBtn} onPress={copyText}>
                    <Ionicons
                      name={copied ? 'checkmark' : 'copy-outline'}
                      size={16}
                      color={copied ? '#22c55e' : ACCENT}
                    />
                    <Text style={[styles.copyBtnText, copied && { color: '#22c55e' }]}>
                      {copied ? 'Đã Copy' : 'Copy'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.textInput}
                  multiline
                  value={ocrText}
                  onChangeText={setOcrText}
                  textAlignVertical="top"
                  placeholderTextColor="rgba(161,161,170,0.4)"
                />
              </View>
            </ScrollView>

            {/* Bottom action bar */}
            <View style={[styles.actionBar, { paddingBottom: insets.bottom + 72 }]}>
              <TouchableOpacity style={styles.actionBtnSecondary} onPress={resetScanner}>
                <Ionicons name="scan-outline" size={18} color="#fff" />
                <Text style={styles.actionBtnText}>Quét Lại</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtnPrimary} onPress={copyText}>
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color="#fff" />
                <Text style={styles.actionBtnText}>{copied ? 'Đã Copy!' : 'Sao Chép'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: BG,
    zIndex: 10,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: ACCENT,
    shadowColor: ACCENT, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
  },
  headerTitle: {
    fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: 0.3,
  },
  headerBadge: {
    fontSize: 10, fontWeight: '700', color: ACCENT,
    letterSpacing: 2.5,
    backgroundColor: 'rgba(6,182,212,0.1)',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(6,182,212,0.25)',
  },

  // Content
  content: { flex: 1 },

  // Permission
  permScreen: {
    flex: 1, backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 40,
  },
  permIcon: {
    width: 100, height: 100, borderRadius: 28,
    backgroundColor: 'rgba(6,182,212,0.1)',
    borderWidth: 1, borderColor: 'rgba(6,182,212,0.2)',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 28,
  },
  permTitle: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 12, textAlign: 'center' },
  message: {
    color: '#a1a1aa', fontSize: 15, textAlign: 'center',
    lineHeight: 22, marginBottom: 36,
  },
  permBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: ACCENT, borderRadius: 16,
    paddingVertical: 16, paddingHorizontal: 32,
  },
  permBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Camera
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },

  overlayTop: { position: 'absolute', top: 0, left: 0, right: 0, height: '10%', backgroundColor: 'rgba(0,0,0,0.5)' },
  overlayBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '30%', backgroundColor: 'rgba(0,0,0,0.5)' },
  overlayLeft: { position: 'absolute', top: '10%', bottom: '30%', left: 0, width: '8%', backgroundColor: 'rgba(0,0,0,0.5)' },
  overlayRight: { position: 'absolute', top: '10%', bottom: '30%', right: 0, width: '8%', backgroundColor: 'rgba(0,0,0,0.5)' },

  scanFrame: {
    position: 'absolute',
    top: '10%', left: '8%', right: '8%', bottom: '30%',
    justifyContent: 'flex-end', alignItems: 'center',
    paddingBottom: 12,
  },
  corner: {
    position: 'absolute', width: 28, height: 28,
    borderColor: ACCENT, borderWidth: 3,
    shadowColor: ACCENT, shadowOpacity: 0.8, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
  },
  tl: { top: -2, left: -2, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 8 },
  tr: { top: -2, right: -2, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 8 },
  bl: { bottom: -2, left: -2, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 8 },
  br: { bottom: -2, right: -2, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 8 },
  frameHint: {
    color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '500', letterSpacing: 0.3,
  },

  zoomControls: {
    position: 'absolute', right: 16, top: '40%',
    transform: [{ translateY: -75 }],
    backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 30, paddingVertical: 12, paddingHorizontal: 6,
    alignItems: 'center', gap: 12,
  },
  zoomBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  zoomTextContainer: { paddingVertical: 4 },
  zoomText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  camControls: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingTop: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  ctrlBtn: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  shutter: { alignItems: 'center', justifyContent: 'center' },
  shutterRing: {
    width: 78, height: 78, borderRadius: 39,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#fff', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 0 },
  },
  shutterCore: {
    width: 62, height: 62, borderRadius: 31,
    backgroundColor: ACCENT,
    shadowColor: ACCENT, shadowOpacity: 0.7, shadowRadius: 12, shadowOffset: { width: 0, height: 0 },
  },

  // Processing
  processingWrap: { flex: 1 },
  blurBg: { ...StyleSheet.absoluteFillObject, opacity: 0.35 },
  processingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(9,9,11,0.6)' },
  processingCard: {
    flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32,
  },
  pulseOuter: {
    width: 110, height: 110, borderRadius: 32,
    backgroundColor: 'rgba(6,182,212,0.12)',
    borderWidth: 1, borderColor: 'rgba(6,182,212,0.25)',
    justifyContent: 'center', alignItems: 'center',
  },
  pulseInner: {
    width: 78, height: 78, borderRadius: 22,
    backgroundColor: 'rgba(6,182,212,0.18)',
    justifyContent: 'center', alignItems: 'center',
  },
  processingTitle: {
    color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 20, letterSpacing: 0.3,
  },
  processingSubtitle: { color: '#a1a1aa', fontSize: 14, marginTop: 6 },

  // Results
  resultWrap: { flex: 1, backgroundColor: BG },
  scroll: { flex: 1 },

  imgCard: {
    margin: 16, borderRadius: 20, overflow: 'hidden',
    backgroundColor: SURFACE,
    borderWidth: 1, borderColor: BORDER,
  },
  imageContainer: {
    width: '100%',
    height: 300,
    position: 'relative',
    backgroundColor: '#000',
  },
  previewImg: { 
    width: '100%', 
    height: '100%',
  },
  bboxOverlay: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: 'none',
  },
  bbox: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: ACCENT,
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    borderRadius: 2,
  },
  imgBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: 12,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  imgBadgeText: { color: ACCENT, fontSize: 13, fontWeight: '600' },

  textCard: {
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: SURFACE, borderRadius: 20,
    borderWidth: 1, borderColor: BORDER,
    overflow: 'hidden',
  },
  textCardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  textCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  textCardTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(6,182,212,0.1)',
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 10, borderWidth: 1, borderColor: 'rgba(6,182,212,0.2)',
  },
  copyBtnText: { color: ACCENT, fontSize: 13, fontWeight: '600' },
  textInput: {
    color: '#f4f4f5', fontSize: 16.5, lineHeight: 28,
    padding: 16, minHeight: 200,
    // Loại bỏ monospace để sử dụng phông chữ hệ thống đẹp và dễ đọc hơn (San Francisco / Roboto)
  },

  // Action bar
  actionBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 12,
    paddingHorizontal: 16, paddingTop: 14,
    backgroundColor: BG,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  actionBtnSecondary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 14, borderRadius: 14,
    borderWidth: 1, borderColor: BORDER,
  },
  actionBtnPrimary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: ACCENT,
    paddingVertical: 14, borderRadius: 14,
    shadowColor: ACCENT, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  actionBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
