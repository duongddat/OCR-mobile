import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  Dimensions,
  Image as RNImage,
  ActivityIndicator,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  SharedValue,
  useDerivedValue,
} from 'react-native-reanimated';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import { OpenCV, ObjectType } from 'react-native-fast-opencv';
import type { DocCorners } from './CustomScanner';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

interface Point { x: number; y: number }

interface DisplayRect {
  displayW: number;
  displayH: number;
  offsetX: number;
  offsetY: number;
}

interface HandleBounds {
  minX: number; maxX: number;
  minY: number; maxY: number;
}

interface CropEditorProps {
  imageUri: string;
  initialCorners?: DocCorners;
  photoAspect?: number;
  frameAspect?: number;
  onCancel: () => void;
  onConfirm: (croppedUri: string) => void;
}

const HANDLE_SIZE = 44;
const PAD         = 36;
const HEADER_H    = 68;

function getContainRect(imgW: number, imgH: number): DisplayRect {
  const imgAspect    = imgW / imgH;
  const screenAspect = SCREEN_W / SCREEN_H;
  if (imgAspect > screenAspect) {
    const displayW = SCREEN_W;
    const displayH = SCREEN_W / imgAspect;
    return { displayW, displayH, offsetX: 0, offsetY: (SCREEN_H - displayH) / 2 };
  } else {
    const displayH = SCREEN_H;
    const displayW = SCREEN_H * imgAspect;
    return { displayW, displayH, offsetX: (SCREEN_W - displayW) / 2, offsetY: 0 };
  }
}

function normalizedToScreen(norm: Point, rect: DisplayRect, bounds: HandleBounds): Point {
  return {
    x: Math.min(Math.max(norm.x * rect.displayW + rect.offsetX, bounds.minX), bounds.maxX),
    y: Math.min(Math.max(norm.y * rect.displayH + rect.offsetY, bounds.minY), bounds.maxY),
  };
}

function buildPath(tlP: Point, trP: Point, brP: Point, blP: Point) {
  const p = Skia.Path.Make();
  p.moveTo(tlP.x, tlP.y); p.lineTo(trP.x, trP.y);
  p.lineTo(brP.x, brP.y); p.lineTo(blP.x, blP.y);
  p.close();
  return p;
}

/**
 * Parse JPEG EXIF orientation tag from a base64-encoded JPEG.
 * Returns: 1=normal, 3=180°, 6=90°CW, 8=90°CCW (270°CW)
 * Any other value → treat as 1 (no rotation).
 */
function parseJpegOrientation(b64: string): number {
  try {
    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const MAX   = 2048; // Only need first ~2 KB to reach EXIF data
    const bytes = new Uint8Array(MAX);
    let ptr = 0;
    for (let i = 0; i < b64.length && ptr < MAX; i += 4) {
      const a = CHARS.indexOf(b64[i]);
      const b = CHARS.indexOf(b64[i + 1]);
      const c = CHARS.indexOf(b64[i + 2]);
      const d = CHARS.indexOf(b64[i + 3]);
      if (a < 0 || b < 0) break;
      bytes[ptr++] = (a << 2) | (b >> 4);
      if (c >= 0 && ptr < MAX) bytes[ptr++] = ((b & 0xF) << 4) | (c >> 2);
      if (d >= 0 && ptr < MAX) bytes[ptr++] = ((c & 0x3) << 6) | d;
    }
    // JPEG SOI must start with FF D8
    if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return 1;
    let off = 2;
    while (off + 4 < bytes.length) {
      if (bytes[off] !== 0xFF) break;
      const marker = bytes[off + 1];
      const segLen = (bytes[off + 2] << 8) | bytes[off + 3];
      if (marker === 0xE1) { // APP1 — may contain EXIF
        // 'Exif\0\0' starts at off+4
        if (bytes[off+4]===0x45 && bytes[off+5]===0x78 &&
            bytes[off+6]===0x69 && bytes[off+7]===0x66) {
          const tiff = off + 10;
          const le   = bytes[tiff] === 0x49; // 'II' = little-endian; 'MM' = big-endian
          const r16  = (o: number) => le ? bytes[o] | (bytes[o+1] << 8)
                                        : (bytes[o] << 8) | bytes[o+1];
          const r32  = (o: number) => le
            ? bytes[o] | (bytes[o+1]<<8) | (bytes[o+2]<<16) | (bytes[o+3]<<24)
            : (bytes[o]<<24) | (bytes[o+1]<<16) | (bytes[o+2]<<8) | bytes[o+3];
          const ifdOff   = r32(tiff + 4);
          const ifd0     = tiff + ifdOff;
          const entries  = r16(ifd0);
          for (let j = 0; j < entries; j++) {
            const e = ifd0 + 2 + j * 12;
            if (r16(e) === 0x0112) return r16(e + 8); // Orientation tag
          }
        }
      }
      off += 2 + segLen;
    }
  } catch {}
  return 1;
}

/** Maps EXIF orientation → OpenCV rotate code (0=90CW, 1=180, 2=90CCW). Returns null if no rotation needed. */
function exifToRotateCode(orientation: number): 0 | 1 | 2 | null {
  if (orientation === 6) return 0;
  if (orientation === 3) return 1;
  if (orientation === 8) return 2;
  return null;
}

interface HandleProps { position: SharedValue<Point>; bounds: HandleBounds }

const Handle = ({ position, bounds }: HandleProps) => {
  const { minX, maxX, minY, maxY } = bounds;
  const pan = Gesture.Pan().onChange((e) => {
    'worklet';
    position.value = {
      x: Math.min(Math.max(position.value.x + e.changeX, minX), maxX),
      y: Math.min(Math.max(position.value.y + e.changeY, minY), maxY),
    };
  });
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: position.value.x - HANDLE_SIZE / 2 },
      { translateY: position.value.y - HANDLE_SIZE / 2 },
    ],
  }));
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[s.handleWrap, style]}>
        <View style={s.handleOuter}><View style={s.handleInner} /></View>
      </Animated.View>
    </GestureDetector>
  );
};

export default function CropEditor({
  imageUri, initialCorners, onCancel, onConfirm,
}: CropEditorProps) {
  const insets = useSafeAreaInsets();

  const [displayRect, setDisplayRect] = React.useState<DisplayRect | null>(null);
  const [imageSize,   setImageSize]   = React.useState<{ width: number; height: number } | null>(null);
  const [isCropping,  setIsCropping]  = React.useState(false);
  const cornersPositioned             = React.useRef(false);
  const headerBottom                  = insets.top + HEADER_H;

  const tl = useSharedValue<Point>({ x: PAD,            y: Math.max(PAD, headerBottom + 8) });
  const tr = useSharedValue<Point>({ x: SCREEN_W - PAD, y: Math.max(PAD, headerBottom + 8) });
  const br = useSharedValue<Point>({ x: SCREEN_W - PAD, y: SCREEN_H - PAD * 3 });
  const bl = useSharedValue<Point>({ x: PAD,            y: SCREEN_H - PAD * 3 });

  const [handleBounds, setHandleBounds] = React.useState<HandleBounds>({
    minX: 0, maxX: SCREEN_W, minY: headerBottom, maxY: SCREEN_H,
  });

  const onImageLoad = React.useCallback(
    (e: { nativeEvent: { source: { width: number; height: number } } }) => {
      const { width: imgW, height: imgH } = e.nativeEvent.source;
      setImageSize({ width: imgW, height: imgH });
      setDisplayRect(getContainRect(imgW, imgH));
    },
    [],
  );

  React.useEffect(() => {
    if (!displayRect || cornersPositioned.current) return;
    cornersPositioned.current = true;

    const { displayW, displayH, offsetX, offsetY } = displayRect;
    const bounds: HandleBounds = {
      minX: offsetX,
      maxX: offsetX + displayW,
      minY: Math.max(offsetY, headerBottom + 8),
      maxY: offsetY + displayH,
    };
    setHandleBounds(bounds);

    if (initialCorners) {
      // initialCorners are in photo space (0-1) — map directly into contain-rect screen space
      tl.value = normalizedToScreen(initialCorners.tl, displayRect, bounds);
      tr.value = normalizedToScreen(initialCorners.tr, displayRect, bounds);
      br.value = normalizedToScreen(initialCorners.br, displayRect, bounds);
      bl.value = normalizedToScreen(initialCorners.bl, displayRect, bounds);
    } else {
      tl.value = { x: offsetX + PAD,            y: bounds.minY };
      tr.value = { x: offsetX + displayW - PAD, y: bounds.minY };
      br.value = { x: offsetX + displayW - PAD, y: offsetY + displayH - PAD };
      bl.value = { x: offsetX + PAD,            y: offsetY + displayH - PAD };
    }
  }, [displayRect]);

  const path = useDerivedValue(() => {
    const p = Skia.Path.Make();
    p.moveTo(tl.value.x, tl.value.y); p.lineTo(tr.value.x, tr.value.y);
    p.lineTo(br.value.x, br.value.y); p.lineTo(bl.value.x, bl.value.y);
    p.close();
    return p;
  }, [tl, tr, br, bl]);

  /**
   * Perspective warp pipeline:
   *  1. Read JPEG → base64
   *  2. base64ToMat (raw pixel data, no EXIF)
   *  3. Parse EXIF orientation from base64, rotate Mat to match display
   *  4. Screen handle positions → image pixel coords (in corrected space)
   *  5. getPerspectiveTransform + warpPerspective
   *  6. saveMatToFile → return URI
   */
  const handleCrop = async () => {
    if (!imageSize || !displayRect) { onConfirm(imageUri); return; }
    setIsCropping(true);
    const ids: string[] = [];

    try {
      // Step 1: Read JPEG to base64
      const b64 = await FileSystem.readAsStringAsync(imageUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Step 2: Load raw Mat — orientation may differ from what RNImage shows
      const srcMat = OpenCV.base64ToMat(b64);
      ids.push(srcMat.id);

      // Step 3: Determine true Mat dimensions via a 1-pixel probe.
      // matToBuffer returns { rows, cols } reliably without needing the full pixel array.
      // We read only 1 "pixel" width of data to keep it cheap.
      const probe = OpenCV.matToBuffer(srcMat, 'uint8');
      const matW = probe.cols;   // true width  of raw JPEG pixel data
      const matH = probe.rows;   // true height of raw JPEG pixel data
      console.log('[CropEditor] matW×matH:', matW, matH, '  onLoad imgW×imgH:', imageSize.width, imageSize.height);

      // Step 4: Decide which displayRect the handles were actually drawn in.
      //
      // React Native Image may report onLoad dimensions that are either:
      //  (a) EXIF-corrected (portrait: 3000×4000) → same as mat is NOT (mat is landscape 4000×3000)
      //  (b) Raw file dims   (landscape: 4000×3000) → matches mat exactly
      //
      // We detect the mismatch: if imageSize matches mat dims, use imageSize as-is.
      // If imageSize is the SWAPPED version of mat dims, swap back for coordinate mapping.
      const imgMatchesMat = (imageSize.width === matW && imageSize.height === matH);
      const imgIsSwapped  = (imageSize.width === matH && imageSize.height === matW);

      // The "display" dims used by RNImage (what the user sees):
      // RNImage always shows EXIF-corrected dims. If onLoad gave raw (matches mat),
      // we need the corrected dims for mapping; if onLoad gave corrected, use directly.
      const dispW = imgMatchesMat ? matH : imageSize.width;   // swap if raw
      const dispH = imgMatchesMat ? matW : imageSize.height;

      // Recompute contain-rect for the actual DISPLAYED dimensions
      const effectiveRect = getContainRect(dispW, dispH);

      // Normalize handle positions to [0,1] relative to displayed image
      const normHandle = (p: Point) => ({
        nx: (p.x - effectiveRect.offsetX) / effectiveRect.displayW,
        ny: (p.y - effectiveRect.offsetY) / effectiveRect.displayH,
      });

      // Step 5: Map normalized coords → raw Mat pixel coords
      // If mat is landscape (4000×3000) but display is portrait (3000×4000),
      // we need to invert the 90°CW rotation: display(nx,ny) → mat(y_raw,x_raw)
      // For EXIF=6 (rotate 90°CW to display): mat_x = ny*matW, mat_y = (1-nx)*matH
      // For EXIF=8 (rotate 90°CCW):           mat_x = (1-ny)*matW, mat_y = nx*matH
      // For EXIF=3 (rotate 180°):             mat_x = (1-nx)*matW, mat_y = (1-ny)*matH
      // For EXIF=1 (no rotation):             mat_x = nx*matW, mat_y = ny*matH

      const orientation = parseJpegOrientation(b64);
      console.log('[CropEditor] EXIF orientation:', orientation, '  imgMatchesMat:', imgMatchesMat, '  imgIsSwapped:', imgIsSwapped);

      const toMatCoord = (p: Point): Point => {
        const { nx, ny } = normHandle(p);
        // If mat dims match imageSize dims → no EXIF rotation needed
        if (imgMatchesMat && orientation === 1) {
          return { x: Math.round(nx * matW), y: Math.round(ny * matH) };
        }
        // Use EXIF orientation to invert the display rotation
        if (orientation === 6) {
          // Display = rotate mat 90°CW. Inverse: mat_x = ny*matW, mat_y=(1-nx)*matH
          return { x: Math.round(ny * matW), y: Math.round((1 - nx) * matH) };
        }
        if (orientation === 8) {
          // Display = rotate mat 90°CCW. Inverse: mat_x=(1-ny)*matW, mat_y=nx*matH
          return { x: Math.round((1 - ny) * matW), y: Math.round(nx * matH) };
        }
        if (orientation === 3) {
          // Display = rotate mat 180°. Inverse: mat_x=(1-nx)*matW, mat_y=(1-ny)*matH
          return { x: Math.round((1 - nx) * matW), y: Math.round((1 - ny) * matH) };
        }
        // Fallback: no rotation (orientation=1 or unknown), or dims already match
        return { x: Math.round(nx * matW), y: Math.round(ny * matH) };
      };

      const pTl = toMatCoord(tl.value);
      const pTr = toMatCoord(tr.value);
      const pBr = toMatCoord(br.value);
      const pBl = toMatCoord(bl.value);

      console.log('[CropEditor] mat corners:', { pTl, pTr, pBr, pBl });

      // Step 6: Compute output size from polygon edge lengths
      const maxW = Math.round(Math.max(
        Math.hypot(pTr.x - pTl.x, pTr.y - pTl.y),
        Math.hypot(pBr.x - pBl.x, pBr.y - pBl.y),
      ));
      const maxH = Math.round(Math.max(
        Math.hypot(pBl.x - pTl.x, pBl.y - pTl.y),
        Math.hypot(pBr.x - pTr.x, pBr.y - pTr.y),
      ));

      console.log('[CropEditor] output size:', { maxW, maxH });

      if (maxW < 10 || maxH < 10) {
        console.warn('[CropEditor] output too small, returning original');
        onConfirm(imageUri);
        return;
      }

      const mkPt = (x: number, y: number) => {
        const o = OpenCV.createObject('point2f' as ObjectType.Point2f, x, y);
        ids.push(o.id);
        return o;
      };

      const srcPts = OpenCV.createObject(
        'point2f_vector' as ObjectType.Point2fVector,
        [mkPt(pTl.x, pTl.y), mkPt(pTr.x, pTr.y), mkPt(pBr.x, pBr.y), mkPt(pBl.x, pBl.y)],
      );
      ids.push(srcPts.id);

      const dstPts = OpenCV.createObject(
        'point2f_vector' as ObjectType.Point2fVector,
        [mkPt(0, 0), mkPt(maxW - 1, 0), mkPt(maxW - 1, maxH - 1), mkPt(0, maxH - 1)],
      );
      ids.push(dstPts.id);

      const dstSize = OpenCV.createObject('size' as ObjectType.Size, maxW, maxH);
      ids.push(dstSize.id);

      const matrix = OpenCV.invoke('getPerspectiveTransform', srcPts, dstPts, 0) as any;
      ids.push(matrix.id);

      const warpedMat = OpenCV.createObject('mat' as ObjectType.Mat, 0, 0, 0);
      ids.push(warpedMat.id);

      const border = OpenCV.createObject('scalar' as ObjectType.Scalar, 0, 0, 0, 0);
      ids.push(border.id);

      // Step 7: Perspective warp on RAW mat (no pre-rotation needed)
      OpenCV.invoke('warpPerspective', srcMat, warpedMat, matrix, dstSize, 1, 0, border);

      // Step 8: Save result
      const outPath = `${(FileSystem as any).cacheDirectory}crop_${Date.now()}.jpg`.replace('file://', '');
      OpenCV.saveMatToFile(warpedMat, outPath, 'jpeg', 0.92);

      const outUri = `file://${outPath}`;
      console.log('[CropEditor] saved to:', outUri);
      onConfirm(outUri);
    } catch (e) {
      console.error('[CropEditor] warp failed:', e);
      onConfirm(imageUri);
    } finally {
      setIsCropping(false);
      try { OpenCV.clearBuffers(ids); } catch {}
    }
  };



  return (
    <GestureHandlerRootView style={s.container}>
      <RNImage
        source={{ uri: imageUri }}
        style={StyleSheet.absoluteFill}
        resizeMode="contain"
        onLoad={onImageLoad}
      />

      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path path={path} color="rgba(6,182,212,0.15)" style="fill" />
        <Path path={path} color="#06b6d4" style="stroke" strokeWidth={2.5} />
      </Canvas>

      <Handle position={tl} bounds={handleBounds} />
      <Handle position={tr} bounds={handleBounds} />
      <Handle position={br} bounds={handleBounds} />
      <Handle position={bl} bounds={handleBounds} />

      <View style={[s.header, { top: insets.top + 12 }]}>
        <TouchableOpacity style={s.headerBtn} onPress={onCancel} disabled={isCropping}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
          <Text style={s.headerBtnText}>Huỷ</Text>
        </TouchableOpacity>

        <Text style={s.headerTitle}>Căn chỉnh tài liệu</Text>

        <TouchableOpacity
          style={[s.headerBtn, s.headerBtnConfirm, isCropping && s.btnDisabled]}
          onPress={handleCrop}
          disabled={isCropping}
        >
          {isCropping
            ? <ActivityIndicator size="small" color="#0a0a0d" />
            : <>
                <Ionicons name="checkmark" size={20} color="#0a0a0d" />
                <Text style={[s.headerBtnText, { color: '#0a0a0d' }]}>Xong</Text>
              </>
          }
        </TouchableOpacity>
      </View>

      <View style={[s.badge, { bottom: insets.bottom + 32 }]}>
        <Ionicons name="move-outline" size={15} color="rgba(255,255,255,0.7)" />
        <Text style={s.badgeText}>Kéo các góc để căn chỉnh vùng crop</Text>
      </View>
    </GestureHandlerRootView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    position: 'absolute', left: 12, right: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 22, zIndex: 10,
  },
  headerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
  },
  headerBtnConfirm: {
    backgroundColor: '#06b6d4', borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 6,
    minWidth: 72, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 4,
  },
  btnDisabled:    { opacity: 0.5 },
  headerBtnText:  { color: '#fff', fontSize: 15, fontWeight: '600' },
  headerTitle:    { color: '#fff', fontSize: 15, fontWeight: '700' },
  handleWrap: {
    position: 'absolute', width: HANDLE_SIZE, height: HANDLE_SIZE,
    justifyContent: 'center', alignItems: 'center', zIndex: 5,
  },
  handleOuter: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 3, borderColor: '#06b6d4',
    backgroundColor: 'rgba(6,182,212,0.15)',
    justifyContent: 'center', alignItems: 'center',
  },
  handleInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#06b6d4' },
  badge: {
    position: 'absolute', alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16,
  },
  badgeText: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '500' },
});