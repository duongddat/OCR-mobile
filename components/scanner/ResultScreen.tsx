import { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Image, StyleSheet,
  Dimensions, Modal, ScrollView, Clipboard, Animated,
} from 'react-native';
import { PinchGestureHandler, State } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';

import { ACCENT, BG, SURFACE, BORDER } from './styles';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ─── Text Result Popup ────────────────────────────────────────────────────────
function TextResultPopup({
  visible, text, onClose, insetsBottom,
}: { visible: boolean; text: string; onClose: () => void; insetsBottom: number }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    Clipboard.setString(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={rS.popupFullCard}>
        {/* Header - Simple & Clean */}
        <View style={rS.popupHeader}>
          <TouchableOpacity style={rS.popupBackBtn} onPress={onClose}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={rS.popupTitleCenter}>Kết quả văn bản</Text>
          {/* Spacer for centering */}
          <View style={{ width: 44 }} />
        </View>

        {/* Text body */}
        <ScrollView style={rS.popupScrollFull} showsVerticalScrollIndicator={false}>
          <Text style={rS.popupText} selectable>
            {text || '(Không có văn bản)'}
          </Text>
        </ScrollView>

        {/* Copy button with bottom inset padding to avoid Android nav bar */}
        <View style={[rS.popupFooter, { paddingBottom: 20 + (insetsBottom > 0 ? insetsBottom : 16) }]}>
          <TouchableOpacity
            style={[rS.copyBtn, copied && rS.copyBtnActive]}
            onPress={handleCopy}
            activeOpacity={0.8}
          >
            <Ionicons
              name={copied ? 'checkmark-circle' : 'copy-outline'}
              size={22}
              color={copied ? '#0a0a0d' : '#0a0a0d'}
            />
            <Text style={rS.copyBtnText}>{copied ? 'ĐÃ SAO CHÉP!' : 'SAO CHÉP'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main ResultScreen ────────────────────────────────────────────────────────
type Props = {
  insetsBottom: number;
  isPdf: boolean;
  pdfFileName: string;
  totalPages: number;
  capturedImage: string | null;
  imageSize: { width: number; height: number };
  ocrDetails: any[];
  ocrText: string;
  resetScanner: () => void;
};

export default function ResultScreen({
  insetsBottom, isPdf, pdfFileName, totalPages, capturedImage,
  imageSize, ocrDetails, ocrText, resetScanner,
}: Props) {
  const [imgZoom, setImgZoom] = useState(1);
  const baseImgZoom = useRef(1);
  const [showTextPopup, setShowTextPopup] = useState(false);

  const onImgPinchEvent = (event: any) => {
    setImgZoom(Math.max(1, Math.min(5, baseImgZoom.current * event.nativeEvent.scale)));
  };
  const onImgPinchStateChange = (event: any) => {
    if (event.nativeEvent.state === State.END) baseImgZoom.current = imgZoom;
  };

  const ratio = (imageSize.width / imageSize.height) || 1;
  const renderW = SCREEN_W;
  const renderH = Math.min(renderW / ratio, SCREEN_H * 0.65);
  const scaledW = renderW * imgZoom;
  const scaledH = renderH * imgZoom;

  return (
    <View style={rS.root}>
      {/* ── Image Section — Full Screen ── */}
      <View style={{ flex: 1, backgroundColor: '#000', position: 'relative' }}>
        {isPdf && !capturedImage ? (
          <View style={[rS.pdfPlaceholder, { flex: 1 }]}>
            <Ionicons name="document-text" size={64} color="#f87171" />
            <Text style={rS.pdfName} numberOfLines={2}>{pdfFileName}</Text>
            {totalPages > 0 && (
              <View style={rS.pdfBadge}>
                <Ionicons name="layers-outline" size={14} color="#f87171" />
                <Text style={rS.pdfBadgeText}>{totalPages} trang đã xử lý</Text>
              </View>
            )}
          </View>
        ) : (
          <PinchGestureHandler
            onGestureEvent={onImgPinchEvent}
            onHandlerStateChange={onImgPinchStateChange}
          >
            <View style={{ width: SCREEN_W, height: SCREEN_H, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
              <ScrollView
                horizontal
                bounces={false}
                showsHorizontalScrollIndicator={false}
                scrollEnabled={imgZoom > 1}
                contentContainerStyle={{ minWidth: SCREEN_W, justifyContent: 'center', alignItems: 'center' }}
              >
                <ScrollView
                  bounces={false}
                  showsVerticalScrollIndicator={false}
                  scrollEnabled={imgZoom > 1}
                  contentContainerStyle={{ minHeight: SCREEN_H, justifyContent: 'center', alignItems: 'center' }}
                >
                  <View style={{ width: scaledW, height: scaledH, position: 'relative' }}>
                    <Image
                      source={{ uri: capturedImage ?? undefined }}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="stretch"
                    />
                    {/* Bounding boxes */}
                    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
                      {!isPdf && ocrDetails.map((detail, index) => {
                        const box = detail.box;
                        const xs = box.map((p: any) => p[0]);
                        const ys = box.map((p: any) => p[1]);
                        const minX = Math.min(...xs); const maxX = Math.max(...xs);
                        const minY = Math.min(...ys); const maxY = Math.max(...ys);
                        return (
                          <View
                            key={index}
                            style={[rS.bbox, {
                              left: `${(minX / imageSize.width) * 100}%`,
                              top: `${(minY / imageSize.height) * 100}%`,
                              width: `${((maxX - minX) / imageSize.width) * 100}%`,
                              height: `${((maxY - minY) / imageSize.height) * 100}%`,
                            }]}
                          />
                        );
                      })}
                    </View>
                  </View>
                </ScrollView>
              </ScrollView>
            </View>
          </PinchGestureHandler>
        )}

        {/* Zoom indicator */}
        {imgZoom > 1 && (
          <View style={[rS.zoomPill, { top: 60, bottom: undefined }]} pointerEvents="none">
            <Text style={rS.zoomPillText}>{imgZoom.toFixed(1)}×</Text>
          </View>
        )}

        {/* Back Button (Top Left) */}
        <TouchableOpacity style={rS.backBtnTop} onPress={resetScanner}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>

        {/* TEXT Button (Middle Right Edge) */}
        <TouchableOpacity style={rS.textBtnSide} onPress={() => setShowTextPopup(true)}>
          <Ionicons name="document-text" size={24} color="#000" />
        </TouchableOpacity>

        {/* Floating Badge under image */}
        <View style={rS.imgBadgeFloating}>
          <Ionicons name="checkmark-circle" size={16} color={ACCENT} />
          <Text style={rS.imgBadgeText}>
            {isPdf ? `${totalPages} trang | ` : ''}Đã nhận dạng {ocrDetails.length} vùng chữ
          </Text>
        </View>
      </View>

      {/* ── Text Result Popup ── */}
      <TextResultPopup
        visible={showTextPopup}
        text={ocrText}
        onClose={() => setShowTextPopup(false)}
        insetsBottom={insetsBottom}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const rS = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  // Image Section
  imageSection: {
    backgroundColor: '#000',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  pdfPlaceholder: {
    alignItems: 'center', justifyContent: 'center',
    padding: 48, gap: 12,
  },
  pdfName: { color: '#a1a1aa', fontSize: 14, textAlign: 'center', paddingHorizontal: 16 },
  pdfBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(248,113,113,0.1)', paddingHorizontal: 12,
    paddingVertical: 5, borderRadius: 20,
  },
  pdfBadgeText: { color: '#f87171', fontSize: 13, fontWeight: '600' },

  bbox: {
    position: 'absolute', borderWidth: 1.5,
    borderColor: ACCENT, backgroundColor: 'rgba(6,182,212,0.12)', borderRadius: 2,
  },

  // Zoom pill
  zoomPill: {
    position: 'absolute', left: 14,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 14, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  zoomPillText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Back button
  backBtnTop: {
    position: 'absolute', top: 40, left: 16,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 10,
  },

  // Side text button
  textBtnSide: {
    position: 'absolute', right: 0, top: '50%', marginTop: -28,
    width: 48, height: 56,
    borderTopLeftRadius: 16, borderBottomLeftRadius: 16,
    backgroundColor: ACCENT,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: -2, height: 2 }, elevation: 8,
    zIndex: 10,
  },

  // Floating badge
  imgBadgeFloating: {
    position: 'absolute', bottom: 40, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  imgBadgeText: { color: ACCENT, fontSize: 13, fontWeight: '600' },

  // ─── TEXT RESULT POPUP FULL SCREEN ──────────────────────────────────────
  popupFullCard: {
    flex: 1, backgroundColor: '#0a0a0d',
  },
  popupHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 40, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)',
    backgroundColor: '#0a0a0d',
  },
  popupBackBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center', alignItems: 'center',
  },
  popupTitleCenter: {
    color: '#fff', fontSize: 17, fontWeight: '700',
  },
  popupScrollFull: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  popupText: {
    color: '#e4e4e7', fontSize: 16, lineHeight: 28,
    paddingBottom: 40,
  },
  popupFooter: {
    paddingHorizontal: 20, paddingTop: 20,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)',
    backgroundColor: '#0a0a0d',
  },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: ACCENT, paddingVertical: 16, borderRadius: 16,
  },
  copyBtnActive: { backgroundColor: '#22c55e' },
  copyBtnText: {
    color: '#0a0a0d', fontSize: 16, fontWeight: '800', letterSpacing: 1.2,
  },
});