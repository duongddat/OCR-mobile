import { Image, Platform } from 'react-native';

export type OcrEngine = 'backend' | 'mlkit';

type MlKitRect = {
  left: number;
  top: number;
  right?: number;
  bottom?: number;
  width?: number;
  height?: number;
};

type MlKitLine = {
  text: string;
  frame: MlKitRect;
  recognizedLanguages?: string[];
};

type MlKitBlock = {
  text: string;
  frame: MlKitRect;
  recognizedLanguages?: string[];
  lines?: MlKitLine[];
};

type MlKitRecognizeTextResult = {
  text: string;
  blocks: MlKitBlock[];
};

type MlKitTextRecognitionModule = {
  recognizeText: (imagePath: string) => Promise<MlKitRecognizeTextResult>;
};

type MlKitDocumentScannerResult = {
  canceled: boolean;
  pdf: { uri: string; pageCount: number } | null;
  pages: string[] | null;
};

type MlKitDocumentScannerModule = {
  launchDocumentScannerAsync: (options?: Record<string, unknown>) => Promise<MlKitDocumentScannerResult>;
  ResultFormatOptions: {
    JPEG: string;
  };
  ScannerModeOptions: {
    FULL: string;
  };
};

type MlKitRecognitionResult = {
  text: string;
  details: Array<{
    id: string;
    text: string;
    frame: {
      left: number;
      top: number;
      width: number;
      height: number;
    };
    recognizedLanguages: string[];
    lines: MlKitLine[];
  }>;
  imageSize: {
    width: number;
    height: number;
  };
};

function getImageSizeAsync(uri: string) {
  return new Promise<{ width: number; height: number }>((resolve) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => resolve({ width: 1, height: 1 })
    );
  });
}

function normalizeRect(frame: MlKitRect) {
  const left = Number(frame.left ?? 0);
  const top = Number(frame.top ?? 0);
  const width = Number(frame.width ?? ((frame.right ?? left) - left));
  const height = Number(frame.height ?? ((frame.bottom ?? top) - top));

  return {
    left,
    top,
    width: Math.max(width, 0),
    height: Math.max(height, 0),
  };
}

export async function recognizeTextWithMlKit(imagePath: string): Promise<MlKitRecognitionResult> {
  const module = await import('@infinitered/react-native-mlkit-text-recognition') as MlKitTextRecognitionModule;
  const result = await module.recognizeText(imagePath);
  const imageSize = await getImageSizeAsync(imagePath);

  return {
    text: result.text ?? '',
    details: (result.blocks ?? []).map((block, index) => ({
      id: `mlkit-${index}`,
      text: block.text ?? '',
      frame: normalizeRect(block.frame ?? { left: 0, top: 0, width: 0, height: 0 }),
      recognizedLanguages: block.recognizedLanguages ?? [],
      lines: block.lines ?? [],
    })),
    imageSize,
  };
}

export async function launchMlKitDocumentScanner(): Promise<MlKitDocumentScannerResult | null> {
  if (Platform.OS !== 'android') {
    return null;
  }

  const module = await import('@infinitered/react-native-mlkit-document-scanner') as MlKitDocumentScannerModule;
  return await module.launchDocumentScannerAsync({
    pageLimit: 1,
    galleryImportAllowed: false,
    scannerMode: module.ScannerModeOptions.FULL,
    resultFormats: module.ResultFormatOptions.JPEG,
  });
}
