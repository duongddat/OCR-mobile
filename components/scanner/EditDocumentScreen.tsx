import React, { useState, useCallback, useEffect } from 'react';
import {
  View, StyleSheet, TouchableOpacity, Text, Image,
  LayoutChangeEvent, ActivityIndicator, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, useDerivedValue, runOnJS,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { Canvas, Path } from '@shopify/react-native-skia';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { OpenCV, ColorConversionCodes, AdaptiveThresholdTypes, ThresholdTypes } from 'react-native-fast-opencv';
import { ACCENT } from './styles';

// ─── Types ────────────────────────────────────────────────────────────────────
interface EditDocumentScreenProps {
  imageUri: string;
  initialPolygon: any[] | null;
  imageSize: { width: number; height: number };
  onRetake: () => void;
  onSave: (finalUri: string) => void;
}

// ─── Draggable Corner ─────────────────────────────────────────────────────────
const HANDLE = 44;
const DOT = 18;

function DraggableCorner({
  x, y, maxX, maxY, activeX, activeY, isDragging, onSnap,
}: {
  x: SharedValue<number>;
  y: SharedValue<number>;
  maxX: SharedValue<number>;
  maxY: SharedValue<number>;
  activeX: SharedValue<number>;
  activeY: SharedValue<number>;
  isDragging: SharedValue<boolean>;
  /** Called on gesture end (JS thread) with the stable corner position. */
  onSnap: (x: number, y: number) => void;
}) {
  const gesture = Gesture.Pan()
    .onStart(() => {
      'worklet';
      isDragging.value = true;
      activeX.value = x.value;
      activeY.value = y.value;
    })
    .onChange((e) => {
      'worklet';
      x.value = Math.max(0, Math.min(maxX.value, x.value + e.changeX));
      y.value = Math.max(0, Math.min(maxY.value, y.value + e.changeY));
      activeX.value = x.value;
      activeY.value = y.value;
    })
    .onEnd(() => {
      'worklet';
      isDragging.value = false;
      // Snapshot the final position to JS state via runOnJS.
      // This guarantees handleConfirm reads a stable, non-stale value.
      runOnJS(onSnap)(x.value, y.value);
    });

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value - HANDLE / 2 },
      { translateY: y.value - HANDLE / 2 },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[s.cornerWrap, style]}>
        <View style={s.cornerOuter}>
          <View style={s.cornerDot} />
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function EditDocumentScreen({
  imageUri, initialPolygon, imageSize, onRetake, onSave,
}: EditDocumentScreenProps) {
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  // imageDimensions tracks ONLY the originalUri dimensions (for corner positioning).
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [activeFilter, setActiveFilter] = useState<'original' | 'grayscale' | 'enhanced'>('original');
  const [originalUri, setOriginalUri] = useState(imageUri);
  const [currentImageUri, setCurrentImageUri] = useState(imageUri);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  // cornerSnapshot: JS-thread snapshot of corner positions.
  // Updated by each DraggableCorner's onSnap callback AND by the corner init effect.
  // handleConfirm reads THIS (not shared .value) to guarantee stable values.
  const [cornerSnapshot, setCornerSnapshot] = useState({
    tlX: 0, tlY: 0,
    trX: 100, trY: 0,
    brX: 100, brY: 100,
    blX: 0, blY: 100,
  });

  // Only track dimensions of the ORIGINAL image for corner math.
  // This prevents corners from being reset whenever a filter is applied.
  useEffect(() => {
    Image.getSize(
      originalUri,
      (w, h) => setImageDimensions({ width: w, height: h }),
      () => { /* silent fail — corners will use fallback */ }
    );
  }, [originalUri]); // ← only reacts to rotation, NOT to filter changes

  useEffect(() => {
    if (activeFilter === 'original') {
      setCurrentImageUri(originalUri);
      return;
    }

    const applyFilter = async () => {
      setIsProcessing(true);
      try {
        const base64 = await FileSystem.readAsStringAsync(originalUri, { encoding: 'base64' });
        const srcMat = OpenCV.base64ToMat(base64);

        if (activeFilter === 'grayscale') {
          // Convert to gray then back to BGR — OpenCV JPEG encoder needs 3-channel mat
          OpenCV.invoke('cvtColor', srcMat, srcMat, ColorConversionCodes.COLOR_BGR2GRAY);
          OpenCV.invoke('cvtColor', srcMat, srcMat, ColorConversionCodes.COLOR_GRAY2BGR);
        } else if (activeFilter === 'enhanced') {
          // Grayscale → adaptive threshold (binary b&w) → back to BGR for encoding
          OpenCV.invoke('cvtColor', srcMat, srcMat, ColorConversionCodes.COLOR_BGR2GRAY);
          OpenCV.invoke(
            'adaptiveThreshold',
            srcMat, srcMat, 255,
            AdaptiveThresholdTypes.ADAPTIVE_THRESH_GAUSSIAN_C,
            ThresholdTypes.THRESH_BINARY,
            11, 2
          );
          OpenCV.invoke('cvtColor', srcMat, srcMat, ColorConversionCodes.COLOR_GRAY2BGR);
        }

        const resultObj = OpenCV.toJSValue(srcMat, 'jpeg') as any;
        const cacheDir = (FileSystem as any).cacheDirectory || 'file:///tmp/';
        const tmpPath = cacheDir + 'preview_' + Date.now() + '.jpg';
        await FileSystem.writeAsStringAsync(tmpPath, resultObj.base64, { encoding: 'base64' });
        setCurrentImageUri(tmpPath.startsWith('file://') ? tmpPath : 'file://' + tmpPath);
        OpenCV.releaseBuffers();
      } catch (e) {
        console.warn('Live filter error', e);
      }
      setIsProcessing(false);
    };

    // run on mount and when filter/image changes
    applyFilter();
  }, [activeFilter, originalUri]);

  // Shared values for container bounds (used in gesture worklet)
  const maxX = useSharedValue(300);
  const maxY = useSharedValue(500);

  // 4 corner shared values — initialized at 0, updated once layout is known
  // 4 corner shared values
  const tlX = useSharedValue(0); const tlY = useSharedValue(0);
  const trX = useSharedValue(100); const trY = useSharedValue(0);
  const brX = useSharedValue(100); const brY = useSharedValue(100);
  const blX = useSharedValue(0);  const blY = useSharedValue(100);

  // Magnifier shared values
  const activeX = useSharedValue(0);
  const activeY = useSharedValue(0);
  const isDragging = useSharedValue(false);

  // Update corners once container is measured and image dimensions are known.
  // Depends on imageDimensions (originalUri-based) so filter changes do NOT reset corners.
  useEffect(() => {
    if (!containerSize.w || !containerSize.h || !imageDimensions) return;

    const cw = containerSize.w;
    const ch = containerSize.h;

    // imageSize represents the CameraOverlay's screen dimensions (SCREEN_WIDTH × SCREEN_HEIGHT)
    const overlayW = imageSize.width;
    const overlayH = imageSize.height;

    const imgW = imageDimensions.width;
    const imgH = imageDimensions.height;

    // 1. Camera scaling (Cover mode in CameraOverlay)
    const scale1 = Math.max(overlayW / imgW, overlayH / imgH);
    const cv_oX = (overlayW - imgW * scale1) / 2;
    const cv_oY = (overlayH - imgH * scale1) / 2;

    // 2. Edit screen scaling (Contain mode)
    const scale2 = Math.min(cw / imgW, ch / imgH);
    const ed_oX = (cw - imgW * scale2) / 2;
    const ed_oY = (ch - imgH * scale2) / 2;

    maxX.value = cw;
    maxY.value = ch;

    const margin = Math.min(imgW * scale2, imgH * scale2) * 0.06;

    let newTlX: number, newTlY: number, newTrX: number, newTrY: number;
    let newBrX: number, newBrY: number, newBlX: number, newBlY: number;

    if (initialPolygon?.length === 4 && originalUri === imageUri) {
      const mapPt = (pt: any) => {
        const ix = (pt.x - cv_oX) / scale1;
        const iy = (pt.y - cv_oY) / scale1;
        return { x: ix * scale2 + ed_oX, y: iy * scale2 + ed_oY };
      };
      const pts = initialPolygon.map(mapPt);
      newTlX = pts[0].x; newTlY = pts[0].y;
      newTrX = pts[1].x; newTrY = pts[1].y;
      newBrX = pts[2].x; newBrY = pts[2].y;
      newBlX = pts[3].x; newBlY = pts[3].y;
    } else {
      const rW = imgW * scale2;
      const rH = imgH * scale2;
      newTlX = ed_oX + margin; newTlY = ed_oY + margin;
      newTrX = ed_oX + rW - margin; newTrY = ed_oY + margin;
      newBrX = ed_oX + rW - margin; newBrY = ed_oY + rH - margin;
      newBlX = ed_oX + margin; newBlY = ed_oY + rH - margin;
    }

    // Update shared values (for Skia overlay + magnifier)
    tlX.value = newTlX; tlY.value = newTlY;
    trX.value = newTrX; trY.value = newTrY;
    brX.value = newBrX; brY.value = newBrY;
    blX.value = newBlX; blY.value = newBlY;

    // ALSO snapshot to JS state — handleConfirm reads this
    setCornerSnapshot({
      tlX: newTlX, tlY: newTlY,
      trX: newTrX, trY: newTrY,
      brX: newBrX, brY: newBrY,
      blX: newBlX, blY: newBlY,
    });
  }, [containerSize.w, containerSize.h, imageDimensions, imageSize, initialPolygon]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize({ w: width, h: height });
  }, []);

  // Skia polygon path — reactive to corner drags
  const polygonPath = useDerivedValue(() =>
    `M ${tlX.value} ${tlY.value} ` +
    `L ${trX.value} ${trY.value} ` +
    `L ${brX.value} ${brY.value} ` +
    `L ${blX.value} ${blY.value} Z`
  );

  // Magnifier animations
  const magnifierStyle = useAnimatedStyle(() => {
    const isAtEdge = activeX.value <= 10 || activeX.value >= maxX.value - 10 || activeY.value <= 10 || activeY.value >= maxY.value - 10;
    return {
      opacity: isDragging.value && !isAtEdge ? 1 : 0,
      transform: [
        { translateX: Math.max(60, Math.min(containerSize.w - 60, activeX.value)) - 60 },
        { translateY: activeY.value > 120 ? activeY.value - 140 : activeY.value + 60 },
      ]
    };
  });

  const magInnerStyle = useAnimatedStyle(() => {
    if (!containerSize.w) return {};
    return {
      transform: [
        { translateX: -activeX.value * 2 + 60 },
        { translateY: -activeY.value * 2 + 60 },
      ],
    };
  });

  const handleRotate = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const res = await ImageManipulator.manipulateAsync(
        originalUri,
        [{ rotate: 90 }],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
      );
      setOriginalUri(res.uri);
    } catch (e) {
      console.warn('Rotate error', e);
    }
    setIsProcessing(false);
  };

  const handleReset = () => {
    // Reset to original captured image + original corners + no filter
    setOriginalUri(imageUri);
    setActiveFilter('original');
    setCurrentImageUri(imageUri);
    setShowFilterMenu(false);
    // Corner reinit triggers automatically via imageDimensions useEffect
  };

  const handleConfirm = async () => {
    if (isProcessing || !containerSize.w || !containerSize.h) return;
    setIsProcessing(true);
    try {
      // Get true pixel dimensions via manipulateAsync (Image.getSize on Android
      // can return display-scaled dp values, not actual JPEG pixel count).
      const probe = await ImageManipulator.manipulateAsync(
        currentImageUri, [],
        { compress: 1.0, format: ImageManipulator.SaveFormat.JPEG }
      );
      const imgW = probe.width;
      const imgH = probe.height;

      const cw = containerSize.w;
      const ch = containerSize.h;
      const scale = Math.min(cw / imgW, ch / imgH);
      const oX = (cw - imgW * scale) / 2;
      const oY = (ch - imgH * scale) / 2;

      const snap = cornerSnapshot;
      const allX = [snap.tlX, snap.trX, snap.brX, snap.blX];
      const allY = [snap.tlY, snap.trY, snap.brY, snap.blY];

      let cropX = (Math.min(...allX) - oX) / scale;
      let cropY = (Math.min(...allY) - oY) / scale;
      let cropW = (Math.max(...allX) - Math.min(...allX)) / scale;
      let cropH = (Math.max(...allY) - Math.min(...allY)) / scale;

      cropX = Math.max(0, Math.floor(cropX));
      cropY = Math.max(0, Math.floor(cropY));
      cropW = Math.floor(Math.min(imgW - cropX, cropW));
      cropH = Math.floor(Math.min(imgH - cropY, cropH));
      cropW = Math.max(1, cropW);
      cropH = Math.max(1, cropH);

      const res = await ImageManipulator.manipulateAsync(
        currentImageUri,
        [{ crop: { originX: cropX, originY: cropY, width: cropW, height: cropH } }],
        { compress: 1.0, format: ImageManipulator.SaveFormat.JPEG }
      );

      onSave(res.uri);
    } catch (e) {
      onSave(currentImageUri); // fallback: uncropped
    } finally {
      setIsProcessing(false);
    }
  };
  return (
    <View style={s.container}>
      {/* ── Header: Back + Confirm only ── */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={onRetake} disabled={isProcessing}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
          <Text style={s.backText}>Chụp lại</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.doneBtn} onPress={handleConfirm} disabled={isProcessing}>
          <Text style={s.doneText}>Xác nhận</Text>
          <Ionicons name="checkmark-circle" size={22} color={ACCENT} />
        </TouchableOpacity>
      </View>

      {/* ── Hint ── */}
      <View style={s.hint}>
        <Ionicons name="move-outline" size={14} color="rgba(255,255,255,0.5)" />
        <Text style={s.hintText}>Kéo các góc để căn chỉnh vùng tài liệu</Text>
      </View>

      {/* ── Image Workspace ── */}
      <View style={s.workspace} onLayout={onLayout}>
        {isProcessing && (
          <View style={[StyleSheet.absoluteFill, {zIndex: 10, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)'}]}>
            <ActivityIndicator size="large" color={ACCENT} />
          </View>
        )}
        {containerSize.w > 0 && (
          <>
            <Image
              source={{ uri: currentImageUri }}
              style={StyleSheet.absoluteFill}
              resizeMode="contain"
            />
            <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
              <Path path={polygonPath} style="fill" color="rgba(6,182,212,0.15)" />
              <Path path={polygonPath} style="stroke" strokeWidth={2.5} color={ACCENT} />
            </Canvas>
            <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
              <DraggableCorner x={tlX} y={tlY} maxX={maxX} maxY={maxY} activeX={activeX} activeY={activeY} isDragging={isDragging}
                onSnap={(x, y) => setCornerSnapshot(p => ({ ...p, tlX: x, tlY: y }))}
              />
              <DraggableCorner x={trX} y={trY} maxX={maxX} maxY={maxY} activeX={activeX} activeY={activeY} isDragging={isDragging}
                onSnap={(x, y) => setCornerSnapshot(p => ({ ...p, trX: x, trY: y }))}
              />
              <DraggableCorner x={brX} y={brY} maxX={maxX} maxY={maxY} activeX={activeX} activeY={activeY} isDragging={isDragging}
                onSnap={(x, y) => setCornerSnapshot(p => ({ ...p, brX: x, brY: y }))}
              />
              <DraggableCorner x={blX} y={blY} maxX={maxX} maxY={maxY} activeX={activeX} activeY={activeY} isDragging={isDragging}
                onSnap={(x, y) => setCornerSnapshot(p => ({ ...p, blX: x, blY: y }))}
              />
            </View>
            <Animated.View style={[s.magnifier, magnifierStyle]} pointerEvents="none">
              <View style={s.magnifierCrosshairX} />
              <View style={s.magnifierCrosshairY} />
              <Animated.View style={[{ width: containerSize.w * 2, height: containerSize.h * 2 }, magInnerStyle]}>
                <Image source={{ uri: currentImageUri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
              </Animated.View>
            </Animated.View>
          </>
        )}
      </View>

      {/* ── Bottom Toolbar ── */}
      <View style={s.toolbar}>
        {/* Filter popup menu — renders ABOVE the toolbar when open */}
        {showFilterMenu && (
          <View style={s.filterMenu}>
            {([
              { key: 'original', label: 'Gốc', icon: 'image-outline' },
              { key: 'grayscale', label: 'Xám', icon: 'contrast-outline' },
              { key: 'enhanced', label: 'Nét hơn', icon: 'sunny-outline' },
            ] as const).map(({ key, label, icon }) => (
              <TouchableOpacity
                key={key}
                style={[s.filterMenuItem, activeFilter === key && s.filterMenuItemActive]}
                onPress={() => { setActiveFilter(key); setShowFilterMenu(false); }}
              >
                <Ionicons name={icon} size={18} color={activeFilter === key ? '#fbbf24' : 'rgba(255,255,255,0.7)'} />
                <Text style={[s.filterMenuText, activeFilter === key && s.filterMenuTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Toolbar row: Xoay | Đặt lại | Lọc ảnh */}
        <View style={{ flexDirection: 'row' }}>
          <TouchableOpacity style={s.toolbarBtn} onPress={handleRotate} disabled={isProcessing}>
            <Ionicons name="refresh" size={22} color="#fff" />
            <Text style={s.toolbarBtnText}>Xoay</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.toolbarBtn} onPress={handleReset} disabled={isProcessing}>
            <Ionicons name="reload-circle-outline" size={22} color="rgba(255,255,255,0.7)" />
            <Text style={s.toolbarBtnText}>Đặt lại</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.toolbarBtn, showFilterMenu && s.toolbarBtnActive]}
            onPress={() => setShowFilterMenu(v => !v)}
          >
            <Ionicons
              name={activeFilter === 'original' ? 'color-wand-outline' : activeFilter === 'grayscale' ? 'contrast-outline' : 'sunny-outline'}
              size={22}
              color={activeFilter !== 'original' ? '#fbbf24' : 'rgba(255,255,255,0.7)'}
            />
            <Text style={[s.toolbarBtnText, activeFilter !== 'original' && { color: '#fbbf24' }]}>
              {activeFilter === 'original' ? 'Lọc ảnh' : activeFilter === 'grayscale' ? 'Xám' : 'Nét hơn'}
            </Text>
            <Ionicons name={showFilterMenu ? 'chevron-down' : 'chevron-up'} size={14} color="rgba(255,255,255,0.4)" />
          </TouchableOpacity>
        </View>

      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0d' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4 },
  backText: { color: '#fff', fontSize: 15 },
  rotateBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4 },
  rotateText: { color: '#fff', fontSize: 15, fontWeight: '500' },
  doneBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 4 },
  doneText: { color: ACCENT, fontSize: 15, fontWeight: '700' },

  // Hint
  hint: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  hintText: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },

  // Workspace
  workspace: { flex: 1, backgroundColor: '#000', position: 'relative' },
  grayscaleOverlay: {
    backgroundColor: 'rgba(0,0,0,0)',
    // Simulate grayscale with a white+black blend trick
    opacity: 0.0,
  },

  // Corner Handle
  cornerWrap: {
    position: 'absolute', width: HANDLE, height: HANDLE,
    justifyContent: 'center', alignItems: 'center',
  },
  cornerOuter: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 2, borderColor: ACCENT,
    justifyContent: 'center', alignItems: 'center',
  },
  cornerDot: {
    width: DOT, height: DOT, borderRadius: DOT / 2,
    backgroundColor: ACCENT,
  },

  // Magnifier
  magnifier: {
    position: 'absolute',
    left: 0, top: 0,
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 3, borderColor: ACCENT,
    overflow: 'hidden', backgroundColor: '#000',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.5, shadowRadius: 10,
    elevation: 10,
    zIndex: 9999,
  },
  magnifierCrosshairX: {
    position: 'absolute', left: 55, top: 0, width: 4, height: 120, backgroundColor: 'rgba(6,182,212,0.4)', zIndex: 10,
  },
  magnifierCrosshairY: {
    position: 'absolute', left: 0, top: 55, width: 120, height: 4, backgroundColor: 'rgba(6,182,212,0.4)', zIndex: 10,
  },

  // Bottom Toolbar
  toolbar: {
    backgroundColor: '#0f0f12',
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
    paddingBottom: 6,
  },
  toolbarBtn: {
    flex: 1,
    flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 12,
    // rendered inside a row via the toolbar row layout below
  },
  toolbarBtnActive: {
    backgroundColor: 'rgba(6,182,212,0.08)',
  },
  toolbarBtnText: {
    color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '600',
  },

  // Filter popup menu (floats above toolbar)
  filterMenu: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#1a1a20',
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
  },
  filterMenuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  filterMenuItemActive: {
    backgroundColor: 'rgba(251,191,36,0.12)',
    borderColor: 'rgba(251,191,36,0.35)',
  },
  filterMenuText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' },
  filterMenuTextActive: { color: '#fbbf24' },
});

