import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import CameraOverlay from './CameraOverlay';
import EditDocumentScreen from './EditDocumentScreen';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ACCENT } from './styles';
import DocumentScanner from 'react-native-document-scanner-plugin';
import * as ImageManipulator from 'expo-image-manipulator';

// AUTO_SCAN: CameraOverlay is NOT rendered → VisionCamera fully releases camera
// before DocumentScanner opens → no more "Camera device is already in use"
export type ScannerMode = 'CAMERA' | 'AUTO_SCAN' | 'EDIT' | 'SAVING';

interface CustomScannerScreenProps {
  onCancel: () => void;
  onSaveFoundDocument: (imageUri: string, pdfUri?: string) => void;
  onPickImage: () => void;
  onPickPdf: () => void;
}

export default function CustomScannerScreen({ onCancel, onSaveFoundDocument, onPickImage, onPickPdf }: CustomScannerScreenProps) {
  const [mode, setMode] = useState<ScannerMode>('CAMERA');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [detectedPolygon, setDetectedPolygon] = useState<any[] | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);

  // ─── AUTO_SCAN: runs after CameraOverlay is unmounted ───────────────────────
  // When mode switches to 'AUTO_SCAN':
  //   • CameraOverlay is no longer rendered → <Camera> component is unmounted
  //   • VisionCamera destroys its native session (hardware camera released)
  //   • We wait 800ms for Android to fully close the session
  //   • THEN open DocumentScanner, which now has exclusive camera access
  useEffect(() => {
    if (mode !== 'AUTO_SCAN') return;

    let cancelled = false;

    const run = async () => {
      // Wait for VisionCamera native session teardown
      await new Promise(resolve => setTimeout(resolve, 800));
      if (cancelled) return;

      try {
        const { scannedImages, status } = await DocumentScanner.scanDocument({
          croppedImageQuality: 100,
        });

        if (cancelled) return;

        if (status === 'success' && scannedImages && scannedImages.length > 0) {
          const processed = await ImageManipulator.manipulateAsync(
            scannedImages[0],
            [],
            { compress: 1.0, format: ImageManipulator.SaveFormat.JPEG }
          );
          if (!cancelled) handleSave(processed.uri);
        } else {
          // User cancelled native scanner → go back to camera
          if (!cancelled) setMode('CAMERA');
        }
      } catch (err) {
        console.warn('Auto scan error:', err);
        if (!cancelled) setMode('CAMERA');
      }
    };

    run();

    return () => { cancelled = true; };
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCapture = useCallback(
    (uri: string, polygon: any[], originSize: { width: number; height: number }) => {
      setCapturedImage(uri);
      setDetectedPolygon(polygon);
      setImageSize(originSize);
      setMode('EDIT');
    },
    []
  );

  const handleRetake = useCallback(() => {
    setCapturedImage(null);
    setDetectedPolygon(null);
    setImageSize(null);
    setMode('CAMERA');
  }, []);

  const handleSave = useCallback(
    (processedUri: string) => {
      // Show brief "saving" state to prevent black flash, then hand off to parent
      setMode('SAVING');
      setTimeout(() => {
        onSaveFoundDocument(processedUri);
      }, 0);
    },
    [onSaveFoundDocument]
  );

  // ─── SAVING ───
  if (mode === 'SAVING') {
    return (
      <View style={styles.savingWrap}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.savingText}>Đang lưu tài liệu...</Text>
      </View>
    );
  }

  // ─── AUTO_SCAN: CameraOverlay NOT rendered (camera fully released) ───
  if (mode === 'AUTO_SCAN') {
    return (
      <View style={styles.savingWrap}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.savingText}>Đang mở máy quét tự động...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {mode === 'CAMERA' ? (
        <CameraOverlay
          onCapture={handleCapture}
          onAutoScanRequest={() => setMode('AUTO_SCAN')}
          onCancel={onCancel}
          onPickImage={onPickImage}
          onPickPdf={onPickPdf}
        />
      ) : (
        <EditDocumentScreen
          imageUri={capturedImage!}
          initialPolygon={detectedPolygon}
          imageSize={imageSize!}
          onRetake={handleRetake}
          onSave={handleSave}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  savingWrap: {
    flex: 1,
    backgroundColor: '#09090b',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
  },
  savingText: {
    color: '#a1a1aa',
    fontSize: 16,
    fontWeight: '500',
  },
});
