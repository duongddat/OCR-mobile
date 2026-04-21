import {
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ACCENT } from "./styles";

type Props = {
  insetsTop: number;
  requestPermission: () => void;
};

const bullets = [
  "Quét tài liệu trực tiếp bằng camera",
  "Căn khung nhanh và rõ hơn",
  "Trích xuất văn bản sau khi chụp",
];

export default function PermissionScreen({
  insetsTop,
  requestPermission,
}: Props) {
  return (
    <View style={[s.root, { paddingTop: insetsTop + 20 }]}>
      <StatusBar barStyle="light-content" />

      <View style={s.glow} />

      <View style={s.heroCard}>
        <View style={s.iconWrap}>
          <View style={s.iconInner}>
            <Ionicons name="scan" size={44} color={ACCENT} />
          </View>
        </View>

        <View style={s.badge}>
          <Ionicons name="shield-checkmark-outline" size={14} color={ACCENT} />
          <Text style={s.badgeText}>QUYỀN TRUY CẬP AN TOÀN</Text>
        </View>

        <Text style={s.title}>Cho phép camera để bắt đầu quét</Text>
        <Text style={s.subtitle}>
          Ứng dụng cần camera để chụp tài liệu, căn viền và nhận dạng văn bản
          chính xác hơn.
        </Text>

        <View style={s.featureList}>
          {bullets.map((item) => (
            <View key={item} style={s.featureItem}>
              <View style={s.featureDot}>
                <Ionicons name="checkmark" size={12} color="#081016" />
              </View>
              <Text style={s.featureText}>{item}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={s.primaryBtn}
          onPress={requestPermission}
          activeOpacity={0.9}
        >
          <Ionicons name="camera-outline" size={20} color="#081016" />
          <Text style={s.primaryBtnText}>Cho phép truy cập</Text>
        </TouchableOpacity>

        <Text style={s.helperText}>
          Bạn chỉ cần cấp quyền một lần. Có thể thay đổi lại trong phần cài đặt
          thiết bị.
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#09090b",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  glow: {
    position: "absolute",
    top: 120,
    left: "20%",
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(6,182,212,0.12)",
    transform: [{ scaleX: 1.1 }],
  },
  heroCard: {
    backgroundColor: "rgba(24,24,27,0.96)",
    borderRadius: 30,
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
  iconWrap: {
    alignSelf: "center",
    width: 108,
    height: 108,
    borderRadius: 30,
    backgroundColor: "rgba(6,182,212,0.1)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(6,182,212,0.22)",
  },
  iconInner: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: "rgba(6,182,212,0.16)",
    justifyContent: "center",
    alignItems: "center",
  },
  badge: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(6,182,212,0.1)",
    borderWidth: 1,
    borderColor: "rgba(6,182,212,0.2)",
  },
  badgeText: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  title: {
    color: "#fff",
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 12,
  },
  subtitle: {
    color: "#a1a1aa",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 23,
    marginBottom: 22,
  },
  featureList: {
    gap: 12,
    marginBottom: 24,
  },
  featureItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  featureDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: ACCENT,
    justifyContent: "center",
    alignItems: "center",
  },
  featureText: {
    flex: 1,
    color: "#f4f4f5",
    fontSize: 14,
    fontWeight: "600",
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: ACCENT,
    borderRadius: 18,
    paddingVertical: 17,
    shadowColor: ACCENT,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  primaryBtnText: {
    color: "#081016",
    fontSize: 16,
    fontWeight: "800",
  },
  helperText: {
    color: "rgba(161,161,170,0.82)",
    fontSize: 12.5,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 16,
  },
});
