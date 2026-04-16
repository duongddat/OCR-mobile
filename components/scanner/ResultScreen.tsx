import { useState, useRef } from 'react';
import { View, ScrollView, Text, TouchableOpacity, Image, StyleSheet, TextInput, Dimensions } from 'react-native';
import { PinchGestureHandler, State } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { styles, ACCENT } from './styles';

const { width: SCREEN_W } = Dimensions.get('window');

type Props = {
  insetsBottom: number;
  isPdf: boolean;
  pdfFileName: string;
  totalPages: number;
  capturedImage: string | null;
  imageSize: { width: number; height: number };
  ocrDetails: any[];
  ocrText: string;
  setOcrText: (t: string) => void;
  copied: boolean;
  copyText: () => void;
  resetScanner: () => void;
};

export default function ResultScreen({
  insetsBottom, isPdf, pdfFileName, totalPages, capturedImage,
  imageSize, ocrDetails, ocrText, setOcrText,
  copied, copyText, resetScanner
}: Props) {
  // Local zoom for viewing the analyzed image
  const [imgZoom, setImgZoom] = useState(1);
  const baseImgZoom = useRef(1);

  const zoomInImg = () => setImgZoom(prev => { const n = Math.min(prev + 0.5, 5); baseImgZoom.current = n; return n; });
  const zoomOutImg = () => setImgZoom(prev => { const n = Math.max(prev - 0.5, 1); baseImgZoom.current = n; return n; });
  const onImgPinchEvent = (event: any) => { setImgZoom(Math.max(1, Math.min(5, baseImgZoom.current * event.nativeEvent.scale))); };
  const onImgPinchStateChange = (event: any) => { if (event.nativeEvent.state === State.END) baseImgZoom.current = imgZoom; };

  return (
    <View style={styles.resultWrap}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insetsBottom + 110 }}>
        
        <View style={[styles.imgCard, { marginHorizontal: 0, marginTop: 0, borderRadius: 0, borderWidth: 0, borderBottomWidth: 1 }]}>
          {isPdf && !capturedImage ? (
            <View style={styles.pdfPreviewCard}>
              <Ionicons name="document-text" size={64} color="#f87171" />
              <Text style={styles.pdfPreviewName} numberOfLines={2}>{pdfFileName}</Text>
              {totalPages > 0 && (
                <View style={styles.pdfPageBadge}>
                  <Ionicons name="layers-outline" size={14} color="#f87171" />
                  <Text style={styles.pdfPageBadgeText}>{totalPages} trang đã xử lý</Text>
                </View>
              )}
            </View>
          ) : (
            <View style={{ width: '100%', alignItems: 'center', backgroundColor: '#000', paddingVertical: 0 }}>
              {(() => {
                const ratio = imageSize.width / imageSize.height || 1;
                const renderW = SCREEN_W;
                const renderH = renderW / ratio;
                const scaledW = renderW * imgZoom;
                const scaledH = renderH * imgZoom;

                return (
                  <>
                    <PinchGestureHandler onGestureEvent={onImgPinchEvent} onHandlerStateChange={onImgPinchStateChange}>
                      <View style={{ width: SCREEN_W, height: renderH, overflow: 'hidden' }}>
                        <ScrollView horizontal bounces={false} showsHorizontalScrollIndicator={true} scrollEnabled={imgZoom > 1}>
                          <ScrollView bounces={false} showsVerticalScrollIndicator={true} scrollEnabled={imgZoom > 1}>
                            <View style={{ width: scaledW, height: scaledH, position: 'relative' }}>
                              <Image source={{ uri: capturedImage ?? undefined }} style={{ width: '100%', height: '100%' }} resizeMode="stretch" />
                             
                              <View style={{ ...StyleSheet.absoluteFillObject, pointerEvents: 'none' }}>
                                {!isPdf && ocrDetails.map((detail, index) => {
                                  const box = detail.box;
                                  const xs = box.map((p: any) => p[0]);
                                  const ys = box.map((p: any) => p[1]);
                                  const minX = Math.min(...xs); const maxX = Math.max(...xs);
                                  const minY = Math.min(...ys); const maxY = Math.max(...ys);

                                  const leftPct = (minX / imageSize.width) * 100;
                                  const topPct = (minY / imageSize.height) * 100;
                                  const widthPct = ((maxX - minX) / imageSize.width) * 100;
                                  const heightPct = ((maxY - minY) / imageSize.height) * 100;

                                  return (
                                    <View key={index} style={[styles.bbox, { left: `${leftPct}%`, top: `${topPct}%`, width: `${widthPct}%`, height: `${heightPct}%` }]} />
                                  );
                                })}
                              </View>
                            </View>
                          </ScrollView>
                        </ScrollView>
                      </View>
                    </PinchGestureHandler>

                    <View style={{ position: 'absolute', bottom: 16, right: 16, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, alignItems: 'center' }}>
                      <TouchableOpacity onPress={zoomOutImg} style={{ padding: 6, paddingHorizontal: 10 }}><Ionicons name="remove" size={18} color="#fff" /></TouchableOpacity>
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', marginHorizontal: 4 }}>{imgZoom.toFixed(1)}x</Text>
                      <TouchableOpacity onPress={zoomInImg} style={{ padding: 6, paddingHorizontal: 10 }}><Ionicons name="add" size={18} color="#fff" /></TouchableOpacity>
                    </View>
                  </>
                );
              })()}
            </View>
          )}
          
          <View style={styles.imgBadge}>
            <Ionicons name="checkmark-circle" size={14} color={ACCENT} />
            <Text style={styles.imgBadgeText}>
              {isPdf ? `${totalPages} trang | ` : ''}Đã nhận dạng {ocrDetails.length} vùng chữ
            </Text>
          </View>
        </View>

        <View style={styles.textCard}>
          <View style={styles.textCardHeader}>
            <View style={styles.textCardLeft}>
              <Ionicons name="text" size={18} color={ACCENT} />
              <Text style={styles.textCardTitle}>Kết Quả Trích Xuất</Text>
            </View>
            <TouchableOpacity style={styles.copyBtn} onPress={copyText}>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={copied ? '#22c55e' : ACCENT} />
              <Text style={[styles.copyBtnText, copied && { color: '#22c55e' }]}>{copied ? 'Đã Copy' : 'Copy'}</Text>
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

      <View style={[styles.actionBar, { paddingBottom: insetsBottom + 72 }]}>
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
  );
}
