import React, { useState, useCallback } from 'react';
import {
  StyleSheet, Text, View, FlatList, Image,
  TouchableOpacity, Alert, StatusBar, Modal,
  ScrollView, Clipboard,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { loadHistory, deleteRecord, clearHistory, formatDate, ScanRecord } from '@/utils/history';

const ACCENT = '#06b6d4';
const BG = '#09090b';
const SURFACE = '#18181b';
const BORDER = 'rgba(255,255,255,0.08)';

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const [records, setRecords] = useState<ScanRecord[]>([]);
  const [selected, setSelected] = useState<ScanRecord | null>(null);
  const [copied, setCopied] = useState(false);

  // Tải lại mỗi khi tab được focus
  useFocusEffect(
    useCallback(() => {
      loadHistory().then(setRecords);
    }, [])
  );

  const handleDelete = (id: string) => {
    Alert.alert('Xoá bản ghi', 'Bạn có chắc muốn xoá bản ghi này không?', [
      { text: 'Huỷ', style: 'cancel' },
      {
        text: 'Xoá',
        style: 'destructive',
        onPress: async () => {
          const updated = await deleteRecord(id);
          setRecords(updated);
        },
      },
    ]);
  };

  const handleClearAll = () => {
    Alert.alert('Xoá tất cả', 'Bạn có muốn xoá toàn bộ lịch sử quét không?', [
      { text: 'Huỷ', style: 'cancel' },
      {
        text: 'Xoá tất cả',
        style: 'destructive',
        onPress: async () => {
          await clearHistory();
          setRecords([]);
        },
      },
    ]);
  };

  const copyText = (text: string) => {
    Clipboard.setString(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderItem = ({ item }: { item: ScanRecord }) => (
    <TouchableOpacity style={styles.card} onPress={() => setSelected(item)} activeOpacity={0.75}>
      {/* Thumbnail */}
      {item.isPdf ? (
        <View style={[styles.thumb, { backgroundColor: 'rgba(248,113,113,0.1)', justifyContent: 'center', alignItems: 'center' }]}>
           <Ionicons name="document-text" size={32} color="#f87171" />
        </View>
      ) : (
        <Image source={{ uri: item.imageUri }} style={styles.thumb} resizeMode="cover" />
      )}

      {/* Info */}
      <View style={styles.cardInfo}>
        <Text style={styles.cardText} numberOfLines={3}>{item.text || '(Không có văn bản)'}</Text>
        <View style={styles.cardMeta}>
          <View style={styles.metaChip}>
            <Ionicons name="text-outline" size={11} color={ACCENT} />
            <Text style={styles.metaText}>{item.wordCount} từ</Text>
          </View>
          <View style={styles.metaChip}>
            <Ionicons name="time-outline" size={11} color="rgba(161,161,170,0.6)" />
            <Text style={[styles.metaText, { color: 'rgba(161,161,170,0.6)' }]}>{formatDate(item.createdAt)}</Text>
          </View>
        </View>
      </View>

      {/* Delete */}
      <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="trash-outline" size={18} color="rgba(239,68,68,0.7)" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerDot} />
          <Text style={styles.headerTitle}>Lịch Sử</Text>
        </View>
        {records.length > 0 && (
          <TouchableOpacity onPress={handleClearAll} style={styles.clearBtn}>
            <Ionicons name="trash" size={14} color="rgba(239,68,68,0.8)" />
            <Text style={styles.clearBtnText}>Xoá tất cả</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* List */}
      {records.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name="time-outline" size={48} color="rgba(6,182,212,0.4)" />
          </View>
          <Text style={styles.emptyTitle}>Chưa có lịch sử</Text>
          <Text style={styles.emptySubtitle}>Các lần quét của bạn sẽ xuất hiện ở đây</Text>
        </View>
      ) : (
        <FlatList
          data={records}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 90 }}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}

      {/* Detail Modal */}
      <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelected(null)}>
        {selected && (
          <View style={styles.modal}>
            <StatusBar barStyle="light-content" />

            {/* Modal Header */}
            <View style={[styles.modalHeader, { paddingTop: insets.top + 12 }]}>
              <TouchableOpacity onPress={() => setSelected(null)} style={styles.modalClose}>
                <Ionicons name="chevron-down" size={22} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Chi tiết</Text>
              <TouchableOpacity onPress={() => copyText(selected.text)} style={styles.copyBtn}>
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={copied ? '#22c55e' : ACCENT} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 20 }} showsVerticalScrollIndicator={false}>
              {/* Image / PDF Preview */}
              {selected.isPdf ? (
                <View style={[styles.modalImage, { backgroundColor: 'rgba(248,113,113,0.05)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(248,113,113,0.2)' }]}>
                  <Ionicons name="document-text" size={64} color="#f87171" />
                  <Text style={{ color: '#f87171', marginTop: 12, fontSize: 16, fontWeight: '600' }}>Tài Liệu PDF</Text>
                </View>
              ) : (
                <Image source={{ uri: selected.imageUri }} style={styles.modalImage} resizeMode="contain" />
              )}

              {/* Meta */}
              <View style={styles.modalMeta}>
                <View style={styles.metaChip}>
                  <Ionicons name="time-outline" size={13} color={ACCENT} />
                  <Text style={[styles.metaText, { fontSize: 13 }]}>{formatDate(selected.createdAt)}</Text>
                </View>
                <View style={styles.metaChip}>
                  <Ionicons name="text-outline" size={13} color={ACCENT} />
                  <Text style={[styles.metaText, { fontSize: 13 }]}>{selected.wordCount} từ</Text>
                </View>
              </View>

              {/* Text */}
              <View style={styles.modalTextCard}>
                <Text style={styles.modalText}>{selected.text || '(Không có văn bản)'}</Text>
              </View>

              {/* Actions */}
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.actionPrimary} onPress={() => copyText(selected.text)}>
                  <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color="#fff" />
                  <Text style={styles.actionText}>{copied ? 'Đã Copy!' : 'Sao Chép'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionDanger}
                  onPress={() => {
                    setSelected(null);
                    setTimeout(() => handleDelete(selected.id), 300);
                  }}
                >
                  <Ionicons name="trash-outline" size={18} color="#fff" />
                  <Text style={styles.actionText}>Xoá</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: ACCENT,
    shadowColor: ACCENT, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
  clearBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)',
    backgroundColor: 'rgba(239,68,68,0.07)',
  },
  clearBtnText: { color: 'rgba(239,68,68,0.8)', fontSize: 13, fontWeight: '600' },

  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon: {
    width: 100, height: 100, borderRadius: 28,
    backgroundColor: 'rgba(6,182,212,0.08)', borderWidth: 1, borderColor: 'rgba(6,182,212,0.15)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 20,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: '#a1a1aa', textAlign: 'center', lineHeight: 20 },

  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: SURFACE, borderRadius: 16,
    borderWidth: 1, borderColor: BORDER,
    overflow: 'hidden', padding: 12, gap: 12,
  },
  thumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: '#000' },
  cardInfo: { flex: 1 },
  cardText: { color: '#e4e4e7', fontSize: 14, lineHeight: 20, marginBottom: 8 },
  cardMeta: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { color: ACCENT, fontSize: 11, fontWeight: '500' },
  deleteBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: 'rgba(239,68,68,0.07)',
    justifyContent: 'center', alignItems: 'center',
  },

  modal: { flex: 1, backgroundColor: '#0c0c0f' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  modalClose: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    justifyContent: 'center', alignItems: 'center',
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  copyBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(6,182,212,0.1)',
    justifyContent: 'center', alignItems: 'center',
  },
  modalImage: { width: '100%', height: 220, borderRadius: 16, backgroundColor: '#111', marginBottom: 14 },
  modalMeta: { flexDirection: 'row', gap: 10, marginBottom: 14, flexWrap: 'wrap' },
  modalTextCard: {
    backgroundColor: SURFACE, borderRadius: 16,
    borderWidth: 1, borderColor: BORDER,
    padding: 16, marginBottom: 16,
  },
  modalText: { color: '#f4f4f5', fontSize: 16, lineHeight: 28 },
  modalActions: { flexDirection: 'row', gap: 12 },
  actionPrimary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: ACCENT, paddingVertical: 14, borderRadius: 14,
  },
  actionDanger: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(239,68,68,0.15)', paddingVertical: 14, borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
  },
  actionText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
