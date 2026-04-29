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
 
const FOCUS_THROTTLE = 2000; // ms — tăng lên 2s để camera ổn định hơn khi đã phát hiện tài liệu
 
// ─── Types ────────────────────────────────────────────────────────────────
 
export interface DocCorners {
  tl: { x: number; y: number };
  tr: { x: number; y: number };
  br: { x: number; y: number };
  bl: { x: number; y: number };
}
 
export type ScanTarget = 'document' | 'card';

interface CustomScannerProps {
  onCapture: (uri: string, corners?: any[], type?: ScanTarget) => void;
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

// ─── Rectangle validator ──────────────────────────────────────────────────
// Chạy được trên cả worklet lẫn JS thread.
// Ba tiêu chí loại bỏ hình tam giác / hình thoi / vùng chữ:
//   1. Hai cặp cạnh đối phải GẦN SONG SONG  → loại hình tam giác, hình chéo
//   2. Bốn góc xấp xỉ VUÔNG                 → loại hình thoi, hình bình hành
//   3. Tỷ lệ khung phù hợp target            → loại bỏ contour chữ / nhiễu

function isRectLike(
  tl: { x: number; y: number },
  tr: { x: number; y: number },
  br: { x: number; y: number },
  bl: { x: number; y: number },
  imgW: number,
  imgH: number,
  target: 'document' | 'card',
): boolean {
  'worklet';
  // Chuyển sang pixel
  const P = [
    { x: tl.x * imgW, y: tl.y * imgH },
    { x: tr.x * imgW, y: tr.y * imgH },
    { x: br.x * imgW, y: br.y * imgH },
    { x: bl.x * imgW, y: bl.y * imgH },
  ];

  // Các vector cạnh theo thứ tự: tl→tr (top), tr→br (right), br→bl (bottom), bl→tl (left)
  const S = [
    { x: P[1].x - P[0].x, y: P[1].y - P[0].y }, // top
    { x: P[2].x - P[1].x, y: P[2].y - P[1].y }, // right
    { x: P[3].x - P[2].x, y: P[3].y - P[2].y }, // bottom
    { x: P[0].x - P[3].x, y: P[0].y - P[3].y }, // left
  ];
  const L = S.map((s) => Math.sqrt(s.x * s.x + s.y * s.y));

  // Cạnh quá ngắn → không phải đối tượng thực
  const minSide = target === 'card' ? 10 : 15;
  if (L.some((l) => l < minSide)) return false;

  // ── 1. SONG SONG: top ↔ bottom, right ↔ left ─────────────────────────
  // dot(unit(top), unit(-bottom)) > threshold  → hai cạnh đối gần song song
  const dot2D = (
    ax: number, ay: number, al: number,
    bx: number, by: number, bl2: number,
  ) => (ax * bx + ay * by) / (al * bl2);

  const parallelTB = dot2D(S[0].x, S[0].y, L[0], -S[2].x, -S[2].y, L[2]);
  const parallelRL = dot2D(S[1].x, S[1].y, L[1], -S[3].x, -S[3].y, L[3]);
  
  // Nới lỏng độ song song để dễ bắt tài liệu khi cầm điện thoại nghiêng (perspective distortion)
  // 0.65 = cho phép nghiêng tới ~49° (rất dễ bắt)
  const minParallel = target === 'card' ? 0.85 : 0.65;
  if (parallelTB < minParallel || parallelRL < minParallel) return false;

  // ── 2. VUÔNG GÓC: các cặp cạnh liền kề ──────────────────────────────
  // Nới lỏng để chấp nhận các góc nhọn/tù do phối cảnh (hình thang)
  // doc: |cosA| < 0.55 → góc cho phép từ 56° đến 124° (rất linh hoạt)
  const maxCos = target === 'card' ? 0.40 : 0.55;
  for (let i = 0; i < 4; i++) {
    const a = S[i], b = S[(i + 1) % 4];
    const lenA = L[i], lenB = L[(i + 1) % 4];
    if (lenA < 1 || lenB < 1) return false;
    const cosA = (a.x * b.x + a.y * b.y) / (lenA * lenB);
    if (Math.abs(cosA) > maxCos) return false;
  }

  // ── 3. TỶ LỆ KHUNG ───────────────────────────────────────────────────
  const w = (L[0] + L[2]) / 2; // trung bình cạnh ngang (top + bottom)
  const h = (L[1] + L[3]) / 2; // trung bình cạnh dọc (right + left)
  if (w < minSide || h < minSide) return false;

  // Chuẩn hoá về landscape để so sánh
  const aspect = w > h ? w / h : h / w;

  if (target === 'card') {
    // Thẻ chuẩn ISO ID-1: 85.6 × 54 mm → 1.586
    // Giới hạn 1.35 – 1.80 để loại bỏ hình vuông hoặc quá dài
    return aspect >= 1.35 && aspect <= 1.80;
  }
  // Tài liệu: A4=1.414, Letter=1.294, A5=1.5, hoá đơn dài...
  // → cho phép 1.0 – 3.0
  return aspect >= 1.0 && aspect <= 3.0;
}

// ─── OpenCV detection (worklet) ───────────────────────────────────────────
 
function detectDocument(
  src: any,
  imgW: number,
  imgH: number,
  channels: number = 4,
  minAreaRatio: number = 0.06,
  target: 'document' | 'card' = 'document',  // ✅ FIX: thêm tham số target
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
    const ksize = OpenCV.createObject('size' as ObjectType.Size, 5, 5);
    ids.push(ksize.id);

    // BUG-01 FIX: convertScaleAbs KHÔNG hỗ trợ in-place → dùng mat riêng
    let srcForBlur = gray;
    if (target === 'card') {
      const contrasted = OpenCV.createObject('mat' as ObjectType.Mat, imgH, imgW, 0);
      ids.push(contrasted.id);
      OpenCV.invoke('convertScaleAbs', gray, contrasted, 1.5, 0);
      srcForBlur = contrasted;
    }

    OpenCV.invoke('GaussianBlur', srcForBlur, blurred, ksize, 0);
 
    const edges = OpenCV.createObject('mat' as ObjectType.Mat, imgH, imgW, 0);
    ids.push(edges.id);
    // Thẻ thường có nền trắng/sáng trên bàn tối → giảm ngưỡng Canny
    const cannyLow  = target === 'card' ? 20 : 30;
    const cannyHigh = target === 'card' ? 80 : 100;
    OpenCV.invoke('Canny', blurred, edges, cannyLow, cannyHigh);
 
    const kernelSize = OpenCV.createObject('size' as ObjectType.Size, 5, 5);
    ids.push(kernelSize.id);
    const kernel = OpenCV.invoke(
      'getStructuringElement',
      0 as MorphShapes.MORPH_RECT,
      kernelSize,
    ) as any;
    ids.push(kernel.id);
 
    const closed = OpenCV.createObject('mat' as ObjectType.Mat, imgH, imgW, 0);
    ids.push(closed.id);
    OpenCV.invoke('morphologyEx', edges, closed, 3 as MorphTypes.MORPH_CLOSE, kernel);

    // CR-01 FIX: morphologyEx in-place không được hỗ trợ → dùng mat riêng cho dilate
    let edgeMask = closed;
    if (target === 'card') {
      const dilateSize = OpenCV.createObject('size' as ObjectType.Size, 3, 3);
      ids.push(dilateSize.id);
      const dilateKernel = OpenCV.invoke(
        'getStructuringElement',
        0 as MorphShapes.MORPH_RECT,
        dilateSize,
      ) as any;
      ids.push(dilateKernel.id);
      const dilated = OpenCV.createObject('mat' as ObjectType.Mat, imgH, imgW, 0);
      ids.push(dilated.id);
      OpenCV.invoke('morphologyEx', closed, dilated, 1 as MorphTypes.MORPH_DILATE, dilateKernel);
      edgeMask = dilated;
    }
 
    const contours = OpenCV.createObject('mat_vector' as ObjectType.MatVector);
    ids.push(contours.id);
    OpenCV.invoke(
      'findContours', edgeMask, contours,
      0 as RetrievalModes.RETR_EXTERNAL,
      2 as ContourApproximationModes.CHAIN_APPROX_SIMPLE,
    );
 
    const contourJs = OpenCV.toJSValue(contours) as { array: any[] };
    const count     = contourJs.array.length;
    const minArea   = imgW * imgH * minAreaRatio;
    // BUG-02 FIX: card maxArea 0.55 (thẻ không bao giờ chiếm >55% frame)
    // document maxArea 0.90 (giấy có thể gần full frame)
    const maxArea   = imgW * imgH * (target === 'card' ? 0.55 : 0.90);
    let best: DocCorners | null = null;
    let bestArea = 0;
 
    for (let i = 0; i < count; i++) {
      const contour = OpenCV.copyObjectFromVector(contours, i);
      ids.push(contour.id);
 
      const area = (OpenCV.invoke('contourArea', contour) as { value: number }).value;
      if (area <= minArea || area >= maxArea || area <= bestArea) continue;
 
      const peri = (OpenCV.invoke('arcLength', contour, true) as { value: number }).value;
      const approx = OpenCV.createObject('mat' as ObjectType.Mat, 0, 0, 0);
      ids.push(approx.id);
      
      // WARN-03 FIX: card cần epsilon nhỏ (cạnh thẳng cứng), doc dùng epsilon lớn hơn (giấy cong)
      const epsilons = target === 'card'
        ? [0.02, 0.03, 0.04, 0.05]
        : [0.02, 0.035, 0.05, 0.065, 0.08, 0.10, 0.13];
      let numPts = 999;
      let buf: any = null;

      for (let ei = 0; ei < epsilons.length; ei++) {
        OpenCV.invoke('approxPolyDP', contour, approx, epsilons[ei] * peri, true);
        buf = OpenCV.matToBuffer(approx, 'int32');
        numPts = buf.rows; // rows = số điểm (approxPolyDP trả N×1×2)
        if (numPts <= 4) break;
      }

      // STRICT: chỉ chấp nhận đúng 4 điểm + đủ buffer
      if (numPts !== 4 || !buf || buf.buffer.length < 8) continue;

      // Sắp xếp 4 góc theo thứ tự tl / tr / br / bl
      const raw: { x: number; y: number }[] = [
        { x: buf.buffer[0] / imgW, y: buf.buffer[1] / imgH },
        { x: buf.buffer[2] / imgW, y: buf.buffer[3] / imgH },
        { x: buf.buffer[4] / imgW, y: buf.buffer[5] / imgH },
        { x: buf.buffer[6] / imgW, y: buf.buffer[7] / imgH },
      ];
      raw.sort((a, b) => (a.x + a.y) - (b.x + b.y));
      const tl = raw[0];
      const br = raw[3];
      raw.sort((a, b) => (a.x - a.y) - (b.x - b.y));
      const bl = raw[0];
      const tr = raw[3];

      // Xác thực hình chữ nhật: song song + vuông góc + tỷ lệ đúng
      if (!isRectLike(tl, tr, br, bl, imgW, imgH, target)) continue;  // ✅ FIX: truyền đúng target

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
  minAreaRatio = 0.06,
  target: 'document' | 'card' = 'document',
): DocCorners | null {
  const ids: string[] = [];
  const cleanup = () => { try { OpenCV.releaseBuffers(ids); } catch {} };
 
  try {
    const gray = OpenCV.createObject('mat' as ObjectType.Mat, imgH, imgW, 0);
    ids.push(gray.id);
    OpenCV.invoke('cvtColor', src, gray, channels === 3 ? 7 : 11);
 
    const blurred = OpenCV.createObject('mat' as ObjectType.Mat, imgH, imgW, 0);
    ids.push(blurred.id);
    const ksize = OpenCV.createObject('size' as ObjectType.Size, 5, 5);
    ids.push(ksize.id);

    // BUG-01 FIX: convertScaleAbs KHÔNG hỗ trợ in-place → dùng mat riêng
    let srcForBlur = gray;
    if (target === 'card') {
      const contrasted = OpenCV.createObject('mat' as ObjectType.Mat, imgH, imgW, 0);
      ids.push(contrasted.id);
      OpenCV.invoke('convertScaleAbs', gray, contrasted, 1.5, 0);
      srcForBlur = contrasted;
    }

    OpenCV.invoke('GaussianBlur', srcForBlur, blurred, ksize, 0);
 
    const edges = OpenCV.createObject('mat' as ObjectType.Mat, imgH, imgW, 0);
    ids.push(edges.id);
    const cannyLow  = target === 'card' ? 20 : 30;
    const cannyHigh = target === 'card' ? 80 : 100;
    OpenCV.invoke('Canny', blurred, edges, cannyLow, cannyHigh);
 
    const kernelSize = OpenCV.createObject('size' as ObjectType.Size, 5, 5);
    ids.push(kernelSize.id);
    const kernel = OpenCV.invoke(
      'getStructuringElement',
      0 as MorphShapes.MORPH_RECT,
      kernelSize,
    ) as any;
    ids.push(kernel.id);
 
    const closed = OpenCV.createObject('mat' as ObjectType.Mat, imgH, imgW, 0);
    ids.push(closed.id);
    OpenCV.invoke('morphologyEx', edges, closed, 3 as MorphTypes.MORPH_CLOSE, kernel);

    // CR-01 FIX: morphologyEx in-place không được hỗ trợ → dùng mat riêng
    let edgeMask = closed;
    if (target === 'card') {
      const dilateSize = OpenCV.createObject('size' as ObjectType.Size, 3, 3);
      ids.push(dilateSize.id);
      const dilateKernel = OpenCV.invoke(
        'getStructuringElement',
        0 as MorphShapes.MORPH_RECT,
        dilateSize,
      ) as any;
      ids.push(dilateKernel.id);
      const dilated = OpenCV.createObject('mat' as ObjectType.Mat, imgH, imgW, 0);
      ids.push(dilated.id);
      OpenCV.invoke('morphologyEx', closed, dilated, 1 as MorphTypes.MORPH_DILATE, dilateKernel);
      edgeMask = dilated;
    }
 
    const contours = OpenCV.createObject('mat_vector' as ObjectType.MatVector);
    ids.push(contours.id);
    OpenCV.invoke(
      'findContours', edgeMask, contours,
      0 as RetrievalModes.RETR_EXTERNAL,
      2 as ContourApproximationModes.CHAIN_APPROX_SIMPLE,
    );
 
    const contourJs = OpenCV.toJSValue(contours) as { array: any[] };
    const count     = contourJs.array.length;
    const minArea   = imgW * imgH * minAreaRatio;
    // BUG-02 FIX: card maxArea 0.55, document 0.90
    const maxArea   = imgW * imgH * (target === 'card' ? 0.55 : 0.90);
    let best: DocCorners | null = null;
    let bestArea = 0;
 
    for (let i = 0; i < count; i++) {
      const contour = OpenCV.copyObjectFromVector(contours, i);
      ids.push(contour.id);
 
      const area = (OpenCV.invoke('contourArea', contour) as { value: number }).value;
      if (area <= minArea || area >= maxArea || area <= bestArea) continue;
 
      const peri = (OpenCV.invoke('arcLength', contour, true) as { value: number }).value;
      const approx = OpenCV.createObject('mat' as ObjectType.Mat, 0, 0, 0);
      ids.push(approx.id);
      
      // WARN-03 FIX: card dùng epsilon nhỏ hơn (cạnh cứng thẳng)
      const epsilons = target === 'card'
        ? [0.02, 0.03, 0.04, 0.05]
        : [0.02, 0.035, 0.05, 0.065, 0.08, 0.10, 0.13];
      let numPts = 999;
      let buf: any = null;

      for (let ei = 0; ei < epsilons.length; ei++) {
        OpenCV.invoke('approxPolyDP', contour, approx, epsilons[ei] * peri, true);
        buf = OpenCV.matToBuffer(approx, 'int32');
        numPts = buf.rows; // rows = số điểm
        if (numPts <= 4) break;
      }

      if (numPts !== 4 || !buf || buf.buffer.length < 8) continue;

      const raw: { x: number; y: number }[] = [
        { x: buf.buffer[0] / imgW, y: buf.buffer[1] / imgH },
        { x: buf.buffer[2] / imgW, y: buf.buffer[3] / imgH },
        { x: buf.buffer[4] / imgW, y: buf.buffer[5] / imgH },
        { x: buf.buffer[6] / imgW, y: buf.buffer[7] / imgH },
      ];
      raw.sort((a, b) => (a.x + a.y) - (b.x + b.y));
      const tl = raw[0];
      const br = raw[3];
      raw.sort((a, b) => (a.x - a.y) - (b.x - b.y));
      const bl = raw[0];
      const tr = raw[3];

      if (!isRectLike(tl, tr, br, bl, imgW, imgH, target)) continue;

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
  const [scanTarget, setScanTarget]           = useState<ScanTarget>('document');
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
 
  const cameraRef          = useRef<CameraRef>(null);
  const lastFocusTimeRef   = useRef<number>(0);
  const prevCornersRef     = useRef<DocCorners | null>(null);  // EMA output → dùng cho overlay
  const prevRawCornersRef  = useRef<DocCorners | null>(null);  // raw → dùng đo stability
  const lockedCornersRef   = useRef<DocCorners | null>(null);  // corners bị khóa khi stable
  const stableFrameCount   = useRef<number>(0);               // đếm frame ổn định liên tiếp
  const stableTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
 
  // Shared values
  const isActiveShared     = useSharedValue(true);
  const minAreaRatioShared = useSharedValue(0.06);
  const scanTargetShared   = useSharedValue<0 | 1>(0); // 0 = document, 1 = card
  const frameCounterShared = useSharedValue(0);
  const frameAspectShared  = useSharedValue(1);
  const fillAnim           = useSharedValue(0);
  const docMinY            = useSharedValue(0);
  const docMaxY            = useSharedValue(2000);

  // Zoom shared values (for pinch gesture on UI thread)
  const minZoom   = device?.minZoom ?? 1;
  const maxZoom   = Math.min(device?.maxZoom ?? 10, 16);
  const zoomValue = useSharedValue(device?.minZoom ?? 1);
  const startZoom = useSharedValue(1);

  useAnimatedReaction(
    () => zoomValue.value,
    (z) => runOnJS(setZoom)(z),
  );

  // Focus Ring shared values
  const tapFocusX    = useSharedValue(0);
  const tapFocusY    = useSharedValue(0);
  const focusOpacity = useSharedValue(0);
  const focusScale   = useSharedValue(1);
  const focusRingColor = useSharedValue('#34d399');
 
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

  // Sync min area ratio + scan target to worklet thread
  useEffect(() => {
    // Document: 6% (đủ nhạy), Card: 8% (tránh nhiễu nhỏ cho thẻ)
    minAreaRatioShared.value = scanTarget === 'card' ? 0.08 : 0.06;
    scanTargetShared.value   = scanTarget === 'card' ? 1 : 0;
  }, [scanTarget, minAreaRatioShared, scanTargetShared]);
 
  // Reset on mode / target change
  useEffect(() => {
    setDetectedCorners(null);
    setIsStable(false);
    setHasAutoShot(false);
    prevCornersRef.current    = null;
    prevRawCornersRef.current = null;
    lockedCornersRef.current  = null;
    stableFrameCount.current  = 0;
    cancelAnimation(fillAnim);
    fillAnim.value = 0;
    if (stableTimerRef.current) { clearTimeout(stableTimerRef.current); stableTimerRef.current = null; }
  }, [mode, scanTarget]);
 
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
  const onCornersDetected = useCallback((rawCorners: DocCorners | null, aspect: number) => {
    const prev    = prevCornersRef.current;
    const prevRaw = prevRawCornersRef.current;

    // Đo chuyển động dựa trên RAW vs RAW (chính xác hơn EMA vs RAW)
    const movedRaw = prevRaw && rawCorners ? cornersDistance(prevRaw, rawCorners) : Infinity;

    // ── Adaptive EMA ────────────────────────────────────────────────────
    // Alpha thấp = smoothing mạnh (overlay ổn định), alpha cao = bắt kịp nhanh
    //   movedRaw < 0.03 → tài liệu gần như đứng yên → alpha 0.10 (rất ổn định)
    //   movedRaw < 0.12 → chuyển động nhẹ          → alpha 0.35
    //   movedRaw >= 0.12 → chuyển động lớn         → alpha 0.75 (bắt kịp nhanh)
    let finalCorners = rawCorners;
    if (rawCorners && prev) {
      const alpha = movedRaw < 0.03 ? 0.10
                  : movedRaw < 0.12 ? 0.35
                  : 0.75;
      finalCorners = {
        tl: { x: prev.tl.x + (rawCorners.tl.x - prev.tl.x) * alpha, y: prev.tl.y + (rawCorners.tl.y - prev.tl.y) * alpha },
        tr: { x: prev.tr.x + (rawCorners.tr.x - prev.tr.x) * alpha, y: prev.tr.y + (rawCorners.tr.y - prev.tr.y) * alpha },
        br: { x: prev.br.x + (rawCorners.br.x - prev.br.x) * alpha, y: prev.br.y + (rawCorners.br.y - prev.br.y) * alpha },
        bl: { x: prev.bl.x + (rawCorners.bl.x - prev.bl.x) * alpha, y: prev.bl.y + (rawCorners.bl.y - prev.bl.y) * alpha },
      };
    }

    setFrameAspect(aspect);

    const now      = Date.now();
    const canFocus = now - lastFocusTimeRef.current > FOCUS_THROTTLE;
    const wasTracking = prev !== null;

    // ── Không có tài liệu ────────────────────────────────────────────────
    if (!finalCorners) {
      setIsStable(false);
      setDetectedCorners(null);
      lockedCornersRef.current  = null;
      stableFrameCount.current  = 0;
      prevCornersRef.current    = null;
      prevRawCornersRef.current = null;
      if (stableTimerRef.current) {
        clearTimeout(stableTimerRef.current);
        stableTimerRef.current = null;
      }
      // Focus trung tâm khi mất tài liệu (throttled)
      if (canFocus && cameraRef.current) {
        lastFocusTimeRef.current = now;
        cameraRef.current.focusTo({ x: SCREEN_W / 2, y: SCREEN_H / 2 }).catch(() => {});
      }
      return;
    }

    // ── Focus logic: 3 trường hợp ────────────────────────────────────────
    // 1. Tài liệu vừa xuất hiện lần đầu   → focus ngay (không cần throttle)
    // 2. Di chuyển lớn khi đang tracking   → refocus (throttled FOCUS_THROTTLE)
    // 3. Đang tracking ổn định             → KHÔNG focus (tránh làm nhòe ảnh)
    const bigMove = movedRaw > 0.15; // di chuyển > 15% kích thước frame
    const shouldFocus = !wasTracking || (bigMove && canFocus);

    if (shouldFocus && cameraRef.current) {
      lastFocusTimeRef.current = now;
      const { x: fx, y: fy } = getDocumentFocusPoint(finalCorners, aspect, SCREEN_W, SCREEN_H);
      const safeX = Math.max(1, Math.min(SCREEN_W - 1, fx));
      const safeY = Math.max(1, Math.min(SCREEN_H - 1, fy));
      cameraRef.current.focusTo({ x: safeX, y: safeY }).catch(() => {});
      tapFocusX.value = safeX;
      tapFocusY.value = safeY;
      focusRingColor.value = '#06b6d4'; // luôn xanh dương cho focus ring
      focusOpacity.value = 1;
      focusScale.value   = 1.4;
      focusScale.value   = withTiming(1, { duration: 350 });
      focusOpacity.value = withTiming(0, { duration: 1000 });
    }
    // ── Tracking ổn định → không gọi focusTo() ───────────────────────────

    const sc = normalizedToScreenCorners(finalCorners, aspect, SCREEN_W, SCREEN_H);
    docMinY.value = Math.min(sc.tl.y, sc.tr.y, sc.bl.y, sc.br.y);
    docMaxY.value = Math.max(sc.tl.y, sc.tr.y, sc.bl.y, sc.br.y);

    const currentlyStable = movedRaw < 0.05;

    if (currentlyStable) {
      stableFrameCount.current++;
      // Lock corners sau 3 frame ổn định liên tiếp (~1.2s ở 4fps)
      if (stableFrameCount.current >= 3) {
        if (!lockedCornersRef.current) {
          lockedCornersRef.current = finalCorners;
        }
        // Hiển thị locked corners — overlay đứng yên hoàn toàn khi stable
        setDetectedCorners(lockedCornersRef.current);
      } else {
        setDetectedCorners(finalCorners);
      }
      if (!stableTimerRef.current) {
        stableTimerRef.current = setTimeout(() => {
          setIsStable(true);
          stableTimerRef.current = null;
        }, 400);
      }
    } else {
      stableFrameCount.current  = 0;
      lockedCornersRef.current  = null;
      setDetectedCorners(finalCorners);
      setIsStable(false);
      setHasAutoShot(false);
      if (stableTimerRef.current) {
        clearTimeout(stableTimerRef.current);
        stableTimerRef.current = null;
      }
    }

    prevRawCornersRef.current = rawCorners;   // lưu raw để đo stability
    prevCornersRef.current    = finalCorners; // lưu EMA để smooth overlay
  }, [tapFocusX, tapFocusY, focusOpacity, focusScale, focusRingColor, SCREEN_W, SCREEN_H, docMinY, docMaxY]);

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
    focusRingColor.value = '#34d399';
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
        const tgt = scanTargetShared.value === 1 ? 'card' : 'document';
        const corners = detectDocument(src, frame.width, frame.height, channels, minAreaRatioShared.value, tgt);

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
          const detected = detectDocumentJS(
            srcMat, thumb.width, thumb.height, 3,
            scanTarget === 'card' ? 0.08 : 0.06,
            scanTarget,  // ✅ FIX: truyền đúng target cho JS thread
          );
 
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
  }, [photoOutput, isActive, detectedCorners, scanTarget]);  // ✅ FIX: thêm scanTarget
 
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
        onConfirm={(croppedUri) => onCapture(croppedUri, [], scanTarget)}
      />
    );
  }
 
  if (!device || !hasPermission) return <View style={ss.container} />;
 
  const targetLabel = scanTarget === 'card' ? 'thẻ' : 'tài liệu';

  return (
    <View style={ss.container}>
      <GestureDetector gesture={cameraGestures}>
        <View style={StyleSheet.absoluteFill}>
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
              : `Phát hiện ${targetLabel}…`
            : `Đang tìm ${targetLabel}…`}
        </Text>
      </View>
 
      <View style={[ss.header, { top: insets.top + 20 }]}>
        <TouchableOpacity style={ss.iconBtn} onPress={onCancel}>
          <Ionicons name="close" size={22} color="#fff" />
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 24, padding: 4 }}>
          <TouchableOpacity
            onPress={() => setMode('manual')}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 20,
              backgroundColor: mode === 'manual' ? '#e5e7eb' : 'transparent',
            }}
          >
            <Text style={{
              color: mode === 'manual' ? '#111827' : '#e5e7eb',
              fontSize: 13,
              fontWeight: '600'
            }}>Chụp thủ công</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setMode('auto')}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 20,
              backgroundColor: mode === 'auto' ? '#e5e7eb' : 'transparent',
            }}
          >
            <Text style={{
              color: mode === 'auto' ? '#111827' : '#e5e7eb',
              fontSize: 13,
              fontWeight: '600'
            }}>Tự động chụp</Text>
          </TouchableOpacity>
        </View>

        <View style={{ width: 40, alignItems: 'flex-end' }}>
          <TouchableOpacity
            style={ss.iconBtn}
            onPress={() => setTorchEnabled(t => !t)}
          >
            <Ionicons name={torchEnabled ? 'flashlight' : 'flashlight-outline'} size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
 
      <View style={[ss.targetToggle, { bottom: insets.bottom + 140 }]}>
        <TouchableOpacity
          style={[ss.targetBtn, scanTarget === 'document' && ss.targetBtnActive]}
          onPress={() => { setScanTarget('document'); setDetectedCorners(null); }}
        >
          <Text style={[ss.targetText, scanTarget === 'document' && ss.targetTextActive]}>Tài liệu</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[ss.targetBtn, scanTarget === 'card' && ss.targetBtnActive]}
          onPress={() => { setScanTarget('card'); setDetectedCorners(null); }}
        >
          <Text style={[ss.targetText, scanTarget === 'card' && ss.targetTextActive]}>Thẻ</Text>
        </TouchableOpacity>
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
            {detectedCorners ? `Nhấn để chụp ${targetLabel}` : `Đưa ${targetLabel} vào khung hình`}
          </Text>
        </View>
      )}
 
      {mode === 'auto' && (
        <View style={[ss.footer, { bottom: insets.bottom + 36 }]}>
          <Text style={ss.hint}>
            {detectedCorners
              ? isStable ? 'Giữ nguyên, đang chụp…' : 'Giữ điện thoại ổn định'
              : `Đưa ${targetLabel} vào khung hình`}
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

  targetToggle: {
    position: 'absolute', alignSelf: 'center',
    flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 20, padding: 4,
  },
  targetBtn: {
    paddingHorizontal: 20, paddingVertical: 8, borderRadius: 16,
  },
  targetBtnActive: {
    backgroundColor: '#06b6d4',
  },
  targetText: {
    color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600',
  },
  targetTextActive: {
    color: '#fff',
  },
});