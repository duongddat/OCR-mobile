import { StyleSheet, Dimensions } from 'react-native';

const { width: SCREEN_W } = Dimensions.get('window');

export const ACCENT = '#06b6d4';
export const BG = '#09090b';
export const SURFACE = '#18181b';
export const BORDER = 'rgba(255,255,255,0.08)';

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: BORDER, backgroundColor: BG, zIndex: 10,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: ACCENT, shadowColor: ACCENT, shadowOpacity: 0.9, shadowRadius: 6 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
  headerBadge: {
    fontSize: 10, fontWeight: '700', color: ACCENT, letterSpacing: 2.5,
    backgroundColor: 'rgba(6,182,212,0.1)', paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(6,182,212,0.25)',
  },

  content: { flex: 1 },

  // Dashboard GUI
  dashboardWrap: {
    flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24,
    paddingTop: 40, paddingBottom: 100,
  },
  dashboardIconWrap: {
    width: 130, height: 130, borderRadius: 36,
    backgroundColor: 'rgba(6,182,212,0.1)', borderWidth: 1, borderColor: 'rgba(6,182,212,0.2)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 24,
    shadowColor: ACCENT, shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: 10 },
  },
  dashboardTitle: { color: '#fff', fontSize: 26, fontWeight: '800', marginBottom: 12, textAlign: 'center' },
  dashboardDesc: { color: '#a1a1aa', fontSize: 16, textAlign: 'center', lineHeight: 24, marginBottom: 40 },
  scanActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: ACCENT, paddingVertical: 18, paddingHorizontal: 32,
    borderRadius: 20, width: '100%', justifyContent: 'center',
    shadowColor: ACCENT, shadowOpacity: 0.4, shadowRadius: 15, shadowOffset: { width: 0, height: 5 },
  },
  scanActionText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  secondaryActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 20, paddingVertical: 10, paddingHorizontal: 20,
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12,
  },
  secondaryActionText: { color: '#a1a1aa', fontSize: 15, fontWeight: '600' },
  
  expoWarning: {
    marginTop: 40, padding: 16, backgroundColor: 'rgba(251,191,36,0.1)',
    borderWidth: 1, borderColor: 'rgba(251,191,36,0.2)', borderRadius: 12,
  },
  expoWarningText: { color: '#fcd34d', fontSize: 13, lineHeight: 20 },

  // Permission
  permScreen: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  permIcon: { width: 100, height: 100, borderRadius: 28, backgroundColor: 'rgba(6,182,212,0.1)', borderWidth: 1, borderColor: 'rgba(6,182,212,0.2)', justifyContent: 'center', alignItems: 'center', marginBottom: 28 },
  permTitle: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 12, textAlign: 'center' },
  message: { color: '#a1a1aa', fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 36 },
  permBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: ACCENT, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 32 },
  permBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Camera
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  zoomControls: { position: 'absolute', right: 16, top: '40%', transform: [{ translateY: -75 }], backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 30, paddingVertical: 12, paddingHorizontal: 6, alignItems: 'center', gap: 12 },
  zoomBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  zoomTextContainer: { paddingVertical: 4 },
  zoomText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  camControls: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingTop: 20, backgroundColor: 'rgba(0,0,0,0.55)' },
  ctrlBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  shutter: { alignItems: 'center', justifyContent: 'center' },
  shutterRing: { width: 78, height: 78, borderRadius: 39, borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)', justifyContent: 'center', alignItems: 'center', shadowColor: '#fff', shadowOpacity: 0.3, shadowRadius: 10 },
  shutterCore: { width: 62, height: 62, borderRadius: 31, backgroundColor: ACCENT, shadowColor: ACCENT, shadowOpacity: 0.7, shadowRadius: 12 },

  // Processing
  processingWrap: { flex: 1 },
  blurBg: { ...StyleSheet.absoluteFillObject, opacity: 0.35 },
  processingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(9,9,11,0.6)' },
  processingCard: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  pulseOuter: { width: 110, height: 110, borderRadius: 32, backgroundColor: 'rgba(6,182,212,0.12)', borderWidth: 1, borderColor: 'rgba(6,182,212,0.25)', justifyContent: 'center', alignItems: 'center' },
  pulseInner: { width: 78, height: 78, borderRadius: 22, backgroundColor: 'rgba(6,182,212,0.18)', justifyContent: 'center', alignItems: 'center' },
  processingTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 20, letterSpacing: 0.3 },
  processingSubtitle: { color: '#a1a1aa', fontSize: 14, marginTop: 6 },

  // Results
  resultWrap: { flex: 1, backgroundColor: BG },
  scroll: { flex: 1 },
  imgCard: { margin: 16, borderRadius: 20, overflow: 'hidden', backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER },
  bbox: { position: 'absolute', borderWidth: 1.5, borderColor: ACCENT, backgroundColor: 'rgba(6, 182, 212, 0.15)', borderRadius: 2 },
  imgBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12, borderTopWidth: 1, borderTopColor: BORDER },
  imgBadgeText: { color: ACCENT, fontSize: 13, fontWeight: '600' },
  textCard: { marginHorizontal: 16, marginBottom: 16, backgroundColor: SURFACE, borderRadius: 20, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  textCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: BORDER },
  textCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  textCardTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(6,182,212,0.1)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(6,182,212,0.2)' },
  copyBtnText: { color: ACCENT, fontSize: 13, fontWeight: '600' },
  textInput: { color: '#f4f4f5', fontSize: 16.5, lineHeight: 28, padding: 16, minHeight: 200 },

  actionBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 14, backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER },
  actionBtnSecondary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.08)', paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: BORDER },
  actionBtnPrimary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: ACCENT, paddingVertical: 14, borderRadius: 14, shadowColor: ACCENT, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  actionBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // PDF
  pdfActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 12, paddingVertical: 10, paddingHorizontal: 20,
    backgroundColor: 'rgba(248,113,113,0.08)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(248,113,113,0.2)',
  },
  pdfActionText: { color: '#f87171', fontSize: 15, fontWeight: '600' },
  pdfPreviewCard: {
    alignItems: 'center', justifyContent: 'center', padding: 40,
    width: '100%', gap: 12,
  },
  pdfPreviewName: { color: '#a1a1aa', fontSize: 14, textAlign: 'center', paddingHorizontal: 16 },
  pdfPageBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(248,113,113,0.1)', paddingHorizontal: 12,
    paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(248,113,113,0.2)',
  },
  pdfPageBadgeText: { color: '#f87171', fontSize: 13, fontWeight: '600' },
});
