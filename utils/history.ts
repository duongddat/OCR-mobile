import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OcrEngine } from './mlkit';

const HISTORY_KEY = 'ocr_scan_history';
const MAX_ITEMS = 50; // Giữ tối đa 50 bản ghi

export interface ScanRecord {
  id: string;
  imageUri: string;
  text: string;
  wordCount: number;
  createdAt: string; // ISO string
  isPdf?: boolean;
  ocrDetails?: any[];
  imageSize?: { width: number; height: number };
  ocrEngine?: OcrEngine;
}

let memoryStorage: ScanRecord[] | null = null;

export async function saveToHistory(
  imageUri: string,
  text: string,
  isPdf: boolean = false,
  ocrDetails: any[] = [],
  imageSize: { width: number; height: number } = { width: 1, height: 1 },
  ocrEngine: OcrEngine = 'backend'
): Promise<void> {
  try {
    const existing = await loadHistory();
    const record: ScanRecord = {
      id: Date.now().toString(),
      imageUri,
      text,
      wordCount: text.trim().split(/\s+/).filter(Boolean).length,
      createdAt: new Date().toISOString(),
      isPdf,
      ocrDetails,
      imageSize,
      ocrEngine,
    };
    const updated = [record, ...existing].slice(0, MAX_ITEMS);

    // try AsyncStorage first
    try {
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn('Lỗi lưu AsyncStorage, chuyển sang lưu tạm thời:', e);
      memoryStorage = updated;
    }
  } catch (e) {
    console.error('Lỗi lưu lịch sử:', e);
  }
}

export async function loadHistory(): Promise<ScanRecord[]> {
  try {
    if (memoryStorage) return memoryStorage;

    try {
      const raw = await AsyncStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn('Lỗi đọc AsyncStorage, trả về rỗng:', e);
      return [];
    }
  } catch {
    return [];
  }
}

export async function deleteRecord(id: string): Promise<ScanRecord[]> {
  try {
    const existing = await loadHistory();
    const updated = existing.filter((r) => r.id !== id);
    try {
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    } catch (e) {
      memoryStorage = updated;
    }
    return updated;
  } catch {
    return [];
  }
}

export async function clearHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(HISTORY_KEY);
  } catch (e) {}
  memoryStorage = null;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
