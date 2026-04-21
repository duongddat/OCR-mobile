import React from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ACCENT } from "./styles";

type Props = {
  isPdf?: boolean;
  message?: string;
};

export default function ProcessingScreen({ isPdf = false, message }: Props) {
  return (
    <View style={s.root}>
      <View style={s.glowPrimary} />
      <View style={s.glowSecondary} />

      <View style={s.card}>
        <View style={s.badge}>
          <Ionicons
            name={isPdf ? "document-text-outline" : "scan-outline"}
            size={14}
            color={ACCENT}
          />
          <Text style={s.badgeText}>
            {isPdf ? "ĐANG PHÂN TÍCH PDF" : "ĐANG PHÂN TÍCH ẢNH"}
          </Text>
        </View>

        <View style={s.iconWrap}>
          <View style={s.iconInner}>
            <Ionicons
              name={isPdf ? "document-text" : "sparkles"}
              size={38}
              color={ACCENT}
            />
          </View>
        </View>

        <ActivityIndicator size="large" color={ACCENT} style={s.loader} />

        <Text style={s.title}>Đang xử lý tài liệu</Text>
        <Text style={s.subtitle}>
          {message ??
            "Hệ thống đang nhận dạng văn bản, căn bố cục và chuẩn bị kết quả hiển thị."}
        </Text>

        <View style={s.stepList}>
          <View style={s.stepItem}>
            <View style={s.stepIcon}>
              <Ionicons name="image-outline" size={16} color={ACCENT} />
            </View>
            <Text style={s.stepText}>Chuẩn hóa ảnh đầu vào</Text>
          </View>
          <View style={s.stepItem}>
            <View style={s.stepIcon}>
              <Ionicons name="text-outline" size={16} color={ACCENT} />
            </View>
            <Text style={s.stepText}>Trích xuất văn bản OCR</Text>
          </View>
          <View style={s.stepItem}>
            <View style={s.stepIcon}>
              <Ionicons name="layers-outline" size={16} color={ACCENT} />
            </View>
            <Text style={s.stepText}>Sắp xếp kết quả để xem nhanh</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#09090b",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  glowPrimary: {
    position: "absolute",
    top: 110,
    width: 260,
    height: 260,
    borderRadius: 999,
    backgroundColor: "rgba(6,182,212,0.12)",
  },
  glowSecondary: {
    position: "absolute",
    bottom: 100,
    right: -40,
    width: 180,
    height: 180,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "rgba(24,24,27,0.94)",
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(6,182,212,0.1)",
    borderWidth: 1,
    borderColor: "rgba(6,182,212,0.18)",
    marginBottom: 18,
  },
  badgeText: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  iconWrap: {
    width: 118,
    height: 118,
    borderRadius: 34,
    backgroundColor: "rgba(6,182,212,0.1)",
    borderWidth: 1,
    borderColor: "rgba(6,182,212,0.22)",
    justifyContent: "center",
    alignItems: "center",
  },
  iconInner: {
    width: 82,
    height: 82,
    borderRadius: 24,
    backgroundColor: "rgba(6,182,212,0.16)",
    justifyContent: "center",
    alignItems: "center",
  },
  loader: {
    marginTop: 24,
    marginBottom: 18,
  },
  title: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  subtitle: {
    color: "#a1a1aa",
    fontSize: 15,
    lineHeight: 23,
    marginTop: 10,
    textAlign: "center",
  },
  stepList: {
    width: "100%",
    gap: 10,
    marginTop: 24,
  },
  stepItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  stepIcon: {
    width: 32,
    height: 32,
    borderRadius: 12,
    backgroundColor: "rgba(6,182,212,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: {
    flex: 1,
    color: "#f4f4f5",
    fontSize: 14,
    fontWeight: "600",
  },
});
