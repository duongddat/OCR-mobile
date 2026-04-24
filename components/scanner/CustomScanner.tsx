import React, { useCallback, useRef, useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
} from 'react-native';
import {
  Camera,
  CameraRef,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
  useFrameOutput,
} from 'react-native-vision-camera';
import { Canvas, Path, Skia, Group, Rect } from '@shopify/react-native-skia';
import {
  useSharedValue,
  useDerivedValue,
  withTiming,
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useAnimatedReaction,
} from 'react-native-reanimated';
import Animated from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  OpenCV,
  ObjectType,
  MorphShapes,
  MorphTypes,
  RetrievalModes,
  ContourApproximationModes,
} from 'react-native-fast-opencv';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import CropEditor from './CropEditor';
 
const MIN_AREA_RATIO = 0.08;
const FOCUS_THROTTLE = 1000; // ms between camera.focus() calls
 
// ─── Types ────────────────────────────────────────────────────────────────
 
export interface DocCorners {
  tl: { x: number; y: number };
  tr: { x: number; y: number };
  br: { x: number; y: number };
  bl: { x: number; y: number };
}
 
interface CustomScannerProps {
  onCapture: (uri: string, corners?: any[]) => void;
  onCancel: () => void;
}
 
// ─── Smart focus point ────────────────────────────────────────────────────
 
function getDocumentFocusPoint(c: DocCorners, frameAspect: number, screenW: number, screenH: number): { x: number; y: number } {
  const sc = normalizedToScreenCorners(c, frameAspect, screenW, screenH);
  return {
    x: (sc.tl.x + sc.tr.x + sc.br.x + sc.bl.x) / 4,
    y: (sc.tl.y + sc.tr.y + sc.br.y + sc.bl.y) / 4,
  };
}
 
// ─── OpenCV detection (worklet) ───────────────────────────────────────────
 
function detectDocument(
  src: any,
  imgW: number,
  imgH: number,
  channels: number = 4,
): DocCorners | null {
  'worklet';
  const ids: string[] = [];
  const cleanup = () => { try { OpenCV.releaseBuffers(ids); } catch {} };
 
  try {
    const gray = OpenCV.createObject('mat' as ObjectType.Mat, imgH, imgW, 0);
    ids.push(gray.id);
    OpenCV.invoke('cvtColor', src, gray, channels === 3 ? 7 : 11);
 
    const blurred = OpenCV.createObject('mat' as ObjectType.Mat, imgH, imgW, 0);
    ids.push(blurred.id);
    const ksize = OpenCV.createObject('size' as ObjectType.Size, 7, 7);
    ids.push(ksize.id);
    OpenCV.invoke('GaussianBlur', gray, blurred, ksize, 0);
 
    const edges = OpenCV.createObject('mat' as ObjectType.Mat, imgH, imgW, 0);
    ids.push(edges.id);
    OpenCV.invoke('Canny', blurred, edges, 50, 150);
 
    const kernel = OpenCV.invoke(
      'getStructuringElement',
      0 as MorphShapes.MORPH_RECT,
      OpenCV.createObject('size' as ObjectType.Size, 9, 9),
    ) as any;
    ids.push(kernel.id);
 
    const closed = OpenCV.createObject('mat' as ObjectType.Mat, imgH, imgW, 0);
    ids.push(closed.id);
    OpenCV.invoke('morphologyEx', edges, closed, 3 as MorphTypes.MORPH_CLOSE, kernel);
 
    const contours = OpenCV.createObject('mat_vector' as ObjectType.MatVector);
    ids.push(contours.id);
    OpenCV.invoke(
      'findContours', closed, contours,
      0 as RetrievalModes.RETR_EXTERNAL,
      2 as ContourApproximationModes.CHAIN_APPROX_SIMPLE,
    );
 
    const contourJs = OpenCV.toJSValue(contours) as { array: any[] };
    const count     = contourJs.array.length;
    const minArea   = imgW * imgH * MIN_AREA_RATIO;
    let best: DocCorners | null = null;
    let bestArea = 0;
 
    for (let i = 0; i < count; i++) {
      const contour = OpenCV.copyObjectFromVector(contours, i);
      ids.push(contour.id);
 
      const area = (OpenCV.invoke('contourArea', contour) as { value: number }).value;
      if (area <= minArea || area <= bestArea) continue;
 
      const peri = (OpenCV.invoke('arcLength', contour, true) as { value: number }).value;
      const approx = OpenCV.createObject('mat' as ObjectType.Mat, 0, 0, 0);
      ids.push(approx.id);
      OpenCV.invoke('approxPolyDP', contour, approx, 0.02 * peri, true);
 
      const buf    = OpenCV.matToBuffer(approx, 'int32');
      const numPts = buf.rows * buf.cols;
      if (numPts < 4) continue;
 
      const raw: { x: number; y: number }[] = [];
      for (let j = 0; j < numPts; j++) {
        raw.push({ x: buf.buffer[j * 2] / imgW, y: buf.buffer[j * 2 + 1] / imgH });
      }
 
      raw.sort((a, b) => (a.x + a.y) - (b.x + b.y));
      const tl = raw[0];
      const br = raw[raw.length - 1];
      raw.sort((a, b) => (a.x - a.y) - (b.x - b.y));
      const bl = raw[0];
      const tr = raw[raw.length - 1];
 
      best     = { tl, tr, br, bl };
      bestArea = area;
    }
 
    cleanup();
    return best;
  } catch (e: any) {
    console.log('[WORKLET] detectDocument error:', e?.message ?? e);
    cleanup();
    return null;
  }
}
 
// ─── OpenCV detection (JS thread) ─────────────────────────────────────────
 
function detectDocumentJS(
  src: any,
  imgW: number,
  imgH: number,
  channels = 3,
): DocCorners | null {
  const ids: string[] = [];
  const cleanup = () => { try { OpenCV.releaseBuffers(ids); } catch {} };
 
  try {
    const gray = OpenCV.createObject('mat' as ObjectType.Mat, imgH, imgW, 0);
    ids.push(gray.id);
    OpenCV.invoke('cvtColor', src, gray, channels === 3 ? 7 : 11);
 
    const blurred = OpenCV.createObject('mat' as ObjectType.Mat, imgH, imgW, 0);
    ids.push(blurred.id);
    const ksize = OpenCV.createObject('size' as ObjectType.Size, 7, 7);
    ids.push(ksize.id);
    OpenCV.invoke('GaussianBlur', gray, blurred, ksize, 0);
 
    const edges = OpenCV.createObject('mat' as ObjectType.Mat, imgH, imgW, 0);
    ids.push(edges.id);
    OpenCV.invoke('Canny', blurred, edges, 50, 150);
 
    const kernel = OpenCV.invoke(
      'getStructuringElement',
      0 as MorphShapes.MORPH_RECT,
      OpenCV.createObject('size' as ObjectType.Size, 9, 9),
    ) as any;
    ids.push(kernel.id);
 
    const closed = OpenCV.createObject('mat' as ObjectType.Mat, imgH, imgW, 0);
    ids.push(closed.id);
    OpenCV.invoke('morphologyEx', edges, closed, 3 as MorphTypes.MORPH_CLOSE, kernel);
 
    const contours = OpenCV.createObject('mat_vector' as ObjectType.MatVector);
    ids.push(contours.id);
    OpenCV.invoke(
      'findContours', closed, contours,
      0 as RetrievalModes.RETR_EXTERNAL,
      2 as ContourApproximationModes.CHAIN_APPROX_SIMPLE,
    );
 
    const contourJs = OpenCV.toJSValue(contours) as { array: any[] };
    const count     = contourJs.array.length;
    const minArea   = imgW * imgH * MIN_AREA_RATIO;
    let best: DocCorners | null = null;
    let bestArea = 0;
 
    for (let i = 0; i < count; i++) {
      const contour = OpenCV.copyObjectFromVector(contours, i);
      ids.push(contour.id);
 
      const area = (OpenCV.invoke('contourArea', contour) as { value: number }).value;
      if (area <= minArea || area <= bestArea) continue;
 
      const peri = (OpenCV.invoke('arcLength', contour, true) as { value: number }).value;
      const approx = OpenCV.createObject('mat' as ObjectType.Mat, 0, 0, 0);
      ids.push(approx.id);
      OpenCV.invoke('approxPolyDP', contour, approx, 0.02 * peri, true);
 
      const buf    = OpenCV.matToBuffer(approx, 'int32');
      const numPts = buf.rows * buf.cols;
      if (numPts < 4) continue;
 
      const raw: { x: number; y: number }[] = [];
      for (let j = 0; j < numPts; j++) {
        raw.push({ x: buf.buffer[j * 2] / imgW, y: buf.buffer[j * 2 + 1] / imgH });
      }
 
      raw.sort((a, b) => (a.x + a.y) - (b.x + b.y));
      const tl = raw[0];
      const br = raw[raw.length - 1];
      raw.sort((a, b) => (a.x - a.y) - (b.x - b.y));
      const bl = raw[0];
      const tr = raw[raw.length - 1];
 
      best     = { tl, tr, br, bl };
      bestArea = area;
    }
 
    cleanup();
    return best;
  } catch (e: any) {
    console.warn('[detectDocumentJS] error:', e?.message ?? e);
    cleanup();
    return null;
  }
}
 
// ─── Helpers ──────────────────────────────────────────────────────────────
 
function normalizedToScreenCorners(c: DocCorners, frameAspect: number, screenW: number, screenH: number) {
  const screenAspect = screenW / screenH;
  const frameIsLandscape = frameAspect > 1;
  const screenIsPortrait = screenW < screenH;
  const needsRotation = frameIsLandscape && screenIsPortrait;

  const effectiveAspect = needsRotation ? 1 / frameAspect : frameAspect;

  let displayW = screenW, displayH = screenH, offsetX = 0, offsetY = 0;
 
  if (effectiveAspect > screenAspect) {
    displayH = screenH;
    displayW = screenH * effectiveAspect;
    offsetX  = (screenW - displayW) / 2;
  } else {
    displayW = screenW;
    displayH = screenW / effectiveAspect;
    offsetY  = (screenH - displayH) / 2;
  }
 
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const map = needsRotation
    ? (p: { x: number; y: number }) => ({
        x: clamp(p.y * displayW + offsetX, 0, screenW),
        y: clamp((1 - p.x) * displayH + offsetY, 0, screenH),
      })
    : (p: { x: number; y: number }) => ({
        x: clamp(p.x * displayW + offsetX, 0, screenW),
        y: clamp(p.y * displayH + offsetY, 0, screenH),
      });

  return { tl: map(c.tl), tr: map(c.tr), br: map(c.br), bl: map(c.bl) };
}
 
function cornersDistance(a: DocCorners, b: DocCorners): number {
  const keys: (keyof DocCorners)[] = ['tl', 'tr', 'br', 'bl'];
  return Math.max(...keys.map((k) => Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y)));
}
 
function buildPolygonPath(c: ReturnType<typeof normalizedToScreenCorners>) {
  const p = Skia.Path.Make();
  p.moveTo(c.tl.x, c.tl.y);
  p.lineTo(c.tr.x, c.tr.y);
  p.lineTo(c.br.x, c.br.y);
  p.lineTo(c.bl.x, c.bl.y);
  p.close();
  return p;
}
 
function buildDotPath(x: number, y: number, r = 7) {
  const p = Skia.Path.Make();
  p.addCircle(x, y, r);
  return p;
}
 
// ─── Component ────────────────────────────────────────────────────────────
 
import { useWindowDimensions } from 'react-native';

export default function CustomScanner({ onCapture, onCancel }: CustomScannerProps) {
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();
  const device = useCameraDevice('back');
  const insets = useSafeAreaInsets();
  const { hasPermission, requestPermission } = useCameraPermission();
 
  const [isActive, setIsActive]               = useState(true);
  const [mode, setMode]                       = useState<'auto' | 'manual'>('auto');
  const [torchEnabled, setTorchEnabled]       = useState(false);
  const [detectedCorners, setDetectedCorners] = useState<DocCorners | null>(null);
  const [isStable, setIsStable]               = useState(false);
  const [hasAutoShot, setHasAutoShot]         = useState(false);
  const [capturedPhoto, setCapturedPhoto]     = useState<{
    uri: string;
    corners: DocCorners | null;
    photoAspect?: number;
    frameAspect?: number;
  } | null>(null);

  const [zoom, setZoom] = useState(device?.minZoom ?? 1);
  const [frameAspect, setFrameAspect] = useState(1);
 
  // Refs
  const cameraRef        = useRef<CameraRef>(null);
  const lastFocusTimeRef = useRef<number>(0);
  const prevCornersRef   = useRef<DocCorners | null>(null);
  const stableTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
 
  // Shared values
  const isActiveShared     = useSharedValue(true);
  const frameCounterShared = useSharedValue(0);
  const frameAspectShared  = useSharedValue(1);
  const fillAnim           = useSharedValue(0);
  const docMinY            = useSharedValue(0);
  const docMaxY            = useSharedValue(2000); // placeholder, updated in render

  // Zoom shared values (for pinch gesture on UI thread)
  const minZoom   = device?.minZoom ?? 1;
  const maxZoom   = Math.min(device?.maxZoom ?? 10, 16);
  const zoomValue = useSharedValue(device?.minZoom ?? 1);
  const startZoom = useSharedValue(1);

  // ✅ FIX: sync UI-thread zoom → JS state (replaces useAnimatedProps)
  useAnimatedReaction(
    () => zoomValue.value,
    (z) => runOnJS(setZoom)(z),
  );

  // Focus Ring shared values
  const tapFocusX    = useSharedValue(0);
  const tapFocusY    = useSharedValue(0);
  const focusOpacity = useSharedValue(0);
  const focusScale   = useSharedValue(1);
  const focusRingColor = useSharedValue('#34d399'); // green = manual tap, cyan = auto-doc focus
 
  const progressY = useDerivedValue(() => {
    const h = docMaxY.value - docMinY.value;
    return docMaxY.value - h * fillAnim.value;
  });
  const progressHeight = useDerivedValue(
    () => (docMaxY.value - docMinY.value) * fillAnim.value,
  );
 
  const photoOutput = usePhotoOutput();
 
  // Permission
  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission]);
 
  // Reset on mode change
  useEffect(() => {
    setDetectedCorners(null);
    setIsStable(false);
    setHasAutoShot(false);
    prevCornersRef.current = null;
    cancelAnimation(fillAnim);
    fillAnim.value = 0;
    if (stableTimerRef.current) { clearTimeout(stableTimerRef.current); stableTimerRef.current = null; }
  }, [mode]);
 
  useEffect(() => {
    if (isStable && mode === 'auto') {
      fillAnim.value = 0;
      fillAnim.value = withTiming(1, { duration: 600, easing: Easing.linear });
    } else {
      cancelAnimation(fillAnim);
      fillAnim.value = 0;
    }
  }, [isStable, mode]);
 
  // Auto-capture trigger
  useEffect(() => {
    if (isStable && mode === 'auto' && isActive && !hasAutoShot) {
      const t = setTimeout(() => { setHasAutoShot(true); capturePhoto(); }, 600);
      return () => clearTimeout(t);
    }
  }, [isStable, mode, isActive, hasAutoShot]);
 
  // ── Corner update + stability detection + SMART FOCUS ─────────────────
  const onCornersDetected = useCallback((corners: DocCorners | null, aspect: number) => {
    setDetectedCorners(corners);
    setFrameAspect(aspect);
 
    const now      = Date.now();
    const canFocus = now - lastFocusTimeRef.current > FOCUS_THROTTLE;
 
    if (!corners) {
      setIsStable(false);
      prevCornersRef.current = null;
      if (stableTimerRef.current) {
        clearTimeout(stableTimerRef.current);
        stableTimerRef.current = null;
      }
      if (canFocus && cameraRef.current) {
        lastFocusTimeRef.current = now;
        cameraRef.current
          .focusTo({ x: SCREEN_W / 2, y: SCREEN_H / 2 })
          .catch(() => {});
      }
      return;
    }
 
    const sc = normalizedToScreenCorners(corners, aspect, SCREEN_W, SCREEN_H);
    docMinY.value = Math.min(sc.tl.y, sc.tr.y, sc.bl.y, sc.br.y);
    docMaxY.value = Math.max(sc.tl.y, sc.tr.y, sc.bl.y, sc.br.y);
 
    if (canFocus && cameraRef.current) {
      lastFocusTimeRef.current = now;
      const { x: fx, y: fy } = getDocumentFocusPoint(corners, aspect, SCREEN_W, SCREEN_H);
      const safeX = Math.max(1, Math.min(SCREEN_W - 1, fx));
      const safeY = Math.max(1, Math.min(SCREEN_H - 1, fy));
      cameraRef.current.focusTo({ x: safeX, y: safeY }).catch(() => {});

      // ✅ FIX: Hiển thị focus ring tại tâm tài liệu khi auto-focus
      tapFocusX.value = safeX;
      tapFocusY.value = safeY;
      focusRingColor.value = '#06b6d4'; // cyan = auto-focus tài liệu
      focusOpacity.value = 1;
      focusScale.value = 1.4;
      focusScale.value = withTiming(1, { duration: 350 });
      focusOpacity.value = withTiming(0, { duration: 1000 });
    }
 
    const prev  = prevCornersRef.current;
    const moved = prev ? cornersDistance(prev, corners) : Infinity;
 
    if (moved < 0.035) {
      if (!stableTimerRef.current) {
        stableTimerRef.current = setTimeout(() => {
          setIsStable(true);
          stableTimerRef.current = null;
        }, 400);
      }
    } else {
      setIsStable(false);
      setHasAutoShot(false);
      if (stableTimerRef.current) {
        clearTimeout(stableTimerRef.current);
        stableTimerRef.current = null;
      }
    }
 
    prevCornersRef.current = corners;
  }, [tapFocusX, tapFocusY, focusOpacity, focusScale, focusRingColor]);

  // ── Gestures ──────────────────────────────────────────────────────────
  const handleManualFocus = useCallback((x: number, y: number) => {
    lastFocusTimeRef.current = Date.now() + 2000;
    if (cameraRef.current) {
      cameraRef.current.focusTo({ x, y }).catch(() => {});
    }
  }, []);

  const singleTap = Gesture.Tap().onEnd((e) => {
    tapFocusX.value = e.x;
    tapFocusY.value = e.y;
    focusRingColor.value = '#34d399'; // green = tap thủ công
    focusOpacity.value = 1;
    focusScale.value = 1.3;
    focusScale.value = withTiming(1, { duration: 300 });
    focusOpacity.value = withTiming(0, { duration: 800 });
    runOnJS(handleManualFocus)(e.x, e.y);
  });

  const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd(() => {
    runOnJS(setMode)((m: string) => (m === 'auto' ? 'manual' : 'auto'));
  });

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      startZoom.value = zoomValue.value;
    })
    .onUpdate((e) => {
      const z = startZoom.value * e.scale;
      zoomValue.value = Math.max(minZoom, Math.min(z, maxZoom));
    });

  const cameraGestures = Gesture.Simultaneous(pinchGesture, Gesture.Exclusive(doubleTap, singleTap));

  // Focus Ring color: cyan for auto-doc focus, green for manual tap
  const focusRingStyle = useAnimatedStyle(() => ({
    opacity: focusOpacity.value,
    transform: [{ scale: focusScale.value }],
    left: tapFocusX.value - 35,
    top: tapFocusY.value - 35,
    borderColor: focusRingColor.value,
  }));
 
  // ── Frame processor ────────────────────────────────────────────────────
  const frameOutput = useFrameOutput({
    pixelFormat: 'rgb',
    // enablePhysicalBufferRotation removed: frame ở landscape gây offsetX âm lớn, polygon vẽ ngoài màn hình
    onFrame: (frame) => {
      'worklet';
      if (!isActiveShared.value) { frame.dispose(); return; }
 
      frameCounterShared.value = (frameCounterShared.value + 1) % 4;
      if (frameCounterShared.value !== 0) { frame.dispose(); return; }
 
      frameAspectShared.value = frame.width / frame.height;
 
      let srcId: string | null = null;
      try {
        const buffer   = frame.getPixelBuffer();
        const uint8    = new Uint8Array(buffer);
        const calcCh   = Math.round(frame.bytesPerRow / frame.width);
        const channels: 1|3|4 = (calcCh === 1 || calcCh === 3 || calcCh === 4) ? calcCh : 4;
 
        const src = OpenCV.bufferToMat('uint8', frame.height, frame.width, channels, uint8);
        srcId = src.id;
        const corners = detectDocument(src, frame.width, frame.height, channels);
 
        runOnJS(onCornersDetected)(corners, frameAspectShared.value);
      } catch (e: any) {
        console.log('[WORKLET] onFrame error:', e?.message || 'Unknown error');
        runOnJS(onCornersDetected)(null, frameAspectShared.value);
      } finally {
        if (srcId) {
          try { OpenCV.releaseBuffers([srcId]); } catch {}
        }
        frame.dispose();
      }
    },
  });
 
  // ── Photo capture ─────────────────────────────────────────────────────
  const capturePhoto = useCallback(async () => {
    if (!isActive) return;
    try {
      const photoFile = await photoOutput.capturePhotoToFile({}, {});
      setIsActive(false);
      isActiveShared.value = false;
 
      const pFile  = photoFile as any;
      const uri    = `file://${photoFile.filePath}`;
      let accurateCorners: DocCorners | null = detectedCorners;
 
      try {
        const thumb = await manipulateAsync(
          uri,
          [{ resize: { width: 800 } }],
          { format: SaveFormat.JPEG, compress: 0.85 },
        );
 
        const b64 = await FileSystem.readAsStringAsync(thumb.uri, {
          encoding: 'base64' as any,
        });
 
        let srcMatId: string | null = null;
        try {
          const srcMat   = OpenCV.base64ToMat(b64);
          srcMatId = srcMat.id;
          const detected = detectDocumentJS(srcMat, thumb.width, thumb.height, 3);
 
          if (detected) accurateCorners = detected;
        } finally {
          if (srcMatId) {
            try { OpenCV.releaseBuffers([srcMatId]); } catch {}
          }
        }
      } catch (detectErr) {
        console.warn('[capturePhoto] photo re-detect failed, using frame corners:', detectErr);
      }
 
      setCapturedPhoto({
        uri,
        corners: accurateCorners,
        photoAspect: (pFile.width || 3000) / (pFile.height || 4000),
        frameAspect: frameAspectShared.value,
      });
    } catch (e) {
      console.error('[CustomScanner] capture error:', e);
    }
  }, [photoOutput, isActive, detectedCorners]);
 
  const handleCaptureBtn = useCallback(() => capturePhoto(), [capturePhoto]);
 
  // Skia overlay
  const screenCorners = detectedCorners
    ? normalizedToScreenCorners(detectedCorners, frameAspect, SCREEN_W, SCREEN_H)
    : null;
  const skPath      = screenCorners ? buildPolygonPath(screenCorners) : null;
  const strokeColor = isStable && mode === 'auto' ? '#34d399' : '#06b6d4';
 
  // ── CropEditor ────────────────────────────────────────────────────────
  if (capturedPhoto) {
    return (
      <CropEditor
        imageUri={capturedPhoto.uri}
        initialCorners={capturedPhoto.corners ?? undefined}
        photoAspect={capturedPhoto.photoAspect}
        frameAspect={capturedPhoto.frameAspect}
        onCancel={() => {
          setCapturedPhoto(null);
          setIsActive(true);
          isActiveShared.value = true;
          setDetectedCorners(null);
          setIsStable(false);
          setHasAutoShot(false);
          prevCornersRef.current = null;
        }}
        onConfirm={(croppedUri) => onCapture(croppedUri, [])}
      />
    );
  }
 
  if (!device || !hasPermission) return <View style={ss.container} />;
 
  return (
    <View style={ss.container}>
      <GestureDetector gesture={cameraGestures}>
        <View style={StyleSheet.absoluteFill}>
          {/* ✅ FIX: plain <Camera> with zoom={zoom} state — no createAnimatedComponent */}
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={isActive}
            outputs={[photoOutput, frameOutput]}
            torchMode={torchEnabled ? 'on' : 'off'}
            zoom={zoom}
          />

          {skPath && screenCorners && (
            <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
              <Path path={skPath} color="rgba(6,182,212,0.10)" style="fill" />

              {mode === 'auto' && (
                <Group clip={skPath}>
                  <Rect
                    x={0} y={progressY}
                    width={SCREEN_W} height={progressHeight}
                    color="rgba(52,211,153,0.4)"
                  />
                </Group>
              )}

              <Path path={skPath} color={strokeColor} style="stroke" strokeWidth={3} />

              {(['tl', 'tr', 'br', 'bl'] as const).map((key) => (
                <Path
                  key={key}
                  path={buildDotPath(screenCorners[key].x, screenCorners[key].y)}
                  color={strokeColor}
                  style="fill"
                />
              ))}
            </Canvas>
          )}

          <Animated.View
            pointerEvents="none"
            style={[{
              position: 'absolute',
              width: 70, height: 70,
              borderRadius: 35,
              borderWidth: 1.5,
            }, focusRingStyle]}
          />
        </View>
      </GestureDetector>
 
      <View style={[ss.statusBadge, { top: insets.top + 76 }]}>
        <View style={[ss.statusDot, {
          backgroundColor: detectedCorners
            ? isStable ? '#34d399' : '#06b6d4'
            : '#6b7280',
        }]} />
        <Text style={ss.statusText}>
          {detectedCorners
            ? isStable
              ? mode === 'auto' ? 'Đang chụp tự động…' : 'Sẵn sàng — nhấn chụp'
              : 'Phát hiện tài liệu…'
            : 'Đang tìm tài liệu…'}
        </Text>
      </View>
 
      <View style={[ss.header, { top: insets.top + 20 }]}>
        <TouchableOpacity style={ss.iconBtn} onPress={onCancel}>
          <Ionicons name="close" size={22} color="#fff" />
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 }}>
          <Text style={ss.title}>
            {mode === 'auto' ? '⚡ Auto' : '✋ Manual'}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity
            style={ss.iconBtn}
            onPress={() => setMode((m) => (m === 'auto' ? 'manual' : 'auto'))}
          >
            <Ionicons name={mode === 'auto' ? 'scan' : 'document-text'} size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={ss.iconBtn}
            onPress={() => setTorchEnabled(t => !t)}
          >
            <Ionicons name={torchEnabled ? 'flashlight' : 'flashlight-outline'} size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
 
      {mode === 'manual' && (
        <View style={[ss.footer, { bottom: insets.bottom + 36 }]}>
          <TouchableOpacity
            style={[ss.captureBtn, detectedCorners ? ss.captureBtnReady : ss.captureBtnIdle]}
            onPress={handleCaptureBtn}
            activeOpacity={0.8}
          >
            <View style={[ss.captureBtnInner, {
              backgroundColor: detectedCorners ? '#06b6d4' : '#fff',
            }]} />
          </TouchableOpacity>
          <Text style={ss.hint}>
            {detectedCorners ? 'Nhấn để chụp tài liệu' : 'Đưa tài liệu vào khung hình'}
          </Text>
        </View>
      )}
 
      {mode === 'auto' && (
        <View style={[ss.footer, { bottom: insets.bottom + 36 }]}>
          <Text style={ss.hint}>
            {detectedCorners
              ? isStable ? 'Giữ nguyên, đang chụp…' : 'Giữ điện thoại ổn định'
              : 'Đưa tài liệu vào khung hình'}
          </Text>
        </View>
      )}
    </View>
  );
}
 
// ─── Styles ───────────────────────────────────────────────────────────────
 
const ss = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
 
  header: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center',
  },
  title: {
    color: '#fff', fontSize: 14, fontWeight: '700',
    letterSpacing: 0.3,
  },
 
  statusBadge: {
    position: 'absolute', alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
  },
  statusDot:  { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: '#fff', fontSize: 13, fontWeight: '500' },
 
  footer: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 12 },
  captureBtn: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 4,
    justifyContent: 'center', alignItems: 'center',
  },
  captureBtnIdle:  { borderColor: 'rgba(255,255,255,0.4)', opacity: 0.5 },
  captureBtnReady: { borderColor: '#06b6d4' },
  captureBtnInner: { width: 56, height: 56, borderRadius: 28 },
  hint: {
    color: '#fff', fontSize: 13, fontWeight: '500',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16, paddingVertical: 7,
    borderRadius: 16, overflow: 'hidden',
  },
});