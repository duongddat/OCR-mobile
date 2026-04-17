import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import {
  Camera,
  type CameraRef,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
} from 'react-native-vision-camera';
import { Ionicons } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import { ACCENT } from './styles';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface CameraOverlayProps {
  onCapture: (imageUri: string, polygon: any[], originSize: { width: number; height: number }) => void;
  /** Called when the user taps "Tự Động" — parent is responsible for opening DocumentScanner
   *  after this component is unmounted (so camera hardware is fully released). */
  onAutoScanRequest: () => void;
  onCancel: () => void;
  onPickImage: () => void;
  onPickPdf: () => void;
}

export default function CameraOverlay({
  onCapture,
  onAutoScanRequest,
  onCancel,
  onPickImage,
  onPickPdf,
}: CameraOverlayProps) {
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const [isCapturing, setIsCapturing] = useState(false);

  const photoOutput = usePhotoOutput({ containerFormat: 'jpeg' });
  const cameraRef = useRef<CameraRef>(null);

  useEffect(() => {
    (async () => {
      if (!hasPermission) await requestPermission();
    })();
  }, [hasPermission, requestPermission]);

  // ─── Manual Capture ──────────────────────────────────────────────────────
  const handleCapture = async () => {
    if (isCapturing) return;
    setIsCapturing(true);
    try {
      const photo = await photoOutput.capturePhoto({ flashMode: 'off' }, {});
      let tempPath = await photo.saveToTemporaryFileAsync();

      try {
        // Step 1: Bake EXIF orientation into actual pixels
        let proc = await ImageManipulator.manipulateAsync(
          `file://${tempPath}`,
          [],
          { compress: 1.0, format: ImageManipulator.SaveFormat.JPEG }
        );

        // Step 2: Some Android devices store landscape pixels with EXIF=1.
        // Rotate +90° CW to produce portrait output.
        if (proc.width > proc.height) {
          proc = await ImageManipulator.manipulateAsync(
            proc.uri,
            [{ rotate: 90 }],
            { compress: 1.0, format: ImageManipulator.SaveFormat.JPEG }
          );
        }

        tempPath = proc.uri.replace('file://', '');
      } catch (err) {
        console.warn('Orientation normalize error', err);
      }

      // Pass empty polygon — EditDocumentScreen shows full-image corners.
      // We removed the heavy OpenCV readAsStringAsync call that was causing slow capture.
      onCapture(`file://${tempPath}`, [], { width: SCREEN_WIDTH, height: SCREEN_HEIGHT });
    } catch (err) {
      console.warn('Capture error', err);
      setIsCapturing(false);
    }
    // isCapturing is NOT reset on success — parent unmounts this component.
  };

  if (!hasPermission) {
    return (
      <View style={s.center}>
        <Text style={s.centerText}>Yêu cầu quyền truy cập Camera...</Text>
      </View>
    );
  }

  if (device == null) {
    return <View style={s.center}><ActivityIndicator size="large" color={ACCENT} /></View>;
  }

  return (
    <View style={s.container}>
      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity style={s.headerBtn} onPress={onCancel} disabled={isCapturing}>
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>

        {/* "Tự Động" — triggers onAutoScanRequest which unmounts this component FIRST,
            then parent opens DocumentScanner with exclusive camera access. */}
        <TouchableOpacity
          style={s.modeBtn}
          onPress={onAutoScanRequest}
          disabled={isCapturing}
        >
          <Ionicons name="flash" size={16} color="rgba(255,255,255,0.6)" />
          <Text style={s.modeBtnText}>Tự Động</Text>
        </TouchableOpacity>

        <View style={{ width: 44 }} />
      </View>

      {/* ── Camera live view ── */}
      <View style={s.cameraWrap}>
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={!isCapturing}
          outputs={[photoOutput]}
        />
      </View>

      {/* ── Bottom Controls ── */}
      <View style={s.bottomBar}>
        {/* Upload Image */}
        <TouchableOpacity style={s.sideWrapper} onPress={onPickImage} disabled={isCapturing} activeOpacity={0.7}>
          <View style={s.sideBtn}>
             <Ionicons name="image" size={24} color="#fff" />
          </View>
          <Text style={s.sideBtnLabel}>Ảnh</Text>
        </TouchableOpacity>

        {/* Shutter / Capture */}
        <View style={s.captureWrapper}>
          <TouchableOpacity
            style={[s.captureBtn, isCapturing && s.captureBtnDisabled]}
            onPress={handleCapture}
            disabled={isCapturing}
            activeOpacity={0.6}
          >
            {isCapturing
              ? <ActivityIndicator color="#000" />
              : <View style={s.captureBtnInner} /> }
          </TouchableOpacity>
        </View>

        {/* Upload PDF */}
        <TouchableOpacity style={s.sideWrapper} onPress={onPickPdf} disabled={isCapturing} activeOpacity={0.7}>
          <View style={s.sideBtnPdf}>
             <Ionicons name="document-text" size={24} color="#f87171" />
          </View>
          <Text style={s.sideBtnLabelPdf}>PDF</Text>
        </TouchableOpacity>
      </View>

      {/* ── Processing overlay ── */}
      {isCapturing && (
        <View style={s.capturingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={ACCENT} />
          <Text style={s.capturingText}>Đang xử lý...</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  centerText: { color: '#fff', fontSize: 16, textAlign: 'center', paddingHorizontal: 32 },

  // Header
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    zIndex: 10,
  },
  headerBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  modeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  modeBtnText: { color: 'rgba(255,255,255,0.6)', fontWeight: '600', fontSize: 14 },

  // Camera
  cameraWrap: { flex: 1, overflow: 'hidden' },

  // Bottom Controls Bar
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingVertical: 24,
    paddingBottom: 40,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
  },
  captureWrapper: {
    width: 86, height: 86, borderRadius: 43,
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center', alignItems: 'center',
  },
  captureBtn: {
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
  },
  captureBtnInner: {
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: '#fff',
  },
  captureBtnDisabled: { opacity: 0.5 },
  sideWrapper: {
    alignItems: 'center', gap: 8,
    width: 72,
  },
  sideBtn: {
    width: 52, height: 52, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },
  sideBtnLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600' },
  sideBtnPdf: {
    width: 52, height: 52, borderRadius: 20,
    backgroundColor: 'rgba(248,113,113,0.15)',
    justifyContent: 'center', alignItems: 'center',
  },
  sideBtnLabelPdf: { color: '#f87171', fontSize: 13, fontWeight: '600' },

  // Capturing overlay
  capturingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    zIndex: 100,
  },
  capturingText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
