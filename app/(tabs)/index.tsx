import { useRef, useState } from 'react';
import { View, Text, StatusBar, Alert, Clipboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCameraPermissions } from 'expo-camera';
import type { CameraView as CameraViewType } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import Constants, { ExecutionEnvironment } from 'expo-constants';

import { saveToHistory } from '@/utils/history';
import { styles } from '@/components/scanner/styles';

import PermissionScreen from '@/components/scanner/PermissionScreen';
import DashboardMenu from '@/components/scanner/DashboardMenu';
import LegacyCamera from '@/components/scanner/LegacyCamera';
import ProcessingScreen from '@/components/scanner/ProcessingScreen';
import ResultScreen from '@/components/scanner/ResultScreen';

// Nhập thử thư viện Native (sẽ null trên Expo Go)
let DocumentScanner: any = null;
try {
  DocumentScanner = require('react-native-document-scanner-plugin').default;
} catch (e) {
  console.log('Không thể tải DocumentScanner Native (Expo Go)');
}

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export default function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraViewType>(null);
  const insets = useSafeAreaInsets();

  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrText, setOcrText] = useState('');
  const [ocrDetails, setOcrDetails] = useState<any[]>([]);
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  
  const [isPdf, setIsPdf] = useState(false);
  const [pdfFileName, setPdfFileName] = useState('');
  const [totalPages, setTotalPages] = useState(0);

  const [useLegacyCamera, setUseLegacyCamera] = useState(false);

  if (!permission) return <View style={{ flex: 1, backgroundColor: styles.root.backgroundColor }} />;
  if (!permission.granted) {
    return <PermissionScreen insetsTop={insets.top} requestPermission={requestPermission} />;
  }

  const startDocumentScanner = async () => {
    if (isExpoGo || !DocumentScanner) {
      Alert.alert(
        "Chế Độ Expo Go",
        "Trình Quét AI (Document Scanner) sử dụng chức năng Native, không thể chạy trên Expo Go. Bạn có muốn sử dụng Camera thường để test tạm không?",
        [
          { text: "Hủy", style: "cancel" },
          { text: "Mở Camera Thường", onPress: () => setUseLegacyCamera(true) }
        ]
      );
      return;
    }

    try {
      const { scannedImages } = await DocumentScanner.scanDocument({
        croppedImageQuality: 100,
        letUserAdjustCrop: true,
      });

      if (scannedImages && scannedImages.length > 0) {
        setCapturedImage(scannedImages[0]);
        uploadToServer(scannedImages[0]);
      }
    } catch (error) {
      console.error(error);
      Alert.alert("Lỗi", "Không thể khởi động trình quét tài liệu Native.");
    }
  };

  const takeLegacyPicture = async () => {
    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 1.0, skipProcessing: false, exif: false,
        });
        setUseLegacyCamera(false);
        setCapturedImage(photo.uri);
        uploadToServer(photo.uri);
      } catch (e) {
        console.error('Camera Error:', e);
      }
    }
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images', quality: 1,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setUseLegacyCamera(false);
        const uri = result.assets[0].uri;
        setCapturedImage(uri);
        setIsPdf(false);
        uploadToServer(uri, false);
      }
    } catch (e) {
      console.error('Image Picker Error:', e);
    }
  };

  const pickPdf = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setUseLegacyCamera(false);
        setCapturedImage(null);
        setIsPdf(true);
        setPdfFileName(asset.name);
        setTotalPages(0);
        uploadToServer(asset.uri, true, asset.name);
      }
    } catch (e) {
      console.error('Document Picker Error:', e);
      Alert.alert('Lỗi', 'Không thể chọn file PDF.');
    }
  };

  const uploadToServer = async (uri: string, isPdfFlag = false, originalName?: string) => {
    setIsProcessing(true);
    setOcrText('');
    setTotalPages(0);
    try {
      const filename = originalName ?? (uri.split('/').pop() ?? 'file.jpg');
      const type     = isPdfFlag ? 'application/pdf'
                                 : (() => { const m = /\.(\w+)$/.exec(filename); return m ? `image/${m[1]}` : 'image/jpeg'; })();

      const formData = new FormData();
      formData.append('file', { uri, name: filename, type } as unknown as Blob);

      const protocol = process.env.EXPO_PUBLIC_API_PROTOCOL ?? 'https';
      const host     = process.env.EXPO_PUBLIC_API_HOST ?? 'apiocr.aulacsoft.com';
      const port     = process.env.EXPO_PUBLIC_API_PORT ?? '443';

      if (!host) {
        setOcrText('⚠️ Chưa cấu hình API.\nHãy tạo file .env và điền EXPO_PUBLIC_API_HOST.');
        setIsProcessing(false);
        return;
      }

      const portPart = (port && port !== '80' && port !== '443') ? `:${port}` : '';
      const API_URL = `${protocol}://${host}${portPart}/api/extract-text`;

      const response = await fetch(API_URL, {
        method: 'POST',
        body: formData,
      });

      const json = await response.json();
      if (json.status === 'success') {
        setOcrText(json.text);
        setOcrDetails(json.details ?? []);
        setImageSize(json.imageSize ?? { width: 1, height: 1 });
        if (json.pages) setTotalPages(json.pages);
        if (json.pdfPreviewBase64) {
          setCapturedImage(`data:image/jpeg;base64,${json.pdfPreviewBase64}`);
        }
        await saveToHistory(uri, json.text, isPdfFlag);
      } else {
        setOcrText('Lỗi: ' + (json.message ?? 'Không nhận dạng được văn bản.'));
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      setOcrText(`Lỗi kết nối: Không thể truy cập Backend.\nChi tiết: ${errorMessage}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const resetScanner = () => {
    setCapturedImage(null);
    setOcrText('');
    setOcrDetails([]);
    setCopied(false);
    setUseLegacyCamera(false);
    setIsPdf(false);
    setPdfFileName('');
    setTotalPages(0);
  };

  const copyText = () => {
    Clipboard.setString(ocrText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerLeft}>
          <View style={styles.headerDot} />
          <Text style={styles.headerTitle}>AI ScanDoc</Text>
        </View>
        <Text style={styles.headerBadge}>DEEPMIND</Text>
      </View>

      <View style={styles.content}>
        
        {/* STATE 0: DASHBOARD MENU (When not capturing) */}
        {!capturedImage && !useLegacyCamera && !isPdf && (
          <DashboardMenu 
            startDocumentScanner={startDocumentScanner}
            pickImage={pickImage}
            pickPdf={pickPdf}
            openLegacyCamera={() => setUseLegacyCamera(true)}
            isExpoGo={isExpoGo}
          />
        )}

        {/* STATE 1 — Legacy Camera (For Expo Go) */}
        {!capturedImage && useLegacyCamera && !isPdf && (
           <LegacyCamera 
             insetsBottom={insets.bottom}
             cameraRef={cameraRef}
             facing={facing}
             setFacing={setFacing}
             closeLegacyCamera={() => setUseLegacyCamera(false)}
             takeLegacyPicture={takeLegacyPicture}
             pickImage={pickImage}
             pickPdf={pickPdf}
           />
        )}

        {/* STATE 2 — Processing */}
        {(capturedImage || isPdf) && isProcessing && (
           <ProcessingScreen capturedImage={capturedImage} isPdf={isPdf} />
        )}

        {/* STATE 3 — Results */}
        {(capturedImage || isPdf) && !isProcessing && ocrText !== '' && (
           <ResultScreen 
             insetsBottom={insets.bottom}
             isPdf={isPdf}
             pdfFileName={pdfFileName}
             totalPages={totalPages}
             capturedImage={capturedImage}
             imageSize={imageSize}
             ocrDetails={ocrDetails}
             ocrText={ocrText}
             setOcrText={setOcrText}
             copied={copied}
             copyText={copyText}
             resetScanner={resetScanner}
           />
        )}
      </View>
    </View>
  );
}
